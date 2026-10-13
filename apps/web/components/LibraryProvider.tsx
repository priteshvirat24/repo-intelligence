'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AddResourceModal } from '@/components/AddResourceModal';
import { useIndexingStatus } from '@/lib/ui/useIndexingStatus';

// App-wide library state. Owns the "Add repository" modal so every page (and the Navbar) can open
// it, keeps the Navbar's READY-repository count, and follows jobs the user sent to the background.

interface LibraryContextValue {
  openAddRepository: () => void;
  /** Increments whenever the library changed (added, re-indexed, removed, a job finished). */
  libraryVersion: number;
  notifyLibraryChanged: () => void;
  /** READY GitHub repositories; null while unknown. */
  readyRepoCount: number | null;
  /** Resource ids still indexing after the user chose "Continue in background". */
  backgroundJobs: string[];
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext);
  if (!ctx) {
    // Outside the provider (should not happen in the app): degrade to inert values.
    return {
      openAddRepository: () => {},
      libraryVersion: 0,
      notifyLibraryChanged: () => {},
      readyRepoCount: null,
      backgroundJobs: []
    };
  }
  return ctx;
}

export function LibraryProvider({ children }: { children: React.ReactNode }) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [libraryVersion, setLibraryVersion] = useState(0);
  const [readyRepoCount, setReadyRepoCount] = useState<number | null>(null);
  const [backgroundJobs, setBackgroundJobs] = useState<string[]>([]);

  const notifyLibraryChanged = useCallback(() => setLibraryVersion((v) => v + 1), []);
  const openAddRepository = useCallback(() => setIsAddOpen(true), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/resources?type=github_repository&status=READY', { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) setReadyRepoCount(Array.isArray(data.items) ? data.items.length : null);
      } catch {
        if (!cancelled) setReadyRepoCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [libraryVersion]);

  useIndexingStatus(backgroundJobs, {
    onTerminal: (data) => {
      setBackgroundJobs((prev) => prev.filter((id) => id !== data.id));
      notifyLibraryChanged();
    }
  });

  const trackBackgroundJob = useCallback((id: string) => {
    setBackgroundJobs((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setLibraryVersion((v) => v + 1);
  }, []);

  const value = useMemo<LibraryContextValue>(
    () => ({ openAddRepository, libraryVersion, notifyLibraryChanged, readyRepoCount, backgroundJobs }),
    [openAddRepository, libraryVersion, notifyLibraryChanged, readyRepoCount, backgroundJobs]
  );

  return (
    <LibraryContext.Provider value={value}>
      {children}
      <AddResourceModal
        isOpen={isAddOpen}
        onClose={() => setIsAddOpen(false)}
        onResourceAdded={notifyLibraryChanged}
        onContinueInBackground={trackBackgroundJob}
      />
    </LibraryContext.Provider>
  );
}
