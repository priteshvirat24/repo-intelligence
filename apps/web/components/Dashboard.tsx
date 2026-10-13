'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Search, Star, Code } from 'lucide-react';
import { StatusBadge } from '@/components/Primitives';

interface DashboardProps {
  repositories: any[];
  isLoading: boolean;
  onRefresh: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ repositories, isLoading, onRefresh }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = repositories.filter(r => {
    const full = `${r.owner}/${r.name} ${r.description || ''}`.toLowerCase();
    return full.includes(searchTerm.toLowerCase());
  });

  return (
    <div className="stack gap-6">
      <div className="field-wrap">
        <Search size={17} className="field-icon" aria-hidden="true" />
        <label htmlFor="dashboard-search" className="sr-only">Search repositories</label>
        <input
          id="dashboard-search"
          type="text"
          className="field has-icon"
          placeholder="Search repositories by name or description"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      {isLoading ? (
        <div className="loading-line">
          <span className="dot dot-pulse" aria-hidden="true" />
          Loading repositories&hellip;
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <h3>{searchTerm ? 'No matches.' : 'No repositories yet.'}</h3>
          <p>
            {searchTerm
              ? 'No indexed repository matches that search.'
              : 'Add a GitHub repository and Open Eye will read it, list what it can do, and keep the evidence.'}
          </p>
        </div>
      ) : (
        <div className="grid-cards">
          {filtered.map((repo) => (
            <Link key={repo.id} href={`/repositories/${repo.id}`} className="card card-interactive res-card">
              <div className="stack gap-3">
                <div className="res-card-top" style={{ alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0 }}>
                    <span className="mono xsmall muted">{repo.owner}</span>
                    <h3 className="res-title">{repo.name}</h3>
                  </div>
                  <StatusBadge status={repo.status} />
                </div>

                <p className="small muted clamp-2">{repo.description || 'No description on GitHub.'}</p>

                {repo.capabilitySlugs && repo.capabilitySlugs.length > 0 && (
                  <div className="row wrap gap-1">
                    {repo.capabilitySlugs.slice(0, 3).map((slug: string) => (
                      <span key={slug} className="tag tag-mono">{slug}</span>
                    ))}
                    {repo.capabilitiesCount > 3 && (
                      <span className="xsmall muted">+{repo.capabilitiesCount - 3} more</span>
                    )}
                  </div>
                )}
              </div>

              <div className="card-foot">
                <div className="meta-row">
                  {repo.primaryLanguage && (
                    <span><Code size={13} aria-hidden="true" />{repo.primaryLanguage}</span>
                  )}
                  <span><Star size={13} aria-hidden="true" />{repo.stars?.toLocaleString() || 0}</span>
                </div>
                <span className="mono xsmall faint">
                  {new Date(repo.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
