import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { validateGitHubUrl } from '@/lib/validation/url';
import { UniversalIngestionService } from '@/lib/ai/universal_ingestion';
import { checkRateLimit } from '@/lib/security/rate_limit';

// Reads live database state: must never be prerendered/cached at build time
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';

    let sql = `
      SELECT 
        r.id,
        r.owner,
        r.name,
        r.url,
        r.description,
        r.stars,
        r.primary_language as "primaryLanguage",
        r.status,
        r.license,
        r.default_branch as "defaultBranch",
        r.latest_commit_hash as "latestCommitHash",
        r.updated_at as "updatedAt",
        COUNT(DISTINCT rc.id)::int as "capabilitiesCount",
        ARRAY_AGG(DISTINCT c.slug) FILTER (WHERE c.slug IS NOT NULL) as "capabilitySlugs"
      FROM repositories r
      LEFT JOIN repository_capabilities rc ON r.id = rc.repository_id
      LEFT JOIN capabilities c ON rc.capability_id = c.id
    `;

    const params: any[] = [];
    if (search) {
      sql += ` WHERE r.name ILIKE $1 OR r.owner ILIKE $1 OR r.description ILIKE $1`;
      params.push(`%${search}%`);
    }

    sql += ` GROUP BY r.id ORDER BY r.created_at DESC`;

    const res = await query(sql, params);
    return NextResponse.json({ items: res.rows });
  } catch (error: any) {
    console.error('Error fetching repositories:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Rate limit: 10 repository ingestion requests per minute per IP
  const rateLimit = checkRateLimit(req, 'submit_repo', { maxRequests: 10, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  try {
    const body = await req.json();
    const { url } = body;

    const validation = validateGitHubUrl(url);
    if (!validation.valid || !validation.canonicalUrl) {
      return NextResponse.json({ error: validation.error || 'Invalid URL' }, { status: 400 });
    }

    // Same path as "Add resource": creates the resource + repository rows, enforces the size limit,
    // and queues the job atomically. (This endpoint used to insert a repository without a resource row,
    // which left it invisible to search.)
    const result = await UniversalIngestionService.ingestResource(validation.canonicalUrl);
    if (!result.resourceId) {
      const status = /REPOSITORY_NOT_FOUND/.test(result.errorMessage || '') ? 404
        : /PRIVATE_REPOSITORY|ACCESS_FORBIDDEN/.test(result.errorMessage || '') ? 403
        : /REPOSITORY_TOO_LARGE/.test(result.errorMessage || '') ? 413
        : /GITHUB_UNAVAILABLE|GITHUB_RATE_LIMITED/.test(result.errorMessage || '') ? 503
        : 400;
      return NextResponse.json({ error: result.errorMessage || 'Repository could not be queued' }, { status });
    }

    const repoRes = await query('SELECT id FROM repositories WHERE resource_id = $1 ORDER BY updated_at DESC LIMIT 1', [result.resourceId]);
    return NextResponse.json({
      repositoryId: repoRes.rows[0]?.id ?? null,
      resourceId: result.resourceId,
      jobId: result.jobId ?? null,
      status: result.status,
      alreadyExists: result.alreadyExists,
      alreadyProcessing: result.alreadyProcessing
    }, { status: result.alreadyExists ? 200 : 202 });
  } catch (error: any) {
    console.error('Error submitting repository:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
