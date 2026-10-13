// GitHub-specific presentation helpers.

/** "https://github.com/owner/repo(.git)/..." -> "owner/repo", or null for anything else. */
export function parseGithubRepo(url?: string | null): string | null {
  if (!url) return null;
  const m = url.match(/github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[/#?].*)?$/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function githubRepoUrl(fullName: string): string {
  return `https://github.com/${fullName}`;
}

/** Blob URL with a line anchor, pinned to a commit when we know it. */
export function buildGithubBlobUrl(opts: {
  repo?: string | null;
  path?: string | null;
  ref?: string | null;
  startLine?: number | null;
  endLine?: number | null;
}): string | null {
  const { repo, path, ref, startLine, endLine } = opts;
  if (!repo || !path || !/^[^/\s]+\/[^/\s]+$/.test(repo)) return null;
  const cleanPath = path.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
  let url = `https://github.com/${repo}/blob/${encodeURIComponent(ref || 'HEAD')}/${cleanPath}`;
  if (startLine) {
    url += `#L${startLine}`;
    if (endLine && endLine > startLine) url += `-L${endLine}`;
  }
  return url;
}

export function fileBaseName(path?: string | null): string {
  if (!path) return '';
  const parts = path.split('/');
  return parts[parts.length - 1] || path;
}

/** "src/a/b.ts" + 10 -> "b.ts:L10" */
export function shortLocation(path?: string | null, startLine?: number | null): string {
  const base = fileBaseName(path) || 'excerpt';
  return startLine ? `${base}:L${startLine}` : base;
}

export function lineRangeLabel(startLine?: number | null, endLine?: number | null): string | null {
  if (!startLine) return null;
  if (endLine && endLine > startLine) return `L${startLine}–L${endLine}`;
  return `L${startLine}`;
}

/** The seed question used by "Ask about it" everywhere a repository is offered. */
export function repoSeedPrompt(name: string): string {
  return `What does ${name} do, and where in the code is each main capability implemented?`;
}

export function askHref(prompt: string): string {
  return `/?prompt=${encodeURIComponent(prompt)}`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
