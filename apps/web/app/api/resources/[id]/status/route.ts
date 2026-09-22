import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const res = await query(`
      SELECT 
        r.id,
        r.title,
        r.resource_type as "resourceType",
        r.status,
        r.error_message as "errorMessage",
        r.indexed_at as "indexedAt",
        j.status as "jobStatus",
        j.step as "jobStep"
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
    return NextResponse.json({
      id: row.id,
      title: row.title,
      resourceType: row.resourceType,
      status: row.status,
      errorMessage: row.errorMessage,
      indexedAt: row.indexedAt,
      jobStatus: row.jobStatus,
      jobStep: row.jobStep
    });
  } catch (error: any) {
    console.error('Error fetching resource status:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
