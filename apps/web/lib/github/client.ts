export interface GitHubRepoMetadata {
  owner: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  stars: number;
  license: string | null;
  primaryLanguage: string | null;
  sizeKb: number;
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

    if (res.status === 403) {
      const rateLimitRemaining = res.headers.get('x-ratelimit-remaining');
      if (rateLimitRemaining === '0') {
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

    // Check size limit: GitHub API returns size in KB
    const sizeKb = data.size || 0;
    const sizeBytes = sizeKb * 1024;
    if (sizeBytes > this.maxSizeBytes) {
      const maxMb = this.maxSizeBytes / (1024 * 1024);
      throw new Error(`REPOSITORY_TOO_LARGE: Repository size (${Math.round(sizeKb / 1024)}MB) exceeds limit of ${maxMb}MB.`);
    }

    const defaultBranch = data.default_branch || 'main';

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
      commitSha
    };
  }
}
