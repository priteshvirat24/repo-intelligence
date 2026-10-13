'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { EyeMark } from '@/components/Primitives';
import { useLibrary } from '@/components/LibraryProvider';

const NAV_ITEMS = [
  { href: '/', label: 'Studio' },
  { href: '/resources', label: 'Library' },
  { href: '/capabilities', label: 'Capabilities' }
];

export const Navbar: React.FC = () => {
  const pathname = usePathname() || '/';
  const { openAddRepository, readyRepoCount, backgroundJobs } = useLibrary();

  const isActive = (href: string) =>
    href === '/'
      ? pathname === '/'
      : pathname === href || pathname.startsWith(`${href}/`) || (href === '/resources' && pathname.startsWith('/repositories/'));

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link href="/" className="wordmark" aria-label="Open Eye, go to Studio">
          <EyeMark />
          <span>Open Eye</span>
        </Link>

        <nav className="nav-links" aria-label="Primary">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="nav-link"
              aria-current={isActive(item.href) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="nav-actions">
          {backgroundJobs.length > 0 && (
            <Link href="/resources" className="nav-indexing" title="Indexing continues in the background">
              <span className="dot dot-pulse" aria-hidden="true" />
              <span>Indexing <span className="num">{backgroundJobs.length}</span></span>
            </Link>
          )}
          {readyRepoCount !== null && (
            <span className="nav-meta">
              {readyRepoCount} {readyRepoCount === 1 ? 'repository' : 'repositories'} ready
            </span>
          )}
          <button type="button" onClick={openAddRepository} className="btn btn-primary btn-sm">
            <Plus size={15} strokeWidth={2.5} aria-hidden="true" />
            <span>Add repository</span>
          </button>
        </div>
      </div>
    </header>
  );
};
