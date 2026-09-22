'use client';

import React, { useState, useEffect } from 'react';
import { X, GitBranch, Youtube, Globe, FileText, Linkedin, CheckCircle2, Loader2, AlertCircle, Sparkles, BookOpen } from 'lucide-react';
import { ResourceType } from '@repo/shared';

interface AddResourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResourceAdded: () => void;
}

export const AddResourceModal: React.FC<AddResourceModalProps> = ({ isOpen, onClose, onResourceAdded }) => {
  const [url, setUrl] = useState('');
  const [detectedType, setDetectedType] = useState<ResourceType | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = url.trim().toLowerCase();
    if (!trimmed) {
      setDetectedType(null);
      return;
    }

    if (trimmed.includes('github.com')) {
      setDetectedType('github_repository');
    } else if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) {
      setDetectedType('youtube_video');
    } else if (trimmed.includes('linkedin.com')) {
      setDetectedType('linkedin_post');
    } else if (trimmed.endsWith('.pdf') || trimmed.includes('/pdf/')) {
      setDetectedType('pdf');
    } else if (trimmed.includes('docs.') || trimmed.includes('/docs')) {
      setDetectedType('documentation_site');
    } else if (trimmed.includes('http://') || trimmed.includes('https://') || trimmed.includes('.')) {
      setDetectedType('web_page');
    } else {
      setDetectedType(null);
    }
  }, [url]);

  if (!isOpen) return null;

  const quickPicks = [
    { label: 'Agent-Reach (GitHub)', url: 'https://github.com/Panniantong/Agent-Reach', type: 'github_repository' },
    { label: 'Building Production RAG (YouTube)', url: 'https://www.youtube.com/watch?v=0k_2hY5VvN0', type: 'youtube_video' },
    { label: 'FastAPI Tutorial (Web)', url: 'https://fastapi.tiangolo.com/tutorial/', type: 'documentation_site' },
    { label: 'U-Net Satellite Paper (PDF)', url: 'https://cs229.stanford.edu/proj2017/final-reports/5243715.pdf', type: 'pdf' }
  ];

  const getTypeIcon = (type: ResourceType | null) => {
    switch (type) {
      case 'github_repository':
        return <GitBranch size={16} color="var(--accent-indigo)" />;
      case 'youtube_video':
        return <Youtube size={16} color="#ef4444" />;
      case 'linkedin_post':
        return <Linkedin size={16} color="#0284c7" />;
      case 'pdf':
      case 'research_paper':
        return <FileText size={16} color="#f59e0b" />;
      case 'documentation_site':
        return <BookOpen size={16} color="#10b981" />;
      default:
        return <Globe size={16} color="var(--accent-cyan)" />;
    }
  };

  const getTypeLabel = (type: ResourceType | null) => {
    switch (type) {
      case 'github_repository': return 'GitHub Repository';
      case 'youtube_video': return 'YouTube Video';
      case 'linkedin_post': return 'LinkedIn Post';
      case 'pdf': return 'PDF Document';
      case 'research_paper': return 'Research Paper';
      case 'documentation_site': return 'Documentation Site';
      case 'article': return 'Article / Blog';
      default: return 'Web Resource';
    }
  };

  const pollStatus = async (resourceId: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/resources/${resourceId}/status`);
        if (!res.ok) return;
        const data = await res.json();
        setCurrentStep(data.status);

        if (data.status === 'READY') {
          clearInterval(interval);
          setIsLoading(false);
          onResourceAdded();
          setTimeout(() => {
            onClose();
            setUrl('');
            setCurrentStep(null);
          }, 1200);
        } else if (data.status === 'FAILED' || data.status === 'BLOCKED') {
          clearInterval(interval);
          setIsLoading(false);
          setError(data.errorMessage || 'Resource ingestion failed');
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
    setCurrentStep('FETCHING');

    try {
      const res = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to ingest resource');
      }

      if (data.status === 'READY') {
        setCurrentStep('READY');
        setIsLoading(false);
        onResourceAdded();
        setTimeout(() => {
          onClose();
          setUrl('');
          setCurrentStep(null);
        }, 1000);
      } else if (data.status === 'BLOCKED' || data.status === 'FAILED') {
        setIsLoading(false);
        setError(data.errorMessage || 'Resource ingestion blocked or failed');
      } else {
        pollStatus(data.resourceId);
      }
    } catch (err: any) {
      setIsLoading(false);
      setError(err.message);
      setCurrentStep(null);
    }
  };

  const stepLabels: Record<string, string> = {
    FETCHING: 'Fetching resource...',
    ANALYZING: 'Extracting content & understanding semantics...',
    INDEXING: 'Generating embeddings & indexing knowledge...',
    QUEUED: 'Queued for processing...',
    CLONING: 'Cloning repository...',
    READY: 'Resource Ready!'
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
        maxWidth: 580,
        padding: 30,
        position: 'relative'
      }}>
        {/* Close Button */}
        <button
          onClick={onClose}
          disabled={isLoading}
          style={{
            position: 'absolute',
            top: 20,
            right: 20,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: 4
          }}
        >
          <X size={20} />
        </button>

        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 10,
            background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <Sparkles size={18} color="#ffffff" />
          </div>
          <div>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>Add Universal Resource</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '2px 0 0 0' }}>
              Index GitHub repos, YouTube videos, technical articles, docs, or PDFs into Open Eye.
            </p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ marginTop: 24 }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Resource URL
              </label>
              {detectedType && (
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '3px 8px',
                  borderRadius: 6,
                  background: 'rgba(99, 102, 241, 0.12)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--accent-cyan)'
                }}>
                  {getTypeIcon(detectedType)}
                  <span>{getTypeLabel(detectedType)} detected</span>
                </div>
              )}
            </div>

            <div style={{ position: 'relative' }}>
              <input
                type="text"
                placeholder="Paste URL, GitHub repo, YouTube video, article, LinkedIn post, PDF..."
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={isLoading}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  borderRadius: 10,
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.9rem',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
            </div>
          </div>

          {/* Quick Picks */}
          <div style={{ marginBottom: 20 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 8 }}>
              Try a sample resource:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {quickPicks.map((pick) => (
                <button
                  key={pick.label}
                  type="button"
                  onClick={() => setUrl(pick.url)}
                  disabled={isLoading}
                  style={{
                    background: 'rgba(30, 41, 59, 0.5)',
                    border: '1px solid var(--border-subtle)',
                    padding: '5px 10px',
                    borderRadius: 6,
                    fontSize: '0.75rem',
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                    transition: 'all 0.15s'
                  }}
                >
                  {pick.label}
                </button>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: 12,
              borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontSize: '0.85rem',
              marginBottom: 16
            }}>
              <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>{error}</div>
            </div>
          )}

          {/* Processing Status Feedback */}
          {isLoading && currentStep && (
            <div style={{
              padding: 14,
              borderRadius: 8,
              background: 'rgba(99, 102, 241, 0.08)',
              border: '1px solid rgba(99, 102, 241, 0.25)',
              marginBottom: 16
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {currentStep === 'READY' ? (
                  <CheckCircle2 size={18} color="#10b981" />
                ) : (
                  <Loader2 size={18} color="var(--accent-indigo)" className="animate-spin" />
                )}
                <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {stepLabels[currentStep] || currentStep}
                </span>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              style={{
                padding: '10px 18px',
                borderRadius: 8,
                background: 'transparent',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !url.trim()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 22px',
                borderRadius: 8,
                background: isLoading || !url.trim()
                  ? 'rgba(99, 102, 241, 0.4)'
                  : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                color: '#ffffff',
                fontSize: '0.875rem',
                fontWeight: 600,
                border: 'none',
                cursor: isLoading || !url.trim() ? 'not-allowed' : 'pointer'
              }}
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Processing...</span>
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  <span>Add Resource</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
