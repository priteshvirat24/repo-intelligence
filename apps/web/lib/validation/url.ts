export interface URLValidationResult {
  valid: boolean;
  owner?: string;
  repo?: string;
  canonicalUrl?: string;
  error?: string;
}

export function validateGitHubUrl(rawUrl: string): URLValidationResult {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  const trimmed = rawUrl.trim();

  // Reject non-https protocols
  if (trimmed.startsWith('http://')) {
    return { valid: false, error: 'Insecure http:// is not allowed. Use https://' };
  }
  if (trimmed.startsWith('git@') || trimmed.startsWith('ssh://')) {
    return { valid: false, error: 'SSH URLs are not supported. Use https://github.com/owner/repo' };
  }

  // Reject URLs containing query strings or fragments
  if (trimmed.includes('?') || trimmed.includes('#')) {
    return { valid: false, error: 'Query parameters and fragments are not allowed in repository URLs' };
  }

  // Strict regex for https://github.com/{owner}/{repo}
  // Disallows paths beyond repository (e.g. /tree/main, /issues, etc.)
  const githubRegex = /^https:\/\/github\.com\/([a-zA-Z0-9_\-\.]+)\/([a-zA-Z0-9_\-\.]+)(?:\/)?$/;
  const match = trimmed.match(githubRegex);

  if (!match) {
    return {
      valid: false,
      error: 'Invalid GitHub URL format. Expected: https://github.com/{owner}/{repo}'
    };
  }

  const owner = match[1];
  let repo = match[2];

  // Prevent path traversal or reserved names
  if (owner === '.' || owner === '..' || repo === '.' || repo === '..') {
    return { valid: false, error: 'Invalid repository path' };
  }

  // Normalize .git suffix
  if (repo.endsWith('.git')) {
    repo = repo.slice(0, -4);
  }

  const canonicalUrl = `https://github.com/${owner}/${repo}`;

  return {
    valid: true,
    owner,
    repo,
    canonicalUrl
  };
}
