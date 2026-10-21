import { query } from '@repo/database';
import { BlueprintVerification, BriefBlueprint, BriefCandidate, BriefDetail, BriefSummary } from '@repo/shared';

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

export async function listBriefs(limit = 50): Promise<BriefSummary[]> {
  const res = await query<BriefSummary>(
    `SELECT ${SUMMARY_COLUMNS} FROM briefs b ORDER BY b.created_at DESC LIMIT $1`,
    [limit]
  );
  return res.rows;
}

export async function getBrief(id: string): Promise<BriefDetail | null> {
  const briefRes = await query(
    `SELECT ${SUMMARY_COLUMNS},
       b.brief_text as "briefText",
       b.decomposition_mode as "decompositionMode",
       b.requirements_json as "requirements",
       b.discovery_json as "discovery"
     FROM briefs b WHERE b.id = $1`,
    [id]
  );
  const brief = briefRes.rows[0];
  if (!brief) return null;

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
       assessment_json as "assessment"
     FROM brief_candidates
     WHERE brief_id = $1
     ORDER BY rank ASC`,
    [id]
  );

  return { ...brief, candidates: candidatesRes.rows as BriefCandidate[], blueprint: await getBlueprint(id) };
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
