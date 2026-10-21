import type { PoolClient } from '@repo/database';
import { query } from '@repo/database';
import type { MemoryEpisode, MemoryProcedure } from '@repo/shared';
import type { RequestContext } from '@/lib/auth/context';

// Episodic and procedural memory as the web app sees them (apps/worker/memory/{episodic,procedural}.py own the
// write paths; the activation rules below mirror procedural.activate / retire).

/** Successful uses a candidate procedure needs before it may be activated (procedural.MIN_ACTIVATION_SUCCESSES) */
export const MIN_ACTIVATION_SUCCESSES = 3;

export async function listEpisodes(workspaceId: string, limit = 50): Promise<MemoryEpisode[]> {
  const res = await query(
    `SELECT id, brief_id AS "briefId", parent_id AS "parentId", kind, outcome, title, summary, tuning_version AS "tuningVersion",
            queries_json AS queries, shortlisted_json AS shortlisted, rejected_json AS rejected, decisions_json AS decisions,
            budget_json AS budget, memory_json AS memory, feedback_json AS feedback, detail_json AS detail, finished_at AS "finishedAt"
     FROM episodes WHERE workspace_id = $1 ORDER BY finished_at DESC LIMIT $2`,
    [workspaceId, Math.min(Math.max(limit, 1), 200)]
  );
  return res.rows as MemoryEpisode[];
}

export async function listProcedures(workspaceId: string, limit = 100): Promise<MemoryProcedure[]> {
  const res = await query(
    `SELECT id, workspace_id AS "workspaceId", kind, name, trigger_json AS trigger, steps_json AS steps, evidence_json AS evidence,
            success_count AS "successCount", failure_count AS "failureCount", uses_count AS "usesCount", confidence::float AS confidence,
            status, scope, revalidation_rule AS "revalidationRule", activated_at AS "activatedAt", retired_at AS "retiredAt",
            updated_at AS "updatedAt"
     FROM procedures WHERE workspace_id IS NULL OR workspace_id = $1
     ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END, updated_at DESC LIMIT $2`,
    [workspaceId, Math.min(Math.max(limit, 1), 200)]
  );
  return res.rows as MemoryProcedure[];
}

export type ProcedureAction = 'activate' | 'retire';

export class ProcedureActionError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/**
 * Activation turns a learned procedure into a planner hint (an L2 change, PRODUCT_DEFINITION 9.1): only a
 * maintainer may do it, and only once the procedure has measured support. Retiring is maintainer-only too.
 */
export async function changeProcedure(client: PoolClient, id: string, action: ProcedureAction, ctx: RequestContext) {
  if (ctx.role !== 'maintainer') throw new ProcedureActionError(`Only a maintainer can ${action} a procedure.`, 403);
  const res = await client.query(
    `SELECT id, workspace_id AS "workspaceId", status, success_count AS "successCount" FROM procedures WHERE id = $1 FOR UPDATE`,
    [id]
  );
  const p = res.rows[0];
  if (!p || (p.workspaceId && p.workspaceId !== ctx.workspaceId)) throw new ProcedureActionError('Procedure not found.', 404);
  if (action === 'activate') {
    if (p.status === 'active') return { id, status: 'active' };
    if (p.status === 'retired') throw new ProcedureActionError('A retired procedure is not re-activated; it is proposed again if it recurs.', 409);
    if (p.successCount < MIN_ACTIVATION_SUCCESSES) {
      throw new ProcedureActionError(`Needs at least ${MIN_ACTIVATION_SUCCESSES} successful uses; has ${p.successCount}.`, 409);
    }
    await client.query(`UPDATE procedures SET status = 'active', activated_at = NOW(), activated_by = $2, updated_at = NOW() WHERE id = $1`, [id, ctx.userId]);
    return { id, status: 'active' };
  }
  await client.query(`UPDATE procedures SET status = 'retired', retired_at = NOW(), retired_by = $2, updated_at = NOW() WHERE id = $1`, [id, ctx.userId]);
  return { id, status: 'retired' };
}
