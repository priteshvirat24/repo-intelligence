'use client';

import React from 'react';
import Link from 'next/link';
import { Layers, Plus, Database, Sparkles, BookOpen, Globe } from 'lucide-react';

interface NavbarProps {
  onOpenAddModal: () => void;
  resourceCount?: number;
  repoCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenAddModal, resourceCount, repoCount }) => {
  const displayCount = resourceCount ?? repoCount ?? 0;
  return (
    <header style={{
      borderBottom: '1px solid var(--border-subtle)',
      background: 'rgba(9, 13, 22, 0.85)',
      backdropFilter: 'blur(12px)',
      position: 'sticky',
      top: 0,
      zIndex: 40
    }}>
      <div style={{
        maxWidth: 1400,
        margin: '0 auto',
        padding: '0 24px',
        height: 64,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 32 }}>
          <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
            <div style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 15px rgba(99, 102, 241, 0.4)'
            }}>
              <span style={{ fontSize: '1.2rem' }}>👁️</span>
            </div>
            <div>
              <span style={{
                fontSize: '1.2rem',
                fontWeight: 800,
                background: 'linear-gradient(90deg, #ffffff 0%, #cbd5e1 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                letterSpacing: '-0.02em'
              }}>
                Open Eye
              </span>
              <span style={{
                fontSize: '0.65rem',
                fontWeight: 600,
                color: 'var(--accent-cyan)',
                marginLeft: 8,
                padding: '2px 6px',
                borderRadius: 4,
                background: 'rgba(6, 182, 212, 0.12)',
                border: '1px solid rgba(6, 182, 212, 0.25)',
                verticalAlign: 'middle'
              }}>
                Universal
              </span>
            </div>
          </Link>

          <nav style={{ display: 'flex', gap: 24, fontSize: '0.9rem', fontWeight: 500 }}>
            <Link href="/" style={{ color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}>
              <Sparkles size={16} color="var(--accent-indigo)" />
              Studio & Chat
            </Link>
            <Link href="/resources" style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.2s', textDecoration: 'none' }}>
              <Globe size={15} color="var(--accent-cyan)" />
              Resources
            </Link>
            <Link href="/capabilities" style={{ color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, transition: 'color 0.2s', textDecoration: 'none' }}>
              <Layers size={15} color="#a855f7" />
              Capabilities
            </Link>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
              <Database size={15} />
              <span>{displayCount} Resources Indexed</span>
            </div>
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={onOpenAddModal}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 8,
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              color: '#ffffff',
              fontSize: '0.875rem',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 2px 10px rgba(99, 102, 241, 0.3)',
              transition: 'all 0.2s'
            }}
          >
            <Plus size={16} />
            <span>Add Resource</span>
          </button>
        </div>
      </div>
    </header>
  );
};
