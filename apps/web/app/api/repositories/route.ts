import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { validateGitHubUrl } from '@/lib/validation/url';
import { GitHubClient } from '@/lib/github/client';
import { checkRateLimit } from '@/lib/security/rate_limit';

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

    // 1. Strict URL validation
    const validation = validateGitHubUrl(url);
    if (!validation.valid || !validation.owner || !validation.repo) {
      return NextResponse.json({ error: validation.error || 'Invalid URL' }, { status: 400 });
    }

    const { owner, repo, canonicalUrl } = validation;

    // 2. GitHub Pre-flight verification
    const ghClient = new GitHubClient();
    let meta;
    try {
      meta = await ghClient.fetchMetadata(owner, repo);
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.startsWith('REPOSITORY_NOT_FOUND')) {
        return NextResponse.json({ error: msg, code: 'REPOSITORY_NOT_FOUND' }, { status: 404 });
      }
      if (msg.startsWith('PRIVATE_REPOSITORY')) {
        return NextResponse.json({ error: msg, code: 'PRIVATE_REPOSITORY' }, { status: 403 });
      }
      if (msg.startsWith('REPOSITORY_TOO_LARGE')) {
        return NextResponse.json({ error: msg, code: 'REPOSITORY_TOO_LARGE' }, { status: 413 });
      }
      // If GitHub is unreachable or rate limited, fallback to basic record creation with warning
      console.warn('GitHub pre-flight check warning:', err.message);
      meta = {
        owner,
        name: repo,
        description: null,
        defaultBranch: 'main',
        stars: 0,
        license: null,
        primaryLanguage: null,
        sizeKb: 0,
        commitSha: null
      };
    }

    // 3. Create or update repository record
    const repoRes = await query(`
      INSERT INTO repositories (owner, name, url, description, default_branch, stars, license, primary_language, latest_commit_hash, status, error_message, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', NULL, NOW())
      ON CONFLICT (owner, name) DO UPDATE
      SET description = COALESCE(EXCLUDED.description, repositories.description),
          default_branch = EXCLUDED.default_branch,
          stars = EXCLUDED.stars,
          license = COALESCE(EXCLUDED.license, repositories.license),
          primary_language = COALESCE(EXCLUDED.primary_language, repositories.primary_language),
          latest_commit_hash = COALESCE(EXCLUDED.latest_commit_hash, repositories.latest_commit_hash),
          status = 'PENDING',
          error_message = NULL,
          updated_at = NOW()
      RETURNING id, owner, name, status;
    `, [
      meta.owner,
      meta.name,
      canonicalUrl,
      meta.description,
      meta.defaultBranch,
      meta.stars,
      meta.license,
      meta.primaryLanguage,
      meta.commitSha
    ]);

    const repository = repoRes.rows[0];

    // 4. Create Ingestion Job in PostgreSQL-native queue
    const jobRes = await query(`
      INSERT INTO ingestion_jobs (repository_id, status, step)
      VALUES ($1, 'QUEUED', 'QUEUED')
      RETURNING id, status, step;
    `, [repository.id]);

    // 5. Return 202 Accepted immediately
    return NextResponse.json({
      repositoryId: repository.id,
      jobId: jobRes.rows[0].id,
      status: 'PENDING'
    }, { status: 202 });

  } catch (error: any) {
    console.error('Error creating repository ingestion:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
