import type { BuildScope, BuildStatus } from '@repo/shared';

// Who may start and deliver a build, and what a request must say (PRODUCT_DEFINITION 7.1: running a build
// needs approval; external actions with consequences need approval; SYSTEM_DESIGN 11: a branch and pull
// request only after explicit approval). Pure functions, so the rules are tested without a server.

export type Decision<T = undefined> = { ok: true; value: T } | { ok: false; status: number; error: string };

export const MAX_SCOPE_ITEMS = 5;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/;
// Names that are, or usually are, a default or long-lived branch: never pushed to, whatever GitHub says
const PROTECTED_BRANCHES = new Set(['main', 'master', 'trunk', 'develop', 'development', 'default', 'head', 'production', 'release']);

const deny = (status: number, error: string): Decision<any> => ({ ok: false, status, error });

export function checkBuildRequest(input: {
  role: 'member' | 'maintainer';
  body: unknown;
  blueprintStatus: string | null;
  roadmapIds: string[];
  requirementNames: string[];
  activeBuild: boolean;
}): Decision<BuildScope> {
  if (input.role !== 'maintainer') return deny(403, 'Only a maintainer can authorise a build.');
  const body: any = input.body && typeof input.body === 'object' ? input.body : {};
  if (body.authorize !== true) {
    return deny(400, 'A build runs generated code and its dependencies in the sandbox. Send authorize: true to confirm you authorise it.');
  }
  if (input.blueprintStatus !== 'COMPLETED') return deny(409, 'The brief needs a completed blueprint before anything can be built from it.');
  const ids = Array.isArray(body.roadmapTaskIds) ? body.roadmapTaskIds.filter((v: unknown) => typeof v === 'string') : [];
  const names = Array.isArray(body.requirements) ? body.requirements.filter((v: unknown) => typeof v === 'string') : [];
  const unknownIds = ids.filter((id: string) => !input.roadmapIds.includes(id));
  const unknownNames = names.filter((n: string) => !input.requirementNames.includes(n));
  if (unknownIds.length || unknownNames.length) {
    return deny(400, `Not in this blueprint: ${[...unknownIds, ...unknownNames].slice(0, 5).join(', ')}`);
  }
  const scope: BuildScope = { roadmapTaskIds: Array.from(new Set<string>(ids)), requirements: Array.from(new Set<string>(names)) };
  const size = scope.roadmapTaskIds.length + scope.requirements.length;
  if (size === 0) return deny(400, 'Choose at least one roadmap item or requirement to build.');
  if (size > MAX_SCOPE_ITEMS) return deny(400, `A build covers at most ${MAX_SCOPE_ITEMS} items; split it into smaller builds.`);
  if (input.activeBuild) return deny(409, 'A build for this brief is already queued or running.');
  return { ok: true, value: scope };
}

export function isSafeBranchName(branch: string): boolean {
  return (
    BRANCH_RE.test(branch) &&
    !branch.includes('..') &&
    !branch.includes('//') &&
    !branch.endsWith('/') &&
    !branch.endsWith('.lock') &&
    !branch.endsWith('.') &&
    !PROTECTED_BRANCHES.has(branch.toLowerCase())
  );
}

export interface DeliveryTarget {
  repo: string;
  branch: string;
}

export function checkDeliverRequest(input: {
  role: 'member' | 'maintainer';
  body: unknown;
  buildStatus: BuildStatus;
  hasChangeSet: boolean;
}): Decision<DeliveryTarget> {
  if (input.role !== 'maintainer') return deny(403, 'Only a maintainer can deliver a build.');
  const body: any = input.body && typeof input.body === 'object' ? input.body : {};
  if (body.approve !== true) {
    return deny(400, 'Opening a pull request needs your explicit approval. Review the change, then send approve: true.');
  }
  if (input.buildStatus === 'delivered') return deny(409, 'This build was already delivered.');
  if (!['succeeded', 'awaiting_approval'].includes(input.buildStatus) || !input.hasChangeSet) {
    return deny(409, 'Only a finished build with a change set can be delivered.');
  }
  const repo = typeof body.repo === 'string' ? body.repo.trim() : '';
  const branch = typeof body.branch === 'string' ? body.branch.trim() : '';
  if (!REPO_RE.test(repo)) return deny(400, 'Give the target repository as owner/name.');
  if (!isSafeBranchName(branch)) {
    return deny(400, 'Give a new branch name (letters, digits, - _ . /). Default and long-lived branches such as main are never pushed to.');
  }
  return { ok: true, value: { repo, branch } };
}
