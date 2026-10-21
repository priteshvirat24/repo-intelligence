import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@repo/database';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { isUuid } from '@/lib/briefs/store';
import { checkRateLimit } from '@/lib/security/rate_limit';
import { confirmClaim, refuteClaim } from '@/lib/memory/claims';
import { changeProcedure, ProcedureAction, ProcedureActionError } from '@/lib/memory/store';

// Shared handlers for the memory correction endpoints (one transaction each).

export async function correctClaim(req: NextRequest, id: string, action: 'refute' | 'confirm') {
  const rateLimit = checkRateLimit(req, `claim_${action}`, { maxRequests: 30, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) return rateLimit.response;
  if (!isUuid(id)) return NextResponse.json({ error: 'Claim not found.' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const text = typeof body?.reason === 'string' ? body.reason.trim() : typeof body?.note === 'string' ? body.note.trim() : '';
  if (action === 'refute' && !text) return NextResponse.json({ error: 'Say why the claim is wrong.' }, { status: 400 });

  const client = await pool.connect();
  try {
    const ctx = await requestContext();
    await client.query('BEGIN');
    const result = action === 'refute'
      ? await refuteClaim(client, id, text, ctx.workspaceId, ctx.userId)
      : await confirmClaim(client, id, text, ctx.workspaceId, ctx.userId);
    if (!result) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Claim not found.' }, { status: 404 });
    }
    await client.query('COMMIT');
    return NextResponse.json(result);
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    const denied = authErrorResponse(error);
    if (denied) return denied;
    console.error(`Error recording claim ${action}:`, error);
    return NextResponse.json({ error: 'Could not record the correction.' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function changeProcedureRoute(req: NextRequest, id: string, action: ProcedureAction) {
  const rateLimit = checkRateLimit(req, `procedure_${action}`, { maxRequests: 20, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) return rateLimit.response;
  if (!isUuid(id)) return NextResponse.json({ error: 'Procedure not found.' }, { status: 404 });
  const client = await pool.connect();
  try {
    const ctx = await requestContext();
    await client.query('BEGIN');
    const result = await changeProcedure(client, id, action, ctx);
    await client.query('COMMIT');
    return NextResponse.json(result);
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    const denied = authErrorResponse(error);
    if (denied) return denied;
    if (error instanceof ProcedureActionError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error(`Error trying to ${action} a procedure:`, error);
    return NextResponse.json({ error: 'Could not change the procedure.' }, { status: 500 });
  } finally {
    client.release();
  }
}
