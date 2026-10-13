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
  GitCommit,
  CheckCircle2,
  AlertTriangle,
  Layers,
  RotateCw,
  Trash2
} from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { EvidenceDrawer, EvidenceItem } from '@/components/EvidenceDrawer';
import { StatusBadge } from '@/components/Primitives';

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
      <div className="app-shell">
        <Navbar onOpenAddModal={() => {}} />
        <main className="page">
          <div className="loading-line" style={{ paddingTop: 'var(--s-9)' }}>
            <span className="dot dot-pulse" aria-hidden="true" />
            Loading repository&hellip;
          </div>
        </main>
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="app-shell">
        <Navbar onOpenAddModal={() => {}} />
        <main className="page">
          <div className="empty" style={{ marginTop: 'var(--s-9)' }}>
            <span className="eyebrow plain">404</span>
            <h3>Repository not found.</h3>
            <p>It may have been removed from the library, or the link is wrong.</p>
            <Link href="/" className="btn btn-secondary">
              <ArrowLeft size={15} aria-hidden="true" />
              Back to Studio
            </Link>
          </div>
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

  return (
    <div className="app-shell">
      <Navbar onOpenAddModal={() => {}} />

      <main className="page">
        {/* Back + actions */}
        <div className="row between wrap gap-3" style={{ paddingTop: 'var(--s-5)' }}>
          <Link href="/" className="link-quiet">
            <ArrowLeft size={14} aria-hidden="true" />
            Back to Studio
          </Link>

          <div className="row gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleReindex} disabled={isReindexing}>
              <RotateCw size={14} className={isReindexing ? 'animate-spin' : ''} aria-hidden="true" />
              {isReindexing ? 'Re-indexing…' : 'Re-index'}
            </button>
            <button type="button" className="btn btn-ghost btn-sm danger" onClick={handleDelete}>
              <Trash2 size={14} aria-hidden="true" />
              Delete
            </button>
          </div>
        </div>

        {/* Header */}
        <header className="page-head" style={{ paddingTop: 'var(--s-7)' }}>
          <div className="page-head-title">
            <span className="eyebrow">{repo.owner}</span>
            <h1 className="h-page" style={{ overflowWrap: 'anywhere' }}>{repo.name}</h1>
            <div className="row wrap gap-2" style={{ marginTop: 'var(--s-1)' }}>
              <StatusBadge status={repo.status} />
              {completeness && (
                <span
                  className={`badge badge-${completenessTone}`}
                  title={`Discovered: ${completeness.filesDiscovered || 0} files | Analyzed: ${completeness.filesAnalyzed || 0} files | Subsystems: ${completeness.subsystemsAnalyzed || 0}`}
                >
                  <Layers size={12} aria-hidden="true" />
                  {completeness.level?.toUpperCase()} ANALYSIS
                  {completeness.filesAnalyzed ? ` · ${completeness.filesAnalyzed} files` : ''}
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
              {repo.latestCommitHash && (
                <span><GitCommit size={13} aria-hidden="true" />{repo.latestCommitHash.slice(0, 7)}</span>
              )}
            </div>
          </div>
        </header>

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

        {/* Capabilities */}
        <section style={{ marginBottom: 'var(--s-8)' }}>
          <div className="rule-head">
            <h2 className="h-section">Capabilities</h2>
            <span className="count">{repo.capabilities?.length || 0}</span>
          </div>

          {repo.capabilities && repo.capabilities.length > 0 ? (
            <div className="grid-cards">
              {repo.capabilities.map((cap: any, i: number) => (
                <article key={i} className="card res-card">
                  <div className="stack gap-2">
                    <div className="res-card-top" style={{ alignItems: 'flex-start' }}>
                      {cap.category ? <span className="tag">{cap.category}</span> : <span />}
                      {typeof cap.confidence === 'number' && (
                        <span className="badge badge-outline" title="Model confidence">
                          <span className="num">{Math.round(cap.confidence * 100)}%</span>
                        </span>
                      )}
                    </div>
                    <h3 className="res-title" style={{ fontSize: 'var(--fs-md)' }}>{cap.name}</h3>
                    {cap.implementationNotes && <p className="small muted">{cap.implementationNotes}</p>}
                  </div>

                  {cap.evidence && cap.evidence.length > 0 && (
                    <div className="card-foot" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
                      <span className="label">Evidence</span>
                      <div className="row wrap gap-2" style={{ maxWidth: '100%' }}>
                        {cap.evidence.map((ev: any, evIdx: number) => (
                          <button
                            key={evIdx}
                            type="button"
                            className={`cite ${ev.verified ? 'is-verified' : 'is-inferred'}`}
                            title={ev.verified ? 'Verified against source' : 'Inferred, not verified'}
                            onClick={() => setSelectedEvidence({
                              repo: `${repo.owner}/${repo.name}`,
                              filePath: ev.filePath,
                              lines: ev.startLine ? `L${ev.startLine}-L${ev.endLine}` : undefined,
                              quote: ev.quoteSnippet,
                              symbolName: ev.symbolName,
                              verified: ev.verified
                            })}
                          >
                            {ev.verified
                              ? <CheckCircle2 size={12} aria-hidden="true" />
                              : <AlertTriangle size={12} aria-hidden="true" />}
                            <span>{ev.filePath}{ev.startLine ? `:${ev.startLine}` : ''}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              ))}
            </div>
          ) : (
            <p className="small muted">No capabilities extracted yet.</p>
          )}
        </section>

        {/* Features / concepts */}
        <div className="grid-2" style={{ marginBottom: 'var(--s-8)' }}>
          <section>
            <div className="rule-head">
              <h2 className="h-section">Features</h2>
              <span className="count">{repo.features?.length || 0}</span>
            </div>
            {repo.features && repo.features.length > 0 ? (
              <div className="def-list">
                {repo.features.map((feat: any, idx: number) => (
                  <div key={idx} className="def-item">
                    <strong>{feat.name}.</strong> {feat.description}
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">None recorded.</p>
            )}
          </section>

          <section>
            <div className="rule-head">
              <h2 className="h-section">Concepts &amp; techniques</h2>
              <span className="count">{repo.concepts?.length || 0}</span>
            </div>
            {repo.concepts && repo.concepts.length > 0 ? (
              <div className="def-list">
                {repo.concepts.map((c: any, idx: number) => (
                  <div key={idx} className="def-item">
                    <strong>{c.name}.</strong> {c.description}
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">None recorded.</p>
            )}
          </section>
        </div>

        {/* Inputs / outputs */}
        <div className="grid-2" style={{ marginBottom: 'var(--s-8)' }}>
          <section>
            <div className="rule-head">
              <h2 className="h-section">Inputs</h2>
              <span className="count">{repo.inputs?.length || 0}</span>
            </div>
            {repo.inputs && repo.inputs.length > 0 ? (
              <div className="def-list">
                {repo.inputs.map((inp: any, idx: number) => (
                  <div key={idx} className="def-item">
                    <strong className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{inp.name}</strong>
                    {inp.description && <> &mdash; {inp.description}</>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">No explicit inputs found.</p>
            )}
          </section>

          <section>
            <div className="rule-head">
              <h2 className="h-section">Outputs</h2>
              <span className="count">{repo.outputs?.length || 0}</span>
            </div>
            {repo.outputs && repo.outputs.length > 0 ? (
              <div className="def-list">
                {repo.outputs.map((out: any, idx: number) => (
                  <div key={idx} className="def-item">
                    <strong className="mono" style={{ fontSize: 'var(--fs-xs)' }}>{out.name}</strong>
                    {out.description && <> &mdash; {out.description}</>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="small muted">No explicit outputs found.</p>
            )}
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
              <div style={{ maxHeight: 260, overflowY: 'auto', paddingRight: 'var(--s-2)' }}>
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
    </div>
  );
}
