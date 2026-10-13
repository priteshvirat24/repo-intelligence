// Re-index and remove calls, with every server outcome mapped to copy a person can act on.

import { formatRetryAfter, readJsonSafe, retryAfterSeconds } from './api';

export type ReindexOutcome =
  | { kind: 'started' }
  | { kind: 'up_to_date'; commitHash?: string }
  | { kind: 'already_indexing'; step?: string }
  | { kind: 'error'; title: string; message: string; retryAfter?: number };

const CODE_MESSAGES: Record<string, { title: string; message: string }> = {
  REPOSITORY_NOT_FOUND: {
    title: 'Repository not found on GitHub',
    message: 'GitHub no longer has this repository. It may have been renamed or deleted.'
  },
  PRIVATE_REPOSITORY: {
    title: 'Repository is private',
    message: 'GitHub reports this repository as private. Open Eye can only read public repositories.'
  },
  ACCESS_FORBIDDEN: {
    title: 'GitHub refused access',
    message: 'GitHub refused the request. Try again later.'
  },
  REPOSITORY_TOO_LARGE: {
    title: 'Repository is too large',
    message: 'This repository has grown past the size Open Eye can index.'
  }
};

async function toOutcome(res: Response): Promise<ReindexOutcome> {
  const body = await readJsonSafe(res);
  if (res.status === 202) return { kind: 'started' };
  if (res.status === 409) return { kind: 'already_indexing', step: body?.step || body?.status };
  if (res.status === 429) {
    const retryAfter = retryAfterSeconds(res, body);
    return {
      kind: 'error',
      title: 'Too many re-index requests',
      message: formatRetryAfter(retryAfter),
      retryAfter
    };
  }
  if (res.ok) {
    if (body && body.reindexed === false) return { kind: 'up_to_date', commitHash: body.commitHash };
    return { kind: 'started' };
  }
  const code = typeof body?.code === 'string' ? body.code : undefined;
  if (code && CODE_MESSAGES[code]) return { kind: 'error', ...CODE_MESSAGES[code] };
  if (res.status === 404) {
    return { kind: 'error', title: 'Not found', message: 'This item is no longer in the library.' };
  }
  if (res.status === 403) return { kind: 'error', ...CODE_MESSAGES.ACCESS_FORBIDDEN };
  if (res.status === 413) return { kind: 'error', ...CODE_MESSAGES.REPOSITORY_TOO_LARGE };
  return {
    kind: 'error',
    title: res.status >= 500 ? 'Server error' : 'Re-index rejected',
    message: res.status >= 500
      ? 'The server could not start the re-index. Try again in a moment.'
      : 'The re-index request was rejected.'
  };
}

const networkError: ReindexOutcome = {
  kind: 'error',
  title: 'Network error',
  message: 'Could not reach Open Eye. Check your connection and try again.'
};

export async function reindexRepository(repositoryId: string, force = false): Promise<ReindexOutcome> {
  try {
    const res = await fetch(
      `/api/repositories/${encodeURIComponent(repositoryId)}/reindex${force ? '?force=true' : ''}`,
      { method: 'POST' }
    );
    return await toOutcome(res);
  } catch {
    return networkError;
  }
}

/** Non-repository resources (docs, videos) only have the generic re-index endpoint. */
export async function reindexResource(resourceId: string): Promise<ReindexOutcome> {
  try {
    const res = await fetch(`/api/resources/${encodeURIComponent(resourceId)}/reindex`, { method: 'POST' });
    if (res.ok) return { kind: 'started' };
    return await toOutcome(res);
  } catch {
    return networkError;
  }
}

export type RemoveOutcome = { ok: true } | { ok: false; message: string };

export async function removeFromLibrary(opts: { repositoryId?: string | null; resourceId?: string | null }): Promise<RemoveOutcome> {
  const url = opts.repositoryId
    ? `/api/repositories/${encodeURIComponent(opts.repositoryId)}`
    : `/api/resources/${encodeURIComponent(opts.resourceId || '')}`;
  try {
    const res = await fetch(url, { method: 'DELETE' });
    // Already gone counts as removed.
    if (res.ok || res.status === 404) return { ok: true };
    const body = await readJsonSafe(res);
    if (res.status === 429) return { ok: false, message: `Too many requests. ${formatRetryAfter(retryAfterSeconds(res, body))}` };
    return {
      ok: false,
      message: res.status >= 500
        ? 'The server could not remove it. Try again in a moment.'
        : 'The request was rejected.'
    };
  } catch {
    return { ok: false, message: 'Could not reach Open Eye. Check your connection and try again.' };
  }
}

export interface ActionNotice {
  tone: 'info' | 'verified' | 'danger' | 'inferred';
  title: string;
  message?: string;
  /** Offer a forced re-index (only for "already up to date"). */
  canForce?: boolean;
}

export function noticeForReindex(outcome: ReindexOutcome, name: string): ActionNotice {
  switch (outcome.kind) {
    case 'started':
      return { tone: 'info', title: 'Re-index started', message: `Open Eye is reading ${name} again. This page updates when it finishes.` };
    case 'up_to_date':
      return {
        tone: 'verified',
        title: 'Already up to date',
        message: outcome.commitHash
          ? `${name} has not changed since commit ${outcome.commitHash.slice(0, 7)}.`
          : `${name} has not changed since it was last indexed.`,
        canForce: true
      };
    case 'already_indexing':
      return {
        tone: 'info',
        title: 'Already indexing',
        message: `A job for ${name} is already running${outcome.step ? ` (${outcome.step.toLowerCase().replace(/_/g, ' ')})` : ''}. Following its progress.`
      };
    case 'error':
      return { tone: 'danger', title: outcome.title, message: outcome.message };
  }
}
