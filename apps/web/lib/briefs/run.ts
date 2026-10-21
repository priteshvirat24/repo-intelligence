import type { PoolClient } from '@repo/database';

// The brief run graph as the web app sees it. The worker owns execution (apps/worker/orchestrator); the web
// app only creates runs and invalidates tasks when the user changes something. Keep in step with graph.py.
export const PIPELINE: Record<string, string[]> = {
  understand: [],
  discover: ['understand'],
  verify: ['discover'],
  blueprint: ['verify']
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
  await client.query(
    `UPDATE tasks SET status = 'stale', locked_at = NULL, locked_by = NULL, attempts = 0, not_before = NULL,
       error_message = NULL, updated_at = NOW(),
       inputs_fingerprint = CASE WHEN $3 AND type = $4 THEN NULL ELSE inputs_fingerprint END
     WHERE brief_id = $1 AND type = ANY($2)`,
    [briefId, types, Boolean(options.force), fromType]
  );
  await client.query(
    `UPDATE briefs SET status = 'QUEUED', error_message = NULL, stop_reason = NULL, updated_at = NOW(),
       budget_json = CASE WHEN $2 THEN jsonb_set(budget_json, '{resetAt}', to_jsonb(NOW())) ELSE budget_json END
     WHERE id = $1`,
    [briefId, Boolean(options.resetBudget)]
  );
}
