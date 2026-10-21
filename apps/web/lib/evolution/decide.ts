import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { isUuid } from '@/lib/briefs/store';
import { checkRateLimit } from '@/lib/security/rate_limit';
import { actorOf, evolutionRefusal, mayGovern } from './store';

// Maintainer actions on the evolution history. The rules (benchmark win required, L4 never applied, one
// promoted version, rollback to the predecessor) are enforced by the database functions of migration 013.

interface ActionBody {
  note: string | null;
  /** rollback: the promoted version the maintainer was looking at */
  expected: string | null;
}

async function readBody(req: NextRequest): Promise<ActionBody> {
  const body = await req.json().catch(() => null);
  const note = body && typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
  const expected = body && typeof body.expected === 'string' && /^cfg-[0-9a-f]{12}$/.test(body.expected) ? body.expected : null;
  return { note: note || null, expected };
}

function refused(error: unknown): NextResponse | null {
  const code = evolutionRefusal(error);
  if (!code) return null;
  const status = code.startsWith('EVOLUTION_UNKNOWN') ? 404 : 409;
  return NextResponse.json({ error: code.split(': ').slice(1).join(': ') || code, kind: code.split(':')[0] }, { status });
}

async function governed(req: NextRequest, action: string, run: (actor: string, body: ActionBody) => Promise<NextResponse>) {
  const rateLimit = checkRateLimit(req, action, { maxRequests: 10, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) return rateLimit.response;
  try {
    const ctx = await requestContext();
    if (!(await mayGovern(ctx))) {
      return NextResponse.json({ error: 'Only maintainers of the operator workspace can change the active configuration.', kind: 'forbidden' }, { status: 403 });
    }
    return await run(actorOf(ctx), await readBody(req));
  } catch (error: any) {
    const denied = authErrorResponse(error) || refused(error);
    if (denied) return denied;
    console.error(`Error in ${action}:`, error);
    return NextResponse.json({ error: 'Could not complete the action.' }, { status: 500 });
  }
}

export function decideProposal(req: NextRequest, id: string, approve: boolean) {
  if (!isUuid(id)) return Promise.resolve(NextResponse.json({ error: 'Proposal not found.' }, { status: 404 }));
  return governed(req, approve ? 'approve_proposal' : 'reject_proposal', async (actor, { note }) => {
    const res = await query('SELECT evolution_decide_proposal($1::uuid, $2, $3, $4) AS status', [id, approve, actor, note]);
    return NextResponse.json({ status: res.rows[0].status });
  });
}

export function rollback(req: NextRequest) {
  return governed(req, 'rollback_config', async (actor, { note, expected }) => {
    // Without an expected version the database rolls back whatever is promoted; the page always sends it
    const res = await query('SELECT evolution_rollback($1, $2, $3, $4) AS restored', [actor, note || 'Rolled back by a maintainer', JSON.stringify({ manual: true }), expected]);
    return NextResponse.json({ rolledBack: expected, restored: res.rows[0].restored });
  });
}
