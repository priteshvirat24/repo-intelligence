import { query } from '@repo/database';
import { BriefCandidate, BriefDetail, BriefSummary } from '@repo/shared';

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

  return { ...brief, candidates: candidatesRes.rows as BriefCandidate[] };
}
