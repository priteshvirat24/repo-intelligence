'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminalStatus } from './status';

export interface ResourceStatusData {
  id: string;
  title?: string;
  resourceType?: string;
  sourceUrl?: string;
  status: string;
  jobStatus?: string | null;
  jobStep?: string | null;
  errorMessage?: string | null;
  errorDetails?: {
    title: string;
    reason: string;
    action: string;
    isRetryable: boolean;
    status?: 'BLOCKED' | 'FAILED';
  } | null;
  problemsSolved?: string[];
  practicalUses?: string[];
  usefulFor?: string[];
  valueProposition?: string;
  capabilitiesCount?: number;
  repositoryId?: string | null;
}

interface Options {
  /** Called once per resource when it reaches a terminal status. */
  onTerminal?: (data: ResourceStatusData) => void;
  /** Called after every successful poll. */
  onUpdate?: (data: ResourceStatusData) => void;
  initialDelay?: number;
  maxDelay?: number;
  /** Consecutive failed requests before a resource is reported as lost. */
  maxFailures?: number;
  /** Poll right away instead of waiting for the first interval. */
  immediate?: boolean;
}

/**
 * Polls /api/resources/{id}/status for each non-terminal resource: every `initialDelay` ms (3s),
 * backing off by 1.5x to `maxDelay` (10s), and stopping for each resource once it is terminal.
 */
export function useIndexingStatus(ids: string[], options: Options = {}) {
  const { initialDelay = 3000, maxDelay = 10000, maxFailures = 5, immediate = true } = options;
  const [statuses, setStatuses] = useState<Record<string, ResourceStatusData>>({});
  const [lost, setLost] = useState<Record<string, boolean>>({});
  const [nonce, setNonce] = useState(0);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const key = Array.from(new Set(ids.filter(Boolean))).sort().join(',');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set(key.split(','));
    const failures: Record<string, number> = {};
    let delay = initialDelay;

    // A resource that is being watched again (e.g. re-indexed) must not show its old final state.
    setStatuses((prev) => {
      let changed = false;
      const next = { ...prev };
      pending.forEach((id) => {
        if (next[id] && isTerminalStatus(next[id].status)) {
          delete next[id];
          changed = true;
        }
      });
      return changed ? next : prev;
    });

    const pollOne = async (id: string) => {
      try {
        const res = await fetch(`/api/resources/${encodeURIComponent(id)}/status`, { cache: 'no-store' });
        if (res.status === 404) {
          // Removed while we were watching it: nothing left to poll.
          pending.delete(id);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ResourceStatusData;
        if (cancelled) return;
        failures[id] = 0;
        setStatuses((prev) => ({ ...prev, [id]: data }));
        optionsRef.current.onUpdate?.(data);
        if (isTerminalStatus(data.status)) {
          pending.delete(id);
          optionsRef.current.onTerminal?.(data);
        }
      } catch {
        if (cancelled) return;
        failures[id] = (failures[id] || 0) + 1;
        if (failures[id] >= maxFailures) {
          pending.delete(id);
          setLost((prev) => ({ ...prev, [id]: true }));
        }
      }
    };

    const tick = async () => {
      await Promise.all(Array.from(pending).map(pollOne));
      if (cancelled || pending.size === 0) return;
      delay = Math.min(maxDelay, Math.round(delay * 1.5));
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, immediate ? 0 : initialDelay);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, initialDelay, maxDelay, maxFailures, immediate]);

  /** Start polling again after resources were reported lost. */
  const retry = useCallback(() => {
    setLost({});
    setNonce((n) => n + 1);
  }, []);

  return { statuses, lost, retry };
}
