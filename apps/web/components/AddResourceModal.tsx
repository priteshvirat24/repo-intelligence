'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  GitBranch,
  Youtube,
  Globe,
  FileText,
  Linkedin,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Sparkles,
  BookOpen,
  ArrowRight,
  RotateCw,
  Ban,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Info
} from 'lucide-react';
import { ResourceType } from '@repo/shared';
import { ResourceTypeDetector } from '../lib/adapters/detector';

interface AddResourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResourceAdded?: () => void;
}

interface PreviewData {
  valid: boolean;
  supported: boolean;
  unsupportedReason?: string;
  resourceType: ResourceType;
  canonicalUrl: string;
  previewTitle: string;
  previewDescription?: string;
  thumbnailUrl?: string;
  willAnalyze: string[];
  alreadyExists?: boolean;
  alreadyProcessing?: boolean;
  existingResourceId?: string;
  indexedAt?: string;
}

interface IngestionStatusData {
  id: string;
  title: string;
  resourceType: string;
  status: string;
  errorMessage?: string;
  errorDetails?: {
    title: string;
    reason: string;
    action: string;
    isRetryable: boolean;
    status: 'BLOCKED' | 'FAILED';
  } | null;
  problemsSolved: string[];
  practicalUses: string[];
  usefulFor: string[];
  valueProposition?: string;
  capabilitiesCount: number;
  jobStep?: string;
}

const getTargetProgress = (step?: string, status?: string): number => {
  if (status === 'READY' || step === 'DONE') return 100;
  if (status === 'FAILED' || status === 'BLOCKED' || status === 'CANCELLED') return 0;

  const current = (step || status || '').toUpperCase();
  switch (current) {
    case 'QUEUED':
    case 'PENDING':
    case 'INITIALIZING':
      return 22;
    case 'CLONING':
    case 'FETCHING':
      return 45;
    case 'FILE_FILTERING':
    case 'MANIFEST_ANALYSIS':
      return 60;
    case 'AST_ANALYSIS':
    case 'ANALYZING':
      return 76;
    case 'CAPABILITY_EXTRACTION':
      return 88;
    case 'INDEXING':
      return 95;
    default:
      return 15;
  }
};

const getStageDescription = (step?: string, status?: string, resType?: string): string => {
  const current = (step || status || '').toUpperCase();
  const isRepo = resType === 'github_repository';

  switch (current) {
    case 'QUEUED':
    case 'PENDING':
    case 'INITIALIZING':
      return isRepo ? 'Initializing repository pipeline...' : 'Queuing resource for ingestion...';
    case 'CLONING':
    case 'FETCHING':
      return isRepo ? 'Cloning repository & file manifest...' : 'Fetching web content & clean DOM...';
    case 'FILE_FILTERING':
    case 'MANIFEST_ANALYSIS':
      return 'Analyzing package dependencies & structure...';
    case 'AST_ANALYSIS':
    case 'ANALYZING':
      return isRepo ? 'Extracting AST symbols, functions & syntax tree...' : 'Extracting semantic content & structured outline...';
    case 'CAPABILITY_EXTRACTION':
      return 'Synthesizing domain capabilities with evidence...';
    case 'INDEXING':
      return 'Indexing knowledge objects & vector graph...';
    case 'READY':
    case 'DONE':
      return 'Ingestion complete! Preparing summary...';
    default:
      return 'Analyzing and extracting resource...';
  }
};

export const AddResourceModal: React.FC<AddResourceModalProps> = ({
  isOpen,
  onClose,
  onResourceAdded
}) => {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const [url, setUrl] = useState('');
  const [forceReindex, setForceReindex] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Preview State
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Ingestion Execution State
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null);
  const [ingestionStatus, setIngestionStatus] = useState<IngestionStatusData | null>(null);
  const [pollingActive, setPollingActive] = useState(false);
  const [displayProgress, setDisplayProgress] = useState(0);

  // Focus input automatically on open & reset state when closed
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setUrl('');
      setForceReindex(false);
      setShowAdvanced(false);
      setPreview(null);
      setPreviewError(null);
      setIsSubmitting(false);
      setActiveResourceId(null);
      setIngestionStatus(null);
      setPollingActive(false);
      setDisplayProgress(0);
      submittingRef.current = false;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    }
  }, [isOpen]);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !isSubmitting && !pollingActive) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, pollingActive, onClose]);

  // Debounced Live Preview Fetch
  const fetchPreview = useCallback(async (inputUrl: string) => {
    const trimmed = inputUrl.trim();
    if (!trimmed || trimmed.length < 4) {
      setPreview(null);
      setPreviewError(null);
      setIsPreviewLoading(false);
      return;
    }

    setIsPreviewLoading(true);
    setPreviewError(null);

    try {
      const res = await fetch(`/api/resources/preview?url=${encodeURIComponent(trimmed)}`);
      const data = await res.json();

      if (!res.ok) {
        setPreview(null);
        setPreviewError(data.error || 'Invalid or malformed URL');
      } else {
        setPreview(data);
        if (!data.supported && data.unsupportedReason) {
          setPreviewError(data.unsupportedReason);
        } else {
          setPreviewError(null);
        }
      }
    } catch {
      setPreview(null);
      setPreviewError('Unable to preview URL');
    } finally {
      setIsPreviewLoading(false);
    }
  }, []);

  const handleUrlChange = (value: string) => {
    setUrl(value);
    setIngestionStatus(null);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchPreview(value);
    }, 320);
  };

  // Drag and drop support
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const droppedText = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
    if (droppedText) {
      setUrl(droppedText.trim());
      fetchPreview(droppedText.trim());
    }
  };

  // Status Polling Loop
  useEffect(() => {
    if (!pollingActive || !activeResourceId) return;

    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/resources/${activeResourceId}/status`);
        if (!res.ok) return;

        const data: IngestionStatusData = await res.json();
        if (!isMounted) return;

        setIngestionStatus(data);

        // Terminal States stop polling
        if (data.status === 'READY') {
          setDisplayProgress(100);
          setTimeout(() => {
            if (!isMounted) return;
            clearInterval(interval);
            setPollingActive(false);
            setIsSubmitting(false);
            submittingRef.current = false;
            if (onResourceAdded) onResourceAdded();
          }, 650);
        } else if (data.status === 'FAILED' || data.status === 'BLOCKED' || data.status === 'CANCELLED') {
          clearInterval(interval);
          setPollingActive(false);
          setIsSubmitting(false);
          submittingRef.current = false;
        }
      } catch (err) {
        console.error('Error polling status:', err);
      }
    }, 1500);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [pollingActive, activeResourceId, onResourceAdded]);

  // Submit Handler
  const handleSubmit = async (e?: React.FormEvent, isRetry = false, overrideForce = false) => {
    if (e) e.preventDefault();
    if (submittingRef.current && !isRetry) return;

    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;

    submittingRef.current = true;
    setIsSubmitting(true);
    setIngestionStatus(null);
    setDisplayProgress(15);

    try {
      const res = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: trimmedUrl,
          forceReindex: overrideForce || forceReindex
        })
      });

      const data = await res.json();

      if (!res.ok) {
        setIsSubmitting(false);
        submittingRef.current = false;
        setIngestionStatus({
          id: '',
          title: trimmedUrl,
          resourceType: preview?.resourceType || 'generic_url',
          status: data.status || 'FAILED',
          errorMessage: data.error || 'Failed to add resource',
          errorDetails: {
            title: data.status === 'BLOCKED' ? 'Prohibited or Blocked Destination' : 'Invalid Resource',
            reason: data.error || 'The resource could not be validated or queued.',
            action: 'Check that the URL is public, unauthenticated, and properly formatted.',
            isRetryable: false,
            status: data.status === 'BLOCKED' ? 'BLOCKED' : 'FAILED'
          },
          problemsSolved: [],
          practicalUses: [],
          usefulFor: [],
          capabilitiesCount: 0
        });
        return;
      }

      // Check if duplicate existing resource
      if (data.alreadyExists && !overrideForce && !forceReindex) {
        setIsSubmitting(false);
        submittingRef.current = false;
        setActiveResourceId(data.resourceId);
        setIngestionStatus({
          id: data.resourceId,
          title: data.title || trimmedUrl,
          resourceType: data.resourceType,
          status: 'ALREADY_EXISTS',
          problemsSolved: [],
          practicalUses: [],
          usefulFor: [],
          capabilitiesCount: 0
        });
        return;
      }

      // Check if already processing
      if (data.alreadyProcessing) {
        setActiveResourceId(data.resourceId);
        setPollingActive(true);
        setIngestionStatus({
          id: data.resourceId,
          title: data.title || trimmedUrl,
          resourceType: data.resourceType,
          status: data.status || 'FETCHING',
          problemsSolved: [],
          practicalUses: [],
          usefulFor: [],
          capabilitiesCount: 0
        });
        return;
      }

      // Resource is queued or processing
      setActiveResourceId(data.resourceId);
      if (data.status === 'READY') {
        setDisplayProgress(100);
        setTimeout(async () => {
          setIsSubmitting(false);
          submittingRef.current = false;
          // Fetch full status to display Ready view
          const statusRes = await fetch(`/api/resources/${data.resourceId}/status`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            setIngestionStatus(statusData);
          }
          if (onResourceAdded) onResourceAdded();
        }, 650);
      } else {
        setPollingActive(true);
        setIngestionStatus({
          id: data.resourceId,
          title: data.title || trimmedUrl,
          resourceType: data.resourceType,
          status: data.status || 'PENDING',
          problemsSolved: [],
          practicalUses: [],
          usefulFor: [],
          capabilitiesCount: 0,
          jobStep: 'FETCHING'
        });
      }
    } catch (err: any) {
      setIsSubmitting(false);
      submittingRef.current = false;
      setIngestionStatus({
        id: '',
        title: trimmedUrl,
        resourceType: 'generic_url',
        status: 'FAILED',
        errorMessage: err.message || 'Network error occurred',
        errorDetails: {
          title: 'Network Communication Failure',
          reason: 'Unable to reach the Open Eye ingestion server.',
          action: 'Check your internet connection and retry.',
          isRetryable: true,
          status: 'FAILED'
        },
        problemsSolved: [],
        practicalUses: [],
        usefulFor: [],
        capabilitiesCount: 0
      });
    }
  };

  // Safe Job Cancellation
  const handleCancelJob = async () => {
    if (!activeResourceId) return;
    try {
      await fetch(`/api/resources/${activeResourceId}/cancel`, { method: 'POST' });
      setPollingActive(false);
      setIsSubmitting(false);
      submittingRef.current = false;
      setIngestionStatus(prev => prev ? {
        ...prev,
        status: 'CANCELLED',
        errorMessage: 'Resource ingestion cancelled by user'
      } : null);
    } catch (err) {
      console.error('Cancel request error:', err);
    }
  };

  if (!isOpen) return null;

  const quickPicks = [
    { label: 'GitHub: Agent-Reach', url: 'https://github.com/Panniantong/Agent-Reach' },
    { label: 'YouTube: Production RAG', url: 'https://www.youtube.com/watch?v=0k_2hY5VvN0' },
    { label: 'Documentation: FastAPI', url: 'https://fastapi.tiangolo.com/tutorial/' },
    { label: 'Research Paper: U-Net', url: 'https://arxiv.org/abs/1505.04597' }
  ];

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'github_repository': return <GitBranch size={15} className="text-slate-700" />;
      case 'youtube_video': return <Youtube size={15} className="text-slate-700" />;
      case 'pdf':
      case 'research_paper': return <FileText size={15} className="text-slate-700" />;
      case 'documentation_site': return <BookOpen size={15} className="text-slate-700" />;
      case 'linkedin_post': return <Linkedin size={15} className="text-slate-700" />;
      default: return <Globe size={15} className="text-slate-700" />;
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'github_repository': return 'GitHub Repository';
      case 'youtube_video': return 'YouTube Video';
      case 'pdf': return 'PDF Document';
      case 'research_paper': return 'Research Paper';
      case 'documentation_site': return 'Documentation';
      case 'article': return 'Article';
      case 'linkedin_post': return 'LinkedIn Post';
      default: return 'Web Page';
    }
  };

  const isIngesting = isSubmitting || pollingActive;
  const isFailed = ingestionStatus?.status === 'FAILED' || ingestionStatus?.status === 'BLOCKED';
  const isReady = ingestionStatus?.status === 'READY';
  const isAlreadyExists = ingestionStatus?.status === 'ALREADY_EXISTS';

  // Immediate client-side type detection on URL keystroke
  const clientDetection = useMemo(() => {
    if (!url.trim()) return null;
    return ResourceTypeDetector.detect(url);
  }, [url]);

  const activeResourceType = ingestionStatus?.resourceType || preview?.resourceType || (clientDetection?.isValid ? clientDetection.resourceType : 'web_page');
  const activeCanonicalUrl = (clientDetection?.isValid && clientDetection.canonicalUrl)
    ? clientDetection.canonicalUrl
    : (preview?.canonicalUrl || url);

  // Smooth animation effect towards targetProgress with continuous micro-motion
  useEffect(() => {
    if (!isIngesting) {
      if (!isReady) {
        setDisplayProgress(0);
      }
      return;
    }

    const target = getTargetProgress(ingestionStatus?.jobStep, ingestionStatus?.status);

    const timer = setInterval(() => {
      setDisplayProgress((prev) => {
        if (target === 100) {
          const jump = Math.max(1.5, (100 - prev) * 0.35);
          const next = prev + jump;
          return next >= 99.5 ? 100 : next;
        }
        if (prev < target) {
          const diff = target - prev;
          const step = Math.max(0.35, diff * 0.09);
          return Math.min(target, prev + step);
        }
        // Micro-motion so loading is NEVER static while waiting on server
        if (prev < target + 4 && prev < 97) {
          return prev + 0.05;
        }
        return prev;
      });
    }, 50);

    return () => clearInterval(timer);
  }, [isIngesting, ingestionStatus?.jobStep, ingestionStatus?.status, isReady]);

  // Compute stage checklist states
  const currentStep = (ingestionStatus?.jobStep || ingestionStatus?.status || '').toUpperCase();
  const isFetchingDone = ['ANALYZING', 'FILE_FILTERING', 'MANIFEST_ANALYSIS', 'AST_ANALYSIS', 'CAPABILITY_EXTRACTION', 'INDEXING', 'READY', 'DONE'].includes(currentStep);
  const isAnalyzingDone = ['INDEXING', 'READY', 'DONE'].includes(currentStep);
  const isIndexingDone = ['READY', 'DONE'].includes(currentStep);
  const isFetchingActive = !isFetchingDone && ['CLONING', 'FETCHING', 'QUEUED', 'PENDING', 'INITIALIZING'].includes(currentStep);
  const isAnalyzingActive = !isAnalyzingDone && ['ANALYZING', 'FILE_FILTERING', 'MANIFEST_ANALYSIS', 'AST_ANALYSIS', 'CAPABILITY_EXTRACTION'].includes(currentStep);
  const isIndexingActive = !isIndexingDone && currentStep === 'INDEXING';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-resource-title"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.45)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '16px',
        overflowY: 'auto'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isIngesting) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
          padding: '24px 28px',
          position: 'relative',
          color: '#0f172a',
          fontFamily: 'inherit'
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <style>{`
          @keyframes openEyeShimmer {
            0% { transform: translateX(-150%); }
            100% { transform: translateX(250%); }
          }
          @keyframes pulseDot {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.35; transform: scale(0.8); }
          }
          @keyframes pulseHalo {
            0% { transform: scale(0.85); opacity: 0.8; }
            50% { transform: scale(1.35); opacity: 0.15; }
            100% { transform: scale(0.85); opacity: 0.8; }
          }
        `}</style>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
          <div>
            <h2 id="add-resource-title" style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>
              Add Resource
            </h2>
            <p style={{ fontSize: '0.875rem', color: '#64748b', margin: '4px 0 0 0' }}>
              Paste a public URL to extract intelligence, capabilities, and structured knowledge.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isIngesting}
            aria-label="Close modal"
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '8px',
              padding: '6px',
              color: '#64748b',
              cursor: isIngesting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Form Input Section */}
        {!isReady && (
          <form onSubmit={(e) => handleSubmit(e)} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label htmlFor="resource-url-input" style={{ fontSize: '0.825rem', fontWeight: 600, color: '#334155' }}>
                  Paste a public URL
                </label>
                {(preview?.supported || (clientDetection?.isValid && clientDetection?.isSupported)) && (
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    color: '#0f172a',
                    backgroundColor: '#f1f5f9',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0'
                  }}>
                    {getTypeIcon(activeResourceType)}
                    <span>✓ {getTypeLabel(activeResourceType)} detected</span>
                  </span>
                )}
              </div>

              <div style={{ position: 'relative' }}>
                <input
                  id="resource-url-input"
                  ref={inputRef}
                  type="text"
                  placeholder="https://github.com/..., youtube.com/watch, arxiv.org, .pdf, or web URL"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  disabled={isIngesting}
                  aria-invalid={Boolean(previewError)}
                  style={{
                    width: '100%',
                    padding: '11px 40px 11px 14px',
                    backgroundColor: '#f8fafc',
                    border: previewError ? '1px solid #ef4444' : '1px solid #cbd5e1',
                    borderRadius: '10px',
                    color: '#0f172a',
                    fontSize: '0.9rem',
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.15s, box-shadow 0.15s'
                  }}
                  onFocus={(e) => e.target.style.borderColor = '#0f172a'}
                  onBlur={(e) => e.target.style.borderColor = previewError ? '#ef4444' : '#cbd5e1'}
                />
                {isPreviewLoading && (
                  <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
                    <Loader2 size={16} className="animate-spin" color="#64748b" />
                  </div>
                )}
              </div>

              {/* Validation / Incompatibility Error */}
              {previewError && (
                <div style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  marginTop: 8,
                  padding: '8px 12px',
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: '8px',
                  color: '#991b1b',
                  fontSize: '0.8rem'
                }}>
                  <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                  <div>{previewError}</div>
                </div>
              )}
            </div>

            {/* Live Preview Card */}
            {preview && preview.supported && !isIngesting && !isFailed && !isAlreadyExists && (
              <div style={{
                backgroundColor: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: '10px',
                padding: '12px 14px'
              }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  {preview.thumbnailUrl && (
                    <img
                      src={preview.thumbnailUrl}
                      alt="Thumbnail"
                      style={{
                        width: 72,
                        height: 48,
                        objectFit: 'cover',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        flexShrink: 0
                      }}
                    />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {preview.previewTitle}
                    </div>
                    {preview.previewDescription && (
                      <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {preview.previewDescription}
                      </div>
                    )}
                  </div>
                </div>

                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e2e8f0' }}>
                  <span style={{ fontSize: '0.725rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#475569' }}>
                    Open Eye will:
                  </span>
                  <ul style={{ margin: '4px 0 0 0', paddingLeft: 16, fontSize: '0.775rem', color: '#475569' }}>
                    {preview.willAnalyze.map((bullet, idx) => (
                      <li key={idx} style={{ marginBottom: 2 }}>{bullet}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Duplicate Detected Notice (Section 12) */}
            {(preview?.alreadyExists || isAlreadyExists) && !isIngesting && (
              <div style={{
                backgroundColor: '#f8fafc',
                border: '1px solid #cbd5e1',
                borderRadius: '10px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Info size={18} color="#0284c7" />
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>
                      Already in Open Eye
                    </div>
                    <div style={{ fontSize: '0.775rem', color: '#64748b' }}>
                      This resource has already been indexed{preview?.indexedAt ? ` on ${new Date(preview.indexedAt).toLocaleDateString()}` : ''}.
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 4 }}>
                  <button
                    type="button"
                    onClick={() => {
                      const id = preview?.existingResourceId || ingestionStatus?.id;
                      if (id) {
                        onClose();
                        router.push(`/resources/${id}`);
                      }
                    }}
                    style={{
                      padding: '7px 14px',
                      borderRadius: '8px',
                      backgroundColor: '#ffffff',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      color: '#0f172a',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                  >
                    <span>Open Resource</span>
                    <ExternalLink size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSubmit(undefined, false, true)}
                    style={{
                      padding: '7px 14px',
                      borderRadius: '8px',
                      backgroundColor: '#0f172a',
                      color: '#ffffff',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6
                    }}
                  >
                    <RotateCw size={13} />
                    <span>Reindex</span>
                  </button>
                </div>
              </div>
            )}

            {/* Ingestion In-Progress Card with Motion & Percentage Done */}
            {isIngesting && (
              <div style={{
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: '12px',
                padding: '18px 20px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -2px rgba(0, 0, 0, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                gap: 16
              }}>
                {/* Header Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ minWidth: 0, flex: 1, marginRight: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#0f172a' }}>
                        Analyzing Resource
                      </span>
                      <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '2px 8px',
                        backgroundColor: '#f1f5f9',
                        border: '1px solid #e2e8f0',
                        borderRadius: '6px',
                        fontSize: '0.725rem',
                        fontWeight: 600,
                        color: '#334155'
                      }}>
                        {getTypeIcon(activeResourceType)}
                        <span>{getTypeLabel(activeResourceType)}</span>
                      </span>
                    </div>
                    <div style={{
                      fontSize: '0.75rem',
                      color: '#64748b',
                      marginTop: 3,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}>
                      {activeCanonicalUrl}
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    {/* Live Processing Indicator */}
                    <div style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '3px 10px',
                      borderRadius: '9999px',
                      backgroundColor: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      fontSize: '0.725rem',
                      fontWeight: 600,
                      color: '#1d4ed8'
                    }}>
                      <span style={{
                        width: 7,
                        height: 7,
                        borderRadius: '50%',
                        backgroundColor: '#2563eb',
                        animation: 'pulseDot 1.4s ease-in-out infinite'
                      }} />
                      <span>Processing</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleCancelJob}
                      style={{
                        padding: '4px 9px',
                        borderRadius: '6px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #cbd5e1',
                        fontSize: '0.75rem',
                        fontWeight: 500,
                        color: '#64748b',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        cursor: 'pointer'
                      }}
                    >
                      <Ban size={12} />
                      <span>Cancel</span>
                    </button>
                  </div>
                </div>

                {/* Percentage Done & Motion Progress Bar */}
                <div style={{
                  backgroundColor: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '10px',
                  padding: '12px 14px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Loader2 size={13} className="animate-spin" color="#2563eb" />
                      <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155' }}>
                        {getStageDescription(ingestionStatus?.jobStep, ingestionStatus?.status, activeResourceType)}
                      </span>
                    </div>
                    <div style={{
                      fontSize: '1.15rem',
                      fontWeight: 700,
                      fontVariantNumeric: 'tabular-nums',
                      color: '#0f172a',
                      letterSpacing: '-0.02em'
                    }}>
                      {Math.round(displayProgress)}%
                    </div>
                  </div>

                  {/* Animated Progress Bar Track */}
                  <div style={{
                    width: '100%',
                    height: '8px',
                    backgroundColor: '#e2e8f0',
                    borderRadius: '9999px',
                    overflow: 'hidden',
                    position: 'relative'
                  }}>
                    <div style={{
                      width: `${Math.max(4, Math.round(displayProgress))}%`,
                      height: '100%',
                      borderRadius: '9999px',
                      background: 'linear-gradient(90deg, #0f172a 0%, #2563eb 55%, #38bdf8 100%)',
                      position: 'relative',
                      overflow: 'hidden',
                      transition: 'width 200ms ease-out'
                    }}>
                      {/* Fluid Shimmer Wave with Motion */}
                      <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        bottom: 0,
                        width: '100%',
                        background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.45) 50%, transparent 100%)',
                        animation: 'openEyeShimmer 1.8s infinite cubic-bezier(0.4, 0, 0.2, 1)'
                      }} />
                    </div>
                  </div>
                </div>

                {/* Stage Checklist with Live Motion Icons */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.825rem' }}>
                  {/* Step 1 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#0f172a' }}>
                    <CheckCircle2 size={16} color="#10b981" style={{ flexShrink: 0 }} />
                    <span style={{ fontWeight: 500 }}>Source detected & validated</span>
                  </div>

                  {/* Step 2 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isFetchingDone ? (
                      <CheckCircle2 size={16} color="#10b981" style={{ flexShrink: 0 }} />
                    ) : isFetchingActive ? (
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, flexShrink: 0 }}>
                        <span style={{
                          position: 'absolute',
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          backgroundColor: '#2563eb',
                          animation: 'pulseHalo 1.5s ease-out infinite'
                        }} />
                        <Loader2 size={16} className="animate-spin" color="#2563eb" />
                      </div>
                    ) : (
                      <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #cbd5e1', flexShrink: 0 }} />
                    )}
                    <span style={{
                      color: isFetchingDone ? '#0f172a' : isFetchingActive ? '#0f172a' : '#64748b',
                      fontWeight: isFetchingActive ? 600 : isFetchingDone ? 500 : 400
                    }}>
                      {activeResourceType === 'github_repository' ? 'Repository & dependencies fetched' : 'Resource content fetched'}
                    </span>
                  </div>

                  {/* Step 3 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isAnalyzingDone ? (
                      <CheckCircle2 size={16} color="#10b981" style={{ flexShrink: 0 }} />
                    ) : isAnalyzingActive ? (
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, flexShrink: 0 }}>
                        <span style={{
                          position: 'absolute',
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          backgroundColor: '#2563eb',
                          animation: 'pulseHalo 1.5s ease-out infinite'
                        }} />
                        <Loader2 size={16} className="animate-spin" color="#2563eb" />
                      </div>
                    ) : (
                      <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #cbd5e1', flexShrink: 0 }} />
                    )}
                    <span style={{
                      color: isAnalyzingDone ? '#0f172a' : isAnalyzingActive ? '#0f172a' : '#64748b',
                      fontWeight: isAnalyzingActive ? 600 : isAnalyzingDone ? 500 : 400
                    }}>
                      {activeResourceType === 'github_repository' ? 'AST syntax & domain capabilities extracted' : 'Content analyzed & structured'}
                    </span>
                  </div>

                  {/* Step 4 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {isIndexingDone ? (
                      <CheckCircle2 size={16} color="#10b981" style={{ flexShrink: 0 }} />
                    ) : isIndexingActive ? (
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, flexShrink: 0 }}>
                        <span style={{
                          position: 'absolute',
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          backgroundColor: '#2563eb',
                          animation: 'pulseHalo 1.5s ease-out infinite'
                        }} />
                        <Loader2 size={16} className="animate-spin" color="#2563eb" />
                      </div>
                    ) : (
                      <div style={{ width: 16, height: 16, borderRadius: '50%', border: '2px solid #cbd5e1', flexShrink: 0 }} />
                    )}
                    <span style={{
                      color: isIndexingDone ? '#0f172a' : isIndexingActive ? '#0f172a' : '#64748b',
                      fontWeight: isIndexingActive ? 600 : isIndexingDone ? 500 : 400
                    }}>
                      Knowledge graph & search vectors indexed
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Failure Card (Section 9, 10, 42) */}
            {isFailed && (
              <div style={{
                backgroundColor: '#fff1f2',
                border: '1px solid #fecdd3',
                borderRadius: '10px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <AlertCircle size={18} color="#e11d48" style={{ marginTop: 2, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: '#9f1239' }}>
                      {ingestionStatus?.errorDetails?.title || 'Unable to access this resource'}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#881337', marginTop: 3 }}>
                      <strong>Reason:</strong> {ingestionStatus?.errorDetails?.reason || ingestionStatus?.errorMessage || 'An error occurred during resource retrieval.'}
                    </div>
                    {ingestionStatus?.errorDetails?.action && (
                      <div style={{ fontSize: '0.775rem', color: '#9f1239', marginTop: 4 }}>
                        <strong>What you can do:</strong> {ingestionStatus.errorDetails.action}
                      </div>
                    )}
                  </div>
                </div>

                {ingestionStatus?.errorDetails?.isRetryable && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                    <button
                      type="button"
                      onClick={() => handleSubmit(undefined, true)}
                      style={{
                        padding: '6px 14px',
                        backgroundColor: '#be123c',
                        color: '#ffffff',
                        border: 'none',
                        borderRadius: '6px',
                        fontSize: '0.775rem',
                        fontWeight: 600,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}
                    >
                      <RotateCw size={13} />
                      <span>Retry</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Quick Picks for sample exploration */}
            {!isIngesting && !isFailed && !preview && (
              <div>
                <span style={{ fontSize: '0.725rem', color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                  Or try a sample resource:
                </span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {quickPicks.map((pick) => (
                    <button
                      key={pick.label}
                      type="button"
                      onClick={() => {
                        setUrl(pick.url);
                        fetchPreview(pick.url);
                      }}
                      style={{
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        padding: '4px 9px',
                        borderRadius: '6px',
                        fontSize: '0.75rem',
                        color: '#475569',
                        transition: 'all 0.15s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = '#f1f5f9';
                        e.currentTarget.style.borderColor = '#cbd5e1';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = '#f8fafc';
                        e.currentTarget.style.borderColor = '#e2e8f0';
                      }}
                    >
                      {pick.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Optional Advanced Settings (Section 34) */}
            {!isIngesting && !isFailed && (
              <div>
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: '0.75rem',
                    color: '#64748b',
                    padding: 0
                  }}
                >
                  <span>Advanced options</span>
                  {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </button>

                {showAdvanced && (
                  <div style={{
                    marginTop: 8,
                    padding: '10px 12px',
                    backgroundColor: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0'
                  }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', color: '#334155', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={forceReindex}
                        onChange={(e) => setForceReindex(e.target.checked)}
                      />
                      <span>Force reindex (bypass existing cache and re-crawl fresh content)</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Bottom Actions */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 6 }}>
              <button
                type="button"
                onClick={onClose}
                disabled={isIngesting}
                style={{
                  padding: '9px 16px',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  color: '#475569',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  cursor: isIngesting ? 'not-allowed' : 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isIngesting || !url.trim() || Boolean(previewError)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 20px',
                  borderRadius: '8px',
                  backgroundColor: isIngesting || !url.trim() || Boolean(previewError)
                    ? '#94a3b8'
                    : '#0f172a',
                  color: '#ffffff',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  border: 'none',
                  cursor: isIngesting || !url.trim() || Boolean(previewError) ? 'not-allowed' : 'pointer'
                }}
              >
                {isIngesting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Adding... {Math.round(displayProgress)}%</span>
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
        )}

        {/* Resource Ready Card (Section 29) */}
        {isReady && ingestionStatus && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              backgroundColor: '#ecfdf5',
              border: '1px solid #a7f3d0',
              borderRadius: '8px',
              color: '#065f46'
            }}>
              <CheckCircle2 size={18} color="#059669" />
              <div style={{ fontSize: '0.875rem', fontWeight: 600 }}>
                Resource ready
              </div>
            </div>

            <div style={{
              padding: '16px',
              backgroundColor: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '10px'
            }}>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a' }}>
                {ingestionStatus.title}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: 2 }}>
                {getTypeLabel(ingestionStatus.resourceType)} · Discovered {ingestionStatus.capabilitiesCount} capabilities
              </div>

              {ingestionStatus.problemsSolved && ingestionStatus.problemsSolved.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: '#475569' }}>
                    Problems Solved:
                  </span>
                  <ul style={{ margin: '4px 0 0 0', paddingLeft: 16, fontSize: '0.8rem', color: '#334155' }}>
                    {ingestionStatus.problemsSolved.slice(0, 3).map((prob, i) => (
                      <li key={i}>{prob}</li>
                    ))}
                  </ul>
                </div>
              )}

              {ingestionStatus.usefulFor && ingestionStatus.usefulFor.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', color: '#475569' }}>
                    Useful For:
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 4 }}>
                    {ingestionStatus.usefulFor.slice(0, 4).map((tag, i) => (
                      <span key={i} style={{
                        fontSize: '0.725rem',
                        backgroundColor: '#ffffff',
                        border: '1px solid #cbd5e1',
                        padding: '2px 7px',
                        borderRadius: '4px',
                        color: '#334155'
                      }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: '9px 16px',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  border: '1px solid #cbd5e1',
                  color: '#475569',
                  fontSize: '0.875rem',
                  fontWeight: 600
                }}
              >
                Done
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  router.push(`/resources/${ingestionStatus.id}`);
                }}
                style={{
                  padding: '9px 18px',
                  borderRadius: '8px',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                <span>Open Resource</span>
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
