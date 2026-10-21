/**
 * Database-level check of iterating on a blueprint (Phase 3): what POST /api/briefs/[id]/challenge and
 * POST /api/briefs/[id]/deepen write, and which tasks they invalidate. Runs against DATABASE_URL; use a test
 * database:
 *
 *   cd apps/web && DATABASE_URL=postgresql://postgres@localhost:55432/openeye_test npx tsx scripts/test-blueprint-iteration.ts
 */
import assert from 'node:assert/strict';
import { pool } from '@repo/database';
import { createRun } from '../lib/briefs/run';
import { IterationError, parseChallenge, parseRequirement, recordChallenge, recordDeepen } from '../lib/briefs/iterate';

const REQUIREMENTS = {
  problemSummary: 'Iteration check',
  requirements: [
    { name: 'Orbit propagation', criticality: 'MUST', type: 'functional' },
    { name: 'Ground tracks', criticality: 'SHOULD', type: 'functional' },
    { name: 'Pass prediction', criticality: 'SHOULD', type: 'functional' },
    { name: 'Globe rendering', criticality: 'MUST', type: 'functional' }
  ]
};

async function tasks(client: any, briefId: string) {
  const res = await client.query(`SELECT type, status, inputs_fingerprint FROM tasks WHERE brief_id = $1`, [briefId]);
  return Object.fromEntries(res.rows.map((r: any) => [r.type, { status: r.status, fingerprint: r.inputs_fingerprint }]));
}

async function allDone(client: any, briefId: string) {
  await client.query(`UPDATE tasks SET status = 'done', inputs_fingerprint = 'fp' WHERE brief_id = $1`, [briefId]);
  await client.query(`UPDATE briefs SET status = 'COMPLETED' WHERE id = $1`, [briefId]);
}

async function expectError(promise: Promise<unknown>, status: number) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof IterationError, String(error));
    assert.equal((error as IterationError).status, status);
    return;
  }
  assert.fail('expected an IterationError');
}

async function main() {
  const client = await pool.connect();
  let briefId: string | null = null;
  try {
    const res = await client.query(
      `INSERT INTO briefs (title, brief_text, content_hash, requirements_json, workspace_id)
       VALUES ('Iteration check', 'text', 'iteration-check', $1, '00000000-0000-0000-0000-000000000001') RETURNING id`,
      [JSON.stringify(REQUIREMENTS)]
    );
    briefId = res.rows[0].id as string;
    await createRun(client, briefId);
    await allDone(client, briefId);

    // Input validation
    assert.throws(() => parseChallenge({ requirement: 'Ground tracks' }), IterationError);
    assert.throws(() => parseChallenge({ requirement: 'Ground tracks', repo: 'not a repo' }), IterationError);
    assert.deepEqual(parseChallenge({ requirement: ' Ground tracks ', repo: 'https://github.com/a/b/', note: '' }), { requirement: 'Ground tracks', repo: 'a/b', note: '' });
    assert.throws(() => parseRequirement({}), IterationError);

    // A challenge is stored under the requirement's exact name and re-runs only the blueprint, forced
    const challenge = await recordChallenge(client, briefId, { requirement: 'ground tracks', repo: 'shashwatak/satellite-js', note: 'Why not?' }, null);
    assert.equal(challenge.requirement, 'Ground tracks');
    let t = await tasks(client, briefId);
    assert.deepEqual([t.understand.status, t.discover.status, t.verify.status], ['done', 'done', 'done']);
    assert.equal(t.blueprint.status, 'stale');
    assert.equal(t.blueprint.fingerprint, null);
    let brief = (await client.query(`SELECT status, challenges_json, focus_json FROM briefs WHERE id = $1`, [briefId])).rows[0];
    assert.equal(brief.status, 'QUEUED');
    assert.equal(brief.challenges_json.length, 1);
    assert.equal(brief.challenges_json[0].repo, 'shashwatak/satellite-js');
    assert.deepEqual(brief.focus_json, []);

    // At most 20 challenges are kept, the newest, oldest first
    for (let i = 0; i < 21; i++) await recordChallenge(client, briefId, { requirement: 'Orbit propagation', note: `n${i}` }, null);
    brief = (await client.query(`SELECT challenges_json FROM briefs WHERE id = $1`, [briefId])).rows[0];
    assert.equal(brief.challenges_json.length, 20);
    assert.equal(brief.challenges_json[19].note, 'n20');
    assert.equal(brief.challenges_json[0].note, 'n1');

    await expectError(recordChallenge(client, briefId, { requirement: 'Not in the brief', note: 'x' }, null), 404);

    // Investigating deeper re-runs discovery (forced) and everything after it, not the understanding
    await allDone(client, briefId);
    let focus = await recordDeepen(client, briefId, 'pass prediction');
    assert.deepEqual(focus.map((f) => f.requirement), ['Pass prediction']);
    t = await tasks(client, briefId);
    assert.equal(t.understand.status, 'done');
    assert.deepEqual([t.discover.status, t.verify.status, t.blueprint.status], ['stale', 'stale', 'stale']);
    assert.equal(t.discover.fingerprint, null);
    assert.equal(t.verify.fingerprint, 'fp');

    // At most three focus requirements, without duplicates; asking again moves one to the end
    for (const name of ['Ground tracks', 'Globe rendering', 'Orbit propagation', 'Ground tracks']) focus = await recordDeepen(client, briefId, name);
    assert.deepEqual(focus.map((f) => f.requirement), ['Globe rendering', 'Orbit propagation', 'Ground tracks']);
    brief = (await client.query(`SELECT focus_json FROM briefs WHERE id = $1`, [briefId])).rows[0];
    assert.deepEqual(brief.focus_json.map((f: any) => f.requirement), ['Globe rendering', 'Orbit propagation', 'Ground tracks']);
    await expectError(recordDeepen(client, briefId, 'Not in the brief'), 404);

    console.log('blueprint iteration: all checks passed');
  } finally {
    if (briefId) await client.query(`DELETE FROM briefs WHERE id = $1`, [briefId]);
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
