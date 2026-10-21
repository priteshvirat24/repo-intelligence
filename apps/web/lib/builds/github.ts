// Delivers an approved build as a new branch and a draft pull request (PRODUCT_DEFINITION 5.8, SYSTEM_DESIGN 11).
// Uses GITHUB_BUILD_TOKEN only; the token is never logged, returned or placed in the commit. It never writes to the
// repository's default branch and never moves an existing branch: the branch must be new.

const API = 'https://api.github.com';

export class DeliveryError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

type FetchLike = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export interface PullRequestInput {
  token: string;
  repo: string;
  branch: string;
  files: Record<string, string>;
  pathPrefix: string;
  title: string;
  body: string;
  fetchImpl?: FetchLike;
}

export interface PullRequestResult {
  baseBranch: string;
  commitSha: string;
  pullRequestUrl: string;
  pullRequestNumber: number;
}

export async function openPullRequest(input: PullRequestInput): Promise<PullRequestResult> {
  const doFetch: FetchLike = input.fetchImpl || (fetch as any);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await doFetch(`${API}/repos/${input.repo}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${input.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'open-eye-build',
        ...(body ? { 'Content-Type': 'application/json' } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  };
  const fail = (what: string, r: { status: number; data: any }) =>
    new DeliveryError(`${what} failed (GitHub ${r.status}${r.data?.message ? `: ${String(r.data.message).slice(0, 200)}` : ''})`, r.status === 404 || r.status === 403 ? 400 : 502);

  const repo = await call('GET', '');
  if (!repo.ok) throw fail('Reading the repository', repo);
  const base: string = repo.data.default_branch;
  if (!base) throw new DeliveryError('The repository reports no default branch.');
  if (input.branch.toLowerCase() === base.toLowerCase()) {
    throw new DeliveryError(`"${input.branch}" is the repository's default branch; builds are delivered on a new branch only.`, 400);
  }
  const existing = await call('GET', `/git/ref/heads/${encodeURIComponent(input.branch).replace(/%2F/g, '/')}`);
  if (existing.ok) throw new DeliveryError(`Branch "${input.branch}" already exists; choose a new branch name.`, 409);

  const baseRef = await call('GET', `/git/ref/heads/${encodeURIComponent(base).replace(/%2F/g, '/')}`);
  if (!baseRef.ok) throw fail('Reading the default branch', baseRef);
  const baseSha: string = baseRef.data.object?.sha;
  const baseCommit = await call('GET', `/git/commits/${baseSha}`);
  if (!baseCommit.ok) throw fail('Reading the base commit', baseCommit);

  const tree = await call('POST', '/git/trees', {
    base_tree: baseCommit.data.tree?.sha,
    tree: Object.entries(input.files).map(([path, content]) => ({
      path: input.pathPrefix ? `${input.pathPrefix}/${path}` : path,
      mode: '100644',
      type: 'blob',
      content
    }))
  });
  if (!tree.ok) throw fail('Creating the file tree', tree);
  const commit = await call('POST', '/git/commits', { message: input.title, tree: tree.data.sha, parents: [baseSha] });
  if (!commit.ok) throw fail('Creating the commit', commit);
  const ref = await call('POST', '/git/refs', { ref: `refs/heads/${input.branch}`, sha: commit.data.sha });
  if (!ref.ok) throw fail('Creating the branch', ref);
  const pr = await call('POST', '/pulls', { title: input.title, head: input.branch, base, body: input.body, draft: true });
  if (!pr.ok) throw fail('Opening the pull request', pr);
  return { baseBranch: base, commitSha: commit.data.sha, pullRequestUrl: pr.data.html_url, pullRequestNumber: pr.data.number };
}
