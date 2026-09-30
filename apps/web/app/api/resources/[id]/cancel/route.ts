import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { checkRateLimit } from '@/lib/security/rate_limit';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const rateLimit = checkRateLimit(req, 'cancel_resource', { maxRequests: 20, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  try {
    const { id } = params;

    // 1. Fetch current resource state
    const resRes = await query(`
      SELECT id, title, status
      FROM resources
      WHERE id = $1
    `, [id]);

    if (resRes.rows.length === 0) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    const currentStatus = resRes.rows[0].status;

    // Terminal states cannot be cancelled
    if (currentStatus === 'READY' || currentStatus === 'CANCELLED' || currentStatus === 'BLOCKED') {
      return NextResponse.json({
        message: `Resource is already in terminal state "${currentStatus}".`,
        status: currentStatus,
        cancelled: false
      }, { status: 200 });
    }

    // 2. Safely mark resource as CANCELLED
    await query(`
      UPDATE resources
      SET status = 'CANCELLED',
          error_message = 'Ingestion cancelled by user.',
          updated_at = NOW()
      WHERE id = $1
    `, [id]);

    // 3. Mark any active ingestion jobs as CANCELLED/FAILED so workers safely stop/ignore
    await query(`
      UPDATE ingestion_jobs
      SET status = 'FAILED',
          step = 'CANCELLED',
          error_message = 'Ingestion cancelled by user.',
          updated_at = NOW()
      WHERE resource_id = $1 AND status IN ('QUEUED', 'RUNNING')
    `, [id]);

    // 4. If linked to repositories table, update that as well
    await query(`
      UPDATE repositories
      SET status = 'FAILED',
          error_message = 'Ingestion cancelled by user.',
          updated_at = NOW()
      WHERE resource_id = $1 AND status IN ('PENDING', 'CLONING', 'ANALYZING', 'INDEXING')
    `, [id]);

    return NextResponse.json({
      success: true,
      message: 'Resource ingestion successfully cancelled.',
      status: 'CANCELLED',
      cancelled: true
    }, { status: 200 });

  } catch (error: any) {
    console.error('Error cancelling resource ingestion:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
