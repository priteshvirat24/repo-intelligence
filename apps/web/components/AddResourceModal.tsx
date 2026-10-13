'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  X,
  CheckCircle2,
  Loader2,
  AlertCircle,
  ArrowRight,
  RotateCw,
  Ban,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Info,
  AlertTriangle,
  MessageSquare
} from 'lucide-react';
import { SourceIcon } from '@/components/Primitives';
import { ResourceType } from '@repo/shared';
import { ResourceTypeDetector } from '../lib/adapters/detector';
import { useDialog } from '@/lib/ui/useDialog';
import { useIndexingStatus, ResourceStatusData } from '@/lib/ui/useIndexingStatus';
import { formatRetryAfter, httpErrorTitle, readJsonSafe, retryAfterSeconds } from '@/lib/ui/api';
import { askHref, parseGithubRepo, repoSeedPrompt } from '@/lib/ui/github';

interface AddResourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResourceAdded?: () => void;
  /** The user closed the modal while a job was running; the job keeps going server-side. */
  onContinueInBackground?: (resourceId: string) => void;
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
    status?: 'BLOCKED' | 'FAILED';
  } | null;
  problemsSolved: string[];
  practicalUses: string[];
  usefulFor: string[];
  valueProposition?: string;
  capabilitiesCount: number;
  jobStep?: string | null;
  sourceUrl?: string;
  repositoryId?: string | null;
}

const getTargetProgress = (step?: string | null, status?: string): number => {
  if (status === 'READY' || status === 'PARTIAL' || step === 'DONE') return 100;
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

const getStageDescription = (step?: string | null, status?: string, resType?: string): string => {
  const current = (step || status || '').toUpperCase();
  const isRepo = resType === 'github_repository';

  switch (current) {
    case 'QUEUED':
    case 'PENDING':
    case 'INITIALIZING':
      return isRepo ? 'Queued. Starting the repository job…' : 'Queued. Starting the job…';
    case 'CLONING':
    case 'FETCHING':
      return isRepo ? 'Cloning the repository…' : 'Fetching the page…';
    case 'FILE_FILTERING':
    case 'MANIFEST_ANALYSIS':
      return 'Reading manifests and dependencies…';
    case 'AST_ANALYSIS':
    case 'ANALYZING':
      return isRepo ? 'Parsing source files for symbols…' : 'Reading the content and its structure…';
    case 'CAPABILITY_EXTRACTION':
      return 'Extracting capabilities, with evidence…';
    case 'INDEXING':
      return 'Building the search index…';
    case 'READY':
    case 'DONE':
      return 'Done. Loading the summary…';
    default:
      return 'Working…';
  }
};

export const AddResourceModal: React.FC<AddResourceModalProps> = ({
  isOpen,
  onClose,
  onResourceAdded,
  onContinueInBackground
}) => {
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const previewRequestIdRef = useRef(0);

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
    if (!isOpen) {
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
      previewRequestIdRef.current++;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    }
  }, [isOpen]);

  // Closing while a job runs never cancels it: the job continues and the app keeps following it.
  const handleDismiss = () => {
    if (pollingActive && activeResourceId) {
      onContinueInBackground?.(activeResourceId);
      onClose();
      return;
    }
    if (isSubmitting) return; // the request is still in flight; wait for an id
    onClose();
  };

  useDialog(dialogRef, handleDismiss, isOpen);

  // Debounced Live Preview Fetch
  const fetchPreview = useCallback(async (inputUrl: string) => {
    // Responses can arrive out of order; only the latest request may update state
    const requestId = ++previewRequestIdRef.current;
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
      if (requestId !== previewRequestIdRef.current) return;

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
      if (requestId !== previewRequestIdRef.current) return;
      setPreview(null);
      setPreviewError('Unable to preview URL');
    } finally {
      if (requestId === previewRequestIdRef.current) setIsPreviewLoading(false);
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
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      setIngestionStatus(null);
      setUrl(droppedText.trim());
      fetchPreview(droppedText.trim());
    }
  };

  // Status polling (shared hook): PARTIAL and CANCELLED are terminal too, and repeated failures
  // surface as a "lost track" state instead of spinning forever.
  const finishSubmitting = () => {
    setIsSubmitting(false);
    submittingRef.current = false;
  };

  const { lost: lostMap, retry: retryPolling } = useIndexingStatus(
    pollingActive && activeResourceId ? [activeResourceId] : [],
    {
      initialDelay: 1500,
      maxDelay: 5000,
      maxFailures: 6,
      immediate: false,
      onUpdate: (data: ResourceStatusData) => {
        setIngestionStatus((prev) => ({ ...(prev || {}), ...(data as any), capabilitiesCount: data.capabilitiesCount ?? 0 }));
      },
      onTerminal: (data: ResourceStatusData) => {
        if (data.status === 'READY' || data.status === 'PARTIAL') {
          setDisplayProgress(100);
          setTimeout(() => {
            setPollingActive(false);
            finishSubmitting();
            onResourceAdded?.();
          }, 650);
        } else {
          setPollingActive(false);
          finishSubmitting();
          onResourceAdded?.();
        }
      }
    }
  );
  const pollLost = Boolean(activeResourceId && lostMap[activeResourceId]);

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

      const data: any = (await readJsonSafe(res)) || {};

      if (!res.ok) {
        setIsSubmitting(false);
        submittingRef.current = false;
        const blocked = data.status === 'BLOCKED';
        const retryAfter = retryAfterSeconds(res, data);
        const title = blocked
          ? 'Blocked destination'
          : res.status === 429
            ? 'Rate limited'
            : res.status >= 500
              ? 'Server error'
              : res.status === 400
                ? 'Can’t add this URL'
                : httpErrorTitle(res.status);
        const action = blocked
          ? 'Open Eye only reads public sources on the open internet.'
          : res.status === 429
            ? formatRetryAfter(retryAfter)
            : res.status >= 500
              ? 'This is on our side. Try again in a moment.'
              : 'Check that the URL is public, unauthenticated, and properly formatted.';
        setIngestionStatus({
          id: '',
          title: trimmedUrl,
          resourceType: preview?.resourceType || 'generic_url',
          status: blocked ? 'BLOCKED' : 'FAILED',
          errorMessage: data.error || 'Failed to add resource',
          errorDetails: {
            title,
            reason: res.status >= 500 && !data.error
              ? 'The server could not queue this repository.'
              : data.error || 'The resource could not be validated or queued.',
            action,
            isRetryable: res.status === 429 || res.status >= 500,
            status: blocked ? 'BLOCKED' : 'FAILED'
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
          try {
            const statusRes = await fetch(`/api/resources/${data.resourceId}/status`);
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              setIngestionStatus(statusData);
            }
          } catch {
            setIngestionStatus({
              id: data.resourceId,
              title: data.title || trimmedUrl,
              resourceType: data.resourceType,
              status: 'READY',
              problemsSolved: [],
              practicalUses: [],
              usefulFor: [],
              capabilitiesCount: 0
            });
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
          title: 'Network error',
          reason: 'Unable to reach the Open Eye server.',
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
      const res = await fetch(`/api/resources/${activeResourceId}/cancel`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.cancelled === false) {
        // Job already finished or the cancel was rejected; keep polling for the real state
        console.error('Cancel request not applied:', data.message || data.error || res.status);
        return;
      }
      setPollingActive(false);
      setIsSubmitting(false);
      submittingRef.current = false;
      setIngestionStatus(prev => prev ? {
        ...prev,
        status: 'CANCELLED',
        errorMessage: 'Indexing was cancelled.'
      } : null);
      onResourceAdded?.();
    } catch (err) {
      console.error('Cancel request error:', err);
    }
  };

  const quickPicks = [
    { label: 'Panniantong/Agent-Reach', url: 'https://github.com/Panniantong/Agent-Reach' },
    { label: 'FastAPI docs', url: 'https://fastapi.tiangolo.com/tutorial/' },
    { label: 'Production RAG (video)', url: 'https://www.youtube.com/watch?v=0k_2hY5VvN0' },
    { label: 'U-Net (arXiv)', url: 'https://arxiv.org/abs/1505.04597' }
  ];

  const getTypeIcon = (type: string) => <SourceIcon type={type} size={14} />;

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
  const isCancelled = ingestionStatus?.status === 'CANCELLED';
  const isPartial = ingestionStatus?.status === 'PARTIAL';
  const isReady = (ingestionStatus?.status === 'READY' || isPartial) && !pollingActive;
  const isAlreadyExists = ingestionStatus?.status === 'ALREADY_EXISTS';

  // Immediate client-side type detection on URL keystroke (Hook must be called unconditionally)
  const clientDetection = useMemo(() => {
    if (!url.trim()) return null;
    return ResourceTypeDetector.detect(url);
  }, [url]);

  const activeResourceType = ingestionStatus?.resourceType || preview?.resourceType || (clientDetection?.isValid ? clientDetection.resourceType : 'web_page');
  const activeCanonicalUrl = (clientDetection?.isValid && clientDetection.canonicalUrl)
    ? clientDetection.canonicalUrl
    : (preview?.canonicalUrl || url);

  // Smooth animation effect towards targetProgress with continuous micro-motion (Hook must be called unconditionally)
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

  // "Open repository" needs the repositories.id; old status payloads do not carry it.
  const [readyRepositoryId, setReadyRepositoryId] = useState<string | null>(null);
  const readyResourceId = isReady ? ingestionStatus?.id : undefined;
  const readyRepoIdFromStatus = ingestionStatus?.repositoryId;
  useEffect(() => {
    setReadyRepositoryId(readyRepoIdFromStatus || null);
    if (!readyResourceId || readyRepoIdFromStatus) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/resources?type=github_repository', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const item = (data.items || []).find((it: any) => it.id === readyResourceId);
        if (!cancelled && item?.repositoryId) setReadyRepositoryId(item.repositoryId);
      } catch {
        /* the library link below still works */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readyResourceId, readyRepoIdFromStatus]);

  if (!isOpen) return null;

  const readyName =
    parseGithubRepo(ingestionStatus?.sourceUrl) ||
    parseGithubRepo(activeCanonicalUrl) ||
    ingestionStatus?.title ||
    'this repository';

  const renderStep = (isDone: boolean, isActive: boolean, label: string) => (
    <div className={`step${isDone ? ' is-done' : isActive ? ' is-active' : ''}`}>
      {isDone ? (
        <CheckCircle2 size={16} aria-hidden="true" style={{ flexShrink: 0 }} />
      ) : isActive ? (
        <span className="step-marker is-active" aria-hidden="true">
          <span className="dot dot-pulse" />
        </span>
      ) : (
        <span className="step-marker is-idle" aria-hidden="true" />
      )}
      <span>{label}</span>
    </div>
  );

  return (
    <div
      className="overlay"
      style={{ zIndex: 50 }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isIngesting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-resource-title"
        className="modal"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        {/* Header */}
        <div className="modal-head">
          <div className="stack gap-1">
            <span className="eyebrow">Add to library</span>
            <h2 id="add-resource-title" className="modal-title">
              Add a repository
            </h2>
            <p className="small muted" style={{ maxWidth: '46ch' }}>
              Paste a public GitHub URL. Open Eye reads the code and keeps the evidence.
              Docs, videos and PDFs work too.
            </p>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={isSubmitting && !pollingActive}
            aria-label={pollingActive ? 'Close; indexing continues in the background' : 'Close'}
            className="btn btn-secondary btn-icon"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Form Input Section */}
        {!isReady && (
          <form onSubmit={(e) => handleSubmit(e)} className="stack gap-4">
            <div>
              <div className="row between wrap gap-2" style={{ marginBottom: 'var(--s-2)' }}>
                <label htmlFor="resource-url-input" className="label">
                  Public URL
                </label>
                {(preview?.supported || (clientDetection?.isValid && clientDetection?.isSupported)) && (
                  <span className="badge badge-outline" style={{ color: 'var(--ink)' }}>
                    {getTypeIcon(activeResourceType)}
                    <span>{getTypeLabel(activeResourceType)}</span>
                  </span>
                )}
              </div>

              <div className="field-wrap">
                <input
                  id="resource-url-input"
                  ref={inputRef}
                  data-autofocus
                  type="text"
                  className="field mono"
                  style={{ paddingRight: 40, fontSize: 'var(--fs-sm)' }}
                  placeholder="https://github.com/owner/repo"
                  value={url}
                  onChange={(e) => handleUrlChange(e.target.value)}
                  disabled={isIngesting}
                  aria-invalid={Boolean(previewError)}
                  autoComplete="off"
                  spellCheck={false}
                />
                {isPreviewLoading && (
                  <span className="field-trail" aria-label="Checking URL">
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                  </span>
                )}
              </div>

              {/* Validation / Incompatibility Error */}
              {previewError && (
                <div className="callout callout-danger" role="alert" style={{ marginTop: 'var(--s-2)' }}>
                  <AlertCircle size={15} aria-hidden="true" />
                  <div>{previewError}</div>
                </div>
              )}
            </div>

            {/* Live Preview Card */}
            {preview && preview.supported && !isIngesting && !isFailed && !isAlreadyExists && (
              <div className="card card-sunk" style={{ padding: 'var(--s-3) var(--s-4)' }}>
                <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
                  {preview.thumbnailUrl && (
                    <img
                      src={preview.thumbnailUrl}
                      alt=""
                      style={{
                        width: 72,
                        height: 48,
                        objectFit: 'cover',
                        borderRadius: 'var(--r-sm)',
                        border: '1px solid var(--line-strong)',
                        flexShrink: 0
                      }}
                    />
                  )}
                  <div className="grow">
                    <div className="truncate" style={{ fontWeight: 600 }}>
                      {preview.previewTitle}
                    </div>
                    {preview.previewDescription && (
                      <div className="xsmall muted clamp-2" style={{ marginTop: 2 }}>
                        {preview.previewDescription}
                      </div>
                    )}
                  </div>
                </div>

                {preview.willAnalyze.length > 0 && (
                  <div style={{ marginTop: 'var(--s-3)', paddingTop: 'var(--s-3)', borderTop: '1px solid var(--line-strong)' }}>
                    <span className="label">What happens next</span>
                    <ul className="small muted" style={{ marginTop: 'var(--s-1)' }}>
                      {preview.willAnalyze.map((bullet, idx) => (
                        <li key={idx} style={{ marginBottom: 2 }}>{bullet}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Duplicate Detected Notice */}
            {(preview?.alreadyExists || isAlreadyExists) && !isIngesting && (
              <div className="callout callout-info" style={{ flexDirection: 'column', gap: 'var(--s-3)' }}>
                <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
                  <Info size={17} aria-hidden="true" />
                  <div>
                    <div className="callout-title">Already in your library</div>
                    <div className="muted">
                      Indexed{preview?.indexedAt ? ` on ${new Date(preview.indexedAt).toLocaleDateString()}` : ' earlier'}.
                      Open it, or reindex to pick up new changes.
                    </div>
                  </div>
                </div>
                <div className="row wrap gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => {
                      const id = preview?.existingResourceId || ingestionStatus?.id;
                      if (id) {
                        onClose();
                        router.push(`/resources?id=${encodeURIComponent(id)}`);
                      }
                    }}
                  >
                    <span>Open it</span>
                    <ArrowUpRight size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => handleSubmit(undefined, false, true)}
                  >
                    <RotateCw size={13} aria-hidden="true" />
                    <span>Re-index</span>
                  </button>
                </div>
              </div>
            )}

            {/* Ingestion in progress */}
            {isIngesting && pollLost && (
              <div className="callout callout-inferred" role="alert" style={{ flexDirection: 'column', gap: 'var(--s-3)' }}>
                <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
                  <AlertTriangle size={17} aria-hidden="true" />
                  <div>
                    <div className="callout-title">Lost track of this job</div>
                    <div>
                      Open Eye stopped answering status checks. The job may still be running on the server.
                    </div>
                  </div>
                </div>
                <div className="row wrap gap-2" style={{ justifyContent: 'flex-end', width: '100%' }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={handleDismiss}>
                    Continue in background
                  </button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={retryPolling}>
                    <RotateCw size={13} aria-hidden="true" />
                    <span>Check again</span>
                  </button>
                </div>
              </div>
            )}

            {isIngesting && !pollLost && (
              <div className="card card-ink stack gap-4" style={{ padding: 'var(--s-4)' }}>
                <div className="row between gap-3" style={{ alignItems: 'flex-start' }}>
                  <div className="grow">
                    <div className="row wrap gap-2">
                      <span style={{ fontWeight: 700, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-md)' }}>
                        Indexing
                      </span>
                      <span className="badge badge-outline" style={{ color: 'var(--ink)' }}>
                        {getTypeIcon(activeResourceType)}
                        <span>{getTypeLabel(activeResourceType)}</span>
                      </span>
                    </div>
                    <div className="mono xsmall muted truncate" style={{ marginTop: 'var(--s-1)' }}>
                      {activeCanonicalUrl}
                    </div>
                  </div>

                  <div className="row gap-2" style={{ flexShrink: 0 }}>
                    <span className="badge badge-neutral">
                      <span className="dot dot-pulse" aria-hidden="true" />
                      <span>Working</span>
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm danger" onClick={handleCancelJob}>
                      <Ban size={12} aria-hidden="true" />
                      <span>Cancel</span>
                    </button>
                  </div>
                </div>

                {/* Progress */}
                <div className="stack gap-2">
                  <div className="row between gap-3" style={{ alignItems: 'baseline' }}>
                    <span className="small" style={{ fontWeight: 500 }} role="status">
                      {getStageDescription(ingestionStatus?.jobStep, ingestionStatus?.status, activeResourceType)}
                    </span>
                    <span className="num" style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }} aria-hidden="true">
                      {Math.round(displayProgress)}%
                    </span>
                  </div>
                  <div
                    className="progress"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(displayProgress)}
                    aria-label="Indexing progress"
                  >
                    <div className="progress-fill" style={{ width: `${Math.max(4, Math.round(displayProgress))}%` }} />
                  </div>
                </div>

                {/* Stage checklist */}
                <div className="steps">
                  {renderStep(true, false, 'Source detected and validated')}
                  {renderStep(
                    isFetchingDone,
                    isFetchingActive,
                    activeResourceType === 'github_repository' ? 'Repository and dependencies fetched' : 'Content fetched'
                  )}
                  {renderStep(
                    isAnalyzingDone,
                    isAnalyzingActive,
                    activeResourceType === 'github_repository' ? 'Code parsed, capabilities extracted' : 'Content analyzed and structured'
                  )}
                  {renderStep(isIndexingDone, isIndexingActive, 'Search index built')}
                </div>
              </div>
            )}

            {/* Cancelled */}
            {isCancelled && !isIngesting && (
              <div className="callout callout-info" role="status" style={{ flexDirection: 'column', gap: 'var(--s-2)' }}>
                <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
                  <Ban size={16} aria-hidden="true" />
                  <div>
                    <div className="callout-title">Indexing cancelled</div>
                    <div>Nothing was added. You can start again whenever you like.</div>
                  </div>
                </div>
                <div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleSubmit(undefined, true)}>
                    <RotateCw size={13} aria-hidden="true" />
                    <span>Start again</span>
                  </button>
                </div>
              </div>
            )}

            {/* Failure */}
            {isFailed && (
              <div className="callout callout-danger" role="alert" style={{ flexDirection: 'column', gap: 'var(--s-2)' }}>
                <div className="row gap-2" style={{ alignItems: 'flex-start' }}>
                  <AlertCircle size={17} aria-hidden="true" />
                  <div className="stack gap-1">
                    <div className="callout-title">
                      {ingestionStatus?.errorDetails?.title || 'Couldn’t read this source'}
                    </div>
                    <div>
                      <strong>Why:</strong> {ingestionStatus?.errorDetails?.reason || ingestionStatus?.errorMessage || 'Something went wrong while fetching it.'}
                    </div>
                    {ingestionStatus?.errorDetails?.action && (
                      <div>
                        <strong>Try:</strong> {ingestionStatus.errorDetails.action}
                      </div>
                    )}
                  </div>
                </div>

                {ingestionStatus?.errorDetails?.isRetryable && (
                  <div className="row" style={{ justifyContent: 'flex-end', width: '100%' }}>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleSubmit(undefined, true)}
                    >
                      <RotateCw size={13} aria-hidden="true" />
                      <span>Retry</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Examples */}
            {!isIngesting && !isFailed && !preview && (
              <div>
                <span className="label" style={{ marginBottom: 'var(--s-2)' }}>
                  Or try an example
                </span>
                <div className="row wrap gap-1">
                  {quickPicks.map((pick) => (
                    <button
                      key={pick.label}
                      type="button"
                      className="tag tag-mono"
                      onClick={() => {
                        setUrl(pick.url);
                        fetchPreview(pick.url);
                      }}
                    >
                      {pick.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Advanced */}
            {!isIngesting && !isFailed && (
              <div>
                <button
                  type="button"
                  className="link-quiet xsmall"
                  aria-expanded={showAdvanced}
                  onClick={() => setShowAdvanced(!showAdvanced)}
                >
                  <span>Advanced</span>
                  {showAdvanced ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
                </button>

                {showAdvanced && (
                  <div className="card card-sunk" style={{ marginTop: 'var(--s-2)', padding: 'var(--s-3)' }}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={forceReindex}
                        onChange={(e) => setForceReindex(e.target.checked)}
                      />
                      <span>Force reindex: skip the cache and fetch everything again</span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="modal-actions">
              {pollingActive ? (
                <button type="button" className="btn btn-secondary" onClick={handleDismiss}>
                  Continue in background
                </button>
              ) : (
                <button type="button" className="btn btn-ghost" onClick={onClose} disabled={isSubmitting}>
                  Cancel
                </button>
              )}
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isIngesting || !url.trim() || Boolean(previewError)}
              >
                {isIngesting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    <span>Adding <span className="num">{Math.round(displayProgress)}%</span></span>
                  </>
                ) : (
                  <>
                    <span>Add to library</span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </>
                )}
              </button>
            </div>
          </form>
        )}

        {/* Ready */}
        {isReady && ingestionStatus && (
          <div className="stack gap-4">
            {isPartial ? (
              <div className="callout callout-inferred" role="status">
                <AlertTriangle size={17} aria-hidden="true" />
                <div>
                  <div className="callout-title">Indexed with gaps. You can ask about it now.</div>
                  <div>Some files could not be analyzed, so answers may miss parts of the code.</div>
                </div>
              </div>
            ) : (
              <div className="callout callout-verified" role="status">
                <CheckCircle2 size={17} aria-hidden="true" />
                <div className="callout-title">Ready. You can ask about it now.</div>
              </div>
            )}

            <div className="card card-sunk" style={{ padding: 'var(--s-4)' }}>
              <div className="res-title" style={{ fontSize: 'var(--fs-lg)' }}>
                {ingestionStatus.title}
              </div>
              <div className="mono xsmall muted" style={{ marginTop: 'var(--s-1)' }}>
                {getTypeLabel(ingestionStatus.resourceType)} · <span className="num">{ingestionStatus.capabilitiesCount}</span> {ingestionStatus.capabilitiesCount === 1 ? 'capability' : 'capabilities'} found
              </div>

              {ingestionStatus.problemsSolved && ingestionStatus.problemsSolved.length > 0 && (
                <div style={{ marginTop: 'var(--s-3)' }}>
                  <span className="label">Solves</span>
                  <ul className="small" style={{ marginTop: 'var(--s-1)' }}>
                    {ingestionStatus.problemsSolved.slice(0, 3).map((prob, i) => (
                      <li key={i}>{prob}</li>
                    ))}
                  </ul>
                </div>
              )}

              {ingestionStatus.usefulFor && ingestionStatus.usefulFor.length > 0 && (
                <div style={{ marginTop: 'var(--s-3)' }}>
                  <span className="label">Useful for</span>
                  <div className="row wrap gap-1" style={{ marginTop: 'var(--s-1)' }}>
                    {ingestionStatus.usefulFor.slice(0, 4).map((tag, i) => (
                      <span key={i} className="tag">{tag}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Done
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  onClose();
                  router.push(
                    readyRepositoryId
                      ? `/repositories/${encodeURIComponent(readyRepositoryId)}`
                      : `/resources?id=${encodeURIComponent(ingestionStatus.id)}`
                  );
                }}
              >
                <span>{readyRepositoryId ? 'Open repository' : 'Open in library'}</span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onClose();
                  router.push(askHref(repoSeedPrompt(readyName)));
                }}
              >
                <MessageSquare size={15} aria-hidden="true" />
                <span className="truncate" style={{ maxWidth: '22ch' }}>Ask about {readyName}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
