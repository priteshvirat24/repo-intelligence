'use client';

import React from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle, RotateCw } from 'lucide-react';
import { getStepLabel, getStepProgress } from '@/lib/ui/status';
import type { ActionNotice } from '@/lib/ui/actions';

/** Step label + thin progress bar for a resource that is still indexing. */
export const IndexingProgress: React.FC<{
  status?: string | null;
  step?: string | null;
  resourceType?: string | null;
  progress?: number;
  compact?: boolean;
}> = ({ status, step, resourceType, progress, compact }) => {
  const label = getStepLabel(step, status, resourceType);
  const value = Math.round(typeof progress === 'number' && progress > 0 ? progress : getStepProgress(step, status));
  return (
    <div className={`indexing${compact ? ' is-compact' : ''}`}>
      <div className="indexing-label">
        <span className="dot dot-pulse" aria-hidden="true" />
        <span>{label}&hellip;</span>
        <span className="num faint">{value}%</span>
      </div>
      <div
        className="progress progress-sm"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        aria-valuetext={`${label}, about ${value}%`}
        aria-label="Indexing progress"
      >
        <div className="progress-fill" style={{ width: `${Math.max(4, value)}%` }} />
      </div>
    </div>
  );
};

/** Inline outcome of an action. Errors are announced assertively, everything else politely. */
export const ActionCallout: React.FC<{
  notice: ActionNotice;
  onForce?: () => void;
  onDismiss?: () => void;
  busy?: boolean;
  style?: React.CSSProperties;
}> = ({ notice, onForce, onDismiss, busy, style }) => {
  const Icon = notice.tone === 'danger' ? AlertCircle : notice.tone === 'verified' ? CheckCircle2 : notice.tone === 'inferred' ? AlertTriangle : Info;
  return (
    <div
      className={`callout callout-${notice.tone}`}
      role={notice.tone === 'danger' ? 'alert' : 'status'}
      style={style}
    >
      <Icon size={16} aria-hidden="true" />
      <div className="grow stack gap-1">
        <div className="callout-title">{notice.title}</div>
        {notice.message && <div>{notice.message}</div>}
        {(notice.canForce && onForce) || onDismiss ? (
          <div className="row wrap gap-2" style={{ marginTop: 'var(--s-1)' }}>
            {notice.canForce && onForce && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={onForce} disabled={busy}>
                <RotateCw size={13} aria-hidden="true" />
                <span>Force re-index</span>
              </button>
            )}
            {onDismiss && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss}>
                Dismiss
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};

/** "Couldn't load …" with a Retry button; distinct from an empty state. */
export const LoadError: React.FC<{ what: string; onRetry: () => void; detail?: string }> = ({ what, onRetry, detail }) => (
  <div className="callout callout-danger" role="alert">
    <AlertCircle size={16} aria-hidden="true" />
    <div className="grow stack gap-2">
      <div>
        <div className="callout-title">Couldn&apos;t load {what}.</div>
        <div>{detail || 'The server did not respond as expected. Your data is not affected.'}</div>
      </div>
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          <RotateCw size={13} aria-hidden="true" />
          <span>Retry</span>
        </button>
      </div>
    </div>
  </div>
);
