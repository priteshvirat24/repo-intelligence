import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@repo/database';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { checkRateLimit } from '@/lib/security/rate_limit';
import { briefInWorkspace, isUuid } from '@/lib/briefs/store';
import { invalidate } from '@/lib/briefs/run';

export const dynamic = 'force-dynamic';

/** Runs discovery again (and everything after it) as a new run with a fresh budget. Previous results stay
 * visible until the new ones replace them. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const rateLimit = checkRateLimit(req, 'rediscover_brief', { maxRequests: 6, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) return rateLimit.response;
  if (!isUuid(params.id)) return NextResponse.json({ error: 'Brief not found.' }, { status: 404 });
  const client = await pool.connect();
  try {
    const ctx = await requestContext();
    if (!(await briefInWorkspace(params.id, ctx.workspaceId))) return NextResponse.json({ error: 'Brief not found.' }, { status: 404 });
    await client.query('BEGIN');
    await invalidate(client, params.id, 'discover', { force: true, resetBudget: true });
    await client.query('COMMIT');
    return NextResponse.json({ id: params.id, status: 'QUEUED' }, { status: 202 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    const denied = authErrorResponse(error);
    if (denied) return denied;
    console.error('Error queuing discovery:', error);
    return NextResponse.json({ error: 'Could not start discovery. Try again.' }, { status: 500 });
  } finally {
    client.release();
  }
}
