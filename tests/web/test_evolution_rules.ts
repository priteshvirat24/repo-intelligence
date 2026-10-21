/**
 * Phase 5 web rules: feedback validation, label proposals and who may govern the configuration.
 *
 *   cd apps/web && npx tsx ../../tests/web/test_evolution_rules.ts
 */
import assert from 'node:assert/strict';
import { canGovernEvolution, changedKeys, labelProposalFor, parseFeedback } from '../../apps/web/lib/evolution/rules';

const BRIEF = '0b7c4f8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f';
const CLAIM = '5f4e3d2c-1b0a-4f9e-8d7c-6b5a4f3e2d1c';
let passed = 0;

function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

function error(body: unknown): string {
  const r = parseFeedback(body);
  assert.equal(r.ok, false, `expected ${JSON.stringify(body)} to be refused`);
  return (r as { ok: false; error: string }).error;
}

test('valid feedback is accepted and normalised', () => {
  const r = parseFeedback({ briefId: BRIEF.toUpperCase(), targetKind: 'candidate', targetId: ' celery/celery ', verdict: 'useful', note: '  great  ' });
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.value, { briefId: BRIEF, targetKind: 'candidate', targetId: 'celery/celery', verdict: 'useful', note: 'great' });
  const cleared = parseFeedback({ briefId: BRIEF, targetKind: 'blueprint_decision', targetId: 'Job queue', verdict: null });
  assert.ok(cleared.ok && cleared.value.verdict === null && cleared.value.note === null);
  assert.ok(parseFeedback({ briefId: BRIEF, targetKind: 'claim', targetId: CLAIM, verdict: 'wrong' }).ok);
});

test('malformed feedback is refused with a reason', () => {
  assert.match(error(null), /JSON object/);
  assert.match(error([]), /JSON object/);
  assert.match(error({ briefId: 'nope', targetKind: 'candidate', targetId: 'a/b', verdict: 'useful' }), /briefId/);
  assert.match(error({ briefId: BRIEF, targetKind: 'tweet', targetId: 'a/b', verdict: 'useful' }), /targetKind/);
  assert.match(error({ briefId: BRIEF, targetKind: 'candidate', targetId: '', verdict: 'useful' }), /targetId/);
  assert.match(error({ briefId: BRIEF, targetKind: 'candidate', targetId: 'x'.repeat(301), verdict: 'useful' }), /targetId/);
  assert.match(error({ briefId: BRIEF, targetKind: 'candidate', targetId: 'not a repo', verdict: 'useful' }), /owner\/repository/);
  assert.match(error({ briefId: BRIEF, targetKind: 'claim', targetId: 'a/b', verdict: 'wrong' }), /claim/);
  assert.match(error({ briefId: BRIEF, targetKind: 'blueprint_decision', targetId: 'bad\u0000name', verdict: 'wrong' }), /targetId/);
  // A verdict must fit its kind: candidates are useful or not, decisions right or wrong
  assert.match(error({ briefId: BRIEF, targetKind: 'candidate', targetId: 'a/b', verdict: 'correct' }), /useful or not_useful/);
  assert.match(error({ briefId: BRIEF, targetKind: 'blueprint_decision', targetId: 'Queue', verdict: 'useful' }), /correct or wrong/);
  assert.match(error({ briefId: BRIEF, targetKind: 'candidate', targetId: 'a/b' }), /verdict/);
  assert.match(error({ briefId: BRIEF, targetKind: 'candidate', targetId: 'a/b', verdict: 'useful', note: 5 }), /note/);
  assert.match(error({ briefId: BRIEF, targetKind: 'candidate', targetId: 'a/b', verdict: 'useful', note: 'x'.repeat(1001) }), /1000/);
});

test('feedback becomes a label proposal only when it suggests a label change', () => {
  const input = (targetKind: any, targetId: string, verdict: any) => ({ briefId: BRIEF, targetKind, targetId, verdict, note: null });
  const useful = labelProposalFor(input('candidate', 'a/b', 'useful'), { rank: 17, shortlisted: false });
  assert.equal(useful?.kind, 'solution');
  assert.equal(useful?.proposal.shownRank, 17);
  assert.equal(labelProposalFor(input('candidate', 'a/b', 'not_useful'), { rank: 2, shortlisted: true })?.kind, 'trap');
  assert.equal(labelProposalFor(input('candidate', 'a/b', 'not_useful'), { rank: 30, shortlisted: false }), null);
  const decision = labelProposalFor(input('blueprint_decision', 'Job queue', 'wrong'), { decision: 'reuse', repo: 'automattic/kue' });
  assert.deepEqual([decision?.kind, decision?.requirement, decision?.repo], ['decision_review', 'Job queue', 'automattic/kue']);
  assert.equal(labelProposalFor(input('blueprint_decision', 'Job queue', 'correct'), {}), null);
  assert.equal(labelProposalFor(input('claim', CLAIM, 'wrong'), { grade: 'E4' })?.kind, 'claim_review');
});

test('only operator maintainers govern the configuration once sign-in is on', () => {
  // Single-workspace mode: the shared workspace's maintainer (everyone) decides
  assert.equal(canGovernEvolution({ authenticated: false, role: 'maintainer' }, false), true);
  // Every signed-in user maintains a personal workspace; that is not enough for global configuration
  assert.equal(canGovernEvolution({ authenticated: true, role: 'maintainer' }, false), false);
  assert.equal(canGovernEvolution({ authenticated: true, role: 'member' }, false), false);
  assert.equal(canGovernEvolution({ authenticated: true, role: 'member' }, true), true);
});

test('changed keys compare whole values', () => {
  assert.deepEqual(changedKeys({ a: 1, b: { x: 1 }, c: 'p' }, { a: 1, b: { x: 2 }, c: 'p' }), ['b']);
  assert.deepEqual(changedKeys({ a: 1 }, null), []);
});

console.log(`${passed} passed`);
