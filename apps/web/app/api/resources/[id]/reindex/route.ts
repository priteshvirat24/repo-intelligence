import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { UniversalIngestionService } from '@/lib/ai/universal_ingestion';
import { checkRateLimit } from '@/lib/security/rate_limit';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const rateLimit = checkRateLimit(req, 'reindex_resource', { maxRequests: 10, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  try {
    const { id } = params;

    const res = await query(`SELECT source_url FROM resources WHERE id = $1`, [id]);
    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    const sourceUrl = res.rows[0].source_url;
    const ingestResult = await UniversalIngestionService.ingestResource(sourceUrl, { forceReindex: true });

    return NextResponse.json({
      message: 'Reindex initiated',
      ...ingestResult
    });
  } catch (error: any) {
    console.error('Error reindexing resource:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
