import type { PoolClient } from '@repo/database';

// The brief run graph as the web app sees it. The worker owns execution (apps/worker/orchestrator); the web
// app only creates runs and invalidates tasks when the user changes something. Keep in step with graph.py.
export const PIPELINE: Record<string, string[]> = {
  understand: [],
  recall: ['understand'], // Phase 4: memory read before research
  discover: ['understand', 'recall'],
  verify: ['discover'],
  // Phase 2: official docs, registry and advisory facts for the shortlist
  docs: ['discover'],
  execute: ['verify'],
  blueprint: ['verify', 'docs', 'execute']
};
const ORDER = Object.keys(PIPELINE);

export function ancestors(type: string): string[] {
  const found = new Set<string>();
  const frontier = [...PIPELINE[type]];
  while (frontier.length) {
    const t = frontier.pop()!;
    if (!found.has(t)) {
      found.add(t);
      frontier.push(...PIPELINE[t]);
    }
  }
  return ORDER.filter((t) => found.has(t));
}

export function downstream(type: string): string[] {
  const found = new Set<string>();
  const frontier = [type];
  while (frontier.length) {
    const current = frontier.pop()!;
    for (const [t, deps] of Object.entries(PIPELINE)) {
      if (deps.includes(current) && !found.has(t)) {
        found.add(t);
        frontier.push(t);
      }
    }
  }
  return ORDER.filter((t) => found.has(t));
}

export async function createRun(client: PoolClient, briefId: string) {
  for (const type of ORDER) {
    await client.query(
      `INSERT INTO tasks (brief_id, type, depends_on) VALUES ($1, $2, $3)
       ON CONFLICT (brief_id, type) DO UPDATE SET depends_on = EXCLUDED.depends_on`,
      [briefId, type, ancestors(type)]
    );
  }
}

/**
 * Marks `fromType` and everything downstream stale; the worker re-runs them, skipping any whose inputs
 * turn out unchanged. force makes `fromType` itself run even if its inputs are unchanged.
 * resetBudget starts the budget count again (an explicit new run by the user).
 */
export async function invalidate(client: PoolClient, briefId: string, fromType: string, options: { force?: boolean; resetBudget?: boolean } = {}) {
  const types = [fromType, ...downstream(fromType)];
  // Runs created before a task type existed (Phase 2 added docs) get it now, with current dependencies
  await createRun(client, briefId);
  await client.query(
    `UPDATE tasks SET status = 'stale', locked_at = NULL, locked_by = NULL, attempts = 0, not_before = NULL,
       error_message = NULL, updated_at = NOW(),
       inputs_fingerprint = CASE WHEN $3 AND type = $4 THEN NULL ELSE inputs_fingerprint END
     WHERE brief_id = $1 AND type = ANY($2)`,
    [briefId, types, Boolean(options.force), fromType]
  );
  // The brief's status summarises its tasks exactly as the worker's _sync_brief_status does. Always writing
  // QUEUED was wrong when a task outside the invalidated set is failed or awaiting an answer: nothing can be
  // claimed behind it, so the brief showed "Waiting for the worker" for ever and lost its error message.
  await client.query(
    `WITH t AS (
       SELECT status, error_message, array_position($3::text[], type) AS pos FROM tasks WHERE brief_id = $1
     )
     UPDATE briefs SET
       status = CASE
         WHEN EXISTS (SELECT 1 FROM t WHERE status = 'failed') THEN 'FAILED'
         WHEN EXISTS (SELECT 1 FROM t WHERE status = 'awaiting_input') THEN 'AWAITING_INPUT'
         WHEN NOT EXISTS (SELECT 1 FROM t WHERE status NOT IN ('pending', 'stale')) THEN 'QUEUED'
         ELSE 'RUNNING' END,
       error_message = (SELECT error_message FROM t WHERE status = 'failed' ORDER BY pos LIMIT 1),
       stop_reason = NULL, updated_at = NOW(),
       budget_json = CASE WHEN $2 THEN jsonb_set(budget_json, '{resetAt}', to_jsonb(NOW())) ELSE budget_json END
     WHERE id = $1`,
    [briefId, Boolean(options.resetBudget), ORDER]
  );
}
