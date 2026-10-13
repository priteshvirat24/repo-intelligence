'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Search, ArrowUpRight, Plus } from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { useLibrary } from '@/components/LibraryProvider';
import { LoadError } from '@/components/IndexingState';
import { slugify } from '@/lib/ui/github';

interface CapabilityItem {
  name: string;
  category: string;
  description: string;
  repoCount: number;
  repositories: Array<{ id: string; owner: string; name: string }>;
}

export default function CapabilityExplorerPage() {
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const { openAddRepository, libraryVersion } = useLibrary();

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/capabilities', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setCapabilities(data.capabilities || []);
      setLoadError(false);
    } catch (err) {
      console.error('Error fetching capabilities:', err);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, libraryVersion]);

  const categories = ['ALL', ...Array.from(new Set(capabilities.map(c => c.category).filter(Boolean)))];

  const filtered = capabilities.filter(c => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.category?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'ALL' || c.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const isFiltering = searchTerm.trim() !== '' || selectedCategory !== 'ALL';

  return (
    <div className="app-shell">
      <Navbar />

      <main className="page">
        <header className="page-head">
          <div className="page-head-title">
            <span className="eyebrow">Capabilities</span>
            <h1 className="h-page">What the indexed code can do.</h1>
          </div>
          <div className="page-head-aside">
            <p className="lede">
              Capabilities Open Eye found while reading each repository. Categories come from the
              code itself, not a fixed list. Each one links to the repos that implement it.
            </p>
            {!isLoading && !loadError && (
              <span className="mono small muted">
                <span className="num" style={{ color: 'var(--ink)', fontWeight: 600 }}>{capabilities.length}</span>
                {' '}{capabilities.length === 1 ? 'capability' : 'capabilities'}
                {categories.length > 1 && (
                  <> across <span className="num" style={{ color: 'var(--ink)', fontWeight: 600 }}>{categories.length - 1}</span> {categories.length - 1 === 1 ? 'category' : 'categories'}</>
                )}
              </span>
            )}
          </div>
        </header>

        {/* Search & category filter */}
        <div className="stack gap-4" style={{ marginBottom: 'var(--s-6)' }}>
          <div className="field-wrap">
            <Search size={17} className="field-icon" aria-hidden="true" />
            <label htmlFor="capability-search" className="sr-only">Search capabilities</label>
            <input
              id="capability-search"
              type="text"
              className="field has-icon"
              placeholder="Search capabilities, e.g. crawling, kalman filter, 3d globe"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>

          {categories.length > 1 && (
            <div className="pill-row" role="group" aria-label="Filter by category">
              {categories.map(cat => (
                <button
                  key={cat}
                  type="button"
                  className="pill"
                  aria-pressed={selectedCategory === cat}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat === 'ALL' ? 'All' : cat}
                </button>
              ))}
            </div>
          )}
        </div>

        {isLoading && capabilities.length === 0 ? (
          <div className="loading-line" role="status">
            <span className="dot dot-pulse" aria-hidden="true" />
            Loading capabilities&hellip;
          </div>
        ) : loadError ? (
          <LoadError what="capabilities" onRetry={load} />
        ) : filtered.length === 0 ? (
          <div className="empty">
            <span className="eyebrow plain">{isFiltering ? 'No matches' : 'Nothing yet'}</span>
            <h3>{isFiltering ? 'Nothing matches that.' : 'No capabilities yet.'}</h3>
            <p>
              {isFiltering
                ? 'Try a broader search term or another category.'
                : 'Index a GitHub repository and the capabilities Open Eye finds in its code will show up here.'}
            </p>
            {!isFiltering && (
              <button type="button" className="btn btn-primary" onClick={openAddRepository}>
                <Plus size={16} strokeWidth={2.5} aria-hidden="true" />
                <span>Add repository</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid-cards">
            {filtered.map((cap, i) => (
              <article key={i} className="card res-card">
                <div className="stack gap-3">
                  <div className="res-card-top" style={{ alignItems: 'flex-start' }}>
                    {cap.category ? <span className="tag">{cap.category}</span> : <span />}
                    <span className="badge badge-outline">
                      <span className="num">{cap.repoCount}</span> {cap.repoCount === 1 ? 'repo' : 'repos'}
                    </span>
                  </div>
                  <h3 className="res-title">{cap.name}</h3>
                  {cap.description && <p className="small muted">{cap.description}</p>}
                </div>

                {cap.repositories && cap.repositories.length > 0 && (
                  <div className="card-foot" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                    <span className="label">Implemented in</span>
                    <div className="row wrap gap-1">
                      {cap.repositories.map(repo => (
                        <Link
                          key={repo.id}
                          href={`/repositories/${repo.id}#cap-${slugify(cap.name)}`}
                          className="tag tag-mono tag-ink"
                          aria-label={`${cap.name} in ${repo.owner}/${repo.name}`}
                        >
                          <span className="truncate">{repo.owner}/{repo.name}</span>
                          <ArrowUpRight size={11} aria-hidden="true" />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </main>

    </div>
  );
}
