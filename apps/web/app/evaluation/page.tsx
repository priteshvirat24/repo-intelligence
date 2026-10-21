'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { LoadError } from '@/components/IndexingState';
import { readJsonSafe, shortDate } from '@/lib/ui/api';
import type { EvaluationData, EvalRunSummary } from '@/lib/eval/results';

const SYSTEM_LABEL: Record<string, string> = {
  b0: 'Plain search (B0)',
  b0s: 'Plain search by stars (B0s)',
  b1: 'Open Eye (B1)'
};

/** "b1:category-queries" -> "Open Eye (B1) · category-queries"; the default tuning needs no suffix */
function variantLabel(variant: string): string {
  const [system, tuning] = variant.split(':');
  const base = SYSTEM_LABEL[system] || system.toUpperCase();
  return tuning && tuning !== 'default' ? `${base} · ${tuning}` : base;
}

function shortVariant(variant: string): string {
  const [system, tuning] = variant.split(':');
  const name = system === 'b0s' ? 'B0s' : system.toUpperCase();
  return tuning ? `${name} ${tuning}` : name;
}

const METRICS: Array<{ key: keyof EvalRunSummary['aggregate']; label: string; help: string }> = [
  { key: 'recallAt10', label: 'Recall@10', help: 'Share of the essential solutions an expert expects that appear in the top 10' },
  { key: 'recallAll', label: 'Recall (all kept)', help: 'The same over every candidate kept, up to 40' },
  { key: 'shortlistPrecision', label: 'Shortlist precision', help: 'Share of recommended starting points that are labelled essential or acceptable' },
  { key: 'trapRejection', label: 'Trap rejection (all traps)', help: 'Share of look-alike, abandoned or unusable repositories that were not recommended. A system that finds nothing scores 100%.' },
  { key: 'trapRejectionSurfaced', label: 'Trap rejection (traps it found)', help: 'Of the traps the system actually surfaced, the share it did not recommend' }
];

function stats(values: Array<number | null>): { mean: number | null; min: number | null; max: number | null; n: number } {
  const v = values.filter((x): x is number => typeof x === 'number');
  if (v.length === 0) return { mean: null, min: null, max: null, n: 0 };
  return { mean: v.reduce((a, b) => a + b, 0) / v.length, min: Math.min(...v), max: Math.max(...v), n: v.length };
}

function pct(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)}%`;
}

/** The learning record (PRODUCT_DEFINITION 4.2): how well Open Eye performs, measured, not claimed. */
export default function EvaluationPage() {
  const [data, setData] = useState<EvaluationData | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/evaluation', { cache: 'no-store' });
      const body = await readJsonSafe<EvaluationData>(res);
      if (!res.ok || !body) throw new Error('load failed');
      setData(body);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const bySystem = useMemo(() => {
    const map = new Map<string, EvalRunSummary[]>();
    for (const run of data?.runs || []) {
      if (!map.has(run.variant)) map.set(run.variant, []);
      map.get(run.variant)!.push(run);
    }
    return map;
  }, [data]);

  const systems = data?.systems || [];
  // The most recent Open Eye variant, whose misses the per-brief table lists
  const latestB1 = data?.runs.find((r) => r.system === 'b1')?.variant;
  const draftLabels = (data?.labelsStatus || '').toLowerCase().startsWith('draft');

  return (
    <div className="app-shell">
      <Navbar />
      <main className="page">
        <header className="page-head">
          <div className="page-head-title">
            <span className="eyebrow">Evaluation</span>
            <h1 className="h-page">Measured, not claimed.</h1>
          </div>
          <div className="page-head-aside">
            <p className="lede">
              The same briefs run through plain search and through Open Eye, scored against labelled answers:
              the solutions an expert would expect, and the traps that must not be recommended.
            </p>
          </div>
        </header>

        {error ? (
          <LoadError what="evaluation results" onRetry={load} />
        ) : !data ? (
          <div className="loading-line" role="status">
            <span className="dot dot-pulse" aria-hidden="true" />
            Loading results&hellip;
          </div>
        ) : data.runs.length === 0 ? (
          <div className="empty">
            <span className="eyebrow plain">No runs yet</span>
            <h3>Nothing measured yet.</h3>
            <p>Run the evaluation harness (see eval/README.md) and commit its results to show them here.</p>
          </div>
        ) : (
          <div className="stack gap-6">
            {draftLabels && (
              <div className="callout callout-inferred">
                <AlertTriangle size={16} aria-hidden="true" />
                <div>
                  <div className="callout-title">Provisional: the labels are a draft.</div>
                  <div>
                    {data.suite} was labelled once and checked against GitHub, but not yet labelled independently by two
                    people. Use these numbers to compare systems and versions, not as final scores.
                  </div>
                </div>
              </div>
            )}

            <section className="stack gap-3">
              <div className="rule-head">
                <h2 className="label">Summary</h2>
                <span className="count">{data.suite}</span>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      {systems.map((s) => (
                        <th key={s} className="num" title={variantLabel(s)}>
                          {shortVariant(s)}
                          <div className="faint" style={{ textTransform: 'none' }}>{bySystem.get(s)?.length || 0} run{(bySystem.get(s)?.length || 0) === 1 ? '' : 's'}</div>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {METRICS.map((m) => {
                      const cells = systems.map((s) => stats((bySystem.get(s) || []).map((r) => r.aggregate[m.key] as number | null)));
                      const best = Math.max(...cells.map((c) => c.mean ?? -1));
                      return (
                        <tr key={m.key}>
                          <td title={m.help} style={{ whiteSpace: 'nowrap' }}>{m.label}</td>
                          {cells.map((c, i) => (
                            <td key={systems[i]} className="num" style={c.mean === best && c.mean !== null && systems.length > 1 ? { fontWeight: 600 } : undefined}>
                              {pct(c.mean)}
                              {c.n > 1 && c.min !== c.max && <span className="faint"> ({pct(c.min)}–{pct(c.max)})</span>}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    <tr>
                      <td style={{ whiteSpace: 'nowrap' }}>AI calls per run</td>
                      {systems.map((s) => <td key={s} className="num">{Math.round(stats((bySystem.get(s) || []).map((r) => r.aggregate.llmCalls)).mean || 0)}</td>)}
                    </tr>
                    <tr>
                      <td style={{ whiteSpace: 'nowrap' }}>Time per brief</td>
                      {systems.map((s) => <td key={s} className="num">{Math.round((stats((bySystem.get(s) || []).map((r) => r.aggregate.meanDurationMs)).mean || 0) / 1000)}s</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="xsmall faint">Means across runs, with the range across runs in brackets. LLM output varies between runs, so differences inside the range are noise.</p>
            </section>

            <section className="stack gap-3">
              <div className="rule-head">
                <h2 className="label">Recall@10 per brief (latest run of each)</h2>
                <span className="count">{data.briefs.length}</span>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Brief</th>
                      {systems.map((s) => <th key={s} className="num" title={variantLabel(s)}>{shortVariant(s)}</th>)}
                      <th>Essential solutions missed by Open Eye ({latestB1 ? shortVariant(latestB1) : 'B1'}, latest)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.briefs.map((b) => (
                      <tr key={b.briefId}>
                        <td style={{ whiteSpace: 'nowrap' }}><span className="mono">{b.briefId}</span><div className="xsmall faint">{b.domain}</div></td>
                        {systems.map((s) => (
                          <td key={s} className="num">{b.bySystem[s]?.error ? 'error' : pct(b.bySystem[s]?.recallAt10 ?? null)}</td>
                        ))}
                        <td className="xsmall">
                          {latestB1 && b.bySystem[latestB1]
                            ? b.bySystem[latestB1].error || (b.bySystem[latestB1].missed.length ? b.bySystem[latestB1].missed.join(', ') : 'none')
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="stack gap-3">
              <div className="rule-head">
                <h2 className="label">Runs</h2>
                <span className="count">{data.runs.length}</span>
              </div>
              <div className="table-wrap">
                <table className="data-table">
                  <thead>
                    <tr><th>When</th><th>System</th><th>Mode</th><th>Tuning</th><th>Commit</th><th>Model</th><th className="num">Recall@10</th><th>Note</th></tr>
                  </thead>
                  <tbody>
                    {data.runs.map((r) => (
                      <tr key={r.runId}>
                        <td>{shortDate(r.finishedAt)}</td>
                        <td>{shortVariant(r.variant)}</td>
                        <td>{r.mode}</td>
                        <td className="mono xsmall">{r.tuningVersion || '—'}</td>
                        <td className="mono xsmall">{r.commit}</td>
                        <td className="xsmall">{r.model || '—'}</td>
                        <td className="num">{pct(r.aggregate.recallAt10)}</td>
                        <td className="xsmall muted">{r.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
