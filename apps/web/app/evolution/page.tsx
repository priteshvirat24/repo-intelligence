'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, RotateCcw, X } from 'lucide-react';
import type { ConfigVersionSummary, EvolutionData, EvolutionEvent, EvolutionMetrics, EvolutionProposal } from '@repo/shared';
import { Navbar } from '@/components/Navbar';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { LoadError } from '@/components/IndexingState';
import { readJsonSafe, shortDate } from '@/lib/ui/api';

const STATUS_TONE: Record<string, string> = {
  promoted: 'badge-verified', pending: 'badge-inferred', candidate: 'badge-neutral', retired: 'badge-outline',
  rejected: 'badge-danger', rolled_back: 'badge-danger', approved: 'badge-verified'
};
const STATUS_LABEL: Record<string, string> = { rolled_back: 'rolled back' };
const EVENT_LABEL: Record<string, string> = {
  promoted: 'Promoted', rejected: 'Rejected by the gate', rolled_back: 'Rolled back', proposed: 'Proposed', proposal_rejected: 'Proposal rejected'
};
const LABEL_KIND: Record<string, string> = {
  solution: 'Possible solution', trap: 'Possible trap', decision_review: 'Decision to review', claim_review: 'Claim to review'
};

function signed(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  const points = Math.round(value * 1000) / 10;
  return `${points > 0 ? '+' : ''}${points} pts`;
}

function actor(value: string): string {
  if (value === 'auto-tuner') return 'Auto-tuner';
  if (value === 'monitor') return 'Live monitor';
  if (value === 'replay-gate') return 'Replay gate';
  if (value === 'cli') return 'Command line';
  if (value.startsWith('user:')) return 'Maintainer';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

const Version: React.FC<{ id: string | null }> = ({ id }) =>
  id ? <span className="mono xsmall" style={{ whiteSpace: 'nowrap' }}>{id}</span> : <span className="xsmall faint">built-in defaults</span>;

const Status: React.FC<{ status: string }> = ({ status }) => (
  <span className={`badge ${STATUS_TONE[status] || 'badge-outline'}`}>{STATUS_LABEL[status] || status}</span>
);

/** The evolution record (PRODUCT_DEFINITION 9): what changed, on what evidence, and who decided. */
export default function EvolutionPage() {
  const [data, setData] = useState<EvolutionData | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/evolution', { cache: 'no-store' });
      const body = await readJsonSafe<EvolutionData>(res);
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

  const act = async (key: string, url: string, body: Record<string, unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const out = await readJsonSafe<{ error?: string }>(res);
        setActionError(out?.error || 'The action was refused.');
        return false;
      }
      await load();
      return true;
    } catch {
      setActionError('Could not reach Open Eye.');
      return false;
    } finally {
      setBusy(null);
    }
  };

  const pending = (data?.proposals || []).filter((p) => p.status === 'pending');
  const decided = (data?.proposals || []).filter((p) => p.status !== 'pending');

  return (
    <div className="app-shell">
      <Navbar />
      <main className="page">
        <header className="page-head">
          <div className="page-head-title">
            <span className="eyebrow">Evolution</span>
            <h1 className="h-page">Changed only on evidence.</h1>
          </div>
          <div className="page-head-aside">
            <p className="lede">
              Ranking weights and thresholds (L1) change automatically when they beat the promoted version on the{' '}
              <Link href="/evaluation" className="link">benchmark</Link> beyond its noise. Prompts and strategies (L2) also need a
              maintainer&rsquo;s approval. Open Eye&rsquo;s own code (L4) never changes itself. Live feedback can roll a version back.
            </p>
          </div>
        </header>

        {error ? (
          <LoadError what="the evolution history" onRetry={load} />
        ) : !data ? (
          <div className="loading-line" role="status">
            <span className="dot dot-pulse" aria-hidden="true" />
            Loading the evolution history&hellip;
          </div>
        ) : (
          <div className="stack gap-6">
            <section className="stack gap-3" aria-labelledby="active-heading">
              <div className="rule-head">
                <h2 id="active-heading" className="label">Active configuration</h2>
              </div>
              <div className="row wrap between gap-3">
                <div className="stack gap-1">
                  <Version id={data.active} />
                  <span className="xsmall faint">
                    {data.active ? 'Every new run records this version, so its results and feedback can be compared with the one before.' : 'Nothing has been promoted yet.'}
                  </span>
                </div>
                {data.canGovern && data.active && (
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setConfirmRollback(true)} disabled={busy !== null}>
                    <RotateCcw size={13} aria-hidden="true" />
                    <span>Roll back</span>
                  </button>
                )}
              </div>
              {actionError && (
                <div className="callout callout-danger" role="alert">
                  <AlertTriangle size={16} aria-hidden="true" />
                  <div>{actionError}</div>
                </div>
              )}
            </section>

            <section className="stack gap-3" aria-labelledby="proposals-heading">
              <div className="rule-head">
                <h2 id="proposals-heading" className="label">Waiting for approval</h2>
                <span className="count">{pending.length}</span>
              </div>
              {pending.length === 0 ? (
                <p className="small muted">No proposal is waiting. L2 proposals come from benchmarked candidates (apps.worker.evolution.propose).</p>
              ) : (
                pending.map((p) => (
                  <ProposalCard key={p.id} proposal={p} canGovern={data.canGovern} busy={busy}
                    onApprove={() => act(`approve-${p.id}`, `/api/evolution/proposals/${p.id}/approve`, {})}
                    onReject={() => act(`reject-${p.id}`, `/api/evolution/proposals/${p.id}/reject`, {})} />
                ))
              )}
              {!data.canGovern && pending.length > 0 && (
                <p className="xsmall faint">Only maintainers of the operator workspace can approve or reject.</p>
              )}
            </section>

            <section className="stack gap-3" aria-labelledby="versions-heading">
              <div className="rule-head">
                <h2 id="versions-heading" className="label">Configuration versions</h2>
                <span className="count">{data.versions.length}</span>
              </div>
              {data.versions.length === 0 ? (
                <p className="small muted">No version has been registered. The auto-tuner registers the defaults as the first baseline.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Version</th><th>Level</th><th>Status</th><th>What changed</th>
                        <th className="num" title="Change in recall@10 against the baseline, on the evidence runs">Recall@10</th>
                        <th className="num" title="Change in shortlist precision against the baseline">Precision</th>
                        <th className="num" title="Benchmark runs behind the decision">Runs</th>
                        <th className="num" title="Share of live verdicts marking its results not useful or wrong">Not useful</th>
                        <th>Decided</th><th>Notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.versions.map((v) => <VersionRow key={v.id} version={v} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="stack gap-3" aria-labelledby="events-heading">
              <div className="rule-head">
                <h2 id="events-heading" className="label">History</h2>
                <span className="count">{data.events.length}</span>
              </div>
              {data.events.length === 0 ? (
                <p className="small muted">No promotion, rejection or rollback yet.</p>
              ) : (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>When</th><th>Event</th><th>Version</th><th>Active after</th><th>By</th><th>Evidence and reason</th></tr>
                    </thead>
                    <tbody>
                      {data.events.map((e) => <EventRow key={e.id} event={e} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {decided.length > 0 && (
              <section className="stack gap-3" aria-labelledby="decided-heading">
                <div className="rule-head">
                  <h2 id="decided-heading" className="label">Decided proposals</h2>
                  <span className="count">{decided.length}</span>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Proposal</th><th>Level</th><th>Status</th><th>Benchmark win</th><th>Decided</th></tr></thead>
                    <tbody>
                      {decided.map((p) => (
                        <tr key={p.id}>
                          <td>{p.title}</td>
                          <td>{p.level}</td>
                          <td><Status status={p.status} /></td>
                          <td>{p.benchmarkWin ? 'yes' : 'no'}</td>
                          <td className="xsmall">{shortDate(p.decidedAt) || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section className="stack gap-3" aria-labelledby="labels-heading">
              <div className="rule-head">
                <h2 id="labels-heading" className="label">Label proposals for the evaluation suite</h2>
                <span className="count">{data.labelProposals.length}</span>
              </div>
              <p className="xsmall faint">
                Drawn from feedback on your briefs. Reviewers decide which become labels or new suite cases; nothing is added automatically.
              </p>
              {data.labelProposals.length > 0 && (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead><tr><th>Brief</th><th>Suggestion</th><th>Repository or requirement</th><th>Status</th><th>When</th></tr></thead>
                    <tbody>
                      {data.labelProposals.map((l) => (
                        <tr key={l.id}>
                          <td><Link href={`/briefs/${l.briefId}`} className="link">{l.briefTitle}</Link></td>
                          <td>{LABEL_KIND[l.kind] || l.kind}</td>
                          <td className="mono xsmall">{l.repo || l.requirement || '—'}</td>
                          <td><Status status={l.status} /></td>
                          <td className="xsmall">{shortDate(l.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      <ConfirmDialog
        open={confirmRollback}
        title="Roll back the active configuration?"
        confirmLabel="Roll back"
        tone="danger"
        busy={busy === 'rollback'}
        error={confirmRollback ? actionError : null}
        onCancel={() => setConfirmRollback(false)}
        onConfirm={async () => {
          if (await act('rollback', '/api/evolution/rollback', { expected: data?.active })) setConfirmRollback(false);
        }}
      >
        <p>
          <span className="mono">{data?.active}</span> is replaced by the version it superseded. New runs use that version; the
          rollback is recorded in the history. A rolled-back version is never promoted again automatically.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function gateMetrics(evidence: ConfigVersionSummary['evidence'] | EvolutionProposal['evidence']): EvolutionMetrics {
  return (evidence?.gate?.metrics || {}) as EvolutionMetrics;
}

const VersionRow: React.FC<{ version: ConfigVersionSummary }> = ({ version: v }) => {
  const m = gateMetrics(v.evidence);
  return (
    <tr>
      <td><Version id={v.id} /></td>
      <td>{v.level}</td>
      <td><Status status={v.status} /></td>
      <td className="mono xsmall">{v.changedKeys.length ? v.changedKeys.join(', ') : '—'}</td>
      <td className="num">{signed(m.recallAt10?.delta)}</td>
      <td className="num">{signed(m.shortlistPrecision?.delta)}</td>
      <td className="num">{v.evidence?.runs?.length ?? '—'}</td>
      <td className="num">{v.feedback.total ? `${Math.round((v.feedback.rate || 0) * 100)}% of ${v.feedback.total}` : '—'}</td>
      <td className="xsmall">{shortDate(v.decidedAt || v.promotedAt) || '—'}</td>
      <td className="xsmall muted" style={{ minWidth: '28ch', maxWidth: '48ch' }}>{v.notes}</td>
    </tr>
  );
};

const EventRow: React.FC<{ event: EvolutionEvent }> = ({ event: e }) => (
  <tr>
    <td className="xsmall" style={{ whiteSpace: 'nowrap' }}>{shortDate(e.createdAt)}</td>
    <td>{EVENT_LABEL[e.kind] || e.kind}{e.level ? <span className="faint"> · {e.level}</span> : null}</td>
    <td><Version id={e.version} /></td>
    <td>{e.kind === 'promoted' || e.kind === 'rolled_back' ? <Version id={e.activeAfter} /> : <span className="faint">unchanged</span>}</td>
    <td className="xsmall">{actor(e.actor)}</td>
    <td className="xsmall muted" style={{ minWidth: '28ch', maxWidth: '56ch' }}>{e.notes}</td>
  </tr>
);

const ProposalCard: React.FC<{
  proposal: EvolutionProposal;
  canGovern: boolean;
  busy: string | null;
  onApprove: () => void;
  onReject: () => void;
}> = ({ proposal: p, canGovern, busy, onApprove, onReject }) => {
  const m = gateMetrics(p.evidence);
  const traps = p.evidence?.gate?.recurringTraps || [];
  return (
    <article className="card stack gap-3">
      <div className="row wrap between gap-3">
        <div className="row wrap gap-2">
          <span className="badge badge-outline">{p.level}</span>
          <strong>{p.title}</strong>
        </div>
        <span className={`badge ${p.benchmarkWin ? 'badge-verified' : 'badge-danger'}`}>
          {p.benchmarkWin ? 'Benchmark win' : 'No benchmark win'}
        </span>
      </div>
      {p.rationale && <p className="small">{p.rationale}</p>}
      <div className="row wrap gap-4 small muted">
        <span>Recall@10 {signed(m.recallAt10?.delta)}</span>
        <span>Shortlist precision {signed(m.shortlistPrecision?.delta)}</span>
        <span>{p.evidence?.runs?.length || 0} candidate runs, {p.evidence?.baselineRuns?.length || 0} baseline runs</span>
      </div>
      {p.changedKeys.length > 0 && <div className="mono xsmall">Changes: {p.changedKeys.join(', ')}</div>}
      {(p.evidence?.gate?.reasons || []).map((r, i) => <p key={i} className="xsmall faint">{r}</p>)}
      {traps.length > 0 && (
        <div className="callout callout-inferred">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>Shortlisted in every candidate run and never by the baseline: <span className="mono">{traps.join(', ')}</span></div>
        </div>
      )}
      {p.level === 'L4' && <p className="xsmall faint">Code and security changes are never applied by Open Eye: open a reviewed pull request.</p>}
      {canGovern && (
        <div className="row gap-2">
          <button type="button" className="btn btn-primary btn-sm" onClick={onApprove}
            disabled={busy !== null || !p.benchmarkWin || p.level === 'L4'}
            title={!p.benchmarkWin ? 'Approval needs a benchmark win' : p.level === 'L4' ? 'L4 is never applied' : undefined}>
            <Check size={13} aria-hidden="true" />
            <span>{busy === `approve-${p.id}` ? 'Approving…' : 'Approve and promote'}</span>
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onReject} disabled={busy !== null}>
            <X size={13} aria-hidden="true" />
            <span>{busy === `reject-${p.id}` ? 'Rejecting…' : 'Reject'}</span>
          </button>
        </div>
      )}
    </article>
  );
};
