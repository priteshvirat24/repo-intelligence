import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@repo/database';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { checkRateLimit } from '@/lib/security/rate_limit';
import { briefInWorkspace, isUuid } from '@/lib/briefs/store';
import { IterationError, parseRequirement, recordDeepen } from '@/lib/briefs/iterate';

export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Brief not found.' }, { status: 404 });

/**
 * Investigate one requirement deeper: discovery runs again with extra search queries for it, then whatever
 * depends on discovery. Other results stay visible until the new ones replace them.
 * Body: { requirement }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const rateLimit = checkRateLimit(req, 'deepen_requirement', { maxRequests: 4, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) return rateLimit.response;
  if (!isUuid(params.id)) return notFound();
  let requirement: string;
  try {
    requirement = parseRequirement(await req.json().catch(() => null));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    const ctx = await requestContext();
    if (!(await briefInWorkspace(params.id, ctx.workspaceId))) return notFound();
    await client.query('BEGIN');
    const focus = await recordDeepen(client, params.id, requirement);
    await client.query('COMMIT');
    return NextResponse.json({ focus, status: 'QUEUED' }, { status: 202 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    const denied = authErrorResponse(error);
    if (denied) return denied;
    if (error instanceof IterationError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error queuing deeper investigation:', error);
    return NextResponse.json({ error: 'Could not start the deeper investigation. Try again.' }, { status: 500 });
  } finally {
    client.release();
  }
}
