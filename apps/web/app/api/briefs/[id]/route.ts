import { NextRequest, NextResponse } from 'next/server';
import { pool, query } from '@repo/database';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { briefInWorkspace, getBrief, isUuid } from '@/lib/briefs/store';
import { invalidate } from '@/lib/briefs/run';
import { parseBudget, parseConstraints } from '@/lib/briefs/constraints';
import { checkRateLimit } from '@/lib/security/rate_limit';

export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Brief not found.' }, { status: 404 });

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return notFound();
  try {
    const ctx = await requestContext();
    const brief = await getBrief(params.id, ctx.workspaceId);
    return brief ? NextResponse.json(brief) : notFound();
  } catch (error: any) {
    const denied = authErrorResponse(error);
    if (denied) return denied;
    console.error('Error loading brief:', error);
    return NextResponse.json({ error: 'Could not load the brief.' }, { status: 500 });
  }
}

/**
 * Revise a brief without restarting it (PRODUCT_DEFINITION 4.1 step 6): constraints and answers re-run the
 * understanding and whatever depends on a changed result; a budget change resumes a stopped run.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const rateLimit = checkRateLimit(req, 'revise_brief', { maxRequests: 20, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) return rateLimit.response;
  if (!isUuid(params.id)) return notFound();
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Send constraints, answers or budget.' }, { status: 400 });

  const client = await pool.connect();
  try {
    const ctx = await requestContext();
    if (!(await briefInWorkspace(params.id, ctx.workspaceId))) return notFound();
    await client.query('BEGIN');
    let rerun = false;
    if (body.constraints !== undefined) {
      await client.query('UPDATE briefs SET constraints_json = $2 WHERE id = $1', [params.id, JSON.stringify(parseConstraints(body.constraints))]);
      rerun = true;
    }
    if (body.answers !== undefined && body.answers && typeof body.answers === 'object') {
      const answers: Record<string, string> = {};
      for (const [q, a] of Object.entries(body.answers)) {
        if (typeof a === 'string' && a.trim()) answers[String(q).slice(0, 300)] = a.trim().slice(0, 1000);
      }
      await client.query(`UPDATE briefs SET answers_json = answers_json || $2::jsonb WHERE id = $1`, [params.id, JSON.stringify(answers)]);
      rerun = true;
    }
    if (body.budget !== undefined) {
      const limits = parseBudget(body.budget);
      if (!limits) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Budget limits must be positive numbers.' }, { status: 400 });
      }
      await client.query(`UPDATE briefs SET budget_json = jsonb_set(budget_json, '{limits}', $2::jsonb) WHERE id = $1`, [params.id, JSON.stringify(limits)]);
      // A run stopped on budget continues from the task that stopped
      const stopped = await client.query(`SELECT type FROM tasks WHERE brief_id = $1 AND status = 'failed' ORDER BY updated_at LIMIT 1`, [params.id]);
      if (stopped.rows[0]) await invalidate(client, params.id, stopped.rows[0].type);
    }
    if (rerun) await invalidate(client, params.id, 'understand');
    await client.query('COMMIT');
    return NextResponse.json({ updated: true }, { status: 202 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    const denied = authErrorResponse(error);
    if (denied) return denied;
    console.error('Error revising brief:', error);
    return NextResponse.json({ error: 'Could not update the brief.' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return notFound();
  try {
    const ctx = await requestContext();
    // A running task notices the missing brief at its next ownership check and writes nothing
    const res = await query(`DELETE FROM briefs WHERE id = $1 AND workspace_id = $2`, [params.id, ctx.workspaceId]);
    return res.rowCount === 0 ? notFound() : NextResponse.json({ deleted: true });
  } catch (error: any) {
    const denied = authErrorResponse(error);
    if (denied) return denied;
    console.error('Error deleting brief:', error);
    return NextResponse.json({ error: 'Could not delete the brief.' }, { status: 500 });
  }
}
