import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { normalizeResourceError } from '@/lib/adapters/errors';
import { contextOrRefusal } from '@/lib/auth/context';
import { isUuid } from '@/lib/briefs/store';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const gate = await contextOrRefusal();
  if (gate.refusal) return gate.refusal;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const { id } = params;

    // Web pages, videos, PDFs and posts are ingested inside the web process (no worker lock or heartbeat), so a
    // restart mid-run leaves the job RUNNING for ever and the UI polling "Fetching…" indefinitely. A job with no
    // progress for 20 minutes (the same threshold ingestResource uses to allow a fresh run) is settled here.
    await query(`
      WITH abandoned AS (
        UPDATE ingestion_jobs
        SET status = 'FAILED', step = 'ABANDONED', error_message = 'Ingestion stopped before it finished (the server restarted).', updated_at = NOW()
        WHERE resource_id = $1 AND repository_id IS NULL AND status IN ('QUEUED', 'RUNNING')
          AND updated_at < NOW() - INTERVAL '20 minutes'
        RETURNING resource_id
      )
      UPDATE resources
      SET status = CASE WHEN indexed_at IS NOT NULL THEN 'READY' ELSE 'FAILED' END,
          error_message = CASE WHEN indexed_at IS NOT NULL THEN 'Re-index stopped before it finished; showing the previous index.'
                               ELSE 'Ingestion stopped before it finished. Add it again to retry.' END,
          updated_at = NOW()
      WHERE id IN (SELECT resource_id FROM abandoned) AND status IN ('PENDING', 'FETCHING', 'ANALYZING', 'INDEXING')
    `, [id]);

    const res = await query(`
      SELECT 
        r.id,
        r.title,
        r.description,
        r.author,
        r.resource_type as "resourceType",
        r.source_domain as "sourceDomain",
        r.source_url as "sourceUrl",
        r.status,
        r.error_message as "errorMessage",
        r.problems_solved as "problemsSolved",
        r.practical_uses as "practicalUses",
        r.useful_for as "usefulFor",
        r.value_proposition as "valueProposition",
        r.indexed_at as "indexedAt",
        j.status as "jobStatus",
        j.step as "jobStep",
        (SELECT COUNT(*)::int FROM knowledge_objects ko WHERE ko.resource_id = r.id AND ko.object_type = 'capability') as "capabilitiesCount"
      FROM resources r
      LEFT JOIN ingestion_jobs j ON r.id = j.resource_id
      WHERE r.id = $1
      ORDER BY j.created_at DESC
      LIMIT 1
    `, [id]);

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    const row = res.rows[0];
    const isErrorState = row.status === 'FAILED' || row.status === 'BLOCKED' || Boolean(row.errorMessage);
    const errorDetails = isErrorState
      ? normalizeResourceError(row.errorMessage, { resourceType: row.resourceType, domain: row.sourceDomain })
      : null;

    return NextResponse.json({
      id: row.id,
      title: row.title,
      description: row.description,
      author: row.author,
      resourceType: row.resourceType,
      sourceDomain: row.sourceDomain,
      sourceUrl: row.sourceUrl,
      status: row.status,
      errorMessage: row.errorMessage,
      errorDetails,
      problemsSolved: row.problemsSolved || [],
      practicalUses: row.practicalUses || [],
      usefulFor: row.usefulFor || [],
      valueProposition: row.valueProposition,
      capabilitiesCount: row.capabilitiesCount || 0,
      indexedAt: row.indexedAt,
      jobStatus: row.jobStatus,
      jobStep: row.jobStep
    });
  } catch (error: any) {
    console.error('Error fetching resource status:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
