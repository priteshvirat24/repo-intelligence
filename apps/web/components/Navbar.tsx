'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { EyeMark } from '@/components/Primitives';
import { useLibrary } from '@/components/LibraryProvider';

const NAV_ITEMS = [
  { href: '/', label: 'Studio' },
  { href: '/briefs', label: 'Briefs' },
  { href: '/resources', label: 'Library' },
  { href: '/capabilities', label: 'Capabilities' },
  { href: '/memory', label: 'Memory' },
  { href: '/evaluation', label: 'Evaluation' },
  { href: '/evolution', label: 'Evolution' }
];

export const Navbar: React.FC = () => {
  const pathname = usePathname() || '/';
  const { openAddRepository, readyRepoCount, backgroundJobs } = useLibrary();
  const [me, setMe] = useState<{ authConfigured: boolean; authenticated: boolean; user?: { name?: string } | null } | null>(null);

  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

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
          {me?.authConfigured && !me.authenticated && (
            <a href="/api/auth/signin" className="btn btn-secondary btn-sm">Sign in with GitHub</a>
          )}
          {me?.authenticated && (
            <span className="nav-meta">
              {me.user?.name || 'Signed in'} · <a href="/api/auth/signout" className="link-quiet">sign out</a>
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
