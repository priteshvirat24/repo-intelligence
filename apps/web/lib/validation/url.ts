import { ResourceTypeDetector } from '../adapters/detector';

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

  // Normalize via ResourceTypeDetector (strips tracking query params, .git suffix, trailing slashes, handles shorthand)
  const normalized = ResourceTypeDetector.normalizeUrl(rawUrl);
  if (!normalized) {
    return { valid: false, error: 'Please enter a valid GitHub repository URL' };
  }

  // Reject unsupported protocols
  if (rawUrl.startsWith('git@') || rawUrl.startsWith('ssh://')) {
    return { valid: false, error: 'SSH URLs are not supported. Use https://github.com/owner/repo' };
  }

  // Strict regex for https://github.com/{owner}/{repo}
  const githubRegex = /^https:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9_\-\.]+)\/([a-zA-Z0-9_\-\.]+)(?:\/)?$/i;
  const match = normalized.match(githubRegex);

  if (!match) {
    // Check if it was an issue, pull request, or other subpath
    const desc = ResourceTypeDetector.detect(rawUrl);
    if (!desc.isSupported && desc.unsupportedReason) {
      return {
        valid: false,
        error: desc.unsupportedReason
      };
    }

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
