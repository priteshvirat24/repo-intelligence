'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Search, Star, Layers, Code, GitBranch, ArrowUpRight, CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { Repository } from '@repo/shared';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Search & Filter Bar */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{
          position: 'relative',
          flex: 1
        }}>
          <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
          <input
            type="text"
            placeholder="Search indexed repositories, architectures, or capabilities..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              width: '100%',
              padding: '12px 14px 12px 42px',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              fontSize: '0.9rem',
              outline: 'none',
              backdropFilter: 'blur(8px)'
            }}
          />
        </div>
      </div>

      {/* Repositories Grid */}
      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>
          Loading repository intelligence...
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass-panel" style={{ textAlign: 'center', padding: '60px 24px' }}>
          <Layers size={40} color="var(--accent-indigo)" style={{ margin: '0 auto 16px' }} />
          <h3 style={{ fontSize: '1.15rem', fontWeight: 600, marginBottom: 8 }}>No Repositories Found</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: 460, margin: '0 auto 20px' }}>
            {searchTerm ? 'No indexed repositories match your search query.' : 'Add your first GitHub repository to extract capabilities and enable cross-repo reasoning.'}
          </p>
        </div>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
          gap: 20
        }}>
          {filtered.map((repo) => (
            <Link
              key={repo.id}
              href={`/repositories/${repo.id}`}
              className="glass-panel"
              style={{
                padding: 22,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                transition: 'transform 0.2s, border-color 0.2s',
                textDecoration: 'none'
              }}
            >
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div>
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{repo.owner}</span>
                    <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {repo.name}
                      <ArrowUpRight size={14} color="var(--accent-cyan)" />
                    </h3>
                  </div>

                  <span className={`badge-${repo.status.toLowerCase()}`} style={{
                    fontSize: '0.725rem',
                    fontWeight: 600,
                    padding: '3px 8px',
                    borderRadius: 6,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4
                  }}>
                    {repo.status === 'READY' && <CheckCircle2 size={12} />}
                    {repo.status === 'INDEXING' && <Clock size={12} />}
                    {repo.status === 'FAILED' && <AlertTriangle size={12} />}
                    {repo.status}
                  </span>
                </div>

                <p style={{
                  fontSize: '0.85rem',
                  color: 'var(--text-secondary)',
                  marginBottom: 16,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden'
                }}>
                  {repo.description || 'No description provided.'}
                </p>

                {/* Capability Pills */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                  {repo.capabilitySlugs && repo.capabilitySlugs.slice(0, 3).map((slug: string) => (
                    <span
                      key={slug}
                      style={{
                        fontSize: '0.725rem',
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: 'rgba(99, 102, 241, 0.12)',
                        color: '#a5b4fc',
                        border: '1px solid rgba(99, 102, 241, 0.25)',
                        fontFamily: 'var(--font-mono)'
                      }}
                    >
                      {slug}
                    </span>
                  ))}
                  {repo.capabilitiesCount > 3 && (
                    <span style={{ fontSize: '0.725rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
                      +{repo.capabilitiesCount - 3} more
                    </span>
                  )}
                </div>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingTop: 12,
                borderTop: '1px solid var(--border-subtle)',
                fontSize: '0.775rem',
                color: 'var(--text-muted)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  {repo.primaryLanguage && (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Code size={13} color="var(--accent-cyan)" />
                      {repo.primaryLanguage}
                    </span>
                  )}
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Star size={13} color="var(--accent-amber)" />
                    {repo.stars?.toLocaleString() || 0}
                  </span>
                </div>

                <span>
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
