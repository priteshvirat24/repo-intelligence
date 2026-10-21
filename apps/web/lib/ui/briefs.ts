import { DiscoveryStep } from '@repo/shared';

const STEP_LABELS: Record<DiscoveryStep, string> = {
  QUEUED: 'Waiting for the worker',
  UNDERSTANDING: 'Reading the brief',
  PLANNING_QUERIES: 'Planning GitHub searches',
  SEARCHING_GITHUB: 'Searching GitHub',
  READING_READMES: 'Reading READMEs of the strongest matches',
  RANKING: 'Ranking candidates',
  VERIFYING: 'Verifying the best repositories against their code',
  EXECUTING: 'Running checks in the sandbox',
  DESIGNING: 'Writing the blueprint',
  DONE: 'Done',
  FAILED: 'Failed'
};

const STEP_PROGRESS: Record<DiscoveryStep, number> = {
  QUEUED: 3,
  UNDERSTANDING: 8,
  PLANNING_QUERIES: 15,
  SEARCHING_GITHUB: 30,
  READING_READMES: 45,
  RANKING: 55,
  VERIFYING: 70,
  EXECUTING: 80,
  DESIGNING: 90,
  DONE: 100,
  FAILED: 100
};

export function discoveryStepLabel(step?: string | null): string {
  return STEP_LABELS[(step || 'QUEUED') as DiscoveryStep] || 'Working';
}

export function discoveryProgress(step?: string | null): number {
  return STEP_PROGRESS[(step || 'QUEUED') as DiscoveryStep] ?? 10;
}

export function isBriefActive(status?: string | null): boolean {
  return status === 'QUEUED' || status === 'RUNNING';
}

export const KIND_LABELS: Record<string, string> = {
  implementation: 'Implementation',
  library: 'Library',
  framework: 'Framework',
  curated_list: 'Curated list',
  tutorial: 'Tutorial',
  unknown: 'Not assessed'
};

export function compactNumber(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k`;
  return String(value);
}
