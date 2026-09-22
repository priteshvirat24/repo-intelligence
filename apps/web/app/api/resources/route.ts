import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { UniversalIngestionService } from '@/lib/ai/universal_ingestion';
import { checkRateLimit } from '@/lib/security/rate_limit';
import { ResourceTypeDetector } from '@/lib/adapters/detector';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const type = searchParams.get('type') || '';
    const status = searchParams.get('status') || '';

    let sql = `
      SELECT 
        r.id,
        r.resource_type as "resourceType",
        r.resource_role as "resourceRole",
        r.source_url as "sourceUrl",
        r.canonical_url as "canonicalUrl",
        r.title,
        r.description,
        r.author,
        r.publisher,
        r.source_domain as "sourceDomain",
        r.status,
        r.error_message as "errorMessage",
        r.content_hash as "contentHash",
        r.domain_tags as "domainTags",
        r.problems_solved as "problemsSolved",
        r.practical_uses as "practicalUses",
        r.value_proposition as "valueProposition",
        r.useful_for as "usefulFor",
        r.metadata_json as "metadata",
        r.indexed_at as "indexedAt",
        r.created_at as "createdAt",
        r.updated_at as "updatedAt",
        COUNT(DISTINCT ko.id)::int as "capabilitiesCount"
      FROM resources r
      LEFT JOIN knowledge_objects ko ON r.id = ko.resource_id AND ko.object_type = 'capability'
    `;

    const conditions: string[] = [];
    const params: any[] = [];

    if (search.trim()) {
      params.push(`%${search.trim()}%`);
      const pIdx = params.length;
      conditions.push(`(r.title ILIKE $${pIdx} OR r.description ILIKE $${pIdx} OR r.value_proposition ILIKE $${pIdx} OR r.source_domain ILIKE $${pIdx})`);
    }

    if (type && type !== 'all') {
      params.push(type);
      conditions.push(`r.resource_type = $${params.length}`);
    }

    if (status) {
      params.push(status);
      conditions.push(`r.status = $${params.length}`);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ` + conditions.join(' AND ');
    }

    sql += ` GROUP BY r.id ORDER BY r.created_at DESC`;

    const res = await query(sql, params);

    // Compute library statistics
    const statsRes = await query(`
      SELECT 
        COUNT(*)::int as "totalResources",
        COUNT(*) FILTER (WHERE resource_type = 'github_repository')::int as "totalRepositories",
        COUNT(*) FILTER (WHERE resource_type IN ('web_page', 'documentation_site', 'article', 'generic_url'))::int as "totalWebSources",
        COUNT(*) FILTER (WHERE resource_type = 'youtube_video')::int as "totalVideos",
        COUNT(*) FILTER (WHERE resource_type IN ('pdf', 'research_paper', 'document'))::int as "totalDocuments",
        COUNT(DISTINCT source_domain)::int as "totalDomains"
      FROM resources
    `);

    return NextResponse.json({
      items: res.rows,
      stats: statsRes.rows[0] || {
        totalResources: res.rows.length,
        totalRepositories: 0,
        totalWebSources: 0,
        totalVideos: 0,
        totalDocuments: 0,
        totalDomains: 0
      }
    });
  } catch (error: any) {
    console.error('Error fetching resources:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit(req, 'add_resource', { maxRequests: 15, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  try {
    const body = await req.json();
    const rawUrl = body.url;

    if (!rawUrl || typeof rawUrl !== 'string') {
      return NextResponse.json({ error: 'Valid URL is required' }, { status: 400 });
    }

    const detected = ResourceTypeDetector.detect(rawUrl);

    // Trigger universal ingestion
    const result = await UniversalIngestionService.ingestResource(rawUrl);

    return NextResponse.json({
      resourceId: result.resourceId,
      resourceType: result.resourceType,
      status: result.status,
      title: result.title,
      jobId: result.jobId,
      errorMessage: result.errorMessage
    }, { status: result.status === 'PENDING' ? 202 : 200 });

  } catch (error: any) {
    console.error('Error adding resource:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
