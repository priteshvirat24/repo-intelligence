'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertCircle, AlertTriangle, ArrowLeft, ArrowUpRight, Plus, RotateCw, Star } from 'lucide-react';
import { BriefCandidate, BriefDetail, OpenRequirement, RequirementCoverage } from '@repo/shared';
import { Navbar } from '@/components/Navbar';
import { StatusBadge } from '@/components/Primitives';
import { LoadError } from '@/components/IndexingState';
import { BlueprintSection } from '@/components/briefs/BlueprintSection';
import { formatRetryAfter, httpErrorTitle, readJsonSafe, retryAfterSeconds, shortDate } from '@/lib/ui/api';
import { KIND_LABELS, compactNumber, discoveryProgress, discoveryStepLabel, isBriefActive } from '@/lib/ui/briefs';

const COVERAGE_TONE: Record<RequirementCoverage, string> = {
  yes: 'badge-verified',
  partial: 'badge-inferred',
  no: 'badge-outline',
  unknown: 'badge-outline'
};

type AddState = { busy?: boolean; message?: string; error?: boolean };

export default function BriefDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [brief, setBrief] = useState<BriefDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const [rerunError, setRerunError] = useState<string | null>(null);
  const [added, setAdded] = useState<Record<string, AddState>>({});

  const fetchBrief = useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/briefs/${id}`, { cache: 'no-store' });
      const data: any = await readJsonSafe(res);
      if (!res.ok || !data) {
        setLoadError(res.status === 404 ? 'This brief does not exist or was deleted.' : 'The server did not respond as expected.');
        return;
      }
      setBrief(data);
      setLoadError(null);
    } catch {
      setLoadError('Could not reach Open Eye.');
    }
  }, [id]);

  useEffect(() => {
    fetchBrief();
  }, [fetchBrief]);

  useEffect(() => {
    // Keep polling while discovery runs, and while the blueprint waits for verification or is being written
    const blueprintActive = brief?.blueprint && (brief.blueprint.status === 'WAITING' || brief.blueprint.status === 'RUNNING');
    if (!brief || (!isBriefActive(brief.status) && !blueprintActive)) return;
    const timer = setInterval(fetchBrief, 3000);
    return () => clearInterval(timer);
  }, [brief, fetchBrief]);

  const rerun = async () => {
    setRerunning(true);
    setRerunError(null);
    try {
      const res = await fetch(`/api/briefs/${id}/discover`, { method: 'POST' });
      const data: any = (await readJsonSafe(res)) || {};
      if (!res.ok) {
        setRerunError(res.status === 429 ? formatRetryAfter(retryAfterSeconds(res, data)) : data.error || httpErrorTitle(res.status));
        return;
      }
      await fetchBrief();
    } catch {
      setRerunError('Could not reach Open Eye.');
    } finally {
      setRerunning(false);
    }
  };

  const addToLibrary = async (candidate: BriefCandidate) => {
    setAdded((prev) => ({ ...prev, [candidate.id]: { busy: true } }));
    try {
      const res = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: candidate.sourceUrl })
      });
      const data: any = (await readJsonSafe(res)) || {};
      const state: AddState = !res.ok
        ? { error: true, message: data.error || httpErrorTitle(res.status) }
        : data.alreadyExists
          ? { message: 'Already in the library.' }
          : { message: 'Added. Indexing runs in the background.' };
      setAdded((prev) => ({ ...prev, [candidate.id]: state }));
    } catch {
      setAdded((prev) => ({ ...prev, [candidate.id]: { error: true, message: 'Could not reach Open Eye.' } }));
    }
  };

  if (loadError && !brief) {
    return (
      <div className="app-shell">
        <Navbar />
        <main className="page">
          <LoadError what="the brief" detail={loadError} onRetry={fetchBrief} />
        </main>
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="app-shell">
        <Navbar />
        <main className="page">
          <div className="loading-line" role="status">
            <span className="dot dot-pulse" aria-hidden="true" />
            Loading the brief&hellip;
          </div>
        </main>
      </div>
    );
  }

  const active = isBriefActive(brief.status);
  const requirements = brief.requirements?.requirements || [];
  const shortlist = brief.candidates.filter((c) => c.shortlisted);
  const others = brief.candidates.filter((c) => !c.shortlisted);
  const queries = brief.discovery?.queries || [];

  return (
    <div className="app-shell">
      <Navbar />

      <main className="page">
        <Link href="/briefs" className="link-action small" style={{ marginBottom: 'var(--s-4)', display: 'inline-flex' }}>
          <ArrowLeft size={14} aria-hidden="true" />
          <span>All briefs</span>
        </Link>

        <header className="page-head">
          <div className="page-head-title">
            <span className="eyebrow">Brief</span>
            <h1 className="h-page">{brief.title}</h1>
          </div>
          <div className="page-head-aside">
            <p className="lede">{brief.requirements?.problemSummary}</p>
            <div className="row wrap gap-3">
              <StatusBadge status={brief.status} />
              {!active && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={rerun} disabled={rerunning}>
                  <RotateCw size={13} aria-hidden="true" />
                  <span>{rerunning ? 'Queuing…' : 'Run discovery again'}</span>
                </button>
              )}
            </div>
            {rerunError && <div className="small" role="alert" style={{ color: 'var(--danger)' }}>{rerunError}</div>}
          </div>
        </header>

        {active && (
          <div className="indexing" style={{ marginBottom: 'var(--s-6)' }}>
            <div className="indexing-label">
              <span className="dot dot-pulse" aria-hidden="true" />
              <span>{discoveryStepLabel(brief.step)}&hellip;</span>
              <span className="num faint">{discoveryProgress(brief.step)}%</span>
            </div>
            <div className="progress progress-sm" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={discoveryProgress(brief.step)} aria-label="Discovery progress">
              <div className="progress-fill" style={{ width: `${discoveryProgress(brief.step)}%` }} />
            </div>
            {brief.errorMessage && <p className="small muted">{brief.errorMessage}</p>}
          </div>
        )}

        {brief.status === 'FAILED' && (
          <div className="callout callout-danger" role="alert" style={{ marginBottom: 'var(--s-6)' }}>
            <AlertCircle size={16} aria-hidden="true" />
            <div>
              <div className="callout-title">Discovery failed.</div>
              <div>{brief.errorMessage || 'The worker could not finish discovery.'}</div>
            </div>
          </div>
        )}

        {brief.decompositionMode === 'heuristic' && (
          <div className="callout callout-inferred" style={{ marginBottom: 'var(--s-6)' }}>
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <div className="callout-title">Requirements were extracted with keyword rules.</div>
              <div>The AI provider did not return a usable breakdown, so these requirements are rough. Searches are based on them.</div>
            </div>
          </div>
        )}

        <section style={{ marginBottom: 'var(--s-7)' }}>
          <div className="rule-head">
            <h2 className="label">Requirements</h2>
            <span className="count">{requirements.length}</span>
          </div>
          <div className="stack gap-3">
            {requirements.map((r) => <RequirementRow key={r.name} requirement={r} />)}
          </div>
        </section>

        {brief.status === 'COMPLETED' && (
          <>
            {brief.blueprint && <BlueprintSection blueprint={brief.blueprint} />}

            <section style={{ marginBottom: 'var(--s-7)' }}>
              <div className="rule-head">
                <h2 className="label">Best starting points</h2>
                <span className="count">{shortlist.length}</span>
              </div>
              <p className="small muted" style={{ marginBottom: 'var(--s-4)' }}>
                Ranked by how much of the brief their README shows they cover, then search relevance and project health.
                Add one to the library to verify its capabilities against the code.
              </p>
              {shortlist.length === 0 ? (
                <div className="empty">
                  <h3>No strong match.</h3>
                  <p>None of the repositories whose READMEs were read clearly covers a requirement. That can mean the gap is real; the other candidates are listed below.</p>
                </div>
              ) : (
                <div className="stack gap-4">
                  {shortlist.map((c) => (
                    <CandidateCard key={c.id} candidate={c} requirements={requirements} addState={added[c.id]} onAdd={() => addToLibrary(c)} />
                  ))}
                </div>
              )}
            </section>

            {others.length > 0 && (
              <section style={{ marginBottom: 'var(--s-7)' }}>
                <div className="rule-head">
                  <h2 className="label">Other candidates</h2>
                  <span className="count">{others.length}</span>
                </div>
                <div className="stack gap-3">
                  {others.map((c) => (
                    <CandidateCard key={c.id} candidate={c} requirements={requirements} addState={added[c.id]} onAdd={() => addToLibrary(c)} compact />
                  ))}
                </div>
              </section>
            )}

            <section>
              <div className="rule-head">
                <h2 className="label">How the search ran</h2>
              </div>
              <div className="stack gap-3 small">
                <div className="muted">
                  {brief.discovery?.candidatesFound ?? 0} repositories found, {brief.discovery?.duplicatesRemoved ?? 0} copies set aside,{' '}
                  {brief.discovery?.readmesAssessed ?? 0} READMEs read
                  {brief.discovery?.durationMs ? ` in ${Math.round(brief.discovery.durationMs / 1000)}s` : ''}.
                  {brief.discovery?.queryPlanner === 'heuristic' && ' Queries were built from requirement keywords because the AI planner was unavailable.'}
                  {brief.discovery?.githubAuthenticated === false && ' GitHub was searched without a token, at lower rate limits.'}
                  {brief.discoveredAt && ` Last run ${shortDate(brief.discoveredAt)}.`}
                </div>
                <div className="row wrap gap-2">
                  {queries.map((q) => (
                    <span key={q.query} className="tag tag-mono" title={`${q.requirement === '(overall)' ? 'Whole problem' : q.requirement}${q.searchedAs?.length ? `\nSearched as: ${q.searchedAs.join(' → ')}` : ''}`}>
                      {q.query} <span className="faint">{q.results}</span>
                    </span>
                  ))}
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

const RequirementRow: React.FC<{ requirement: OpenRequirement }> = ({ requirement }) => (
  <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
    <span className={`badge ${requirement.criticality === 'MUST' ? 'badge-signal' : 'badge-neutral'}`} style={{ flexShrink: 0, minWidth: 64, justifyContent: 'center' }}>
      {requirement.criticality.replace(/_/g, ' ')}
    </span>
    <div className="stack gap-1">
      <strong>{requirement.name}</strong>
      <span className="small muted">
        {requirement.description}
        {requirement.confidenceLevel && requirement.confidenceLevel !== 'explicit' && (
          <span className="faint"> · {requirement.confidenceLevel}</span>
        )}
      </span>
    </div>
  </div>
);

const CandidateCard: React.FC<{
  candidate: BriefCandidate;
  requirements: OpenRequirement[];
  addState?: AddState;
  onAdd: () => void;
  compact?: boolean;
}> = ({ candidate: c, requirements, addState, onAdd, compact }) => {
  const coverage = c.assessment?.coverage || {};
  const assessedNames = requirements.map((r) => r.name).filter((name) => coverage[name]);
  const summary = c.assessment?.summary || c.description;
  return (
    <article className={`card stack ${compact ? 'gap-2' : 'gap-3'}`} style={compact ? { padding: 'var(--s-4)' } : undefined}>
      <div className="row wrap between gap-3">
        <div className="row wrap gap-2">
          <span className="num faint">#{c.rank}</span>
          <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="link res-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: compact ? undefined : 'var(--fs-md)' }}>
            {c.fullName}
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <span className="tag">{KIND_LABELS[c.candidateKind] || c.candidateKind}</span>
          {c.duplicateOf && <span className="tag">Copy of {c.duplicateOf}</span>}
        </div>
        <div className="row wrap gap-3 small muted">
          <span className="row gap-1"><Star size={13} aria-hidden="true" />{compactNumber(c.stars)}</span>
          {c.primaryLanguage && <span>{c.primaryLanguage}</span>}
          {c.license && c.license !== 'NOASSERTION' && <span>{c.license}</span>}
          {c.pushedAt && <span>pushed {shortDate(c.pushedAt)}</span>}
        </div>
      </div>

      {summary && <p className={compact ? 'small clamp-2' : ''}>{summary}</p>}

      {assessedNames.length > 0 && (
        <div className="row wrap gap-2" aria-label="Requirement coverage from the README">
          {assessedNames.map((name) => {
            const value = coverage[name] as RequirementCoverage;
            return (
              <span key={name} className={`badge ${COVERAGE_TONE[value] || 'badge-outline'}`} title={`README shows: ${value}`}>
                {name}: {value}
              </span>
            );
          })}
        </div>
      )}

      {!compact && c.assessment?.reason && <p className="small muted">{c.assessment.reason}</p>}

      <div className="row wrap between gap-3">
        <span className="xsmall faint mono">
          score {c.finalScore.toFixed(2)}
          {c.coverageScore !== null && ` · coverage ${c.coverageScore.toFixed(2)}`} · relevance {c.relevanceScore.toFixed(2)} · health {c.healthScore.toFixed(2)}
        </span>
        <div className="row gap-2">
          {addState?.message && (
            <span className="small" role="status" style={addState.error ? { color: 'var(--danger)' } : undefined}>{addState.message}</span>
          )}
          {!addState?.message && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onAdd} disabled={addState?.busy}>
              <Plus size={13} aria-hidden="true" />
              <span>{addState?.busy ? 'Adding…' : 'Add to library'}</span>
            </button>
          )}
        </div>
      </div>
    </article>
  );
};
