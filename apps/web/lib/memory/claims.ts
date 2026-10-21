import type { PoolClient } from '@repo/database';
import { query } from '@repo/database';
import type { MemoryClaim } from '@repo/shared';
import { invalidate } from '@/lib/briefs/run';

// Semantic memory as the web app sees it: the audit search and user corrections. The worker owns the same
// rules in apps/worker/memory/semantic.py (refute_claim, confirm_claim); keep the two in step.

const HALF_LIFE_DAYS = 90;
const SOURCE_TYPES: Record<string, string> = {
  readme_assessment: 'readme',
  code_located: 'code',
  platform_api: 'platform_api',
  analysis_inferred: 'inferred',
  docs: 'docs'
};
const USER_METHODS = new Set(['user_refutation', 'user_confirmation', 'corroboration']);

export interface ClaimSearch {
  q?: string;
  kind?: string;
  grade?: string;
  status?: string;
  /** current: still valid now; stale: needs revalidation or past its date */
  freshness?: 'current' | 'stale';
  limit?: number;
}

const SOURCE_TYPE_SQL = `CASE c.evidence_json->0->>'method'
  WHEN 'readme_assessment' THEN 'readme' WHEN 'code_located' THEN 'code' WHEN 'platform_api' THEN 'platform_api'
  WHEN 'analysis_inferred' THEN 'inferred' ELSE c.evidence_json->0->>'method' END`;

/** Global claims (facts about public sources) and the workspace's project claims. */
export async function searchClaims(workspaceId: string, search: ClaimSearch): Promise<MemoryClaim[]> {
  const where = ['(c.brief_id IS NULL OR b.workspace_id = $1)'];
  const params: unknown[] = [workspaceId];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  const text = (search.q || '').trim().slice(0, 200);
  if (text) {
    params.push(text);
    const n = params.length;
    params.push(`%${text.replace(/[%_]/g, '')}%`);
    where.push(`(to_tsvector('english', c.statement) @@ plainto_tsquery('english', $${n}) OR c.subject ILIKE $${n + 1})`);
  }
  if (search.kind) add('c.kind = ?', search.kind);
  if (search.grade) add('c.grade = ?', search.grade);
  if (search.status) add('c.status = ?', search.status);
  if (search.freshness === 'current') where.push(`c.status = 'current' AND (c.revalidate_after IS NULL OR c.revalidate_after > NOW())`);
  if (search.freshness === 'stale') where.push(`(c.status = 'needs_revalidation' OR (c.status = 'current' AND c.revalidate_after <= NOW()))`);
  params.push(Math.min(Math.max(search.limit || 50, 1), 200));
  const res = await query(
    `SELECT c.id, c.subject, c.subject_version AS "subjectVersion", c.kind, c.statement, c.grade, c.status, c.scope,
            c.brief_id AS "briefId", c.evidence_json AS evidence, c.observed_at AS "observedAt",
            c.revalidate_after AS "revalidateAfter", c.revalidated_at AS "revalidatedAt",
            (c.status = 'current' AND (c.revalidate_after IS NULL OR c.revalidate_after > NOW())) AS current,
            ROUND(((COALESCE(own.verified_weight, 0) + 2 * ((COALESCE(agg.verified_weight, 0) + 1) / (COALESCE(agg.verified_weight, 0) + COALESCE(agg.refuted_weight, 0) + 2)))
              / (COALESCE(own.verified_weight, 0) + COALESCE(own.refuted_weight, 0) + 2))::numeric, 4)::float AS "sourceReliability"
     FROM claims c
     LEFT JOIN briefs b ON b.id = c.brief_id
     LEFT JOIN source_stats own ON own.source = c.subject AND own.source_type = ${SOURCE_TYPE_SQL}
     LEFT JOIN source_stats agg ON agg.source = '*' AND agg.source_type = ${SOURCE_TYPE_SQL}
     WHERE ${where.join(' AND ')}
     ORDER BY c.updated_at DESC
     LIMIT $${params.length}`,
    params
  );
  return res.rows as MemoryClaim[];
}

interface LockedClaim {
  id: string;
  subject: string;
  grade: string;
  status: string;
  briefId: string | null;
  evidence: any[];
}

async function claimForUpdate(client: PoolClient, claimId: string, workspaceId: string): Promise<LockedClaim | null> {
  const res = await client.query(
    `SELECT c.id, c.subject, c.grade, c.status, c.brief_id AS "briefId", c.evidence_json AS evidence, b.workspace_id AS "workspaceId"
     FROM claims c LEFT JOIN briefs b ON b.id = c.brief_id WHERE c.id = $1 FOR UPDATE OF c`,
    [claimId]
  );
  const row = res.rows[0];
  // Project-scoped claims belong to their brief's workspace; global claims are facts about public code
  if (!row || (row.briefId && row.workspaceId !== workspaceId)) return null;
  return row;
}

function sourceOf(subject: string, evidence: any): [string, string] | null {
  const method = evidence?.method || 'unknown';
  if (USER_METHODS.has(method)) return null;
  const type = SOURCE_TYPES[method] || method;
  if (type === 'platform_api') {
    const match = /^https?:\/\/([^/]+)/.exec(evidence?.sourceUrl || '');
    return [(match ? match[1] : 'api.github.com').toLowerCase(), type];
  }
  return [subject, type];
}

async function recordClaimEvent(client: PoolClient, subject: string, evidence: any[], event: 'verified' | 'refuted') {
  const seen = new Set<string>();
  for (const item of evidence || []) {
    const src = sourceOf(subject, item);
    if (!src || seen.has(src.join('|'))) continue;
    seen.add(src.join('|'));
    for (const source of new Set([src[0], '*'])) {
      await client.query(
        `INSERT INTO source_stats (source, source_type, claims_verified, claims_refuted, verified_weight, refuted_weight, last_event_at, updated_at)
         VALUES ($1, $2, $3::int, $4::int, $3::float8, $4::float8, NOW(), NOW())
         ON CONFLICT (source, source_type) DO UPDATE SET
           claims_verified = source_stats.claims_verified + EXCLUDED.claims_verified,
           claims_refuted = source_stats.claims_refuted + EXCLUDED.claims_refuted,
           verified_weight = source_stats.verified_weight * power(0.5, GREATEST(0, EXTRACT(EPOCH FROM NOW() - COALESCE(source_stats.last_event_at, NOW()))) / 86400.0 / $5) + EXCLUDED.verified_weight,
           refuted_weight = source_stats.refuted_weight * power(0.5, GREATEST(0, EXTRACT(EPOCH FROM NOW() - COALESCE(source_stats.last_event_at, NOW()))) / 86400.0 / $5) + EXCLUDED.refuted_weight,
           last_event_at = NOW(), updated_at = NOW()`,
        [source.slice(0, 300), src[1], event === 'verified' ? 1 : 0, event === 'refuted' ? 1 : 0, HALF_LIFE_DAYS]
      );
    }
  }
}

/** An event episode under the brief's latest run episode, and a feedback note on that run. */
async function recordEvent(client: PoolClient, briefId: string, outcome: 'refuted' | 'confirmed', detail: Record<string, unknown>) {
  const run = await client.query(
    `SELECT id, procedures_used::text[] AS procedures FROM episodes WHERE brief_id = $1 AND kind = 'run' ORDER BY finished_at DESC LIMIT 1`,
    [briefId]
  );
  const note = Object.fromEntries(Object.entries({ outcome, ...detail }).filter(([, v]) => v !== null && v !== undefined));
  await client.query(
    `INSERT INTO episodes (workspace_id, brief_id, parent_id, kind, outcome, title, summary, detail_json, provenance_json, finished_at)
     SELECT b.workspace_id, b.id, $2, 'event', $3, b.title, $4, $5, '{"writer": "correction"}'::jsonb, NOW() FROM briefs b WHERE b.id = $1`,
    [briefId, run.rows[0]?.id || null, outcome,
     `Claim ${outcome} on ${detail.subject || 'a finding'}${detail.reason ? `: ${detail.reason}` : ''}`, JSON.stringify(note)]
  );
  if (run.rows[0]) {
    await client.query(`UPDATE episodes SET feedback_json = feedback_json || $2::jsonb WHERE id = $1`, [run.rows[0].id, JSON.stringify([note])]);
  }
  return run.rows[0]?.procedures as string[] | undefined;
}

export interface CorrectionResult {
  claimId: string;
  status: string;
  invalidatedBriefs: string[];
}

/**
 * The user says a claim is wrong: it is downgraded (refuted, E5, refuting evidence appended), its sources lose
 * reliability, the blueprint of every brief in the workspace that cites it is re-written, and the runs that
 * relied on it record the refutation (procedures they used count it as a failure). Call inside a transaction.
 */
export async function refuteClaim(client: PoolClient, claimId: string, reason: string, workspaceId: string, userId: string | null): Promise<CorrectionResult | null> {
  const claim = await claimForUpdate(client, claimId, workspaceId);
  if (!claim) return null;
  const item = { method: 'user_refutation', grade: 'E5', reason: reason.slice(0, 1000), previousGrade: claim.grade, by: userId || undefined, at: new Date().toISOString() };
  await client.query(
    `UPDATE claims SET status = 'refuted', grade = 'E5', evidence_json = evidence_json || $2::jsonb, updated_at = NOW() WHERE id = $1`,
    [claimId, JSON.stringify([item])]
  );
  if (claim.status !== 'refuted') await recordClaimEvent(client, claim.subject, claim.evidence, 'refuted');
  const citing = await client.query(
    `SELECT bb.brief_id AS id FROM brief_blueprints bb JOIN briefs b ON b.id = bb.brief_id
     WHERE b.workspace_id = $1 AND bb.blueprint_json -> 'sources' @> $2::jsonb ORDER BY bb.brief_id`,
    [workspaceId, JSON.stringify([{ claimId }])]
  );
  const briefs: string[] = citing.rows.map((r: any) => r.id);
  for (const briefId of briefs) await invalidate(client, briefId, 'blueprint', { force: true });
  for (const briefId of Array.from(new Set([...briefs, ...(claim.briefId ? [claim.briefId] : [])])).sort()) {
    const procedures = await recordEvent(client, briefId, 'refuted', { claimId, subject: claim.subject, reason: item.reason, by: userId });
    if (procedures?.length) {
      await client.query(
        `UPDATE procedures SET uses_count = uses_count + 1, failure_count = failure_count + 1,
           confidence = ROUND((success_count::numeric / NULLIF(success_count + failure_count + 1 + 2, 0)), 2), updated_at = NOW()
         WHERE id = ANY($1::uuid[])`,
        [procedures]
      );
      await client.query(
        `UPDATE procedures SET status = 'retired', retired_at = NOW(),
           provenance_json = provenance_json || '{"retiredBecause": "failed half of its uses"}'::jsonb
         WHERE id = ANY($1::uuid[]) AND status = 'active' AND uses_count >= 4 AND failure_count * 2 >= uses_count`,
        [procedures]
      );
    }
  }
  return { claimId, status: 'refuted', invalidatedBriefs: briefs };
}

/** The user confirms a claim: recorded as evidence (a person's word does not raise the grade); its sources gain reliability. */
export async function confirmClaim(client: PoolClient, claimId: string, note: string, workspaceId: string, userId: string | null): Promise<CorrectionResult | null> {
  const claim = await claimForUpdate(client, claimId, workspaceId);
  if (!claim) return null;
  const item = { method: 'user_confirmation', note: note.slice(0, 1000) || undefined, by: userId || undefined, at: new Date().toISOString() };
  await client.query(`UPDATE claims SET evidence_json = evidence_json || $2::jsonb, updated_at = NOW() WHERE id = $1`, [claimId, JSON.stringify([item])]);
  await recordClaimEvent(client, claim.subject, claim.evidence, 'verified');
  if (claim.briefId) await recordEvent(client, claim.briefId, 'confirmed', { claimId, subject: claim.subject, by: userId });
  return { claimId, status: claim.status, invalidatedBriefs: [] };
}
