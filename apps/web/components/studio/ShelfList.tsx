'use client';

import React from 'react';
import Link from 'next/link';
import { SourceIcon, StatusBadge } from '@/components/Primitives';
import { IndexingProgress } from '@/components/IndexingState';
import { ResourceStatusData } from '@/lib/ui/useIndexingStatus';
import { isFailedStatus, isTerminalStatus } from '@/lib/ui/status';

export interface ShelfResource {
  id: string;
  title: string;
  resourceType: string;
  status: string;
  repositoryId?: string | null;
  sourceDomain?: string;
  sourceUrl?: string;
  problemsSolved?: string[];
  errorMessage?: string | null;
}

interface ShelfListProps {
  items: ShelfResource[];
  state: 'loading' | 'error' | 'ready';
  statuses: Record<string, ResourceStatusData>;
  onRetry: () => void;
  limit?: number;
}

export const ShelfList: React.FC<ShelfListProps> = ({ items, state, statuses, onRetry, limit = 12 }) => {
  if (state === 'loading' && items.length === 0) {
    return (
      <p className="loading-line" role="status" style={{ padding: 'var(--s-3) 0' }}>
        <span className="dot dot-pulse" aria-hidden="true" />
        Loading&hellip;
      </p>
    );
  }
  if (state === 'error' && items.length === 0) {
    return (
      <div className="shelf-note" role="alert">
        <p className="small">Couldn&apos;t load the library.</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>Retry</button>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <p className="small muted shelf-note">
        Nothing indexed yet. Add a GitHub repository to give Open Eye something to read.
      </p>
    );
  }

  return (
    <ul className="shelf-items">
      {items.slice(0, limit).map((r) => {
        const live = statuses[r.id];
        const status = live?.status || r.status;
        const indexing = !isTerminalStatus(status);
        const failed = isFailedStatus(status);
        const href = r.repositoryId ? `/repositories/${r.repositoryId}` : `/resources?id=${encodeURIComponent(r.id)}`;
        const sub = failed
          ? live?.errorDetails?.reason || live?.errorMessage || r.errorMessage || 'Indexing failed.'
          : r.problemsSolved?.[0] || r.sourceDomain;
        return (
          <li key={r.id}>
            <Link href={href} className="shelf-item">
              <span className="shelf-item-title">
                <SourceIcon type={r.resourceType} />
                <span className="truncate">{r.title}</span>
                {(indexing || failed || status === 'PARTIAL') && <StatusBadge status={status} className="shelf-badge" />}
              </span>
              {indexing ? (
                <IndexingProgress status={status} step={live?.jobStep} resourceType={r.resourceType} compact />
              ) : (
                sub && <span className={`shelf-item-sub clamp-2${failed ? ' is-danger' : ''}`}>{sub}</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
};
