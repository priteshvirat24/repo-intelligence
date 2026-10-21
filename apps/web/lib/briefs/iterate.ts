import type { PoolClient } from '@repo/database';
import type { BlueprintChallenge, BlueprintFocus } from '@repo/shared';
import { invalidate } from './run';

// Iterating on a blueprint without restarting the run (PRODUCT_DEFINITION 4.1 step 6). Each action stores what
// the user asked for on the brief, then invalidates only the task that has to answer it:
//   challenge a decision    -> the blueprint task re-runs and answers the challenge explicitly
//   investigate deeper      -> discovery re-runs with extra queries for one requirement (and what follows)

const MAX_STORED_CHALLENGES = 20;
const MAX_FOCUS = 3; // keep in step with apps/worker/discovery/planner.py MAX_FOCUS
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

export class IterationError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface ChallengeInput {
  requirement: string;
  repo?: string | null;
  note: string;
}

export function parseChallenge(body: unknown): ChallengeInput {
  if (!body || typeof body !== 'object') throw new IterationError('Send the requirement and a note.');
  const b = body as Record<string, unknown>;
  const requirement = typeof b.requirement === 'string' ? b.requirement.trim().slice(0, 300) : '';
  const note = typeof b.note === 'string' ? b.note.trim().slice(0, 1000) : '';
  let repo = typeof b.repo === 'string' ? b.repo.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '') : '';
  if (!requirement) throw new IterationError('Name the requirement whose decision you are challenging.');
  if (!note && !repo) throw new IterationError('Say why, or name the repository you think should be used.');
  if (repo && !REPO_RE.test(repo)) throw new IterationError('The repository must be written as owner/name.');
  return { requirement, repo: repo || null, note };
}

export function parseRequirement(body: unknown): string {
  const requirement = body && typeof body === 'object' && typeof (body as any).requirement === 'string' ? (body as any).requirement.trim().slice(0, 300) : '';
  if (!requirement) throw new IterationError('Name the requirement to investigate.');
  return requirement;
}

/** The requirement's exact name in the brief, matched case-insensitively; null when the brief has no such requirement. */
async function requirementName(client: PoolClient, briefId: string, requirement: string): Promise<string | null> {
  const res = await client.query(
    `SELECT r->>'name' AS name FROM briefs b, jsonb_array_elements(COALESCE(b.requirements_json->'requirements', '[]'::jsonb)) r
     WHERE b.id = $1 AND lower(r->>'name') = lower($2) LIMIT 1`,
    [briefId, requirement]
  );
  return res.rows[0]?.name ?? null;
}

/** Stores a challenge and re-runs only the blueprint (forced: its other inputs are unchanged). */
export async function recordChallenge(client: PoolClient, briefId: string, input: ChallengeInput, userId: string | null): Promise<BlueprintChallenge> {
  const name = await requirementName(client, briefId, input.requirement);
  if (!name) throw new IterationError('The brief has no requirement with that name.', 404);
  const challenge: BlueprintChallenge = {
    id: crypto.randomUUID(),
    requirement: name,
    repo: input.repo || null,
    note: input.note,
    createdAt: new Date().toISOString(),
    createdBy: userId
  };
  await client.query(
    `UPDATE briefs SET challenges_json = (
       SELECT COALESCE(jsonb_agg(c ORDER BY n), '[]'::jsonb) FROM (
         SELECT c, n FROM jsonb_array_elements(challenges_json || jsonb_build_array($2::jsonb)) WITH ORDINALITY AS t(c, n)
         ORDER BY n DESC LIMIT $3
       ) newest
     ), updated_at = NOW()
     WHERE id = $1`,
    [briefId, JSON.stringify(challenge), MAX_STORED_CHALLENGES]
  );
  await invalidate(client, briefId, 'blueprint', { force: true });
  return challenge;
}

/** Records a requirement to investigate deeper and re-runs discovery (and what depends on it). */
export async function recordDeepen(client: PoolClient, briefId: string, requirement: string): Promise<BlueprintFocus[]> {
  const name = await requirementName(client, briefId, requirement);
  if (!name) throw new IterationError('The brief has no requirement with that name.', 404);
  const res = await client.query(`SELECT focus_json FROM briefs WHERE id = $1 FOR UPDATE`, [briefId]);
  const current: BlueprintFocus[] = Array.isArray(res.rows[0]?.focus_json) ? res.rows[0].focus_json : [];
  const focus = [...current.filter((f) => f?.requirement?.toLowerCase() !== name.toLowerCase()), { requirement: name, createdAt: new Date().toISOString() }].slice(-MAX_FOCUS);
  await client.query(`UPDATE briefs SET focus_json = $2::jsonb, updated_at = NOW() WHERE id = $1`, [briefId, JSON.stringify(focus)]);
  await invalidate(client, briefId, 'discover', { force: true });
  return focus;
}
