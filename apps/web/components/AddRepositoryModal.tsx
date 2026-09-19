'use client';

import React, { useState } from 'react';
import { X, GitBranch, CheckCircle2, Loader2, AlertCircle, Sparkles } from 'lucide-react';

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
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 50,
      padding: 16
    }}>
      <div className="glass-panel" style={{
        width: '100%',
        maxWidth: 540,
        padding: 28,
        position: 'relative'
      }}>
        <button
          onClick={onClose}
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            color: 'var(--text-muted)',
            transition: 'color 0.2s'
          }}
        >
          <X size={20} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            background: 'rgba(99, 102, 241, 0.15)',
            border: '1px solid rgba(99, 102, 241, 0.3)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <GitBranch size={20} color="var(--accent-indigo)" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 600 }}>Onboard Repository</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Ingest, extract AST capabilities, and index code chunks.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              GITHUB REPOSITORY URL
            </label>
            <input
              type="text"
              placeholder="https://github.com/owner/repository"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={isLoading}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(0, 0, 0, 0.4)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontSize: '0.9rem',
                outline: 'none',
                transition: 'border 0.2s'
              }}
              required
            />
          </div>

          <div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              QUICK PICKS
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {quickPicks.map((pick) => (
                <button
                  key={pick.label}
                  type="button"
                  onClick={() => setUrl(pick.url)}
                  disabled={isLoading}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 6,
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)'
                  }}
                >
                  {pick.label}
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: 10,
              borderRadius: 8,
              background: 'rgba(244, 63, 94, 0.1)',
              border: '1px solid rgba(244, 63, 94, 0.25)',
              color: '#fb7185',
              fontSize: '0.825rem'
            }}>
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          {isLoading && currentStep && (
            <div style={{
              padding: 14,
              borderRadius: 8,
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.2)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--accent-indigo)' }}>
                  Ingestion in Progress
                </span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Step: {currentStep}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                {currentStep === 'DONE' ? (
                  <CheckCircle2 size={16} color="var(--accent-emerald)" />
                ) : (
                  <Loader2 size={16} className="animate-spin" color="var(--accent-cyan)" />
                )}
                <span>
                  {currentStep === 'CLONING' && 'Performing shallow git clone...'}
                  {currentStep === 'ANALYZING' && 'Parsing Tree-sitter AST & verifying capabilities...'}
                  {currentStep === 'INDEXING' && 'Generating embeddings & updating pgvector...'}
                  {currentStep === 'DONE' && 'Repository ready for intelligence queries!'}
                  {currentStep === 'QUEUED' && 'Waiting for background worker...'}
                </span>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                fontWeight: 500
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !url}
              style={{
                padding: '10px 22px',
                borderRadius: 8,
                background: isLoading ? 'rgba(99, 102, 241, 0.4)' : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                color: '#ffffff',
                fontSize: '0.875rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 2px 12px rgba(99, 102, 241, 0.4)'
              }}
            >
              {isLoading && <Loader2 size={16} className="animate-spin" />}
              {isLoading ? 'Ingesting...' : 'Start Ingestion'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
