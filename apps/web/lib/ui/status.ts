// Shared vocabulary for indexing state: which statuses are final, how far along a step is, and
// how to describe it to a person. Used by the add modal, Library cards, the Studio shelf and the
// repository page so they never disagree.

export const TERMINAL_STATUSES = new Set(['READY', 'FAILED', 'BLOCKED', 'CANCELLED', 'PARTIAL']);

export function isTerminalStatus(status?: string | null): boolean {
  return TERMINAL_STATUSES.has((status || '').toUpperCase());
}

export function isFailedStatus(status?: string | null): boolean {
  const s = (status || '').toUpperCase();
  return s === 'FAILED' || s === 'BLOCKED';
}

/** Approximate progress (0-100) for a job step. Monotonic across the pipeline. */
export function getStepProgress(step?: string | null, status?: string | null): number {
  const s = (status || '').toUpperCase();
  if (s === 'READY' || s === 'PARTIAL' || (step || '').toUpperCase() === 'DONE') return 100;
  if (s === 'FAILED' || s === 'BLOCKED' || s === 'CANCELLED') return 0;

  const current = (step || status || '').toUpperCase();
  switch (current) {
    case 'QUEUED':
    case 'PENDING':
    case 'INITIALIZING':
      return 12;
    case 'CLONING':
    case 'FETCHING':
      return 30;
    case 'FILE_FILTERING':
    case 'MANIFEST_ANALYSIS':
      return 48;
    case 'AST_ANALYSIS':
    case 'ANALYZING':
      return 64;
    case 'CAPABILITY_EXTRACTION':
      return 80;
    case 'INDEXING':
      return 92;
    default:
      return 8;
  }
}

/** One short, human sentence for where an indexing job is. */
export function getStepLabel(step?: string | null, status?: string | null, resourceType?: string | null): string {
  const s = (status || '').toUpperCase();
  if (s === 'READY') return 'Ready';
  if (s === 'PARTIAL') return 'Indexed with gaps';
  if (s === 'FAILED') return 'Indexing failed';
  if (s === 'BLOCKED') return 'Blocked';
  if (s === 'CANCELLED') return 'Cancelled';

  const current = (step || status || '').toUpperCase();
  const isRepo = !resourceType || resourceType === 'github_repository';
  switch (current) {
    case 'QUEUED':
    case 'PENDING':
    case 'INITIALIZING':
    case 'IDLE':
      return 'Queued';
    case 'CLONING':
    case 'FETCHING':
      return isRepo ? 'Cloning the repository' : 'Fetching the page';
    case 'FILE_FILTERING':
    case 'MANIFEST_ANALYSIS':
      return 'Reading manifests and dependencies';
    case 'AST_ANALYSIS':
    case 'ANALYZING':
      return isRepo ? 'Parsing source files' : 'Reading the content';
    case 'CAPABILITY_EXTRACTION':
      return 'Extracting capabilities with evidence';
    case 'INDEXING':
      return 'Building the search index';
    case 'DONE':
      return 'Finishing up';
    default:
      return 'Working';
  }
}
