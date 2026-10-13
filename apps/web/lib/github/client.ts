export interface GitHubRepoMetadata {
  owner: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  license: string | null;
  primaryLanguage: string | null;
  sizeKb: number;          // GitHub's reported size: the whole git history, not what we download
  snapshotSizeKb: number;  // size of the files at the latest commit (what a shallow clone checks out)
  commitSha: string | null;
}

export class GitHubClient {
  private token?: string;
  private maxSizeBytes: number;

  constructor() {
    this.token = process.env.GITHUB_TOKEN;
    const maxMb = parseInt(process.env.MAX_REPOSITORY_SIZE_MB || '100', 10);
    this.maxSizeBytes = maxMb * 1024 * 1024;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': 'Repo-Intelligence-App/1.0',
      Accept: 'application/vnd.github.v3+json'
    };
    if (this.token) {
      headers.Authorization = `token ${this.token}`;
    }
    return headers;
  }

  async fetchMetadata(owner: string, repo: string): Promise<GitHubRepoMetadata> {
    const url = `https://api.github.com/repos/${owner}/${repo}`;
    const res = await fetch(url, { headers: this.getHeaders() });

    if (res.status === 404) {
      throw new Error(`REPOSITORY_NOT_FOUND: Repository ${owner}/${repo} does not exist or is private.`);
    }

    if (res.status === 403 || res.status === 429) {
      const rateLimitRemaining = res.headers.get('x-ratelimit-remaining');
      const body = await res.clone().text().catch(() => '');
      // Primary limit (remaining 0) and secondary/abuse limits (403/429 mentioning "rate limit") are temporary
      if (rateLimitRemaining === '0' || res.status === 429 || /rate limit/i.test(body)) {
        throw new Error('GITHUB_RATE_LIMITED: GitHub API rate limit reached. Set GITHUB_TOKEN in .env for higher limits.');
      }
      throw new Error(`ACCESS_FORBIDDEN: Cannot access repository ${owner}/${repo}.`);
    }

    if (!res.ok) {
      throw new Error(`GITHUB_API_ERROR: HTTP ${res.status} from GitHub API.`);
    }

    const data = await res.json();

    if (data.private) {
      throw new Error('PRIVATE_REPOSITORY: Only public GitHub repositories are supported in V1.');
    }

    const sizeKb = data.size || 0;
    const defaultBranch = data.default_branch || 'main';

    // Size limit applies to the files at the latest commit: the worker makes a shallow (depth 1) clone,
    // so the history GitHub reports in `size` (often 10-50x larger) is never downloaded.
    const snapshotBytes = await this.fetchSnapshotSizeBytes(owner, repo, defaultBranch);
    if (snapshotBytes > this.maxSizeBytes) {
      const maxMb = this.maxSizeBytes / (1024 * 1024);
      throw new Error(`REPOSITORY_TOO_LARGE: Repository files total ${Math.round(snapshotBytes / (1024 * 1024))}MB, exceeding the limit of ${maxMb}MB.`);
    }

    // Fetch latest commit SHA on default branch
    let commitSha: string | null = null;
    try {
      const commitRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/commits/${defaultBranch}`,
        { headers: this.getHeaders() }
      );
      if (commitRes.ok) {
        const commitData = await commitRes.json();
        commitSha = commitData.sha || null;
      }
    } catch {
      // Fallback: commit hash will be extracted during clone
    }

    return {
      owner: data.owner?.login || owner,
      name: data.name || repo,
      description: data.description || null,
      defaultBranch,
      stars: data.stargazers_count || 0,
      license: data.license?.spdx_id || data.license?.name || null,
      primaryLanguage: data.language || null,
      sizeKb,
      snapshotSizeKb: Math.round(snapshotBytes / 1024),
      commitSha
    };
  }

  /** Total size of all files at the tip of `branch`, from a single recursive tree listing. */
  private async fetchSnapshotSizeBytes(owner: string, repo: string, branch: string): Promise<number> {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch.split('/').map(encodeURIComponent).join('/')}?recursive=1`,
      { headers: this.getHeaders() }
    );
    if (res.status === 409) {
      // GitHub answers 409 "Git Repository is empty" for repositories without commits
      throw new Error('REPOSITORY_EMPTY: This repository has no files to index yet.');
    }
    if ((res.status === 403 || res.status === 429) && (res.headers.get('x-ratelimit-remaining') === '0' || res.status === 429)) {
      throw new Error('GITHUB_RATE_LIMITED: GitHub API rate limit reached. Set GITHUB_TOKEN in .env for higher limits.');
    }
    if (!res.ok) {
      throw new Error(`GITHUB_API_ERROR: HTTP ${res.status} listing repository files.`);
    }
    const tree = await res.json();
    if (tree.truncated) {
      // GitHub truncates listings beyond ~100,000 entries: far beyond what the worker can analyze
      throw new Error('REPOSITORY_TOO_LARGE: Repository has too many files to index (GitHub could not list them all).');
    }
    return (tree.tree || [])
      .filter((entry: any) => entry.type === 'blob')
      .reduce((total: number, entry: any) => total + (entry.size || 0), 0);
  }
}
