import type { FeedbackTargetKind, FeedbackVerdict } from '@repo/shared';

// Rules for feedback and evolution decisions (PRODUCT_DEFINITION 9). Pure functions, without database or
// framework imports, so they can be tested on their own (tests/web/test_evolution_rules.ts).

export const VERDICTS: Record<FeedbackTargetKind, FeedbackVerdict[]> = {
  candidate: ['useful', 'not_useful'],
  blueprint_decision: ['correct', 'wrong'],
  claim: ['correct', 'wrong']
};

export const NEGATIVE_VERDICTS: FeedbackVerdict[] = ['not_useful', 'wrong'];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;
export const MAX_NOTE_LENGTH = 1000;
export const MAX_TARGET_LENGTH = 300;

export interface FeedbackInput {
  briefId: string;
  targetKind: FeedbackTargetKind;
  targetId: string;
  /** null clears the caller's earlier verdict */
  verdict: FeedbackVerdict | null;
  note: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates a POST /api/feedback body. */
export function parseFeedback(body: unknown): Parsed<FeedbackInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Send a JSON object.' };
  const b = body as Record<string, unknown>;
  if (typeof b.briefId !== 'string' || !UUID_RE.test(b.briefId)) return { ok: false, error: 'briefId must be a brief id.' };
  if (typeof b.targetKind !== 'string' || !(b.targetKind in VERDICTS)) {
    return { ok: false, error: 'targetKind must be candidate, blueprint_decision or claim.' };
  }
  const kind = b.targetKind as FeedbackTargetKind;
  const target = typeof b.targetId === 'string' ? b.targetId.trim() : '';
  if (!target || target.length > MAX_TARGET_LENGTH || CONTROL_RE.test(target)) return { ok: false, error: 'targetId is missing or too long.' };
  if (kind === 'candidate' && !REPO_RE.test(target)) return { ok: false, error: 'A candidate is named owner/repository.' };
  if (kind === 'claim' && !UUID_RE.test(target)) return { ok: false, error: 'A claim is identified by its id.' };
  if (b.verdict !== null && (typeof b.verdict !== 'string' || !VERDICTS[kind].includes(b.verdict as FeedbackVerdict))) {
    return { ok: false, error: `verdict must be ${VERDICTS[kind].join(' or ')} (or null to clear).` };
  }
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== 'string') return { ok: false, error: 'note must be text.' };
    if (b.note.length > MAX_NOTE_LENGTH) return { ok: false, error: `note is limited to ${MAX_NOTE_LENGTH} characters.` };
    note = b.note.trim() || null;
  }
  return { ok: true, value: { briefId: b.briefId.toLowerCase(), targetKind: kind, targetId: target, verdict: (b.verdict as FeedbackVerdict) ?? null, note } };
}

/** What was shown when the verdict was given */
export interface TargetContext {
  rank?: number | null;
  shortlisted?: boolean;
  decision?: string | null;
  repo?: string | null;
  grade?: string | null;
}

export interface LabelProposalDraft {
  kind: 'solution' | 'trap' | 'decision_review' | 'claim_review';
  repo: string | null;
  requirement: string | null;
  proposal: Record<string, unknown>;
}

/**
 * The label change a verdict suggests for the evaluation suite, for a reviewer to accept or dismiss; never
 * applied by itself. A useful candidate may be a solution the labels lack; a recommended candidate marked
 * not useful may be a trap; a wrong decision or claim is queued for review. A verdict that agrees with what
 * was shown (not useful and not recommended, correct) suggests nothing.
 */
export function labelProposalFor(input: FeedbackInput, context: TargetContext): LabelProposalDraft | null {
  const note = input.note || undefined;
  switch (input.targetKind) {
    case 'candidate':
      if (input.verdict === 'useful') {
        return {
          kind: 'solution', repo: input.targetId, requirement: null,
          proposal: { suggestedRating: 'acceptable', shownRank: context.rank ?? null, shortlisted: !!context.shortlisted, note }
        };
      }
      if (input.verdict === 'not_useful' && context.shortlisted) {
        return { kind: 'trap', repo: input.targetId, requirement: null, proposal: { shownRank: context.rank ?? null, note } };
      }
      return null;
    case 'blueprint_decision':
      return input.verdict === 'wrong'
        ? { kind: 'decision_review', repo: context.repo ?? null, requirement: input.targetId, proposal: { decision: context.decision ?? null, note } }
        : null;
    case 'claim':
      return input.verdict === 'wrong'
        ? { kind: 'claim_review', repo: context.repo ?? null, requirement: null, proposal: { claimId: input.targetId, grade: context.grade ?? null, note } }
        : null;
  }
}

/**
 * Who may approve, reject or roll back. Configuration versions are global, so being the maintainer of a
 * personal workspace (every new user is) is not enough once sign-in is on: it takes the maintainer role in
 * the operator's workspace (the default workspace). Without sign-in, the single shared workspace's
 * maintainer (everyone) decides, as for everything else in that mode.
 */
export function canGovernEvolution(ctx: { authenticated: boolean; role: string }, operatorMaintainer: boolean): boolean {
  if (!ctx.authenticated) return ctx.role === 'maintainer';
  return operatorMaintainer;
}

/** Keys whose values differ between two configuration contents. */
export function changedKeys(content: Record<string, unknown> | null, parent: Record<string, unknown> | null): string[] {
  if (!content || !parent) return [];
  const keys = new Set([...Object.keys(content), ...Object.keys(parent)]);
  return [...keys].filter((k) => JSON.stringify(content[k]) !== JSON.stringify(parent[k])).sort();
}
