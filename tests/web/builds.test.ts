// Build-mode API rules: authorisation, scope, delivery approval, and the pull-request flow against a fake GitHub.
// Run: cd apps/web && npx tsx --test ../../tests/web/builds.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkBuildRequest, checkDeliverRequest, isSafeBranchName } from '../../apps/web/lib/builds/policy';
import { roadmapItems } from '../../apps/web/lib/builds/scope';
import { DeliveryError, openPullRequest } from '../../apps/web/lib/builds/github';

const base = {
  role: 'maintainer' as const,
  body: { authorize: true, roadmapTaskIds: ['T1'] },
  blueprintStatus: 'COMPLETED',
  roadmapIds: ['T1', 'roadmap-2'],
  requirementNames: ['Orbit propagation'],
  activeBuild: false
};

test('a member cannot authorise a build', () => {
  const d = checkBuildRequest({ ...base, role: 'member' });
  assert.equal(d.ok, false);
  assert.equal(!d.ok && d.status, 403);
});

test('a build needs the explicit authorize flag', () => {
  for (const body of [{ roadmapTaskIds: ['T1'] }, { authorize: 'true', roadmapTaskIds: ['T1'] }, { authorize: 1, roadmapTaskIds: ['T1'] }, null]) {
    const d = checkBuildRequest({ ...base, body });
    assert.equal(d.ok, false);
    assert.equal(!d.ok && d.status, 400);
    assert.match(!d.ok ? d.error : '', /authorize: true/);
  }
});

test('a build needs a completed blueprint, a known non-empty scope and no build in flight', () => {
  const noBlueprint = checkBuildRequest({ ...base, blueprintStatus: 'RUNNING' });
  assert.equal(!noBlueprint.ok && noBlueprint.status, 409);
  const empty = checkBuildRequest({ ...base, body: { authorize: true } });
  assert.equal(!empty.ok && empty.status, 400);
  const unknown = checkBuildRequest({ ...base, body: { authorize: true, roadmapTaskIds: ['T9'] } });
  assert.equal(!unknown.ok && unknown.status, 400);
  const tooMany = checkBuildRequest({ ...base, roadmapIds: ['a', 'b', 'c', 'd', 'e', 'f'], body: { authorize: true, roadmapTaskIds: ['a', 'b', 'c', 'd', 'e', 'f'] } });
  assert.equal(!tooMany.ok && tooMany.status, 400);
  const busy = checkBuildRequest({ ...base, activeBuild: true });
  assert.equal(!busy.ok && busy.status, 409);
  const ok = checkBuildRequest({ ...base, body: { authorize: true, roadmapTaskIds: ['T1', 'T1'], requirements: ['Orbit propagation'] } });
  assert.deepEqual(ok, { ok: true, value: { roadmapTaskIds: ['T1'], requirements: ['Orbit propagation'] } });
});

const deliver = { role: 'maintainer' as const, body: { approve: true, repo: 'acme/tracker', branch: 'open-eye/build-1' }, buildStatus: 'succeeded' as const, hasChangeSet: true };

test('delivery needs a maintainer and explicit approval', () => {
  const member = checkDeliverRequest({ ...deliver, role: 'member' });
  assert.equal(!member.ok && member.status, 403);
  const unapproved = checkDeliverRequest({ ...deliver, body: { repo: 'acme/tracker', branch: 'x' } });
  assert.equal(!unapproved.ok && unapproved.status, 400);
  assert.deepEqual(checkDeliverRequest(deliver), { ok: true, value: { repo: 'acme/tracker', branch: 'open-eye/build-1' } });
});

test('delivery refuses unfinished, delivered or empty builds and default branches', () => {
  assert.equal(checkDeliverRequest({ ...deliver, buildStatus: 'running' }).ok, false);
  assert.equal(checkDeliverRequest({ ...deliver, buildStatus: 'failed' }).ok, false);
  assert.equal(checkDeliverRequest({ ...deliver, buildStatus: 'delivered' }).ok, false);
  assert.equal(checkDeliverRequest({ ...deliver, hasChangeSet: false }).ok, false);
  assert.equal(checkDeliverRequest({ ...deliver, buildStatus: 'awaiting_approval' }).ok, true);
  for (const branch of ['main', 'Master', 'develop', 'a..b', '-x', 'x/', 'x.lock', 'a b', 'refs//x', '']) {
    assert.equal(isSafeBranchName(branch), false, branch);
  }
  assert.equal(checkDeliverRequest({ ...deliver, body: { ...deliver.body, repo: 'not a repo' } }).ok, false);
});

test('roadmap items mirror the worker: roadmap ids, then to-build fallbacks', () => {
  const items = roadmapItems({ roadmap: { tasks: [{ id: 'T1', title: 'Propagation', acceptanceCriteria: ['Returns a position'] }, { title: 'Globe' }] } });
  assert.deepEqual(items.map((i) => i.id), ['T1', 'roadmap-2']);
  assert.deepEqual(roadmapItems({ toBuild: [{ title: 'TLE ingestion' }] }).map((i) => i.id), ['build-1']);
  assert.deepEqual(roadmapItems(null), []);
});

function fakeGitHub(options: { defaultBranch?: string; existingBranches?: string[] } = {}) {
  const calls: Array<{ method: string; url: string; body: any; auth: string }> = [];
  const existing = new Set(['main', ...(options.existingBranches || [])]);
  const fetchImpl = async (url: string, init: any) => {
    const method = init?.method || 'GET';
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body, auth: init?.headers?.Authorization });
    const path = url.replace('https://api.github.com/repos/acme/tracker', '');
    const reply = (status: number, data: any) => ({ ok: status < 300, status, json: async () => data });
    if (method === 'GET' && path === '') return reply(200, { default_branch: options.defaultBranch || 'main' });
    if (method === 'GET' && path.startsWith('/git/ref/heads/')) {
      const name = decodeURIComponent(path.slice('/git/ref/heads/'.length));
      return existing.has(name) ? reply(200, { object: { sha: 'base-sha' } }) : reply(404, { message: 'Not Found' });
    }
    if (method === 'GET' && path === '/git/commits/base-sha') return reply(200, { tree: { sha: 'base-tree' } });
    if (method === 'POST' && path === '/git/trees') return reply(201, { sha: 'new-tree' });
    if (method === 'POST' && path === '/git/commits') return reply(201, { sha: 'new-commit' });
    if (method === 'POST' && path === '/git/refs') return reply(201, {});
    if (method === 'POST' && path === '/pulls') return reply(201, { html_url: 'https://github.com/acme/tracker/pull/7', number: 7 });
    return reply(500, {});
  };
  return { calls, fetchImpl };
}

const prInput = { token: 'test-token', repo: 'acme/tracker', files: { 'a.py': 'x = 1\n' }, pathPrefix: 'open-eye/build-1', title: 'Build', body: 'report' };

test('the pull request goes on a new branch into the default branch', async () => {
  const gh = fakeGitHub();
  const result = await openPullRequest({ ...prInput, branch: 'open-eye/build-1', fetchImpl: gh.fetchImpl });
  assert.equal(result.pullRequestUrl, 'https://github.com/acme/tracker/pull/7');
  assert.equal(result.baseBranch, 'main');
  const tree = gh.calls.find((c) => c.url.endsWith('/git/trees'))!;
  assert.equal(tree.body.tree[0].path, 'open-eye/build-1/a.py');
  const ref = gh.calls.find((c) => c.url.endsWith('/git/refs'))!;
  assert.equal(ref.body.ref, 'refs/heads/open-eye/build-1');
  const pr = gh.calls.find((c) => c.url.endsWith('/pulls'))!;
  assert.deepEqual([pr.body.head, pr.body.base, pr.body.draft], ['open-eye/build-1', 'main', true]);
  // Nothing ever updates an existing ref (no PATCH), and the token is only in the Authorization header
  assert.equal(gh.calls.some((c) => c.method === 'PATCH'), false);
  assert.equal(gh.calls.every((c) => c.auth === 'Bearer test-token' && !JSON.stringify(c.body || {}).includes('test-token')), true);
});

test('the default branch and existing branches are refused before anything is written', async () => {
  const custom = fakeGitHub({ defaultBranch: 'stable' });
  await assert.rejects(openPullRequest({ ...prInput, branch: 'stable', fetchImpl: custom.fetchImpl }), DeliveryError);
  assert.equal(custom.calls.some((c) => c.method === 'POST'), false);
  const taken = fakeGitHub({ existingBranches: ['open-eye/build-1'] });
  await assert.rejects(openPullRequest({ ...prInput, branch: 'open-eye/build-1', fetchImpl: taken.fetchImpl }), /already exists/);
  assert.equal(taken.calls.some((c) => c.method === 'POST'), false);
});
