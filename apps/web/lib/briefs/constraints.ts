// User constraints and budget for a brief (PRODUCT_DEFINITION 4.1 step 1, 7.2), validated before storage.
// Constraints feed the understanding task; changing them re-runs only what depends on them.

export type LicencePolicy = 'copyleft-flagged' | 'permissive-only' | 'any';

export interface BriefConstraints {
  languages?: string;
  infrastructure?: string;
  prefer?: string;
  avoid?: string;
  licencePolicy?: LicencePolicy;
  notes?: string;
  /** Per-project opt-in to running third-party packages in the sandbox for E1 checks (PRODUCT_DEFINITION 12.4) */
  allowExecution?: true;
}

export interface BudgetLimits {
  llmCalls?: number;
  tokens?: number;
  githubRequests?: number;
  /** Package registry, advisory, docs, forum and search requests (connector gateway) */
  sourceRequests?: number;
}

const TEXT_FIELDS: Array<keyof BriefConstraints> = ['languages', 'infrastructure', 'prefer', 'avoid', 'notes'];
const LICENCE_POLICIES: LicencePolicy[] = ['copyleft-flagged', 'permissive-only', 'any'];
// Defaults per brief run; keep in step with apps/worker/orchestrator/store.py DEFAULT_BUDGET
export const DEFAULT_BUDGET: Required<BudgetLimits> = { llmCalls: 60, tokens: 400_000, githubRequests: 250, sourceRequests: 300 };

// Upper bounds keep a typo from authorising an unbounded run
const BUDGET_MAX: Required<BudgetLimits> = { llmCalls: 500, tokens: 5_000_000, githubRequests: 2000, sourceRequests: 3000 };

export function safeJson(value: unknown): unknown {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function parseConstraints(raw: unknown): BriefConstraints {
  const out: BriefConstraints = {};
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const key of TEXT_FIELDS) {
    if (typeof r[key] === 'string' && (r[key] as string).trim()) (out as any)[key] = (r[key] as string).trim().slice(0, 500);
  }
  if (typeof r.licencePolicy === 'string' && LICENCE_POLICIES.includes(r.licencePolicy as LicencePolicy)) {
    out.licencePolicy = r.licencePolicy as LicencePolicy;
  }
  // Only an explicit yes opts in; anything else (absent, false, other strings) leaves execution off
  if (r.allowExecution === true || r.allowExecution === 'true') out.allowExecution = true;
  return out;
}

export function parseBudget(raw: unknown): BudgetLimits | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const out: BudgetLimits = {};
  for (const key of Object.keys(BUDGET_MAX) as Array<keyof BudgetLimits>) {
    const n = Number(r[key]);
    if (Number.isFinite(n) && n > 0) out[key] = Math.min(Math.round(n), BUDGET_MAX[key]);
  }
  return Object.keys(out).length ? out : null;
}
