'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { useLibrary } from '@/components/LibraryProvider';
import { SourceIcon, StatusBadge } from '@/components/Primitives';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ActionCallout, IndexingProgress, LoadError } from '@/components/IndexingState';
import {
  Search,
  ArrowUpRight,
  MessageSquare,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Plus,
  X,
  RotateCw,
  FolderGit2
} from 'lucide-react';
import { UniversalResource, ResourceType } from '@repo/shared';
import { useDialog } from '@/lib/ui/useDialog';
import { useIndexingStatus, ResourceStatusData } from '@/lib/ui/useIndexingStatus';
import { isFailedStatus, isTerminalStatus } from '@/lib/ui/status';
import { askHref, parseGithubRepo, repoSeedPrompt } from '@/lib/ui/github';
import {
  ActionNotice,
  noticeForReindex,
  reindexRepository,
  reindexResource,
  removeFromLibrary
} from '@/lib/ui/actions';

type LibraryItem = UniversalResource & { repositoryId?: string | null; errorMessage?: string | null };

// "autonomous-agent-automation" -> "Autonomous agent automation" (slug-style tags from analysis)
function humanizeTag(tag: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(tag)) return tag;
  const words = tag.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const getSourceLabel = (type: ResourceType) => {
  switch (type) {
    case 'github_repository': return 'GitHub repository';
    case 'youtube_video': return 'Video';
    case 'linkedin_post': return 'LinkedIn';
    case 'pdf': return 'PDF';
    case 'research_paper': return 'Paper';
    case 'documentation_site': return 'Docs';
    case 'article': return 'Article';
    default: return 'Web page';
  }
};

/** owner/repo for GitHub resources, the title for everything else. */
function displayName(r: { title?: string | null; sourceUrl?: string | null; canonicalUrl?: string | null; resourceType?: string | null }): string {
  if (r.resourceType === 'github_repository') {
    return parseGithubRepo(r.canonicalUrl) || parseGithubRepo(r.sourceUrl) || r.title || 'this repository';
  }
  return r.title || 'this source';
}

function ResourcesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedResourceId = searchParams.get('id');
  const removedName = searchParams.get('removed');
  const { openAddRepository, libraryVersion, notifyLibraryChanged } = useLibrary();

  const [resources, setResources] = useState<LibraryItem[]>([]);
  const [stats, setStats] = useState<any>({
    totalResources: 0,
    totalRepositories: 0,
    totalWebSources: 0,
    totalVideos: 0,
    totalDocuments: 0,
    totalDomains: 0
  });
  const [hasLoaded, setHasLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [pageNotice, setPageNotice] = useState<ActionNotice | null>(null);

  // Per-card action feedback and local status overrides (e.g. PENDING right after a re-index)
  const [notices, setNotices] = useState<Record<string, ActionNotice>>({});
  const [busyIds, setBusyIds] = useState<Record<string, boolean>>({});
  const [watchIds, setWatchIds] = useState<string[]>([]);

  // Detail sheet
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<any | null>(null);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'error' | 'notfound'>('idle');
  const [detailStatus, setDetailStatus] = useState<ResourceStatusData | null>(null);

  // Remove confirmation
  const [pendingRemove, setPendingRemove] = useState<LibraryItem | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const requestSeq = useRef(0);

  const fetchResources = useCallback(async () => {
    const seq = ++requestSeq.current;
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (appliedQuery.trim()) params.set('search', appliedQuery.trim());
      if (activeFilter !== 'all') params.set('type', activeFilter);
      const res = await fetch(`/api/resources?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (seq !== requestSeq.current) return;
      setResources(data.items || []);
      if (data.stats) setStats(data.stats);
      setLoadError(false);
      setHasLoaded(true);
    } catch (err) {
      if (seq !== requestSeq.current) return;
      console.error('Error fetching resources:', err);
      setLoadError(true);
    } finally {
      if (seq === requestSeq.current) setIsLoading(false);
    }
  }, [appliedQuery, activeFilter]);

  useEffect(() => {
    fetchResources();
  }, [fetchResources, libraryVersion]);

  // A repository page sends people here after removing something: confirm it, then clean the URL.
  useEffect(() => {
    if (!removedName) return;
    setPageNotice({ tone: 'verified', title: `Removed ${removedName} from your library.` });
    router.replace('/resources');
  }, [removedName, router]);

  // Poll everything that is still indexing.
  const indexingIds = [
    ...resources.filter((r) => !isTerminalStatus(r.status)).map((r) => r.id),
    ...watchIds
  ];
  const { statuses } = useIndexingStatus(indexingIds, {
    onTerminal: (data) => {
      setWatchIds((prev) => prev.filter((id) => id !== data.id));
      notifyLibraryChanged();
    }
  });

  const liveStatus = (r: LibraryItem) => {
    const live = statuses[r.id];
    return live ? live : null;
  };

  const openDetail = useCallback(async (id: string) => {
    setDetailId(id);
    setDetail(null);
    setDetailStatus(null);
    setDetailState('loading');
    try {
      const res = await fetch(`/api/resources/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (res.status === 404) {
        setDetailState('notfound');
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setDetail(data);
      setDetailState('idle');
      if (isFailedStatus(data.status)) {
        // The status endpoint explains failures in plain language.
        fetch(`/api/resources/${encodeURIComponent(id)}/status`)
          .then((r) => (r.ok ? r.json() : null))
          .then((s) => s && setDetailStatus(s))
          .catch(() => {});
      }
    } catch (err) {
      console.error('Error fetching resource details:', err);
      setDetailState('error');
    }
  }, []);

  const closeDetail = useCallback(() => {
    setDetailId(null);
    setDetail(null);
    setDetailState('idle');
    if (requestedResourceId) router.replace('/resources');
  }, [requestedResourceId, router]);

  // Deep link: /resources?id=<resourceId> opens that resource's detail panel
  useEffect(() => {
    if (requestedResourceId) openDetail(requestedResourceId);
  }, [requestedResourceId, openDetail]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setAppliedQuery(searchQuery);
  };

  const setNotice = (id: string, notice: ActionNotice | null) =>
    setNotices((prev) => {
      const next = { ...prev };
      if (notice) next[id] = notice;
      else delete next[id];
      return next;
    });

  const handleReindex = async (item: LibraryItem, force = false) => {
    const name = displayName(item);
    setBusyIds((prev) => ({ ...prev, [item.id]: true }));
    setNotice(item.id, null);
    const outcome = item.repositoryId
      ? await reindexRepository(item.repositoryId, force)
      : await reindexResource(item.id);
    setBusyIds((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    setNotice(item.id, noticeForReindex(outcome, name));
    if (outcome.kind === 'started' || outcome.kind === 'already_indexing') {
      setWatchIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]));
      setResources((prev) => prev.map((r) => (r.id === item.id ? { ...r, status: 'PENDING' as any } : r)));
    }
  };

  const confirmRemove = async () => {
    if (!pendingRemove) return;
    setRemoveBusy(true);
    setRemoveError(null);
    const target = pendingRemove;
    const result = await removeFromLibrary({ repositoryId: target.repositoryId, resourceId: target.id });
    setRemoveBusy(false);
    if (!result.ok) {
      setRemoveError(result.message);
      return;
    }
    setPendingRemove(null);
    if (detailId === target.id) closeDetail();
    setResources((prev) => prev.filter((r) => r.id !== target.id));
    setPageNotice({ tone: 'verified', title: `Removed ${displayName(target)} from your library.` });
    notifyLibraryChanged();
  };

  const askAbout = (item: Parameters<typeof displayName>[0]) => {
    router.push(askHref(repoSeedPrompt(displayName(item))));
  };

  // Only show source types the library actually contains (GitHub is always shown)
  const filterTabs = [
    { id: 'all', label: 'All', count: stats.totalResources },
    { id: 'github_repository', label: 'GitHub', count: stats.totalRepositories },
    { id: 'web_page', label: 'Web & docs', count: stats.totalWebSources },
    { id: 'youtube_video', label: 'Videos', count: stats.totalVideos },
    { id: 'pdf', label: 'PDFs & papers', count: stats.totalDocuments },
    { id: 'linkedin_post', label: 'LinkedIn', count: resources.filter(r => r.resourceType === 'linkedin_post').length }
  ].filter((tab) => tab.id === 'all' || tab.id === 'github_repository' || tab.count > 0 || tab.id === activeFilter);

  const ledger = [
    { label: 'Repositories', value: stats.totalRepositories, primary: true },
    { label: 'All sources', value: stats.totalResources, hide: stats.totalResources === stats.totalRepositories },
    { label: 'Web & docs', value: stats.totalWebSources, hide: !stats.totalWebSources },
    { label: 'Videos', value: stats.totalVideos, hide: !stats.totalVideos },
    { label: 'PDFs & papers', value: stats.totalDocuments, hide: !stats.totalDocuments },
    { label: 'Domains', value: stats.totalDomains, hide: (stats.totalDomains || 0) <= 1 }
  ].filter((cell) => !cell.hide);

  const isFiltering = Boolean(appliedQuery.trim()) || activeFilter !== 'all';

  return (
    <div className="app-shell">
      <Navbar />

      <main className="page">
        <header className="page-head">
          <div className="page-head-title">
            <span className="eyebrow">Library</span>
            <h1 className="h-page">Everything Open Eye has read.</h1>
          </div>
          <div className="page-head-aside">
            <p className="lede">
              Mostly GitHub repositories, plus any docs, videos or papers you&apos;ve added.
              Open one to see what was extracted and the evidence behind it.
            </p>
            <button type="button" className="btn btn-primary" onClick={openAddRepository}>
              <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
              <span>Add repository</span>
            </button>
          </div>
        </header>

        {hasLoaded && (
          <div className="ledger" aria-label="Collection counts">
            {ledger.map((cell) => (
              <div key={cell.label} className={`ledger-cell${cell.primary ? ' is-primary' : ''}`}>
                <span className="label">{cell.label}</span>
                <div className="ledger-value">{cell.value ?? 0}</div>
              </div>
            ))}
          </div>
        )}

        {pageNotice && (
          <ActionCallout
            notice={pageNotice}
            onDismiss={() => setPageNotice(null)}
            style={{ marginBottom: 'var(--s-5)' }}
          />
        )}

        {/* Search & filters */}
        <div className="stack gap-4" style={{ marginBottom: 'var(--s-6)' }}>
          <form onSubmit={handleSearch} className="search-bar" role="search">
            <div className="field-wrap">
              <Search size={17} className="field-icon" aria-hidden="true" />
              <label htmlFor="library-search" className="sr-only">Search the library</label>
              <input
                id="library-search"
                type="search"
                className="field has-icon"
                placeholder="Search by name, problem, technique or domain"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value) setAppliedQuery('');
                }}
              />
            </div>
            <button type="submit" className="btn btn-secondary">Search</button>
          </form>

          <div className="pill-row" role="group" aria-label="Filter by source type">
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="pill"
                aria-pressed={activeFilter === tab.id}
                onClick={() => setActiveFilter(tab.id)}
              >
                <span>{tab.label}</span>
                {hasLoaded && <span className="num">{tab.count}</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        {loadError && !isLoading ? (
          <LoadError what="the library" onRetry={fetchResources} />
        ) : !hasLoaded || (isLoading && resources.length === 0) ? (
          <div className="loading-line" role="status">
            <span className="dot dot-pulse" aria-hidden="true" />
            Loading the library&hellip;
          </div>
        ) : resources.length === 0 ? (
          <div className="empty">
            <span className="eyebrow plain">{isFiltering ? 'No matches' : 'Nothing here yet'}</span>
            <h3>{isFiltering ? 'No matches.' : 'Start with a repository.'}</h3>
            <p>
              {isFiltering
                ? 'Nothing in the library matches this search or filter. Try a broader term, or switch back to All.'
                : 'Paste a public GitHub URL and Open Eye will read the code, pull out what it can do, and keep the evidence. Docs, videos and PDFs work too.'}
            </p>
            {!isFiltering && (
              <button type="button" className="btn btn-primary" onClick={openAddRepository}>
                <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
                <span>Add repository</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid-cards" aria-busy={isLoading}>
            {resources.map((res) => {
              const live = liveStatus(res);
              const status = live?.status || res.status;
              const indexing = !isTerminalStatus(status);
              const failed = isFailedStatus(status);
              const failure = live?.errorDetails?.reason || live?.errorMessage || res.errorMessage;
              const usefulTags = (res.usefulFor && res.usefulFor.length > 0)
                ? res.usefulFor
                : (res.domainTags || []);
              const summary = res.valueProposition || res.description || '';
              const name = displayName(res);
              const titleId = `res-${res.id}-title`;
              const notice = notices[res.id];
              const busy = Boolean(busyIds[res.id]);
              const isRepo = res.resourceType === 'github_repository';

              return (
                <article key={res.id} className="card res-card card-linkable" aria-labelledby={titleId}>
                  <div className="stack gap-3">
                    <div className="res-card-top">
                      <span className="res-type">
                        <SourceIcon type={res.resourceType} size={13} />
                        <span>{getSourceLabel(res.resourceType)}</span>
                        {res.sourceDomain && !isRepo && <span className="domain truncate">/ {res.sourceDomain}</span>}
                      </span>
                      <StatusBadge status={status} />
                    </div>

                    <h3 id={titleId} className="res-title">
                      <button type="button" className="stretched-link" onClick={() => openDetail(res.id)}>
                        {res.title}
                      </button>
                    </h3>

                    {indexing && (
                      <IndexingProgress
                        status={status}
                        step={live?.jobStep}
                        resourceType={res.resourceType}
                        compact
                      />
                    )}

                    {failed && (
                      <div className="callout callout-danger" style={{ padding: 'var(--s-2) var(--s-3)' }}>
                        <AlertCircle size={14} aria-hidden="true" />
                        <div className="grow stack gap-2">
                          <div className="clamp-2">
                            {live?.errorDetails?.title ? <strong>{live.errorDetails.title}. </strong> : null}
                            {failure || 'Indexing failed.'}
                          </div>
                          <div>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleReindex(res)}
                              disabled={busy}
                            >
                              <RotateCw size={12} aria-hidden="true" />
                              <span>Retry</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {summary && <p className="small muted clamp-2">{summary}</p>}

                    {/* Only what analysis actually extracted — no filler */}
                    {res.problemsSolved && res.problemsSolved.length > 0 && (
                      <div className="res-fact">
                        <span className="label">Solves</span>
                        <p>{res.problemsSolved[0]}</p>
                      </div>
                    )}

                    {res.practicalUses && res.practicalUses.length > 0 && (
                      <div className="res-fact">
                        <span className="label">Use it for</span>
                        <p>{res.practicalUses[0]}</p>
                      </div>
                    )}

                    {usefulTags.length > 0 && (
                      <div className="row wrap gap-1">
                        {usefulTags.slice(0, 4).map((tag, i) => (
                          <span key={i} className="tag">{humanizeTag(tag)}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="stack gap-3">
                    {notice && (
                      <ActionCallout
                        notice={notice}
                        busy={busy}
                        onForce={() => handleReindex(res, true)}
                        onDismiss={() => setNotice(res.id, null)}
                      />
                    )}

                    <div className="card-foot">
                      <div className="row wrap gap-3">
                        {res.repositoryId && (
                          <Link href={`/repositories/${res.repositoryId}`} className="link-action">
                            <FolderGit2 size={13} aria-hidden="true" />
                            <span>Open repository</span>
                          </Link>
                        )}
                        <button type="button" className="link-action" onClick={() => askAbout(res)}>
                          <MessageSquare size={13} aria-hidden="true" />
                          <span>Ask about it</span>
                        </button>
                        <a href={res.sourceUrl} target="_blank" rel="noopener noreferrer" className="link-quiet">
                          <span>{isRepo ? 'GitHub' : 'Source'}</span>
                          <ArrowUpRight size={13} aria-hidden="true" />
                          <span className="sr-only">(opens in a new tab)</span>
                        </a>
                      </div>

                      <div className="icon-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon"
                          title="Re-index"
                          aria-label={`Re-index ${name}`}
                          onClick={() => handleReindex(res)}
                          disabled={busy || indexing}
                        >
                          <RefreshCw size={14} className={busy ? 'animate-spin' : undefined} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon danger"
                          title="Remove from library"
                          aria-label={`Remove ${name} from library`}
                          onClick={() => {
                            setRemoveError(null);
                            setPendingRemove(res);
                          }}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <DetailSheet
        open={Boolean(detailId)}
        state={detailState}
        resource={detail}
        failure={detailStatus}
        repositoryId={
          detail?.repositoryId ||
          resources.find((r) => r.id === detailId)?.repositoryId ||
          null
        }
        onClose={closeDetail}
        onRetry={() => detailId && openDetail(detailId)}
        onAsk={() => detail && askAbout(detail)}
      />

      <ConfirmDialog
        open={Boolean(pendingRemove)}
        title={pendingRemove ? `Remove ${displayName(pendingRemove)} from library?` : ''}
        confirmLabel="Remove from library"
        tone="danger"
        busy={removeBusy}
        error={removeError}
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      >
        Open Eye will forget its capabilities, evidence and search index. The
        {pendingRemove?.resourceType === 'github_repository' ? ' repository on GitHub' : ' original source'} is not touched,
        and you can add it again later.
      </ConfirmDialog>
    </div>
  );
}

function DetailSheet({
  open,
  state,
  resource,
  failure,
  repositoryId,
  onClose,
  onRetry,
  onAsk
}: {
  open: boolean;
  state: 'idle' | 'loading' | 'error' | 'notfound';
  resource: any | null;
  failure: ResourceStatusData | null;
  repositoryId: string | null;
  onClose: () => void;
  onRetry: () => void;
  onAsk: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useDialog(ref, onClose, open);
  if (!open) return null;

  const failed = resource && isFailedStatus(resource.status);

  return (
    <div
      className="overlay overlay-right"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <aside
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="resource-detail-title"
        aria-busy={state === 'loading'}
      >
        <div className="row between gap-3" style={{ marginBottom: 'var(--s-5)' }}>
          {resource ? (
            <span className="res-type">
              <SourceIcon type={resource.resourceType} size={13} />
              <span>{getSourceLabel(resource.resourceType)}</span>
              {resource.sourceDomain && <span className="domain truncate">/ {resource.sourceDomain}</span>}
            </span>
          ) : (
            <span className="res-type">Details</span>
          )}
          <button type="button" className="btn btn-secondary btn-icon" aria-label="Close details" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {state === 'loading' && (
          <>
            <h2 id="resource-detail-title" className="sr-only">Loading details</h2>
            <div className="loading-line" role="status">
              <span className="dot dot-pulse" aria-hidden="true" />
              Loading details&hellip;
            </div>
          </>
        )}

        {state === 'notfound' && (
          <div className="empty">
            <h2 id="resource-detail-title" className="h-section">Not in the library.</h2>
            <p>It may have been removed, or the link is out of date.</p>
          </div>
        )}

        {state === 'error' && (
          <>
            <h2 id="resource-detail-title" className="sr-only">Details unavailable</h2>
            <LoadError what="these details" onRetry={onRetry} />
          </>
        )}

        {state === 'idle' && resource && (
          <>
            <h2 id="resource-detail-title" className="display" style={{ fontSize: 'var(--fs-2xl)', marginBottom: 'var(--s-3)', overflowWrap: 'anywhere' }}>
              {resource.title}
            </h2>

            <div style={{ marginBottom: 'var(--s-4)' }}>
              <StatusBadge status={resource.status} />
            </div>

            {failed && (
              <div className="callout callout-danger" role="alert" style={{ marginBottom: 'var(--s-5)' }}>
                <AlertCircle size={16} aria-hidden="true" />
                <div className="stack gap-1">
                  <div className="callout-title">{failure?.errorDetails?.title || 'Indexing failed'}</div>
                  <div>{failure?.errorDetails?.reason || resource.errorMessage || 'Open Eye could not read this source.'}</div>
                  {failure?.errorDetails?.action && <div><strong>Try:</strong> {failure.errorDetails.action}</div>}
                </div>
              </div>
            )}

            {(resource.description || resource.valueProposition) && (
              <p className="muted" style={{ fontSize: 'var(--fs-md)', lineHeight: 1.55, marginBottom: 'var(--s-5)', maxWidth: '60ch' }}>
                {resource.description || resource.valueProposition}
              </p>
            )}

            <div className="row wrap gap-3" style={{ marginBottom: 'var(--s-7)' }}>
              <button type="button" className="btn btn-primary" onClick={onAsk}>
                <MessageSquare size={16} aria-hidden="true" />
                <span>Ask about it</span>
              </button>
              {repositoryId && (
                <Link href={`/repositories/${repositoryId}`} className="btn btn-secondary">
                  <FolderGit2 size={16} aria-hidden="true" />
                  <span>Open repository</span>
                </Link>
              )}
              <a href={resource.sourceUrl} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
                <span>{resource.resourceType === 'github_repository' ? 'View on GitHub' : 'Open source'}</span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>

            {resource.problemsSolved?.length > 0 && (
              <section style={{ marginBottom: 'var(--s-7)' }}>
                <div className="rule-head">
                  <h3 className="label">Problems solved</h3>
                  <span className="count">{resource.problemsSolved.length}</span>
                </div>
                <ul className="def-list" style={{ listStyle: 'none', padding: 0 }}>
                  {resource.problemsSolved.map((p: string, i: number) => (
                    <li key={i} className="def-item" style={{ color: 'var(--ink)' }}>{p}</li>
                  ))}
                </ul>
              </section>
            )}

            {resource.practicalUses?.length > 0 && (
              <section style={{ marginBottom: 'var(--s-7)' }}>
                <div className="rule-head">
                  <h3 className="label">Practical uses</h3>
                  <span className="count">{resource.practicalUses.length}</span>
                </div>
                <ul className="def-list" style={{ listStyle: 'none', padding: 0 }}>
                  {resource.practicalUses.map((u: string, i: number) => (
                    <li key={i} className="def-item" style={{ color: 'var(--ink)' }}>{u}</li>
                  ))}
                </ul>
              </section>
            )}

            {resource.capabilities?.length > 0 && (
              <section style={{ marginBottom: 'var(--s-7)' }}>
                <div className="rule-head">
                  <h3 className="label">Capabilities</h3>
                  <span className="count">{resource.capabilities.length}</span>
                </div>
                <div className="def-list">
                  {resource.capabilities.map((cap: any) => (
                    <div key={cap.id} className="def-item">
                      <strong style={{ display: 'block', marginBottom: 2 }}>{cap.name}</strong>
                      {cap.description}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {resource.evidence?.length > 0 && (
              <section>
                <div className="rule-head">
                  <h3 className="label">Evidence</h3>
                  <span className="count">
                    {resource.evidence.length > 5 ? `5 of ${resource.evidence.length}` : resource.evidence.length}
                  </span>
                </div>
                <div className="stack gap-4">
                  {resource.evidence.slice(0, 5).map((ev: any) => (
                    <div key={ev.id} className="stack gap-2">
                      <div className="row between gap-3">
                        <span className="mono xsmall truncate" style={{ color: 'var(--ink)' }} title={ev.filePath || undefined}>
                          {ev.filePath ? `${ev.filePath}${ev.startLine ? `:${ev.startLine}` : ''}` : 'Source excerpt'}
                        </span>
                        {ev.isVerified ? (
                          <span className="badge badge-verified">
                            <CheckCircle2 size={12} aria-hidden="true" />
                            Verified
                          </span>
                        ) : (
                          <span className="badge badge-inferred">
                            <AlertTriangle size={12} aria-hidden="true" />
                            Inferred
                          </span>
                        )}
                      </div>
                      {ev.quoteSnippet && <div className="quote-well">{ev.quoteSnippet}</div>}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

export default function ResourcesPage() {
  return (
    <React.Suspense fallback={null}>
      <ResourcesPageContent />
    </React.Suspense>
  );
}
