import fs from 'fs';
import path from 'path';

// Reads evaluation runs written by the harness (apps/worker/eval/run.py) to eval/results/<suite>/.
// Results are committed with the code, so the page shows the measurements of the deployed version.

export interface EvalAggregate {
  briefs: number;
  recallAt10: number | null;
  recallAll: number | null;
  shortlistPrecision: number | null;
  trapRejection: number | null;
  errors: number;
  meanDurationMs: number;
  llmCalls: number;
  inputTokens: number;
  outputTokens: number;
  costCents: number | null;
}

export interface EvalRunSummary {
  runId: string;
  suite: string;
  labelsStatus: string | null;
  system: string;
  /** system, or system:tuning name for B1 (runs with different tunings are compared, not averaged) */
  variant: string;
  mode: string;
  tuningVersion: string | null;
  tuningName: string | null;
  commit: string;
  model: string | null;
  note: string;
  finishedAt: string;
  aggregate: EvalAggregate;
}

export interface EvalBriefRow {
  briefId: string;
  domain: string;
  bySystem: Record<string, { recallAt10: number | null; shortlistPrecision: number | null; missed: string[]; error?: string }>;
}

export interface EvaluationData {
  suite: string | null;
  labelsStatus: string | null;
  runs: EvalRunSummary[];
  /** variants, baselines first */
  systems: string[];
  briefs: EvalBriefRow[];
}

function variantOf(run: any): string {
  return run.tuningName ? `${run.system}:${run.tuningName}` : run.system;
}

function resultsRoot(): string | null {
  // The web app runs from apps/web; the repository root holds eval/
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const candidate = path.join(dir, 'eval', 'results');
    if (fs.existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}

export function loadEvaluation(): EvaluationData {
  const root = resultsRoot();
  if (!root) return { suite: null, labelsStatus: null, runs: [], systems: [], briefs: [] };
  const suites = fs.readdirSync(root).filter((d) => fs.statSync(path.join(root, d)).isDirectory()).sort();
  const suite = suites[suites.length - 1];
  if (!suite) return { suite: null, labelsStatus: null, runs: [], systems: [], briefs: [] };

  const full: any[] = fs
    .readdirSync(path.join(root, suite))
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(root, suite, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter((r) => r && r.aggregate && Array.isArray(r.briefs))
    .map((r) => ({ ...r, tuningName: r.tuningName ?? null, variant: variantOf(r) }))
    .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));

  const systems = Array.from(new Set(full.map((r) => r.variant))).sort();
  const latestBySystem = new Map<string, any>();
  for (const r of full) if (!latestBySystem.has(r.variant)) latestBySystem.set(r.variant, r);

  const briefIds: string[] = full[0]?.briefs.map((b: any) => b.briefId) || [];
  const briefs: EvalBriefRow[] = briefIds.map((briefId) => {
    const row: EvalBriefRow = { briefId, domain: '', bySystem: {} };
    for (const [system, run] of latestBySystem) {
      const b = run.briefs.find((x: any) => x.briefId === briefId);
      if (!b) continue;
      row.domain = b.domain || row.domain;
      row.bySystem[system] = b.scores
        ? { recallAt10: b.scores.recallAt10, shortlistPrecision: b.scores.shortlistPrecision, missed: b.scores.missedEssential || [] }
        : { recallAt10: null, shortlistPrecision: null, missed: [], error: b.error };
    }
    return row;
  });

  return {
    suite,
    labelsStatus: full[0]?.labelsStatus ?? null,
    runs: full.map(({ briefs: _briefs, snapshot: _snapshot, ...summary }) => summary as EvalRunSummary),
    systems,
    briefs
  };
}
