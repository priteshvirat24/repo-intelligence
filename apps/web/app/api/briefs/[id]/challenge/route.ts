import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@repo/database';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { checkRateLimit } from '@/lib/security/rate_limit';
import { briefInWorkspace, isUuid } from '@/lib/briefs/store';
import { IterationError, parseChallenge, recordChallenge } from '@/lib/briefs/iterate';

export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Brief not found.' }, { status: 404 });

/**
 * Challenge a blueprint decision ("why not X?") without restarting the run: the challenge is stored on the
 * brief and only the blueprint is written again, answering it explicitly.
 * Body: { requirement, repo?, note }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const rateLimit = checkRateLimit(req, 'challenge_blueprint', { maxRequests: 6, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) return rateLimit.response;
  if (!isUuid(params.id)) return notFound();
  let input;
  try {
    input = parseChallenge(await req.json().catch(() => null));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const ctx = await requestContext();
    if (!(await briefInWorkspace(params.id, ctx.workspaceId))) return notFound();
    await client.query('BEGIN');
    const challenge = await recordChallenge(client, params.id, input, ctx.userId);
    await client.query('COMMIT');
    return NextResponse.json({ challenge, status: 'QUEUED' }, { status: 202 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    const denied = authErrorResponse(error);
    if (denied) return denied;
    if (error instanceof IterationError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error recording challenge:', error);
    return NextResponse.json({ error: 'Could not record the challenge. Try again.' }, { status: 500 });
  } finally {
    client.release();
  }
}
