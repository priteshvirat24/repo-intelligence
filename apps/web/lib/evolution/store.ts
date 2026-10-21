import { pool, query } from '@repo/database';
import type { ConfigVersionSummary, EvolutionData, EvolutionEvent, EvolutionProposal, FeedbackEntry, LabelProposal } from '@repo/shared';
import { DEFAULT_WORKSPACE_ID, RequestContext } from '@/lib/auth/context';
import { FeedbackInput, NEGATIVE_VERDICTS, TargetContext, canGovernEvolution, changedKeys, labelProposalFor } from './rules';

const NO_USER = '00000000-0000-0000-0000-000000000000';

export class NotFound extends Error {}

/** A refusal raised by the evolution_* database functions (migration 013), e.g. EVOLUTION_NO_BENCHMARK_WIN */
export function evolutionRefusal(error: unknown): string | null {
  const message = String((error as any)?.message || '');
  const i = message.indexOf('EVOLUTION_');
  return i >= 0 ? message.slice(i) : null;
}

/** Maintainer of the operator's workspace: the only role that may change global configuration when sign-in is on. */
export async function mayGovern(ctx: RequestContext): Promise<boolean> {
  if (!ctx.authenticated || !ctx.userId) return canGovernEvolution(ctx, false);
  const res = await query(
    `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 AND role = 'maintainer'`,
    [DEFAULT_WORKSPACE_ID, ctx.userId]
  );
  return canGovernEvolution(ctx, (res.rowCount || 0) > 0);
}

export function actorOf(ctx: RequestContext): string {
  return ctx.userId ? `user:${ctx.userId}` : 'maintainer';
}

/**
 * Records (or replaces, or with verdict null clears) the caller's verdict on one result of a brief in their
 * workspace, with the tuning version that produced it, and the label proposal it suggests.
 */
export async function saveFeedback(ctx: RequestContext, input: FeedbackInput): Promise<{ tuningVersion: string | null }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const brief = await client.query(
      `SELECT discovery_json->>'tuningVersion' AS tuning FROM briefs WHERE id = $1 AND workspace_id = $2`,
      [input.briefId, ctx.workspaceId]
    );
    if (!brief.rows[0]) throw new NotFound('Brief not found.');
    let tuning: string | null = brief.rows[0].tuning;
    let context: TargetContext = {};

    if (input.targetKind === 'candidate') {
      const c = await client.query(
        `SELECT rank, shortlisted FROM brief_candidates WHERE brief_id = $1 AND lower(full_name) = lower($2)`,
        [input.briefId, input.targetId]
      );
      if (!c.rows[0]) throw new NotFound('This brief has no such candidate.');
      context = { rank: c.rows[0].rank, shortlisted: c.rows[0].shortlisted };
    } else if (input.targetKind === 'blueprint_decision') {
      const bp = await client.query(`SELECT blueprint_json FROM brief_blueprints WHERE brief_id = $1`, [input.briefId]);
      const blueprint = bp.rows[0]?.blueprint_json || {};
      const component = (blueprint.components || []).find((c: any) => c?.requirement === input.targetId);
      if (!component) throw new NotFound('The blueprint has no decision for this requirement.');
      context = { decision: component.decision ?? null, repo: component.repo ?? null };
      tuning = blueprint.tuningVersion || tuning;
    } else {
      const claim = await client.query(
        `SELECT subject, grade FROM claims WHERE id = $1 AND (brief_id = $2 OR (brief_id IS NULL AND (workspace_id IS NULL OR workspace_id = $3)))`,
        [input.targetId, input.briefId, ctx.workspaceId]
      );
      if (!claim.rows[0]) throw new NotFound('No such claim for this brief.');
      context = { repo: String(claim.rows[0].subject).replace(/^github:/, ''), grade: claim.rows[0].grade };
    }

    const identity = [input.briefId, input.targetKind, input.targetId, ctx.userId];
    if (input.verdict === null) {
      await client.query(
        `DELETE FROM feedback WHERE brief_id = $1 AND target_kind = $2 AND target_id = $3 AND COALESCE(user_id, '${NO_USER}'::uuid) = COALESCE($4::uuid, '${NO_USER}'::uuid)`,
        identity
      );
    } else {
      const saved = await client.query(
        `INSERT INTO feedback (brief_id, workspace_id, user_id, target_kind, target_id, verdict, note, tuning_version, context_json)
         VALUES ($1, $5, $4, $2, $3, $6, $7, $8, $9)
         ON CONFLICT (brief_id, target_kind, target_id, (COALESCE(user_id, '${NO_USER}'::uuid)))
         DO UPDATE SET verdict = EXCLUDED.verdict, note = EXCLUDED.note, tuning_version = EXCLUDED.tuning_version,
                       context_json = EXCLUDED.context_json, updated_at = NOW()
         RETURNING id`,
        [...identity, ctx.workspaceId, input.verdict, input.note, tuning, JSON.stringify(context)]
      );
      const feedbackId = saved.rows[0].id;
      const draft = labelProposalFor(input, context);
      if (draft) {
        await client.query(
          `INSERT INTO label_proposals (feedback_id, brief_id, kind, repo, requirement, proposal_json)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (feedback_id) DO UPDATE SET kind = EXCLUDED.kind, repo = EXCLUDED.repo, requirement = EXCLUDED.requirement,
             proposal_json = EXCLUDED.proposal_json, created_at = NOW()
           WHERE label_proposals.status = 'pending'`,
          [feedbackId, input.briefId, draft.kind, draft.repo, draft.requirement, JSON.stringify(draft.proposal)]
        );
      } else {
        await client.query(`DELETE FROM label_proposals WHERE feedback_id = $1 AND status = 'pending'`, [feedbackId]);
      }
    }
    await client.query('COMMIT');
    return { tuningVersion: tuning };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** The caller's own verdicts on a brief (to show which thumb is pressed). */
export async function briefFeedback(ctx: RequestContext, briefId: string): Promise<FeedbackEntry[]> {
  const res = await query(
    `SELECT f.target_kind AS "targetKind", f.target_id AS "targetId", f.verdict, f.note, f.tuning_version AS "tuningVersion", f.updated_at AS "updatedAt"
     FROM feedback f JOIN briefs b ON b.id = f.brief_id
     WHERE f.brief_id = $1 AND b.workspace_id = $2 AND COALESCE(f.user_id, '${NO_USER}'::uuid) = COALESCE($3::uuid, '${NO_USER}'::uuid)`,
    [briefId, ctx.workspaceId, ctx.userId]
  );
  return res.rows as FeedbackEntry[];
}

export async function loadEvolution(ctx: RequestContext): Promise<EvolutionData> {
  const versions = await query(
    `SELECT c.id, c.parent_id AS "parentId", c.level, c.status, c.notes, c.content, p.content AS "parentContent",
            c.evidence_json AS evidence, c.created_at AS "createdAt", c.promoted_at AS "promotedAt", c.decided_at AS "decidedAt",
            COALESCE(f.total, 0)::int AS total, COALESCE(f.negative, 0)::int AS negative
     FROM config_versions c
     LEFT JOIN config_versions p ON p.id = c.parent_id
     LEFT JOIN (
       SELECT tuning_version, COUNT(*) AS total, COUNT(*) FILTER (WHERE verdict = ANY($1)) AS negative FROM feedback GROUP BY tuning_version
     ) f ON f.tuning_version = c.id
     ORDER BY COALESCE(c.decided_at, c.promoted_at, c.created_at) DESC
     LIMIT 60`,
    [NEGATIVE_VERDICTS]
  );
  const events = await query(
    `SELECT id::int, kind, version, active_before AS "activeBefore", active_after AS "activeAfter", level, actor, notes, created_at AS "createdAt"
     FROM evolution_events ORDER BY created_at DESC, id DESC LIMIT 100`
  );
  const proposals = await query(
    `SELECT p.id, p.level, p.title, p.rationale, p.config_version AS "configVersion", p.base_version AS "baseVersion",
            p.benchmark_win AS "benchmarkWin", p.evidence_json AS evidence, p.status, p.created_by AS "createdBy",
            p.decided_by AS "decidedBy", p.decided_at AS "decidedAt", p.created_at AS "createdAt", c.content, b.content AS "baseContent"
     FROM evolution_proposals p
     LEFT JOIN config_versions c ON c.id = p.config_version
     LEFT JOIN config_versions b ON b.id = p.base_version
     ORDER BY (p.status = 'pending') DESC, p.created_at DESC LIMIT 50`
  );
  const labels = await query(
    `SELECT l.id, l.brief_id AS "briefId", b.title AS "briefTitle", l.kind, l.repo, l.requirement, l.proposal_json AS proposal,
            l.status, l.created_at AS "createdAt"
     FROM label_proposals l JOIN briefs b ON b.id = l.brief_id
     WHERE b.workspace_id = $1 ORDER BY (l.status = 'pending') DESC, l.created_at DESC LIMIT 100`,
    [ctx.workspaceId]
  );
  const active = versions.rows.find((v: any) => v.status === 'promoted');
  return {
    active: active ? active.id : null,
    versions: versions.rows.map((v: any): ConfigVersionSummary => ({
      id: v.id, parentId: v.parentId, level: v.level, status: v.status, notes: v.notes,
      changedKeys: changedKeys(v.content, v.parentContent), evidence: v.evidence,
      createdAt: v.createdAt, promotedAt: v.promotedAt, decidedAt: v.decidedAt,
      feedback: { total: v.total, negative: v.negative, rate: v.total ? v.negative / v.total : null }
    })),
    events: events.rows as EvolutionEvent[],
    proposals: proposals.rows.map((p: any): EvolutionProposal => {
      const { content, baseContent, ...rest } = p;
      return { ...rest, changedKeys: changedKeys(content, baseContent) };
    }),
    labelProposals: labels.rows as LabelProposal[],
    canGovern: await mayGovern(ctx)
  };
}
