'use client';

import React, { useState } from 'react';
import { X, CheckCircle2, Loader2, AlertCircle } from 'lucide-react';

interface AddRepositoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRepositoryAdded: () => void;
}

export const AddRepositoryModal: React.FC<AddRepositoryModalProps> = ({ isOpen, onClose, onRepositoryAdded }) => {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  if (!isOpen) return null;

  const quickPicks = [
    { label: 'Crawl4AI', url: 'https://github.com/unclecode/crawl4ai' },
    { label: 'Mem0', url: 'https://github.com/mem0ai/mem0' },
    { label: 'Docling', url: 'https://github.com/DS4SD/docling' },
    { label: 'Chroma', url: 'https://github.com/chroma-core/chroma' }
  ];

  const pollStatus = async (repoId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/repositories/${repoId}/status`);
        if (!res.ok) return;
        const data = await res.json();
        setCurrentStep(data.step || data.status);

        if (data.status === 'READY') {
          clearInterval(interval);
          setIsLoading(false);
          onRepositoryAdded();
          setTimeout(() => {
            onClose();
            setUrl('');
            setCurrentStep(null);
          }, 1200);
        } else if (data.status === 'FAILED') {
          clearInterval(interval);
          setIsLoading(false);
          setError(data.errorMessage || 'Ingestion failed');
        }
      } catch (err) {
        clearInterval(interval);
        setIsLoading(false);
      }
    }, 1500);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    setCurrentStep('QUEUED');

    try {
      const res = await fetch('/api/repositories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to onboard repository');
      }

      setJobId(data.job.id);
      pollStatus(data.repository.id);
    } catch (err: any) {
      setIsLoading(false);
      setError(err.message);
      setCurrentStep(null);
    }
  };


  return (
    <div className="overlay" style={{ zIndex: 50 }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="add-repo-title">
        <div className="modal-head">
          <div className="stack gap-1">
            <h2 id="add-repo-title" className="modal-title">Add a repository</h2>
            <p className="small muted">Open Eye clones it, parses the code and indexes it for questions.</p>
          </div>
          <button type="button" className="btn btn-secondary btn-icon" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="stack gap-4">
          <div>
            <label htmlFor="add-repo-url" className="label" style={{ marginBottom: 'var(--s-2)' }}>
              GitHub repository URL
            </label>
            <input
              id="add-repo-url"
              type="text"
              className="field"
              placeholder="https://github.com/owner/repository"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isLoading}
              required
            />
          </div>

          <div>
            <span className="label" style={{ marginBottom: 'var(--s-2)' }}>Examples</span>
            <div className="row wrap gap-1">
              {quickPicks.map((pick) => (
                <button
                  key={pick.label}
                  type="button"
                  className="tag tag-mono"
                  onClick={() => setUrl(pick.url)}
                  disabled={isLoading}
                >
                  {pick.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="callout callout-danger" role="alert">
              <AlertCircle size={16} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {isLoading && currentStep && (
            <div className="card card-ink stack gap-2" style={{ padding: 'var(--s-3) var(--s-4)' }}>
              <div className="row between gap-3">
                <span style={{ fontWeight: 600 }}>Indexing</span>
                <span className="badge badge-neutral">
                  <span className="dot dot-pulse" aria-hidden="true" />
                  {currentStep}
                </span>
              </div>
              <div className="row gap-2 small muted">
                {currentStep === 'DONE' ? (
                  <CheckCircle2 size={16} aria-hidden="true" style={{ color: 'var(--verified)' }} />
                ) : (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                )}
                <span>
                  {currentStep === 'CLONING' && 'Cloning the repository…'}
                  {currentStep === 'ANALYZING' && 'Parsing source files and checking evidence…'}
                  {currentStep === 'INDEXING' && 'Building the search index…'}
                  {currentStep === 'DONE' && 'Ready. You can ask about it now.'}
                  {currentStep === 'QUEUED' && 'Waiting for a worker…'}
                </span>
              </div>
            </div>
          )}

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isLoading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isLoading || !url}>
              {isLoading && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
              {isLoading ? 'Indexing…' : 'Start indexing'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
