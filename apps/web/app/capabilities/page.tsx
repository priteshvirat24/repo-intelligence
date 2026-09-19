'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Layers,
  Search,
  ArrowLeft,
  ArrowUpRight,
  Sparkles,
  Database,
  Tag,
  Filter
} from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { AddRepositoryModal } from '@/components/AddRepositoryModal';

interface CapabilityItem {
  name: string;
  category: string;
  description: string;
  repoCount: number;
  repositories: Array<{ id: string; owner: string; name: string }>;
}

export default function CapabilityExplorerPage() {
  const [capabilities, setCapabilities] = useState<CapabilityItem[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [isLoading, setIsLoading] = useState(true);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/capabilities');
        if (res.ok) {
          const data = await res.json();
          setCapabilities(data.capabilities || []);
        }
      } catch (err) {
        console.error('Error fetching capabilities:', err);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  const categories = ['ALL', ...Array.from(new Set(capabilities.map(c => c.category).filter(Boolean)))];

  const filtered = capabilities.filter(c => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.category?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === 'ALL' || c.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar onOpenAddModal={() => setIsAddModalOpen(true)} repoCount={0} />

      <main style={{
        maxWidth: 1400,
        margin: '0 auto',
        width: '100%',
        padding: '36px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 28
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Link href="/" style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.85rem' }}>
                <ArrowLeft size={14} />
                Back to Studio
              </Link>
            </div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Layers size={26} color="var(--accent-cyan)" />
              Open-World Capability Explorer
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: 680, marginTop: 6 }}>
              Dynamic technical and domain capabilities uncovered by our LLM understanding engine across all indexed repositories. Not constrained by fixed taxonomies.
            </p>
          </div>

          <div style={{
            padding: '10px 18px',
            borderRadius: 10,
            background: 'rgba(99, 102, 241, 0.1)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            textAlign: 'right'
          }}>
            <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#a5b4fc' }}>
              {capabilities.length}
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
              Unique Capabilities Discovered
            </div>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ position: 'relative', width: '100%' }}>
            <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              placeholder="Search capabilities (e.g. 'orbital propagation', 'crawling', '3d globe', 'kalman')..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '14px 18px 14px 44px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(15, 23, 42, 0.65)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-primary)',
                fontSize: '0.925rem',
                outline: 'none'
              }}
            />
          </div>

          {/* Category Filter Pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                style={{
                  padding: '6px 14px',
                  borderRadius: 20,
                  fontSize: '0.775rem',
                  fontWeight: selectedCategory === cat ? 600 : 400,
                  background: selectedCategory === cat ? 'rgba(6, 182, 212, 0.2)' : 'rgba(30, 41, 59, 0.4)',
                  color: selectedCategory === cat ? '#22d3ee' : 'var(--text-secondary)',
                  border: `1px solid ${selectedCategory === cat ? 'rgba(6, 182, 212, 0.4)' : 'var(--border-subtle)'}`,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Capabilities Grid */}
        {isLoading ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
            Loading discovered capabilities...
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-panel" style={{ textAlign: 'center', padding: '60px 20px' }}>
            <Layers size={36} color="var(--accent-indigo)" style={{ margin: '0 auto 12px' }} />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 6 }}>No Capabilities Found</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              No capabilities match your search or filter. Try adding more repositories to index.
            </p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
            gap: 20
          }}>
            {filtered.map((cap, i) => (
              <div
                key={i}
                className="glass-panel"
                style={{
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  gap: 16
                }}
              >
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {cap.name}
                    </h3>
                    <span style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: 'rgba(99, 102, 241, 0.15)',
                      color: '#a5b4fc',
                      border: '1px solid rgba(99, 102, 241, 0.3)',
                      fontFamily: 'var(--font-mono)'
                    }}>
                      {cap.repoCount} {cap.repoCount === 1 ? 'repo' : 'repos'}
                    </span>
                  </div>

                  <span style={{
                    fontSize: '0.675rem',
                    padding: '2px 6px',
                    borderRadius: 4,
                    background: 'rgba(6, 182, 212, 0.1)',
                    color: '#67e8f9',
                    display: 'inline-block',
                    marginBottom: 10
                  }}>
                    {cap.category}
                  </span>

                  <p style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    {cap.description || 'Discovered implementation capability.'}
                  </p>
                </div>

                {/* Implementing Repositories List */}
                <div style={{
                  paddingTop: 12,
                  borderTop: '1px solid var(--border-subtle)'
                }}>
                  <div style={{ fontSize: '0.725rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                    Implemented in:
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {cap.repositories && cap.repositories.map(repo => (
                      <Link
                        key={repo.id}
                        href={`/repositories/${repo.id}`}
                        style={{
                          fontSize: '0.725rem',
                          padding: '3px 8px',
                          borderRadius: 4,
                          background: 'rgba(30, 41, 59, 0.6)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-subtle)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4
                        }}
                      >
                        <span>{repo.owner}/{repo.name}</span>
                        <ArrowUpRight size={10} color="var(--accent-cyan)" />
                      </Link>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      <AddRepositoryModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onRepositoryAdded={() => {
          fetch('/api/capabilities')
            .then(res => res.json())
            .then(data => setCapabilities(data.capabilities || []));
        }}
      />
    </div>
  );
}
