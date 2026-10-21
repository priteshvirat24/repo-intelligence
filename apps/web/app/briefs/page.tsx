'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertCircle, FileUp, X } from 'lucide-react';
import { BriefSummary } from '@repo/shared';
import { Navbar } from '@/components/Navbar';
import { StatusBadge } from '@/components/Primitives';
import { LoadError } from '@/components/IndexingState';
import { formatRetryAfter, httpErrorTitle, readJsonSafe, retryAfterSeconds, shortDate } from '@/lib/ui/api';
import { discoveryStepLabel, isBriefActive } from '@/lib/ui/briefs';

const ACCEPT = '.txt,.md,.markdown,.pdf,.docx';

export default function BriefsPage() {
  const router = useRouter();
  const [briefs, setBriefs] = useState<BriefSummary[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<{ title: string; detail: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const fetchBriefs = useCallback(async () => {
    try {
      const res = await fetch('/api/briefs', { cache: 'no-store' });
      const data = await readJsonSafe(res);
      if (!res.ok || !data) throw new Error('load failed');
      setBriefs(data.items || []);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setHasLoaded(true);
    }
  }, []);

  useEffect(() => {
    fetchBriefs();
  }, [fetchBriefs]);

  // Keep statuses current while any discovery is still running
  useEffect(() => {
    if (!briefs.some((b) => isBriefActive(b.status))) return;
    const timer = setInterval(fetchBriefs, 4000);
    return () => clearInterval(timer);
  }, [briefs, fetchBriefs]);

  const canSubmit = !submitting && (file !== null || text.trim().length >= 40);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFormError(null);
    try {
      let res: Response;
      if (file) {
        const form = new FormData();
        form.append('file', file);
        if (title.trim()) form.append('title', title.trim());
        res = await fetch('/api/briefs', { method: 'POST', body: form });
      } else {
        res = await fetch('/api/briefs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), text })
        });
      }
      const data: any = (await readJsonSafe(res)) || {};
      if (!res.ok) {
        const detail = res.status === 429
          ? formatRetryAfter(retryAfterSeconds(res, data))
          : data.error || 'The brief could not be saved.';
        setFormError({ title: httpErrorTitle(res.status), detail });
        return;
      }
      router.push(`/briefs/${data.id}`);
    } catch {
      setFormError({ title: 'Network error', detail: 'Could not reach Open Eye. Check your connection and try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app-shell">
      <Navbar />

      <main className="page">
        <header className="page-head">
          <div className="page-head-title">
            <span className="eyebrow">Briefs</span>
            <h1 className="h-page">Start from what already exists.</h1>
          </div>
          <div className="page-head-aside">
            <p className="lede">
              Give Open Eye a project brief. It pulls out the requirements, searches GitHub for
              repositories that already implement them, reads their READMEs and ranks the best starting points.
            </p>
          </div>
        </header>

        <form className="card stack gap-4" onSubmit={handleSubmit} style={{ marginBottom: 'var(--s-6)' }}>
          <div className="stack gap-2">
            <label htmlFor="brief-title" className="label">Title (optional)</label>
            <input
              id="brief-title"
              className="field"
              placeholder="Taken from the first line of the brief if left empty"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {file ? (
            <div className="row between gap-3 card-sunk" style={{ padding: 'var(--s-3) var(--s-4)', borderRadius: 'var(--r-md)' }}>
              <span className="row gap-2 truncate">
                <FileUp size={16} aria-hidden="true" />
                <span className="truncate">{file.name}</span>
                <span className="faint small">{Math.max(1, Math.round(file.size / 1024))} KB</span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  setFile(null);
                  if (fileInput.current) fileInput.current.value = '';
                }}
              >
                <X size={14} aria-hidden="true" />
                <span>Remove file</span>
              </button>
            </div>
          ) : (
            <div className="stack gap-2">
              <label htmlFor="brief-text" className="label">Brief</label>
              <textarea
                id="brief-text"
                className="field"
                rows={9}
                placeholder="Paste the brief: what you want to build, who it is for, the requirements and constraints."
                value={text}
                onChange={(e) => setText(e.target.value)}
                style={{ resize: 'vertical', lineHeight: 1.5 }}
              />
            </div>
          )}

          <div className="row wrap between gap-3">
            <div className="row gap-2">
              <input
                ref={fileInput}
                id="brief-file"
                type="file"
                accept={ACCEPT}
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <label htmlFor="brief-file" className="btn btn-secondary">
                <FileUp size={16} aria-hidden="true" />
                <span>{file ? 'Choose another file' : 'Upload a file instead'}</span>
              </label>
              <span className="faint small">.txt, .md, .pdf or .docx, up to 10 MB</span>
            </div>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
              {submitting ? 'Reading the brief…' : 'Find existing implementations'}
            </button>
          </div>

          {formError && (
            <div className="callout callout-danger" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <div>
                <div className="callout-title">{formError.title}</div>
                <div>{formError.detail}</div>
              </div>
            </div>
          )}
        </form>

        <div className="rule-head">
          <h2 className="label">Your briefs</h2>
          {hasLoaded && <span className="count">{briefs.length}</span>}
        </div>

        {loadError ? (
          <LoadError what="briefs" onRetry={fetchBriefs} />
        ) : !hasLoaded ? (
          <div className="loading-line" role="status">
            <span className="dot dot-pulse" aria-hidden="true" />
            Loading briefs&hellip;
          </div>
        ) : briefs.length === 0 ? (
          <div className="empty">
            <span className="eyebrow plain">Nothing here yet</span>
            <h3>No briefs yet.</h3>
            <p>Paste or upload a brief above. Discovery takes about a minute; verifying the best repositories against their code and writing the blueprint takes a few more.</p>
          </div>
        ) : (
          <div className="grid-cards">
            {briefs.map((b) => (
              <article key={b.id} className="card card-linkable stack gap-3">
                <div className="row between gap-3">
                  <span className="faint small">{shortDate(b.createdAt)}</span>
                  <StatusBadge status={b.status} />
                </div>
                <h3 className="res-title">
                  <Link href={`/briefs/${b.id}`} className="stretched-link">{b.title}</Link>
                </h3>
                <div className="small muted">
                  {isBriefActive(b.status)
                    ? `${discoveryStepLabel(b.step)}…`
                    : b.status === 'FAILED'
                      ? <span className="clamp-2">{b.errorMessage || 'Discovery failed.'}</span>
                      : `${b.requirementCount} requirements · ${b.candidateCount} candidates · ${b.shortlistedCount} shortlisted`}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
