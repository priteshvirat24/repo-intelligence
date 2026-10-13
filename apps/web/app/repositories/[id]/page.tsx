'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowUpRight,
  Star,
  Code,
  GitBranch,
  Shield,
  GitCommit,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Layers,
  RotateCw,
  Trash2,
  MessageSquare
} from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { useLibrary } from '@/components/LibraryProvider';
import { EvidenceDrawer, EvidenceItem } from '@/components/EvidenceDrawer';
import { StatusBadge } from '@/components/Primitives';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ActionCallout, IndexingProgress, LoadError } from '@/components/IndexingState';
import { useRepositoryStatus } from '@/lib/ui/useRepositoryStatus';
import { isFailedStatus, isTerminalStatus } from '@/lib/ui/status';
import { askHref, githubRepoUrl, repoSeedPrompt, shortLocation, slugify } from '@/lib/ui/github';
import { shortDate } from '@/lib/ui/api';
import { ActionNotice, noticeForReindex, reindexRepository, removeFromLibrary } from '@/lib/ui/actions';

interface EvidenceRow {
  id?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  symbolName?: string;
  verified?: boolean;
  quote?: string;
  quoteSnippet?: string;
}

const COMPLETENESS_COPY: Record<string, string> = {
  full: 'Full analysis',
  partial: 'Partial analysis',
  limited: 'Limited analysis'
};

function EvidenceChips({ evidence, onOpen }: { evidence: EvidenceRow[]; onOpen: (ev: EvidenceRow) => void }) {
  if (!evidence || evidence.length === 0) return null;
  return (
    <div className="row wrap gap-2" style={{ maxWidth: '100%' }}>
      {evidence.map((ev, idx) => {
        const verified = Boolean(ev.verified);
        const label = `${ev.filePath || 'excerpt'}${ev.startLine ? ` lines ${ev.startLine}${ev.endLine && ev.endLine !== ev.startLine ? `–${ev.endLine}` : ''}` : ''}${verified ? ', verified' : ', inferred, not verified'}`;
        return (
          <button
            key={ev.id || idx}
            type="button"
            className={`cite ${verified ? 'is-verified' : 'is-inferred'}`}
            title={ev.filePath || undefined}
            aria-label={`Open evidence: ${label}`}
            onClick={() => onOpen(ev)}
          >
            {verified ? <CheckCircle2 size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
            <span>{shortLocation(ev.filePath, ev.startLine)}</span>
          </button>
        );
      })}
    </div>
  );
}

function KnowledgeList({
  items,
  empty,
  onOpenEvidence,
  mono
}: {
  items: any[];
  empty: string;
  onOpenEvidence: (ev: EvidenceRow) => void;
  mono?: boolean;
}) {
  if (!items || items.length === 0) return <p className="small muted">{empty}</p>;
  return (
    <div className="def-list">
      {items.map((item: any, idx: number) => (
        <div key={item.id || idx} className="def-item stack gap-2">
          <div>
            <strong className={mono ? 'mono' : undefined} style={mono ? { fontSize: 'var(--fs-xs)' } : undefined}>
              {item.name}
            </strong>
            {item.description && <>{mono ? ' — ' : '. '}{item.description}</>}
          </div>
          {Array.isArray(item.evidence) && item.evidence.length > 0 && (
            <EvidenceChips evidence={item.evidence.slice(0, 4)} onOpen={onOpenEvidence} />
          )}
        </div>
      ))}
    </div>
  );
}

export default function RepositoryDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const { notifyLibraryChanged } = useLibrary();
  const [repo, setRepo] = useState<any>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);
  const [notice, setNotice] = useState<ActionNotice | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [forcePolling, setForcePolling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(`/api/repositories/${encodeURIComponent(params.id)}`, { cache: 'no-store' });
      if (res.status === 404) {
        setLoadState('notfound');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRepo(data);
      setLoadState('ready');
    } catch (err) {
      console.error('Error fetching repository detail:', err);
      // Keep showing what we had if a refresh fails.
      setLoadState((prev) => (prev === 'ready' ? prev : 'error'));
    }
  }, [params.id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const fullName = repo ? `${repo.owner}/${repo.name}` : '';
  const githubUrl = repo ? repo.url || githubRepoUrl(fullName) : '';

  // Follow indexing while the repository is not in a final state.
  const pollActive = Boolean(repo) && (forcePolling || !isTerminalStatus(repo?.status));
  const { data: live, lost: pollLost, retry: retryPoll } = useRepositoryStatus(params.id, pollActive, () => {
    setForcePolling(false);
    setNotice(null);
    fetchDetail();
    notifyLibraryChanged();
  });
  const effectiveStatus = pollActive && live?.repositoryStatus ? live.repositoryStatus : repo?.status;
  const isIndexing = pollActive && !isTerminalStatus(effectiveStatus);

  const handleReindex = async (force = false) => {
    if (!repo) return;
    setActionBusy(true);
    setNotice(null);
    const outcome = await reindexRepository(params.id, force);
    setActionBusy(false);
    setNotice(noticeForReindex(outcome, fullName));
    if (outcome.kind === 'started' || outcome.kind === 'already_indexing') {
      setRepo((prev: any) => (prev ? { ...prev, status: 'PENDING', errorMessage: null } : prev));
      setForcePolling(true);
      notifyLibraryChanged();
    }
  };

  const handleRemove = async () => {
    setRemoveBusy(true);
    setRemoveError(null);
    const result = await removeFromLibrary({ repositoryId: params.id });
    setRemoveBusy(false);
    if (!result.ok) {
      setRemoveError(result.message);
      return;
    }
    setConfirmOpen(false);
    notifyLibraryChanged();
    router.push(`/resources?removed=${encodeURIComponent(fullName)}`);
  };

  const openEvidence = useCallback((ev: EvidenceRow) => {
    if (!repo) return;
    setSelectedEvidence({
      repo: `${repo.owner}/${repo.name}`,
      resourceType: 'github_repository',
      filePath: ev.filePath,
      startLine: ev.startLine,
      endLine: ev.endLine,
      quote: ev.quote || ev.quoteSnippet || '',
      symbolName: ev.symbolName,
      verified: Boolean(ev.verified),
      commitHash: repo.latestCommitHash,
      defaultBranch: repo.defaultBranch
    });
  }, [repo]);

  const capabilities: any[] = useMemo(() => repo?.capabilities || [], [repo]);
  const capAnchor = (cap: any) => `cap-${slugify(cap.name || cap.slug || '')}`;

  // Capability deep links (#cap-…) resolve after data loads; fall back to a fuzzy name match.
  useEffect(() => {
    if (loadState !== 'ready' || typeof window === 'undefined') return;
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    if (!hash) return;
    let id = hash;
    if (!document.getElementById(id) && hash.startsWith('cap-')) {
      const wanted = hash.slice(4);
      const match = capabilities.find((c) => {
        const s = slugify(c.name || '');
        return s && (s.includes(wanted) || wanted.includes(s));
      });
      if (match) id = capAnchor(match);
    }
    const el = document.getElementById(id);
    if (!el) return;
    setTargetId(id);
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadState, capabilities]);

  if (loadState === 'loading') {
    return (
      <div className="app-shell">
        <Navbar />
        <main className="page">
          <div className="loading-line" role="status" style={{ paddingTop: 'var(--s-9)' }}>
            <span className="dot dot-pulse" aria-hidden="true" />
            Loading repository&hellip;
          </div>
        </main>
      </div>
    );
  }

  if (loadState === 'notfound' || loadState === 'error' || !repo) {
    return (
      <div className="app-shell">
        <Navbar />
        <main className="page">
          <div style={{ paddingTop: 'var(--s-5)' }}>
            <Link href="/resources" className="link-quiet">
              <ArrowLeft size={14} aria-hidden="true" />
              Back to Library
            </Link>
          </div>
          {loadState === 'notfound' ? (
            <div className="empty" style={{ marginTop: 'var(--s-7)' }}>
              <span className="eyebrow plain">404</span>
              <h1 className="h-section" style={{ fontSize: 'var(--fs-xl)' }}>Repository not found.</h1>
              <p>It may have been removed from the library, or the link is wrong.</p>
              <Link href="/resources" className="btn btn-secondary">
                <ArrowLeft size={15} aria-hidden="true" />
                Back to Library
              </Link>
            </div>
          ) : (
            <div style={{ marginTop: 'var(--s-7)' }}>
              <h1 className="sr-only">Repository</h1>
              <LoadError
                what="this repository"
                onRetry={() => {
                  setLoadState('loading');
                  fetchDetail();
                }}
              />
            </div>
          )}
        </main>
      </div>
    );
  }

  const openKnowledge = repo.openKnowledge || {};
  const completeness = repo.analysisCompleteness;
  const completenessTone = completeness?.level === 'full'
    ? 'verified'
    : completeness?.level === 'partial'
    ? 'inferred'
    : 'danger';
  const concepts = [...(repo.concepts || []), ...(repo.techniques || [])];
  const failed = isFailedStatus(effectiveStatus);
  const lastIndexed = shortDate(repo.updatedAt);
  const capabilityCount = repo.stats?.capabilities ?? capabilities.length;

  return (
    <div className="app-shell">
      <Navbar />

      <main className="page">
        {/* Back + actions */}
        <div className="row between wrap gap-3" style={{ paddingTop: 'var(--s-5)' }}>
          <Link href="/resources" className="link-quiet">
            <ArrowLeft size={14} aria-hidden="true" />
            Back to Library
          </Link>

          <div className="row wrap gap-2">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => handleReindex(false)}
              disabled={actionBusy || isIndexing}
            >
              <RotateCw size={14} className={actionBusy ? 'animate-spin' : ''} aria-hidden="true" />
              {actionBusy ? 'Re-indexing…' : 'Re-index'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm danger"
              onClick={() => {
                setRemoveError(null);
                setConfirmOpen(true);
              }}
            >
              <Trash2 size={14} aria-hidden="true" />
              Remove from library
            </button>
          </div>
        </div>

        {/* Header */}
        <header className="page-head" style={{ paddingTop: 'var(--s-7)' }}>
          <div className="page-head-title">
            <span className="eyebrow">{repo.owner}</span>
            <h1 className="h-page" style={{ overflowWrap: 'anywhere' }}>{repo.name}</h1>
            <div className="row wrap gap-2" style={{ marginTop: 'var(--s-1)' }}>
              <StatusBadge status={effectiveStatus} />
              {completeness?.level && (
                <span className={`badge badge-${completenessTone}`}>
                  <Layers size={12} aria-hidden="true" />
                  {COMPLETENESS_COPY[completeness.level] || completeness.level}
                </span>
              )}
            </div>
          </div>

          <div className="page-head-aside">
            <p className="lede">{repo.description || 'No description on GitHub.'}</p>
            <div className="meta-row">
              {repo.primaryLanguage && (
                <span><Code size={13} aria-hidden="true" />{repo.primaryLanguage}</span>
              )}
              <span><Star size={13} aria-hidden="true" />{repo.stars?.toLocaleString() || 0} stars</span>
              {repo.license && (
                <span><Shield size={13} aria-hidden="true" />{repo.license}</span>
              )}
              {repo.defaultBranch && (
                <span><GitBranch size={13} aria-hidden="true" />{repo.defaultBranch}</span>
              )}
            </div>
            <div className="row wrap gap-2">
              <Link href={askHref(repoSeedPrompt(fullName))} className="btn btn-primary">
                <MessageSquare size={16} aria-hidden="true" />
                <span>Ask about this repo</span>
              </Link>
              <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary">
                <span>View on GitHub</span>
                <ArrowUpRight size={15} aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </div>
          </div>
        </header>

        {notice && (
          <ActionCallout
            notice={notice}
            busy={actionBusy}
            onForce={() => handleReindex(true)}
            onDismiss={() => setNotice(null)}
            style={{ marginBottom: 'var(--s-5)' }}
          />
        )}

        {isIndexing && (
          <section className="card card-ink" style={{ marginBottom: 'var(--s-6)' }} aria-label="Indexing status">
            {pollLost ? (
              <div className="row between wrap gap-3">
                <span className="small">Lost contact with the indexing job. It may still be running.</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={retryPoll}>
                  <RotateCw size={13} aria-hidden="true" />
                  <span>Check again</span>
                </button>
              </div>
            ) : (
              <>
                <IndexingProgress
                  status={effectiveStatus}
                  step={live?.step && live.step !== 'IDLE' ? live.step : undefined}
                  resourceType="github_repository"
                  progress={live?.progress}
                />
                <p className="xsmall muted" style={{ marginTop: 'var(--s-2)' }}>
                  This page refreshes when indexing finishes. You can leave; it keeps going.
                </p>
              </>
            )}
          </section>
        )}

        {failed && (
          <div className="callout callout-danger" role="alert" style={{ marginBottom: 'var(--s-6)' }}>
            <AlertCircle size={16} aria-hidden="true" />
            <div className="grow stack gap-2">
              <div>
                <div className="callout-title">Indexing failed</div>
                <div>{live?.error || repo.errorMessage || 'Open Eye could not finish reading this repository.'}</div>
              </div>
              <div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleReindex(true)} disabled={actionBusy}>
                  <RotateCw size={13} aria-hidden="true" />
                  <span>Retry</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* At a glance */}
        <section aria-labelledby="glance-title" style={{ marginBottom: 'var(--s-8)' }}>
          <h2 id="glance-title" className="sr-only">At a glance</h2>
          <div className="ledger glance">
            {completeness && (
              <div className="ledger-cell">
                <span className="label">Files analyzed</span>
                <div className="ledger-value">
                  {completeness.filesAnalyzed ?? 0}
                  <span className="ledger-of"> / {completeness.filesDiscovered ?? 0}</span>
                </div>
              </div>
            )}
            <div className="ledger-cell is-primary">
              <span className="label">Capabilities</span>
              <div className="ledger-value">{capabilityCount}</div>
            </div>
            {(lastIndexed || repo.latestCommitHash) && (
              <div className="ledger-cell">
                <span className="label">Last indexed</span>
                <div className="glance-text">
                  {lastIndexed || '—'}
                  {repo.latestCommitHash && (
                    <span className="mono xsmall muted" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <GitCommit size={12} aria-hidden="true" />
                      {repo.latestCommitHash.slice(0, 7)}
                    </span>
                  )}
                </div>
              </div>
            )}
            {completeness?.level && (
              <div className="ledger-cell">
                <span className="label">Analysis</span>
                <div className="glance-text">
                  <span className={`glance-level tone-${completenessTone}`}>
                    {COMPLETENESS_COPY[completeness.level] || completeness.level}
                  </span>
                  <span className="xsmall muted">
                    {completeness.reason ||
                      (completeness.level === 'full'
                        ? 'Every discovered source file was analyzed.'
                        : `${completeness.subsystemsAnalyzed ?? 0} subsystems analyzed.`)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </section>

        {repo.domainTags && repo.domainTags.length > 0 && (
          <div className="row wrap gap-2" style={{ marginBottom: 'var(--s-7)' }}>
            <span className="label" style={{ marginRight: 'var(--s-1)' }}>Domains</span>
            {repo.domainTags.map((tag: string, i: number) => (
              <span key={i} className="tag tag-mono">#{tag}</span>
            ))}
          </div>
        )}

        {/* Purpose & problem space */}
        {(openKnowledge.purpose || openKnowledge.problemSpace) && (
          <section style={{ marginBottom: 'var(--s-8)' }}>
            <div className="rule-head">
              <h2 className="h-section">Purpose</h2>
            </div>
            <div className="grid-2">
              {openKnowledge.purpose && (
                <div>
                  <span className="label" style={{ marginBottom: 'var(--s-1)' }}>What it&apos;s for</span>
                  <p style={{ fontSize: 'var(--fs-md)', lineHeight: 1.55, maxWidth: 'var(--measure)' }}>{openKnowledge.purpose}</p>
                </div>
              )}
              {openKnowledge.problemSpace && (
                <div>
                  <span className="label" style={{ marginBottom: 'var(--s-1)' }}>Problem space</span>
                  <p style={{ fontSize: 'var(--fs-md)', lineHeight: 1.55, maxWidth: 'var(--measure)' }}>{openKnowledge.problemSpace}</p>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Use cases */}
        {repo.useCases && repo.useCases.length > 0 && (
          <section style={{ marginBottom: 'var(--s-8)' }}>
            <div className="rule-head">
              <h2 className="h-section">What you can do with it</h2>
              <span className="count">{repo.useCases.length}</span>
            </div>
            <KnowledgeList items={repo.useCases} empty="" onOpenEvidence={openEvidence} />
          </section>
        )}

        {/* Capabilities */}
        <section style={{ marginBottom: 'var(--s-8)' }} aria-labelledby="capabilities-title">
          <div className="rule-head">
            <h2 id="capabilities-title" className="h-section">Capabilities</h2>
            <span className="count">{capabilities.length}</span>
          </div>

          {capabilities.length > 0 ? (
            <div className="grid-cards">
              {capabilities.map((cap: any, i: number) => {
                const anchor = capAnchor(cap);
                const description = cap.description || cap.implementationNotes;
                const notes = cap.description && cap.implementationNotes && cap.implementationNotes !== cap.description
                  ? cap.implementationNotes
                  : null;
                return (
                  <article
                    key={`${anchor}-${i}`}
                    id={anchor}
                    tabIndex={-1}
                    className={`card res-card cap-card${targetId === anchor ? ' is-target' : ''}`}
                    aria-labelledby={`${anchor}-title`}
                  >
                    <div className="stack gap-2">
                      <div className="res-card-top" style={{ alignItems: 'flex-start' }}>
                        {cap.category ? <span className="tag">{cap.category}</span> : <span />}
                        {typeof cap.confidence === 'number' && (
                          <span className="badge badge-outline" title="Model confidence">
                            <span className="num">{Math.round(cap.confidence * 100)}%</span>
                            <span className="sr-only"> confidence</span>
                          </span>
                        )}
                      </div>
                      <h3 id={`${anchor}-title`} className="res-title" style={{ fontSize: 'var(--fs-md)' }}>
                        <a href={`#${anchor}`} className="anchor-link">{cap.name}</a>
                      </h3>
                      {description && <p className="small">{description}</p>}
                      {notes && <p className="small muted">{notes}</p>}
                    </div>

                    {cap.evidence && cap.evidence.length > 0 && (
                      <div className="card-foot" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                        <span className="label">Evidence</span>
                        <EvidenceChips evidence={cap.evidence} onOpen={openEvidence} />
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="small muted">
              {isIndexing ? 'Capabilities appear here once indexing finishes.' : 'No capabilities extracted yet.'}
            </p>
          )}
        </section>

        {/* Components / entry points */}
        {((repo.components && repo.components.length > 0) || (repo.interfaces && repo.interfaces.length > 0)) && (
          <div className="grid-2" style={{ marginBottom: 'var(--s-8)' }}>
            <section>
              <div className="rule-head">
                <h2 className="h-section">Components</h2>
                <span className="count">{repo.components?.length || 0}</span>
              </div>
              <KnowledgeList items={repo.components || []} empty="None recorded." onOpenEvidence={openEvidence} />
            </section>
            <section>
              <div className="rule-head">
                <h2 className="h-section">Entry points &amp; interfaces</h2>
                <span className="count">{repo.interfaces?.length || 0}</span>
              </div>
              <KnowledgeList items={repo.interfaces || []} empty="None recorded." onOpenEvidence={openEvidence} />
            </section>
          </div>
        )}

        {/* Features / concepts */}
        <div className="grid-2" style={{ marginBottom: 'var(--s-8)' }}>
          <section>
            <div className="rule-head">
              <h2 className="h-section">Features</h2>
              <span className="count">{repo.features?.length || 0}</span>
            </div>
            <KnowledgeList items={repo.features || []} empty="None recorded." onOpenEvidence={openEvidence} />
          </section>

          <section>
            <div className="rule-head">
              <h2 className="h-section">Concepts &amp; techniques</h2>
              <span className="count">{concepts.length}</span>
            </div>
            <KnowledgeList items={concepts} empty="None recorded." onOpenEvidence={openEvidence} />
          </section>
        </div>

        {/* Inputs / outputs */}
        <div className="grid-2" style={{ marginBottom: 'var(--s-8)' }}>
          <section>
            <div className="rule-head">
              <h2 className="h-section">Inputs</h2>
              <span className="count">{repo.inputs?.length || 0}</span>
            </div>
            <KnowledgeList items={repo.inputs || []} empty="No explicit inputs found." onOpenEvidence={openEvidence} mono />
          </section>

          <section>
            <div className="rule-head">
              <h2 className="h-section">Outputs</h2>
              <span className="count">{repo.outputs?.length || 0}</span>
            </div>
            <KnowledgeList items={repo.outputs || []} empty="No explicit outputs found." onOpenEvidence={openEvidence} mono />
          </section>
        </div>

        {/* Dependencies / limitations */}
        <div className="grid-2">
          <section>
            <div className="rule-head">
              <h2 className="h-section">Dependencies</h2>
              <span className="count">{repo.dependencies?.length || 0}</span>
            </div>
            {repo.dependencies && repo.dependencies.length > 0 ? (
              <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 'var(--s-2)' }} tabIndex={0} aria-label="Dependencies list">
                {repo.dependencies.map((d: any, idx: number) => (
                  <div key={idx} className="dep-row">
                    <span className="mono truncate">{d.packageName}</span>
                    <span className="mono faint" style={{ flexShrink: 0 }}>{d.versionSpec || 'latest'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">No manifest dependencies found.</p>
            )}
          </section>

          <section>
            <div className="rule-head">
              <h2 className="h-section">Known limitations</h2>
              <span className="count">{repo.limitations?.length || 0}</span>
            </div>
            {repo.limitations && repo.limitations.length > 0 ? (
              <div className="def-list">
                {repo.limitations.map((lim: any, idx: number) => (
                  <div key={idx} className="def-item">
                    {lim.category && <span className="badge badge-outline" style={{ marginRight: 'var(--s-2)' }}>{lim.category}</span>}
                    {lim.description}
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">None recorded.</p>
            )}
          </section>
        </div>
      </main>

      <EvidenceDrawer
        isOpen={Boolean(selectedEvidence)}
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
      />

      <ConfirmDialog
        open={confirmOpen}
        title={`Remove ${fullName} from library?`}
        confirmLabel="Remove from library"
        tone="danger"
        busy={removeBusy}
        error={removeError}
        onConfirm={handleRemove}
        onCancel={() => setConfirmOpen(false)}
      >
        Open Eye will forget this repository&apos;s capabilities, evidence and search index. The repository on
        GitHub is not touched, and you can add it again later.
      </ConfirmDialog>
    </div>
  );
}
