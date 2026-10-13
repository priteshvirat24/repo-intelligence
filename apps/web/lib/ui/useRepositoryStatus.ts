'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminalStatus } from './status';

export interface RepositoryStatusData {
  repositoryId: string;
  repositoryStatus: string;
  jobStatus?: string;
  step?: string;
  progress?: number;
  error?: string | null;
}

/**
 * Polls /api/repositories/{id}/status while `active`, 3s backing off to 10s, and calls
 * `onTerminal` once the repository reaches a final status.
 */
export function useRepositoryStatus(
  id: string,
  active: boolean,
  onTerminal?: (data: RepositoryStatusData) => void
) {
  const [data, setData] = useState<RepositoryStatusData | null>(null);
  const [lost, setLost] = useState(false);
  const [nonce, setNonce] = useState(0);
  const onTerminalRef = useRef(onTerminal);
  onTerminalRef.current = onTerminal;

  useEffect(() => {
    if (!active || !id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 3000;
    let failures = 0;
    setLost(false);

    const tick = async () => {
      try {
        const res = await fetch(`/api/repositories/${encodeURIComponent(id)}/status`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const next = (await res.json()) as RepositoryStatusData;
        if (cancelled) return;
        failures = 0;
        setData(next);
        if (isTerminalStatus(next.repositoryStatus)) {
          onTerminalRef.current?.(next);
          return;
        }
      } catch {
        if (cancelled) return;
        failures += 1;
        if (failures >= 5) {
          setLost(true);
          return;
        }
      }
      delay = Math.min(10000, Math.round(delay * 1.5));
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, 0);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [id, active, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);

  return { data, lost, retry };
}
