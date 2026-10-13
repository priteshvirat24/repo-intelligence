'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Plus } from 'lucide-react';
import { EyeMark } from '@/components/Primitives';

interface NavbarProps {
  onOpenAddModal: () => void;
  resourceCount?: number;
  repoCount?: number;
}

const NAV_ITEMS = [
  { href: '/', label: 'Studio' },
  { href: '/resources', label: 'Library' },
  { href: '/capabilities', label: 'Capabilities' }
];

export const Navbar: React.FC<NavbarProps> = ({ onOpenAddModal, resourceCount, repoCount }) => {
  const pathname = usePathname() || '/';
  // Only show a count when the page actually loaded one; never show a placeholder zero.
  const displayCount = resourceCount ?? (repoCount ? repoCount : undefined);

  const isActive = (href: string) =>
    href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

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
          {displayCount !== undefined && (
            <span className="nav-meta">
              {displayCount} indexed
            </span>
          )}
          <button type="button" onClick={onOpenAddModal} className="btn btn-primary btn-sm">
            <Plus size={15} strokeWidth={2.5} aria-hidden="true" />
            <span>Add repository</span>
          </button>
        </div>
      </div>
    </header>
  );
};
