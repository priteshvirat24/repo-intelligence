import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { checkRateLimit } from '@/lib/security/rate_limit';
import { isUuid } from '@/lib/briefs/store';

export const dynamic = 'force-dynamic';

/** Queues discovery again. The previous candidates stay visible until the new run replaces them. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const rateLimit = checkRateLimit(req, 'rediscover_brief', { maxRequests: 6, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Brief not found.' }, { status: 404 });
  }
  try {
    const res = await query(
      `UPDATE briefs
       SET status = 'QUEUED', step = 'QUEUED', attempts = 0, error_message = NULL,
           locked_at = NULL, locked_by = NULL, updated_at = NOW()
       WHERE id = $1 AND status IN ('COMPLETED', 'FAILED')
       RETURNING id, status`,
      [params.id]
    );
    if (res.rows[0]) {
      return NextResponse.json(res.rows[0], { status: 202 });
    }
    const exists = await query(`SELECT status FROM briefs WHERE id = $1`, [params.id]);
    if (!exists.rows[0]) {
      return NextResponse.json({ error: 'Brief not found.' }, { status: 404 });
    }
    return NextResponse.json({ id: params.id, status: exists.rows[0].status, alreadyQueued: true });
  } catch (error: any) {
    console.error('Error queuing discovery:', error);
    return NextResponse.json({ error: 'Could not start discovery. Try again.' }, { status: 500 });
  }
}
