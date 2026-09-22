'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Navbar } from '@/components/Navbar';
import { AddResourceModal } from '@/components/AddResourceModal';
import {
  Globe,
  GitBranch,
  Youtube,
  Linkedin,
  FileText,
  BookOpen,
  Search,
  ExternalLink,
  MessageSquare,
  Sparkles,
  RefreshCw,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Layers,
  ChevronRight,
  X
} from 'lucide-react';
import { UniversalResource, ResourceType } from '@repo/shared';

export default function ResourcesPage() {
  const router = useRouter();
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

  const getSourceIcon = (type: ResourceType) => {
    switch (type) {
      case 'github_repository': return <GitBranch size={16} color="var(--accent-indigo)" />;
      case 'youtube_video': return <Youtube size={16} color="#ef4444" />;
      case 'linkedin_post': return <Linkedin size={16} color="#0284c7" />;
      case 'pdf':
      case 'research_paper': return <FileText size={16} color="#f59e0b" />;
      case 'documentation_site': return <BookOpen size={16} color="#10b981" />;
      default: return <Globe size={16} color="var(--accent-cyan)" />;
    }
  };

  const getSourceLabel = (type: ResourceType) => {
    switch (type) {
      case 'github_repository': return 'GitHub Repo';
      case 'youtube_video': return 'YouTube Video';
      case 'linkedin_post': return 'LinkedIn';
      case 'pdf': return 'PDF Document';
      case 'research_paper': return 'Research Paper';
      case 'documentation_site': return 'Documentation';
      case 'article': return 'Article';
      default: return 'Web Resource';
    }
  };

  const filterTabs = [
    { id: 'all', label: 'All Resources', count: stats.totalResources },
    { id: 'github_repository', label: 'GitHub', count: stats.totalRepositories },
    { id: 'web_page', label: 'Web & Docs', count: stats.totalWebSources },
    { id: 'youtube_video', label: 'YouTube', count: stats.totalVideos },
    { id: 'pdf', label: 'PDFs & Papers', count: stats.totalDocuments },
    { id: 'linkedin_post', label: 'LinkedIn', count: resources.filter(r => r.resourceType === 'linkedin_post').length }
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar
        onOpenAddModal={() => setIsAddModalOpen(true)}
        resourceCount={stats.totalResources}
      />

      <main style={{ flex: 1, maxWidth: 1400, margin: '0 auto', padding: '32px 24px', width: '100%', boxSizing: 'border-box' }}>
        {/* Header Banner */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                  Resource Library
                </h1>
                <span style={{
                  padding: '4px 10px',
                  borderRadius: 20,
                  background: 'rgba(99, 102, 241, 0.15)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  color: 'var(--accent-cyan)'
                }}>
                  Universal Collection
                </span>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', margin: 0, maxWidth: 750 }}>
                What knowledge has Open Eye collected? Browse all indexed software repositories, video tutorials, technical articles, and research documents connected across your problem space.
              </p>
            </div>

            <button
              onClick={() => setIsAddModalOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 20px',
                borderRadius: 10,
                background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: '0.9rem',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)'
              }}
            >
              <Sparkles size={16} />
              <span>+ Add Resource</span>
            </button>
          </div>

          {/* Collection Intelligence Metrics Bar */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 16,
            marginTop: 24
          }}>
            <div className="glass-panel" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Total Resources</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: 4 }}>
                {stats.totalResources}
              </div>
            </div>
            <div className="glass-panel" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Repositories</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent-indigo)', marginTop: 4 }}>
                {stats.totalRepositories}
              </div>
            </div>
            <div className="glass-panel" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Web Sources & Docs</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--accent-cyan)', marginTop: 4 }}>
                {stats.totalWebSources}
              </div>
            </div>
            <div className="glass-panel" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Videos</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#ef4444', marginTop: 4 }}>
                {stats.totalVideos}
              </div>
            </div>
            <div className="glass-panel" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Documents & Papers</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#f59e0b', marginTop: 4 }}>
                {stats.totalDocuments}
              </div>
            </div>
            <div className="glass-panel" style={{ padding: '16px 20px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600 }}>Domains Indexed</div>
              <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#10b981', marginTop: 4 }}>
                {stats.totalDomains}
              </div>
            </div>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 28 }}>
          <form onSubmit={handleSearch} style={{ display: 'flex', gap: 12 }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={18} style={{ position: 'absolute', left: 16, top: 14, color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search resources by keyword, problem solved, technique, domain..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 16px 12px 46px',
                  borderRadius: 10,
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.95rem',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <button
              type="submit"
              style={{
                padding: '0 24px',
                borderRadius: 10,
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Search
            </button>
          </form>

          {/* Filter Tabs */}
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
            {filterTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveFilter(tab.id)}
                style={{
                  padding: '8px 16px',
                  borderRadius: 8,
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  border: activeFilter === tab.id
                    ? '1px solid rgba(99, 102, 241, 0.5)'
                    : '1px solid transparent',
                  background: activeFilter === tab.id
                    ? 'rgba(99, 102, 241, 0.2)'
                    : 'rgba(15, 23, 42, 0.5)',
                  color: activeFilter === tab.id
                    ? 'var(--text-primary)'
                    : 'var(--text-secondary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s'
                }}
              >
                <span>{tab.label}</span>
                <span style={{
                  padding: '1px 6px',
                  borderRadius: 12,
                  background: 'rgba(255, 255, 255, 0.08)',
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)'
                }}>
                  {tab.count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Resources Grid */}
        {isLoading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading resources...
          </div>
        ) : resources.length === 0 ? (
          <div className="glass-panel" style={{ padding: 60, textAlign: 'center' }}>
            <Globe size={40} color="var(--text-muted)" style={{ margin: '0 auto 16px' }} />
            <h3 style={{ fontSize: '1.2rem', fontWeight: 700, margin: '0 0 8px' }}>No Resources Found</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: 450, margin: '0 auto 20px' }}>
              Add a GitHub repository, YouTube video, technical article, or PDF document to start building your universal knowledge base.
            </p>
            <button
              onClick={() => setIsAddModalOpen(true)}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                color: '#ffffff',
                fontWeight: 600,
                border: 'none',
                cursor: 'pointer'
              }}
            >
              Add First Resource
            </button>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
            gap: 20
          }}>
            {resources.map((res) => {
              const problems = (res.problemsSolved && res.problemsSolved.length > 0)
                ? res.problemsSolved
                : ['General technical capabilities and domain knowledge'];

              const uses = (res.practicalUses && res.practicalUses.length > 0)
                ? res.practicalUses
                : ['Integration and technical reference in architecture'];

              const usefulTags = (res.usefulFor && res.usefulFor.length > 0)
                ? res.usefulFor
                : (res.domainTags || []);

              return (
                <div
                  key={res.id}
                  className="glass-panel"
                  onClick={() => handleOpenDetail(res.id)}
                  style={{
                    padding: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    transition: 'transform 0.15s, border-color 0.15s',
                    position: 'relative'
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'rgba(99, 102, 241, 0.4)')}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                >
                  {/* Top Bar: Source Type & Status */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid var(--border-subtle)',
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        color: 'var(--text-secondary)'
                      }}>
                        {getSourceIcon(res.resourceType)}
                        <span>{getSourceLabel(res.resourceType)}</span>
                        {res.sourceDomain && (
                          <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>• {res.sourceDomain}</span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          background: res.status === 'READY'
                            ? 'rgba(16, 185, 129, 0.15)'
                            : res.status === 'BLOCKED'
                            ? 'rgba(239, 68, 68, 0.15)'
                            : 'rgba(245, 158, 11, 0.15)',
                          color: res.status === 'READY'
                            ? '#10b981'
                            : res.status === 'BLOCKED'
                            ? '#ef4444'
                            : '#f59e0b',
                          border: `1px solid ${res.status === 'READY' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.3)'}`
                        }}>
                          {res.status}
                        </span>
                      </div>
                    </div>

                    {/* Title */}
                    <h3 style={{
                      fontSize: '1.15rem',
                      fontWeight: 700,
                      margin: '0 0 8px 0',
                      lineHeight: 1.35,
                      color: 'var(--text-primary)'
                    }}>
                      {res.title}
                    </h3>

                    {/* Value Proposition / Summary */}
                    <p style={{
                      fontSize: '0.875rem',
                      color: 'var(--text-secondary)',
                      margin: '0 0 16px 0',
                      lineHeight: 1.45,
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden'
                    }}>
                      {res.valueProposition || res.description || 'Universal resource indexed in Open Eye.'}
                    </p>

                    {/* Problem Solved */}
                    <div style={{ marginBottom: 12 }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Problem Solved
                      </span>
                      <p style={{
                        fontSize: '0.85rem',
                        color: 'var(--text-primary)',
                        margin: '4px 0 0 0',
                        fontWeight: 500,
                        lineHeight: 1.4
                      }}>
                        {problems[0]}
                      </p>
                    </div>

                    {/* How Open Eye Uses It */}
                    <div style={{ marginBottom: 16 }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        How Open Eye Can Use It
                      </span>
                      <p style={{
                        fontSize: '0.85rem',
                        color: 'var(--accent-cyan)',
                        margin: '4px 0 0 0',
                        lineHeight: 1.4
                      }}>
                        {uses[0]}
                      </p>
                    </div>

                    {/* Tags */}
                    {usefulTags.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                        {usefulTags.slice(0, 4).map((tag, i) => (
                          <span
                            key={i}
                            style={{
                              padding: '2px 8px',
                              borderRadius: 4,
                              background: 'rgba(30, 41, 59, 0.6)',
                              fontSize: '0.75rem',
                              color: 'var(--text-secondary)'
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actions Bar */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingTop: 14,
                    borderTop: '1px solid var(--border-subtle)',
                    marginTop: 8
                  }}>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <a
                        href={res.sourceUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: '0.8rem',
                          color: 'var(--text-secondary)',
                          textDecoration: 'none'
                        }}
                      >
                        <ExternalLink size={13} />
                        <span>Source</span>
                      </a>

                      <button
                        onClick={(e) => handleAskAbout(res, e)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: '0.8rem',
                          color: 'var(--accent-indigo)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 600,
                          padding: 0
                        }}
                      >
                        <MessageSquare size={13} />
                        <span>Ask Open Eye</span>
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        title="Reindex Resource"
                        onClick={(e) => handleReindex(res.id, e)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: 4
                        }}
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        title="Delete Resource"
                        onClick={(e) => handleDelete(res.id, e)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--text-muted)',
                          cursor: 'pointer',
                          padding: 4
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Resource Detail Drawer / Modal */}
      {selectedResource && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.75)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          justifyContent: 'flex-end',
          zIndex: 60
        }}>
          <div style={{
            width: '100%',
            maxWidth: 680,
            background: 'var(--bg-secondary)',
            borderLeft: '1px solid var(--border-subtle)',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflowY: 'auto',
            padding: 32,
            boxSizing: 'border-box'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {getSourceIcon(selectedResource.resourceType)}
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-cyan)' }}>
                  {getSourceLabel(selectedResource.resourceType)} Intelligence Profile
                </span>
              </div>
              <button
                onClick={() => setSelectedResource(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: 4
                }}
              >
                <X size={20} />
              </button>
            </div>

            <h2 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 12px 0', lineHeight: 1.3 }}>
              {selectedResource.title}
            </h2>

            <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', margin: '0 0 24px 0', lineHeight: 1.5 }}>
              {selectedResource.description || selectedResource.valueProposition}
            </p>

            {/* Quick Action */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
              <button
                onClick={(e) => handleAskAbout(selectedResource, e)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                <MessageSquare size={16} />
                <span>Ask Open Eye About This Resource</span>
              </button>
              <a
                href={selectedResource.sourceUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  borderRadius: 8,
                  background: 'rgba(30, 41, 59, 0.6)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  textDecoration: 'none'
                }}
              >
                <ExternalLink size={16} />
                <span>Open Original Source</span>
              </a>
            </div>

            {/* Problems Solved */}
            <div style={{ marginBottom: 24 }}>
              <h4 style={{ fontSize: '0.9rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.04em', margin: '0 0 8px' }}>
                Problems Solved
              </h4>
              <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--text-primary)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {(selectedResource.problemsSolved || ['General technical problem solving']).map((p: string, i: number) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>

            {/* Practical Uses */}
            <div style={{ marginBottom: 24 }}>
              <h4 style={{ fontSize: '0.9rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.04em', margin: '0 0 8px' }}>
                How You Can Use This Resource
              </h4>
              <ul style={{ margin: 0, paddingLeft: 20, color: 'var(--accent-cyan)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {(selectedResource.practicalUses || ['Use as architectural guidance or software dependency']).map((u: string, i: number) => (
                  <li key={i}>{u}</li>
                ))}
              </ul>
            </div>

            {/* Capabilities */}
            {selectedResource.capabilities?.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h4 style={{ fontSize: '0.9rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.04em', margin: '0 0 12px' }}>
                  Extracted Capabilities ({selectedResource.capabilities.length})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {selectedResource.capabilities.map((cap: any) => (
                    <div key={cap.id} style={{
                      padding: 12,
                      borderRadius: 8,
                      background: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid var(--border-subtle)'
                    }}>
                      <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                        {cap.name}
                      </div>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                        {cap.description}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Verified Evidence */}
            {selectedResource.evidence?.length > 0 && (
              <div>
                <h4 style={{ fontSize: '0.9rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.04em', margin: '0 0 12px' }}>
                  Verified Evidence Citations ({selectedResource.evidence.length})
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {selectedResource.evidence.slice(0, 5).map((ev: any) => (
                    <div key={ev.id} style={{
                      padding: 12,
                      borderRadius: 8,
                      background: 'rgba(15, 23, 42, 0.4)',
                      border: '1px solid rgba(16, 185, 129, 0.2)',
                      fontSize: '0.85rem'
                    }}>
                      <div style={{ color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <CheckCircle2 size={14} />
                        <span>{ev.filePath || 'Verified Citation'}</span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                        "{ev.quoteSnippet}"
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Add Resource Modal */}
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
