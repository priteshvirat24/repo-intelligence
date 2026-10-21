'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Search } from 'lucide-react';
import type { MemoryClaim, MemoryEpisode, MemoryProcedure, MemoryType } from '@repo/shared';
import { Navbar } from '@/components/Navbar';
import { LoadError } from '@/components/IndexingState';
import { readJsonSafe } from '@/lib/ui/api';

const TABS: Array<{ id: MemoryType; label: string; help: string }> = [
  { id: 'semantic', label: 'Semantic', help: 'Facts about repositories and other sources, graded by evidence' },
  { id: 'episodic', label: 'Episodic', help: 'What happened in each past run, and feedback since' },
  { id: 'procedural', label: 'Procedural', help: 'Ways of researching learned from runs and evaluations' }
];

const GRADE_LABEL: Record<string, string> = { E1: 'executed', E2: 'code', E3: 'documented', E4: 'claimed', E5: 'inferred' };

function gradeTone(grade: string) {
  return grade === 'E1' || grade === 'E2' ? 'badge-verified' : grade === 'E3' ? 'badge-signal' : grade === 'E4' ? 'badge-inferred' : 'badge-neutral';
}

function day(value?: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'unknown';
}

function subjectUrl(subject: string): string | null {
  return subject.startsWith('github:') ? `https://github.com/${subject.slice(7)}` : null;
}

/** Freshness in words: a claim that is not current is never presented as one. */
function Freshness({ claim }: { claim: MemoryClaim }) {
  if (claim.status === 'refuted') return <span className="badge badge-danger">refuted</span>;
  if (claim.status === 'superseded') return <span className="badge badge-neutral">superseded</span>;
  if (!claim.current) return <span className="badge badge-inferred">last verified {day(claim.revalidatedAt || claim.observedAt)}, needs revalidation</span>;
  return (
    <span className="small muted">
      verified {day(claim.revalidatedAt || claim.observedAt)}
      {claim.revalidateAfter ? ` · recheck after ${day(claim.revalidateAfter)}` : ''}
    </span>
  );
}

function ClaimCard({ claim, onChanged }: { claim: MemoryClaim; onChanged: () => void }) {
  const [mode, setMode] = useState<'idle' | 'refute'>('idle');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const url = subjectUrl(claim.subject);

  const send = async (action: 'refute' | 'confirm') => {
    setBusy(true);
    setMessage(null);
    const res = await fetch(`/api/claims/${claim.id}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'refute' ? { reason } : {})
    });
    const body = await readJsonSafe<any>(res);
    setBusy(false);
    if (!res.ok) {
      setMessage(body?.error || 'Could not record that.');
      return;
    }
    setMode('idle');
    setReason('');
    setMessage(action === 'refute'
      ? `Refuted. ${body.invalidatedBriefs?.length ? `${body.invalidatedBriefs.length} blueprint(s) that cited it will be re-written.` : 'No blueprint in this workspace cited it.'}`
      : 'Confirmation recorded.');
    onChanged();
  };

  return (
    <article className="card stack gap-2">
      <div className="row between wrap gap-2">
        <div className="row wrap gap-2">
          <span className={`badge ${gradeTone(claim.grade)}`} title={GRADE_LABEL[claim.grade]}>{claim.grade} {GRADE_LABEL[claim.grade]}</span>
          <span className="tag">{claim.kind}</span>
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="tag tag-mono tag-ink">
              <span className="truncate">{claim.subject.slice(7)}</span>
              <ArrowUpRight size={11} aria-hidden="true" />
            </a>
          ) : <span className="tag tag-mono">{claim.subject}</span>}
          {claim.scope === 'workspace' && claim.briefId && <Link href={`/briefs/${claim.briefId}`} className="tag">project</Link>}
        </div>
        <Freshness claim={claim} />
      </div>
      <p>{claim.statement}</p>
      <details className="disclosure">
        <summary className="small">
          {claim.evidence.length} evidence {claim.evidence.length === 1 ? 'item' : 'items'}
          {claim.subjectVersion ? <> · at <span className="mono">{claim.subjectVersion.slice(0, 10)}</span></> : null}
          {typeof claim.sourceReliability === 'number' ? <> · source reliability <span className="num">{claim.sourceReliability.toFixed(2)}</span></> : null}
        </summary>
        <ul className="stack gap-1 small" style={{ marginTop: 'var(--s-2)' }}>
          {claim.evidence.map((e, i) => (
            <li key={i}>
              <span className="mono">{e.method}</span>
              {e.grade ? <> ({e.grade})</> : null}
              {e.locator?.filePath ? <> · <span className="mono">{e.locator.filePath}{e.locator.startLine ? `:${e.locator.startLine}` : ''}</span></> : null}
              {e.reason ? <> · “{e.reason}”</> : null}
              {e.sourceUrl ? <> · <a className="link" href={e.sourceUrl} target="_blank" rel="noreferrer">source</a></> : null}
              {e.excerpt ? <div className="quote-line mono xsmall">{e.excerpt}</div> : null}
            </li>
          ))}
        </ul>
      </details>
      {claim.status !== 'refuted' && (
        mode === 'refute' ? (
          <div className="stack gap-2">
            <label className="label" htmlFor={`refute-${claim.id}`}>Why is it wrong?</label>
            <textarea id={`refute-${claim.id}`} className="field" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="row gap-2">
              <button type="button" className="btn btn-danger btn-sm" disabled={busy || !reason.trim()} onClick={() => send('refute')}>Refute claim</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMode('idle')}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="row gap-2">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setMode('refute')}>This is wrong</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => send('confirm')}>Confirm</button>
          </div>
        )
      )}
      {message && <p className="small muted" role="status">{message}</p>}
    </article>
  );
}

function SemanticTab() {
  const [q, setQ] = useState('');
  const [grade, setGrade] = useState('');
  const [freshness, setFreshness] = useState('');
  const [status, setStatus] = useState('');
  const [claims, setClaims] = useState<MemoryClaim[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (grade) params.set('grade', grade);
    if (freshness) params.set('freshness', freshness);
    if (status) params.set('status', status);
    try {
      const res = await fetch(`/api/memory/claims?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setClaims((await res.json()).claims);
      setError(false);
    } catch {
      setError(true);
    }
  }, [q, grade, freshness, status]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="stack gap-4">
      <div className="field-wrap">
        <Search size={17} className="field-icon" aria-hidden="true" />
        <label htmlFor="memory-search" className="sr-only">Search claims</label>
        <input id="memory-search" className="field has-icon" placeholder="Search claims or a repository, e.g. sgp4, owner/name"
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row wrap gap-2">
        <select className="field" aria-label="Grade" value={grade} onChange={(e) => setGrade(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Any grade</option>
          {Object.entries(GRADE_LABEL).map(([g, l]) => <option key={g} value={g}>{g} {l}</option>)}
        </select>
        <select className="field" aria-label="Freshness" value={freshness} onChange={(e) => setFreshness(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Any freshness</option>
          <option value="current">Current</option>
          <option value="stale">Needs revalidation</option>
        </select>
        <select className="field" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Any status</option>
          <option value="current">current</option>
          <option value="needs_revalidation">needs revalidation</option>
          <option value="refuted">refuted</option>
          <option value="superseded">superseded</option>
        </select>
      </div>
      {error ? <LoadError what="claims" onRetry={load} /> : claims === null ? (
        <div className="loading-line" role="status"><span className="dot dot-pulse" aria-hidden="true" />Loading claims&hellip;</div>
      ) : claims.length === 0 ? (
        <div className="empty"><h3>No claims match.</h3><p>Claims are written as briefs are researched and repositories verified.</p></div>
      ) : (
        <div className="stack gap-3">{claims.map((c) => <ClaimCard key={c.id} claim={c} onChanged={load} />)}</div>
      )}
    </div>
  );
}

function EpisodicTab() {
  const [episodes, setEpisodes] = useState<MemoryEpisode[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/memory/episodes', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEpisodes((await res.json()).episodes);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <LoadError what="past runs" onRetry={load} />;
  if (episodes === null) return <div className="loading-line" role="status"><span className="dot dot-pulse" aria-hidden="true" />Loading past runs&hellip;</div>;
  if (episodes.length === 0) return <div className="empty"><h3>No runs remembered yet.</h3><p>Each brief run is remembered when it completes, stops or fails.</p></div>;
  return (
    <div className="stack gap-3">
      {episodes.map((e) => (
        <article key={e.id} className={e.kind === 'event' ? 'card card-flat stack gap-1' : 'card stack gap-2'}>
          <div className="row between wrap gap-2">
            <div className="row wrap gap-2">
              <span className={`badge ${e.outcome === 'completed' || e.outcome === 'confirmed' ? 'badge-verified' : e.outcome === 'refuted' || e.outcome === 'failed' ? 'badge-danger' : 'badge-inferred'}`}>{e.outcome}</span>
              <span className="tag">{e.kind === 'run' ? 'run' : 'later event'}</span>
              {e.briefId && <Link href={`/briefs/${e.briefId}`} className="link small">{e.title || 'brief'}</Link>}
            </div>
            <span className="small muted">{day(e.finishedAt)}</span>
          </div>
          {e.summary && <p>{e.summary}</p>}
          {e.kind === 'run' && (
            <details className="disclosure">
              <summary className="small">
                {e.queries.length} queries · {e.shortlisted.length} shortlisted · {e.decisions.length} decisions
                {e.memory?.memoryCandidates ? ` · ${e.memory.memoryCandidates} from memory` : ''}
                {e.memory?.searchesAvoided ? ` · ${e.memory.searchesAvoided} searches avoided` : ''}
                {e.budget?.llmCalls !== undefined ? ` · ${e.budget.llmCalls} LLM calls, ${e.budget.githubRequests ?? 0} GitHub requests` : ''}
              </summary>
              <div className="stack gap-2 small" style={{ marginTop: 'var(--s-2)' }}>
                {e.queries.length > 0 && (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead><tr><th>Query</th><th>Requirement</th><th>Results</th><th>New</th><th>Shortlisted found</th></tr></thead>
                      <tbody>
                        {e.queries.map((q, i) => (
                          <tr key={i}><td className="mono">{q.query}</td><td>{q.requirement}</td><td className="num">{q.results ?? '–'}</td>
                            <td className="num">{q.newCandidates ?? '–'}</td><td className="mono">{(q.shortlistedFound || []).join(', ') || '–'}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {e.decisions.length > 0 && <p>Decisions: {e.decisions.map((d) => `${d.component}: ${d.decision}${d.repo ? ` (${d.repo})` : ''}`).join('; ')}</p>}
                {e.rejected.length > 0 && <p className="muted">Not shortlisted: {e.rejected.slice(0, 6).map((r) => `${r.fullName} (${r.reason})`).join('; ')}</p>}
                {e.feedback.length > 0 && <p>Feedback since: {e.feedback.map((f) => `${f.outcome}${f.subject ? ` ${f.subject}` : ''}${f.reason ? `: ${f.reason}` : ''}`).join('; ')}</p>}
                {e.tuningVersion && <p className="muted mono xsmall">tuning {e.tuningVersion}</p>}
              </div>
            </details>
          )}
        </article>
      ))}
    </div>
  );
}

function ProceduralTab() {
  const [data, setData] = useState<{ procedures: MemoryProcedure[]; canManage: boolean; minActivationSuccesses: number } | null>(null);
  const [error, setError] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/memory/procedures', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (id: string, action: 'activate' | 'retire') => {
    setMessage(null);
    const res = await fetch(`/api/memory/procedures/${id}/${action}`, { method: 'POST' });
    const body = await readJsonSafe<any>(res);
    if (!res.ok) setMessage(body?.error || `Could not ${action} it.`);
    load();
  };

  if (error) return <LoadError what="procedures" onRetry={load} />;
  if (data === null) return <div className="loading-line" role="status"><span className="dot dot-pulse" aria-hidden="true" />Loading procedures&hellip;</div>;
  return (
    <div className="stack gap-3">
      <p className="small muted">
        Procedures are proposed when a pattern recurs in at least three successful runs and no run contradicts it. A maintainer
        activates one only after it has {data.minActivationSuccesses} successful uses; active query procedures are shown to the
        search planner. An active procedure that fails half of its uses retires itself.
      </p>
      {message && <div className="callout callout-danger small" role="alert">{message}</div>}
      {data.procedures.length === 0 ? (
        <div className="empty"><h3>Nothing learned yet.</h3><p>Procedures appear once runs or evaluations show a pattern that works.</p></div>
      ) : data.procedures.map((p) => (
        <article key={p.id} className="card stack gap-2">
          <div className="row between wrap gap-2">
            <div className="row wrap gap-2">
              <span className={`badge ${p.status === 'active' ? 'badge-verified' : p.status === 'candidate' ? 'badge-inferred' : 'badge-neutral'}`}>{p.status}</span>
              <span className="tag">{p.kind.replace('_', ' ')}</span>
              <span className="tag">{p.scope}</span>
            </div>
            <span className="small muted">
              <span className="num">{p.successCount}</span> worked · <span className="num">{p.failureCount}</span> failed · <span className="num">{p.usesCount}</span> uses
              {typeof p.confidence === 'number' ? ` · confidence ${p.confidence.toFixed(2)}` : ''}
            </span>
          </div>
          <h3 className="res-title">{p.name}</h3>
          <p className="small muted">
            When: {p.trigger.requirementTerms?.length ? `a requirement about ${p.trigger.requirementTerms.join(' ')}` : p.trigger.domain ? `a ${p.trigger.domain} brief` : 'any brief'}
            {' · '}Evidence: {p.evidence.episodes?.length ? `${p.evidence.episodes.length} runs` : ''}{p.evidence.evalRuns?.length ? `${p.evidence.evalRuns.length} evaluation runs` : ''}
            {' · '}Revalidation: {p.revalidationRule}
          </p>
          {data.canManage && p.status !== 'retired' && (
            <div className="row gap-2">
              {p.status === 'candidate' && (
                <button type="button" className="btn btn-secondary btn-sm" disabled={p.successCount < data.minActivationSuccesses}
                        title={p.successCount < data.minActivationSuccesses ? `Needs ${data.minActivationSuccesses} successful uses` : undefined}
                        onClick={() => act(p.id, 'activate')}>Activate</button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => act(p.id, 'retire')}>Retire</button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}

export default function MemoryPage() {
  const [tab, setTab] = useState<MemoryType>('semantic');
  return (
    <div className="app-shell">
      <Navbar />
      <main className="page">
        <header className="page-head">
          <div className="page-head-title">
            <span className="eyebrow">Memory</span>
            <h1 className="h-page">What Open Eye remembers, and why.</h1>
          </div>
          <div className="page-head-aside">
            <p className="lede">
              Every finding carries its evidence, grade and the date it was last verified. Findings past their freshness rule are
              shown as such and revalidated before a decision relies on them. Correct anything that is wrong: the blueprints that
              cited it are re-written.
            </p>
          </div>
        </header>
        <div className="segmented" role="tablist" aria-label="Memory type" style={{ marginBottom: 'var(--s-5)' }}>
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} title={t.help} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <section role="tabpanel" aria-label={TABS.find((t) => t.id === tab)?.label}>
          {tab === 'semantic' ? <SemanticTab /> : tab === 'episodic' ? <EpisodicTab /> : <ProceduralTab />}
        </section>
      </main>
    </div>
  );
}
