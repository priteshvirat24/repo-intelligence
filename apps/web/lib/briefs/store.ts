import { query } from '@repo/database';
import { BlueprintVerification, BriefBlueprint, BriefCandidate, BriefDetail, BriefSummary, BriefUsage, CandidateClaim } from '@repo/shared';
import { DEFAULT_BUDGET } from './constraints';

// Connector providers metered against sourceRequests; keep in step with apps/worker/providers/ledger.py SOURCE_PROVIDERS
const SOURCE_PROVIDERS = ['depsdev', 'osv', 'npm', 'crates', 'stackexchange', 'tavily', 'arxiv', 'docs'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

const SUMMARY_COLUMNS = `
  b.id,
  b.title,
  b.source_type as "sourceType",
  b.source_filename as "sourceFilename",
  b.status,
  b.step,
  b.error_message as "errorMessage",
  COALESCE(jsonb_array_length(b.requirements_json->'requirements'), 0)::int as "requirementCount",
  (SELECT COUNT(*) FROM brief_candidates c WHERE c.brief_id = b.id)::int as "candidateCount",
  (SELECT COUNT(*) FROM brief_candidates c WHERE c.brief_id = b.id AND c.shortlisted)::int as "shortlistedCount",
  b.created_at as "createdAt",
  b.discovered_at as "discoveredAt"
`;

export async function listBriefs(workspaceId: string, limit = 50): Promise<BriefSummary[]> {
  const res = await query<BriefSummary>(
    `SELECT ${SUMMARY_COLUMNS} FROM briefs b WHERE b.workspace_id = $1 ORDER BY b.created_at DESC LIMIT $2`,
    [workspaceId, limit]
  );
  return res.rows;
}

/** The brief only if it belongs to the workspace (briefs are private to their workspace). */
export async function briefInWorkspace(id: string, workspaceId: string): Promise<boolean> {
  const res = await query('SELECT 1 FROM briefs WHERE id = $1 AND workspace_id = $2', [id, workspaceId]);
  return (res.rowCount || 0) > 0;
}

export async function getBrief(id: string, workspaceId: string): Promise<BriefDetail | null> {
  const briefRes = await query(
    `SELECT ${SUMMARY_COLUMNS},
       b.brief_text as "briefText",
       b.decomposition_mode as "decompositionMode",
       b.requirements_json as "requirements",
       b.discovery_json as "discovery",
       b.content_hash as "contentHash",
       b.constraints_json as "constraints",
       b.answers_json as "answers",
       NULLIF(b.understanding_json, '{}'::jsonb) as "understanding",
       b.budget_json as "budgetJson",
       b.stop_reason as "stopReason"
     FROM briefs b WHERE b.id = $1 AND b.workspace_id = $2`,
    [id, workspaceId]
  );
  const brief = briefRes.rows[0];
  if (!brief) return null;
  const tasksRes = await query(
    `SELECT type, status, error_message as "errorMessage", started_at as "startedAt", finished_at as "finishedAt", updated_at as "updatedAt"
     FROM tasks WHERE brief_id = $1`,
    [id]
  );
  const order = ['understand', 'discover', 'verify', 'docs', 'blueprint'];
  brief.tasks = tasksRes.rows.sort((a: any, b: any) => order.indexOf(a.type) - order.indexOf(b.type));
  brief.budget = await getBudget(id, brief.budgetJson || {});
  delete brief.budgetJson;

  const candidatesRes = await query(
    `SELECT
       id,
       full_name as "fullName",
       source_url as "sourceUrl",
       description,
       primary_language as "primaryLanguage",
       topics,
       stars,
       forks,
       open_issues as "openIssues",
       license,
       pushed_at as "pushedAt",
       candidate_kind as "candidateKind",
       matched_queries as "matchedQueries",
       matched_requirements as "matchedRequirements",
       relevance_score::float as "relevanceScore",
       health_score::float as "healthScore",
       coverage_score::float as "coverageScore",
       final_score::float as "finalScore",
       rank,
       shortlisted,
       duplicate_of as "duplicateOf",
       assessment_json as "assessment",
       sources,
       packages_json as "packages",
       homepage
     FROM brief_candidates
     WHERE brief_id = $1
     ORDER BY rank ASC`,
    [id]
  );

  const candidates = candidatesRes.rows as BriefCandidate[];
  await attachEvidence(candidates);
  const { contentHash, ...rest } = brief;
  return { ...rest, candidates, blueprint: await getBlueprint(id), usage: await getUsage(id, contentHash) };
}

/** Phase 2: registry, advisory, docs and forum claims about the shortlisted candidates (global claims from
 * the docs task). Capabilities are shown only when quoted from official docs; code-located ones belong to the
 * verification view. */
async function attachEvidence(candidates: BriefCandidate[]) {
  const shortlisted = candidates.filter((c) => c.shortlisted);
  if (shortlisted.length === 0) return;
  const subjects = shortlisted.map((c) => `github:${c.fullName.toLowerCase()}`);
  const res = await query(
    `SELECT id, subject, kind, statement, grade, status,
            evidence_json->-1->>'sourceUrl' AS "sourceUrl",
            evidence_json->-1->>'excerpt' AS excerpt,
            evidence_json->-1->'locator'->>'section' AS section,
            evidence_json->-1->'advisoryIds' AS "advisoryIds",
            evidence_json->-1->>'severity' AS severity
     FROM claims
     WHERE subject = ANY($1) AND brief_id IS NULL AND status <> 'refuted'
       AND (kind IN ('vulnerability', 'known_issue', 'licence_conflict')
            OR (kind = 'capability' AND evidence_json @> '[{"method": "docs_quote"}]'::jsonb)
            OR (kind = 'maintenance' AND evidence_json @> '[{"method": "scorecard"}]'::jsonb))
     ORDER BY subject, kind, grade, statement
     LIMIT 400`,
    [subjects]
  );
  const bySubject = new Map<string, CandidateClaim[]>();
  for (const row of res.rows as any[]) {
    const { subject, ...claim } = row;
    if (!bySubject.has(subject)) bySubject.set(subject, []);
    bySubject.get(subject)!.push(claim as CandidateClaim);
  }
  for (const c of shortlisted) c.evidence = bySubject.get(`github:${c.fullName.toLowerCase()}`) || [];
}

async function getBudget(briefId: string, budgetJson: any) {
  const res = await query(
    `SELECT COUNT(*) FILTER (WHERE provider <> 'github' AND provider <> ALL($3) AND operation <> 'embedding')::int AS "llmCalls",
            COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) FILTER (WHERE provider <> 'github' AND provider <> ALL($3)), 0)::int AS tokens,
            COUNT(*) FILTER (WHERE provider = 'github')::int AS "githubRequests",
            COUNT(*) FILTER (WHERE provider = ANY($3))::int AS "sourceRequests"
     FROM provider_usage
     WHERE scope_type = 'brief' AND scope_id = $1::text AND ($2::timestamptz IS NULL OR created_at >= $2::timestamptz)`,
    [briefId, budgetJson.resetAt || null, SOURCE_PROVIDERS]
  );
  return { limits: { ...DEFAULT_BUDGET, ...(budgetJson.limits || {}) }, used: res.rows[0] };
}

/** Ledger totals for everything spent on a brief: understanding the upload, discovery, indexing the
 * verification repositories (jobs queued by this brief's blueprint) and writing the blueprint. */
async function getUsage(briefId: string, contentHash: string): Promise<BriefUsage> {
  const res = await query(
    `WITH bp AS (SELECT id, created_at, verification_json FROM brief_blueprints WHERE brief_id = $1),
          jobs AS (
            SELECT j.id::text AS id FROM ingestion_jobs j, bp, jsonb_array_elements(bp.verification_json) v
            WHERE v->>'state' = 'queued' AND j.repository_id::text = v->>'repositoryId' AND j.created_at >= bp.created_at - INTERVAL '1 minute'
          )
     SELECT CASE
              WHEN u.scope_type = 'brief_upload' OR u.purpose = 'understanding' THEN 'understanding'
              WHEN u.scope_type = 'brief' AND u.purpose = 'blueprint' THEN 'blueprint'
              WHEN u.scope_type = 'brief' THEN 'discovery'
              WHEN u.scope_type = 'repository_job' THEN 'verification'
              ELSE 'blueprint'
            END AS stage,
            COUNT(*)::int AS calls,
            COUNT(*) FILTER (WHERE NOT u.success)::int AS failed,
            COALESCE(SUM(u.input_tokens), 0)::int AS input,
            COALESCE(SUM(u.output_tokens), 0)::int AS output,
            SUM(u.cost_cents)::float AS cost,
            COUNT(*) FILTER (WHERE u.cost_cents IS NULL)::int AS unpriced
     FROM provider_usage u
     WHERE u.provider <> ALL($3) AND ((u.scope_type = 'brief_upload' AND u.scope_id = left($2, 16))
        OR (u.scope_type = 'brief' AND u.scope_id = $1::text)
        OR (u.scope_type = 'blueprint' AND u.scope_id IN (SELECT id::text FROM bp))
        OR (u.scope_type = 'repository_job' AND u.scope_id IN (SELECT id FROM jobs)))
     GROUP BY 1`,
    [briefId, contentHash, SOURCE_PROVIDERS]
  );
  const order = ['understanding', 'discovery', 'verification', 'blueprint'];
  const rows = [...res.rows].sort((a: any, b: any) => order.indexOf(a.stage) - order.indexOf(b.stage));
  const unpriced = rows.some((r: any) => r.unpriced > 0);
  return {
    calls: rows.reduce((n: number, r: any) => n + r.calls, 0),
    failedCalls: rows.reduce((n: number, r: any) => n + r.failed, 0),
    inputTokens: rows.reduce((n: number, r: any) => n + r.input, 0),
    outputTokens: rows.reduce((n: number, r: any) => n + r.output, 0),
    costCents: rows.length === 0 ? 0 : unpriced ? null : rows.reduce((n: number, r: any) => n + (r.cost || 0), 0),
    byStage: rows.map((r: any) => ({ stage: r.stage, calls: r.calls, inputTokens: r.input, outputTokens: r.output }))
  };
}

async function getBlueprint(briefId: string): Promise<BriefBlueprint | null> {
  const res = await query(
    `SELECT status, step, error_message as "errorMessage", verification_json as "verification",
            NULLIF(blueprint_json, '{}'::jsonb) as "blueprint", completed_at as "completedAt"
     FROM brief_blueprints WHERE brief_id = $1`,
    [briefId]
  );
  const row = res.rows[0];
  if (!row) return null;

  const verification: BlueprintVerification[] = row.verification || [];
  const repoIds = verification.map((v) => v.repositoryId).filter((v): v is string => Boolean(v && isUuid(v)));
  if (repoIds.length > 0) {
    const repos = await query(
      `SELECT r.id, r.status,
              (SELECT j.step FROM ingestion_jobs j WHERE j.repository_id = r.id ORDER BY j.created_at DESC LIMIT 1) as step
       FROM repositories r WHERE r.id = ANY($1::uuid[])`,
      [repoIds]
    );
    const byId = new Map(repos.rows.map((r: any) => [r.id, r]));
    for (const v of verification) {
      const repo: any = v.repositoryId ? byId.get(v.repositoryId) : undefined;
      v.repositoryStatus = repo?.status ?? null;
      v.jobStep = repo?.step ?? null;
    }
  }
  return { ...row, verification };
}
