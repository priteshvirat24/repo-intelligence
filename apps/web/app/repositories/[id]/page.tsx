'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Star,
  Code,
  GitBranch,
  Shield,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Cpu,
  Boxes,
  FileCode,
  RotateCw,
  Trash2,
  ArrowRight
} from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { EvidenceDrawer, EvidenceItem } from '@/components/EvidenceDrawer';

export default function RepositoryDetailPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [repo, setRepo] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isReindexing, setIsReindexing] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);

  const fetchDetail = async () => {
    try {
      const res = await fetch(`/api/repositories/${params.id}`);
      if (res.ok) {
        const data = await res.json();
        setRepo(data);
      }
    } catch (err) {
      console.error('Error fetching repository detail:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDetail();
  }, [params.id]);

  const handleReindex = async () => {
    setIsReindexing(true);
    try {
      const res = await fetch(`/api/repositories/${params.id}/reindex`, { method: 'POST' });
      if (res.ok) {
        await fetchDetail();
      }
    } catch (err) {
      console.error('Error re-indexing repository:', err);
    } finally {
      setIsReindexing(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to delete this repository and all its indexed intelligence?')) return;
    try {
      const res = await fetch(`/api/repositories/${params.id}`, { method: 'DELETE' });
      if (res.ok) {
        router.push('/');
      }
    } catch (err) {
      console.error('Error deleting repository:', err);
    }
  };

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Navbar onOpenAddModal={() => {}} />
        <div style={{ margin: 'auto', color: 'var(--text-muted)' }}>
          Loading repository intelligence profile...
        </div>
      </div>
    );
  }

  if (!repo) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
        <Navbar onOpenAddModal={() => {}} />
        <div style={{ margin: 'auto', textAlign: 'center' }}>
          <h2>Repository Not Found</h2>
          <Link href="/" style={{ color: 'var(--accent-cyan)', marginTop: 10, display: 'inline-block' }}>
            Return to Studio
          </Link>
        </div>
      </div>
    );
  }

  const openKnowledge = repo.openKnowledge || {};

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar onOpenAddModal={() => {}} />

      <main style={{
        maxWidth: 1400,
        margin: '0 auto',
        width: '100%',
        padding: '32px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 28
      }}>
        {/* Navigation back and Actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link href="/" style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <ArrowLeft size={14} />
            Back to Studio & Chat
          </Link>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleReindex}
              disabled={isReindexing}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 8,
                background: 'rgba(99, 102, 241, 0.15)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                color: '#a5b4fc',
                fontSize: '0.825rem',
                cursor: 'pointer'
              }}
            >
              <RotateCw size={14} className={isReindexing ? 'animate-spin' : ''} />
              {isReindexing ? 'Re-indexing...' : 'Re-index'}
            </button>
            <button
              onClick={handleDelete}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 8,
                background: 'rgba(244, 63, 94, 0.12)',
                border: '1px solid rgba(244, 63, 94, 0.25)',
                color: '#fb7185',
                fontSize: '0.825rem',
                cursor: 'pointer'
              }}
            >
              <Trash2 size={14} />
              Delete
            </button>
          </div>
        </div>

        {/* Repository Header Card */}
        <div className="glass-panel" style={{ padding: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                {repo.owner}
              </div>
              <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {repo.name}
              </h1>
            </div>

            <span className={`badge-${repo.status.toLowerCase()}`} style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 5
            }}>
              {repo.status === 'READY' && <CheckCircle2 size={14} />}
              {repo.status}
            </span>
          </div>

          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', lineHeight: 1.6, maxWidth: 840, marginBottom: 20 }}>
            {repo.description || 'No description provided.'}
          </p>

          {/* Inferred Domain Badges */}
          {repo.domainTags && repo.domainTags.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Discovered Domains:</span>
              {repo.domainTags.map((tag: string, i: number) => (
                <span
                  key={i}
                  style={{
                    fontSize: '0.75rem',
                    padding: '3px 10px',
                    borderRadius: 6,
                    background: 'rgba(6, 182, 212, 0.12)',
                    color: '#22d3ee',
                    border: '1px solid rgba(6, 182, 212, 0.3)',
                    fontFamily: 'var(--font-mono)'
                  }}
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Meta specs */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 24,
            paddingTop: 16,
            borderTop: '1px solid var(--border-subtle)',
            fontSize: '0.825rem',
            color: 'var(--text-muted)'
          }}>
            {repo.primaryLanguage && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Code size={14} color="var(--accent-cyan)" />
                {repo.primaryLanguage}
              </span>
            )}
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Star size={14} color="var(--accent-amber)" />
              {repo.stars?.toLocaleString() || 0} stars
            </span>
            {repo.license && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Shield size={14} color="var(--accent-emerald)" />
                {repo.license}
              </span>
            )}
            {repo.defaultBranch && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <GitBranch size={14} />
                {repo.defaultBranch}
              </span>
            )}
            {repo.latestCommitHash && (
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                commit: {repo.latestCommitHash.slice(0, 7)}
              </span>
            )}
          </div>
        </div>

        {/* Purpose & Problem Space Section */}
        {(openKnowledge.purpose || openKnowledge.problemSpace) && (
          <div className="glass-panel" style={{ padding: 24 }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              Purpose & Problem Space
            </h3>
            {openKnowledge.purpose && (
              <div style={{ marginBottom: 10 }}>
                <strong style={{ color: 'var(--accent-cyan)', fontSize: '0.85rem' }}>Purpose: </strong>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{openKnowledge.purpose}</span>
              </div>
            )}
            {openKnowledge.problemSpace && (
              <div>
                <strong style={{ color: 'var(--accent-indigo)', fontSize: '0.85rem' }}>Technical Problem Space: </strong>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{openKnowledge.problemSpace}</span>
              </div>
            )}
          </div>
        )}

        {/* Open-World Discovered Capabilities */}
        <div className="glass-panel" style={{ padding: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Discovered Capabilities ({repo.capabilities?.length || 0})
            </h3>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            {repo.capabilities && repo.capabilities.map((cap: any, i: number) => (
              <div
                key={i}
                style={{
                  background: 'rgba(30, 41, 59, 0.4)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 10,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <span style={{ fontSize: '0.925rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {cap.name}
                  </span>
                  <span style={{
                    fontSize: '0.675rem',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'rgba(99, 102, 241, 0.15)',
                    color: '#a5b4fc',
                    fontFamily: 'var(--font-mono)'
                  }}>
                    {Math.round(cap.confidence * 100)}%
                  </span>
                </div>

                <div style={{ fontSize: '0.725rem', color: 'var(--accent-cyan)' }}>
                  {cap.category}
                </div>

                <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', margin: 0 }}>
                  {cap.implementationNotes || cap.name}
                </p>

                {/* Evidence count */}
                {cap.evidence && cap.evidence.length > 0 && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                      Verified Evidence:
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {cap.evidence.map((ev: any, evIdx: number) => (
                        <button
                          key={evIdx}
                          onClick={() => setSelectedEvidence({
                            repo: `${repo.owner}/${repo.name}`,
                            filePath: ev.filePath,
                            lines: ev.startLine ? `L${ev.startLine}-L${ev.endLine}` : undefined,
                            quote: ev.quoteSnippet,
                            symbolName: ev.symbolName,
                            verified: ev.verified
                          })}
                          style={{
                            fontSize: '0.675rem',
                            padding: '3px 8px',
                            borderRadius: 4,
                            background: 'rgba(16, 185, 129, 0.1)',
                            color: '#6ee7b7',
                            border: '1px solid rgba(16, 185, 129, 0.2)',
                            cursor: 'pointer'
                          }}
                        >
                          {ev.filePath}{ev.startLine ? `:${ev.startLine}` : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Features, Concepts & Techniques */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
          {/* Features */}
          <div className="glass-panel" style={{ padding: 20 }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              Key Features
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {repo.features && repo.features.length > 0 ? (
                repo.features.map((feat: any, idx: number) => (
                  <div key={idx} style={{ fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{feat.name}:</strong> {feat.description}
                  </div>
                ))
              ) : (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>None recorded.</span>
              )}
            </div>
          </div>

          {/* Concepts & Techniques */}
          <div className="glass-panel" style={{ padding: 20 }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              Domain Concepts & Techniques
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {repo.concepts && repo.concepts.length > 0 ? (
                repo.concepts.map((c: any, idx: number) => (
                  <div key={idx} style={{ fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--accent-cyan)' }}>{c.name}:</strong> {c.description}
                  </div>
                ))
              ) : (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>None recorded.</span>
              )}
            </div>
          </div>
        </div>

        {/* Inputs & Outputs / Data Flow */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div className="glass-panel" style={{ padding: 20 }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              Consumed Inputs (Data Requirements)
            </h4>
            {repo.inputs && repo.inputs.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {repo.inputs.map((inp: any, idx: number) => (
                  <div key={idx} style={{ fontSize: '0.825rem' }}>
                    <span style={{ color: 'var(--accent-amber)', fontWeight: 600 }}>{inp.name}</span>
                    <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>({inp.description})</span>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No explicit inputs specified.</span>
            )}
          </div>

          <div className="glass-panel" style={{ padding: 20 }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              Produced Outputs (Export Formats)
            </h4>
            {repo.outputs && repo.outputs.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {repo.outputs.map((out: any, idx: number) => (
                  <div key={idx} style={{ fontSize: '0.825rem' }}>
                    <span style={{ color: 'var(--accent-emerald)', fontWeight: 600 }}>{out.name}</span>
                    <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>({out.description})</span>
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No explicit outputs specified.</span>
            )}
          </div>
        </div>

        {/* Dependencies & Limitations */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div className="glass-panel" style={{ padding: 20 }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              Manifest Dependencies ({repo.dependencies?.length || 0})
            </h4>
            <div style={{ maxHeight: 220, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {repo.dependencies && repo.dependencies.map((d: any, idx: number) => (
                <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '4px 0' }}>
                  <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{d.packageName}</span>
                  <span style={{ color: 'var(--text-muted)' }}>{d.versionSpec || 'latest'}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="glass-panel" style={{ padding: 20 }}>
            <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>
              Known Limitations ({repo.limitations?.length || 0})
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {repo.limitations && repo.limitations.length > 0 ? (
                repo.limitations.map((lim: any, idx: number) => (
                  <div key={idx} style={{ fontSize: '0.825rem', color: 'var(--text-secondary)' }}>
                    <strong style={{ color: 'var(--accent-rose)' }}>[{lim.category}]</strong> {lim.description}
                  </div>
                ))
              ) : (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>No known limitations recorded.</span>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Evidence Drawer */}
      <EvidenceDrawer
        isOpen={Boolean(selectedEvidence)}
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
      />
    </div>
  );
}
