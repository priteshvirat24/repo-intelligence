'use client';

import React, { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { AddResourceModal } from '@/components/AddResourceModal';
import { SourceIcon, StatusBadge } from '@/components/Primitives';
import {
  Search,
  ArrowUpRight,
  MessageSquare,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Plus,
  X
} from 'lucide-react';
import { UniversalResource, ResourceType } from '@repo/shared';

// "autonomous-agent-automation" -> "Autonomous agent automation" (slug-style tags from analysis)
function humanizeTag(tag: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(tag)) return tag;
  const words = tag.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function ResourcesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedResourceId = searchParams.get('id');
  const [resources, setResources] = useState<UniversalResource[]>([]);
  const [stats, setStats] = useState<any>({
    totalResources: 0,
    totalRepositories: 0,
    totalWebSources: 0,
    totalVideos: 0,
    totalDocuments: 0,
    totalDomains: 0
  });
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedResource, setSelectedResource] = useState<any | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchResources = async () => {
    setIsLoading(true);
    try {
      let url = `/api/resources?`;
      if (searchQuery.trim()) url += `search=${encodeURIComponent(searchQuery.trim())}&`;
      if (activeFilter !== 'all') url += `type=${activeFilter}&`;

      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setResources(data.items || []);
        if (data.stats) setStats(data.stats);
      }
    } catch (err) {
      console.error('Error fetching resources:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchResources();
  }, [activeFilter]);

  // Deep link: /resources?id=<resourceId> opens that resource's detail panel
  useEffect(() => {
    if (requestedResourceId) handleOpenDetail(requestedResourceId);
  }, [requestedResourceId]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchResources();
  };

  const handleOpenDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/resources/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedResource(data);
      }
    } catch (err) {
      console.error('Error fetching resource details:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleReindex = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Reindex this resource?\nOpen Eye will fetch the latest accessible content.')) return;
    try {
      await fetch(`/api/resources/${id}/reindex`, { method: 'POST' });
      fetchResources();
    } catch (err) {
      console.error('Error reindexing:', err);
    }
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Are you sure you want to remove this resource from Open Eye?')) return;
    try {
      await fetch(`/api/resources/${id}`, { method: 'DELETE' });
      if (selectedResource?.id === id) setSelectedResource(null);
      fetchResources();
    } catch (err) {
      console.error('Error deleting resource:', err);
    }
  };

  const handleAskAbout = (resource: UniversalResource, e: React.MouseEvent) => {
    e.stopPropagation();
    const prompt = `Tell me about ${resource.title} and how we can use it with our stack.`;
    router.push(`/?prompt=${encodeURIComponent(prompt)}`);
  };

  const getSourceLabel = (type: ResourceType) => {
    switch (type) {
      case 'github_repository': return 'GitHub repo';
      case 'youtube_video': return 'Video';
      case 'linkedin_post': return 'LinkedIn';
      case 'pdf': return 'PDF';
      case 'research_paper': return 'Paper';
      case 'documentation_site': return 'Docs';
      case 'article': return 'Article';
      default: return 'Web page';
    }
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

  return (
    <div className="app-shell">
      <Navbar
        onOpenAddModal={() => setIsAddModalOpen(true)}
        resourceCount={stats.totalResources}
      />

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
            <button type="button" className="btn btn-primary" onClick={() => setIsAddModalOpen(true)}>
              <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
              <span>Add repository</span>
            </button>
          </div>
        </header>

        {/* Collection counts, as reported by the API */}
        <div className="ledger" aria-label="Collection counts">
          {ledger.map((cell) => (
            <div key={cell.label} className={`ledger-cell${cell.primary ? ' is-primary' : ''}`}>
              <span className="label">{cell.label}</span>
              <div className="ledger-value">{cell.value ?? 0}</div>
            </div>
          ))}
        </div>

        {/* Search & filters */}
        <div className="stack gap-4" style={{ marginBottom: 'var(--s-6)' }}>
          <form onSubmit={handleSearch} className="search-bar" role="search">
            <div className="field-wrap">
              <Search size={17} className="field-icon" aria-hidden="true" />
              <label htmlFor="library-search" className="sr-only">Search the library</label>
              <input
                id="library-search"
                type="text"
                className="field has-icon"
                placeholder="Search by name, problem, technique or domain"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
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
                <span className="num">{tab.count}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Results */}
        {isLoading ? (
          <div className="loading-line">
            <span className="dot dot-pulse" aria-hidden="true" />
            Loading the library&hellip;
          </div>
        ) : resources.length === 0 ? (
          <div className="empty">
            <span className="eyebrow plain">Nothing here yet</span>
            <h3>{searchQuery.trim() || activeFilter !== 'all' ? 'No matches.' : 'Start with a repository.'}</h3>
            <p>
              {searchQuery.trim() || activeFilter !== 'all'
                ? 'Nothing in the library matches this search or filter. Try a broader term, or switch back to All.'
                : 'Paste a public GitHub URL and Open Eye will read the code, pull out what it can do, and keep the evidence. Docs, videos and PDFs work too.'}
            </p>
            <button type="button" className="btn btn-primary" onClick={() => setIsAddModalOpen(true)}>
              <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
              <span>Add repository</span>
            </button>
          </div>
        ) : (
          <div className="grid-cards">
            {resources.map((res) => {
              const usefulTags = (res.usefulFor && res.usefulFor.length > 0)
                ? res.usefulFor
                : (res.domainTags || []);
              const summary = res.valueProposition || res.description || '';

              return (
                <div
                  key={res.id}
                  className="card card-interactive res-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open details for ${res.title}`}
                  onClick={() => handleOpenDetail(res.id)}
                  onKeyDown={(e) => {
                    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      handleOpenDetail(res.id);
                    }
                  }}
                >
                  <div className="stack gap-3">
                    <div className="res-card-top">
                      <span className="res-type">
                        <SourceIcon type={res.resourceType} size={13} />
                        <span>{getSourceLabel(res.resourceType)}</span>
                        {res.sourceDomain && <span className="domain truncate">/ {res.sourceDomain}</span>}
                      </span>
                      <StatusBadge status={res.status} />
                    </div>

                    <h3 className="res-title">{res.title}</h3>

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

                  <div className="card-foot" style={{ marginTop: 'var(--s-1)' }}>
                    <div className="row gap-4">
                      <a
                        href={res.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="link-quiet"
                      >
                        <span>Source</span>
                        <ArrowUpRight size={13} aria-hidden="true" />
                      </a>

                      <button type="button" className="link-action" onClick={(e) => handleAskAbout(res, e)}>
                        <MessageSquare size={13} aria-hidden="true" />
                        <span>Ask about it</span>
                      </button>
                    </div>

                    <div className="icon-actions">
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon"
                        title="Reindex"
                        aria-label={`Reindex ${res.title}`}
                        onClick={(e) => handleReindex(res.id, e)}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-icon danger"
                        title="Remove from library"
                        aria-label={`Remove ${res.title}`}
                        onClick={(e) => handleDelete(res.id, e)}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Resource detail sheet */}
      {selectedResource && (
        <div className="overlay overlay-right">
          <aside className="sheet" role="dialog" aria-modal="true" aria-labelledby="resource-detail-title">
            <div className="row between gap-3" style={{ marginBottom: 'var(--s-5)' }}>
              <span className="res-type">
                <SourceIcon type={selectedResource.resourceType} size={13} />
                <span>{getSourceLabel(selectedResource.resourceType)}</span>
                {selectedResource.sourceDomain && <span className="domain truncate">/ {selectedResource.sourceDomain}</span>}
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-icon"
                aria-label="Close details"
                onClick={() => setSelectedResource(null)}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <h2 id="resource-detail-title" className="display" style={{ fontSize: 'var(--fs-2xl)', marginBottom: 'var(--s-3)', overflowWrap: 'anywhere' }}>
              {selectedResource.title}
            </h2>

            {(selectedResource.description || selectedResource.valueProposition) && (
              <p className="muted" style={{ fontSize: 'var(--fs-md)', lineHeight: 1.55, marginBottom: 'var(--s-5)', maxWidth: '60ch' }}>
                {selectedResource.description || selectedResource.valueProposition}
              </p>
            )}

            <div className="row wrap gap-3" style={{ marginBottom: 'var(--s-7)' }}>
              <button type="button" className="btn btn-primary" onClick={(e) => handleAskAbout(selectedResource, e)}>
                <MessageSquare size={16} aria-hidden="true" />
                <span>Ask about this</span>
              </button>
              <a href={selectedResource.sourceUrl} target="_blank" rel="noreferrer" className="btn btn-secondary">
                <span>Open source</span>
                <ArrowUpRight size={16} aria-hidden="true" />
              </a>
            </div>

            {/* Problems Solved (only what analysis actually extracted) */}
            {selectedResource.problemsSolved?.length > 0 && (
              <section style={{ marginBottom: 'var(--s-7)' }}>
                <div className="rule-head">
                  <h3 className="label">Problems Solved</h3>
                  <span className="count">{selectedResource.problemsSolved.length}</span>
                </div>
                <ul className="def-list" style={{ listStyle: 'none', padding: 0 }}>
                  {selectedResource.problemsSolved.map((p: string, i: number) => (
                    <li key={i} className="def-item" style={{ color: 'var(--ink)' }}>{p}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* Practical Uses (only what analysis actually extracted) */}
            {selectedResource.practicalUses?.length > 0 && (
              <section style={{ marginBottom: 'var(--s-7)' }}>
                <div className="rule-head">
                  <h3 className="label">Practical Uses</h3>
                  <span className="count">{selectedResource.practicalUses.length}</span>
                </div>
                <ul className="def-list" style={{ listStyle: 'none', padding: 0 }}>
                  {selectedResource.practicalUses.map((u: string, i: number) => (
                    <li key={i} className="def-item" style={{ color: 'var(--ink)' }}>{u}</li>
                  ))}
                </ul>
              </section>
            )}

            {/* Capabilities */}
            {selectedResource.capabilities?.length > 0 && (
              <section style={{ marginBottom: 'var(--s-7)' }}>
                <div className="rule-head">
                  <h3 className="label">Capabilities</h3>
                  <span className="count">{selectedResource.capabilities.length}</span>
                </div>
                <div className="def-list">
                  {selectedResource.capabilities.map((cap: any) => (
                    <div key={cap.id} className="def-item">
                      <strong style={{ display: 'block', marginBottom: 2 }}>{cap.name}</strong>
                      {cap.description}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Evidence — labelled by its real verification state */}
            {selectedResource.evidence?.length > 0 && (
              <section>
                <div className="rule-head">
                  <h3 className="label">Evidence</h3>
                  <span className="count">
                    {selectedResource.evidence.length > 5 ? `5 of ${selectedResource.evidence.length}` : selectedResource.evidence.length}
                  </span>
                </div>
                <div className="stack gap-4">
                  {selectedResource.evidence.slice(0, 5).map((ev: any) => (
                    <div key={ev.id} className="stack gap-2">
                      <div className="row between gap-3">
                        <span className="mono xsmall truncate" style={{ color: 'var(--ink)' }}>
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
          </aside>
        </div>
      )}

      <AddResourceModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onResourceAdded={() => {
          fetchResources();
        }}
      />
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
