import { query } from '@repo/database';
import type { BuildDetail, BuildSummary } from '@repo/shared';

const SUMMARY = `
  id, brief_id as "briefId", status, step, scope_json as "scope", iterations, max_iterations as "maxIterations",
  NULLIF(test_report_json->>'outcome', '') as outcome, error_message as "errorMessage", delivery_json as delivery,
  created_at as "createdAt", started_at as "startedAt", finished_at as "finishedAt"`;

export async function listBuilds(briefId: string, workspaceId: string, limit = 20): Promise<BuildSummary[]> {
  const res = await query<BuildSummary>(
    `SELECT ${SUMMARY} FROM builds WHERE brief_id = $1 AND workspace_id = $2 ORDER BY created_at DESC LIMIT $3`,
    [briefId, workspaceId, limit]
  );
  return res.rows;
}

export async function getBuild(briefId: string, buildId: string, workspaceId: string): Promise<(BuildDetail & { fileContents: Record<string, string> }) | null> {
  const res = await query(
    `SELECT ${SUMMARY}, NULLIF(test_report_json, '{}'::jsonb) as report, diff_text as diff, files_json as "fileContents"
     FROM builds WHERE id = $1 AND brief_id = $2 AND workspace_id = $3`,
    [buildId, briefId, workspaceId]
  );
  const row = res.rows[0];
  if (!row) return null;
  return { ...row, files: Object.keys(row.fileContents || {}).sort() };
}

export async function blueprintForBuild(briefId: string): Promise<{ status: string | null; blueprint: any; requirementNames: string[] }> {
  const res = await query(
    `SELECT bp.status, bp.blueprint_json as blueprint, b.requirements_json->'requirements' as requirements
     FROM briefs b LEFT JOIN brief_blueprints bp ON bp.brief_id = b.id WHERE b.id = $1`,
    [briefId]
  );
  const row = res.rows[0] || {};
  const requirementNames = (Array.isArray(row.requirements) ? row.requirements : [])
    .map((r: any) => r?.name)
    .filter((n: unknown): n is string => typeof n === 'string');
  return { status: row.status ?? null, blueprint: row.blueprint || {}, requirementNames };
}
