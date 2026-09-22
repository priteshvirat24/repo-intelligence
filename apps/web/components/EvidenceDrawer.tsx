'use client';

import React from 'react';
import { X, CheckCircle2, FileCode, Copy, Check, ShieldCheck, Youtube, FileText, Globe, GitBranch, ExternalLink } from 'lucide-react';
import { ResourceLocatorType, ResourceType } from '@repo/shared';

export interface EvidenceItem {
  repo?: string;
  resourceTitle?: string;
  resourceType?: ResourceType;
  sourceUrl?: string;
  filePath?: string;
  lines?: string;
  quote: string;
  symbolName?: string;
  verified: boolean;
  evidenceStrength?: string;
  locatorType?: ResourceLocatorType;
  locator?: Record<string, any>;
  formattedCitation?: string;
}

interface EvidenceDrawerProps {
  isOpen: boolean;
  evidence: EvidenceItem | null;
  onClose: () => void;
}

export const EvidenceDrawer: React.FC<EvidenceDrawerProps> = ({ isOpen, evidence, onClose }) => {
  const [copied, setCopied] = React.useState(false);

  if (!isOpen || !evidence) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(evidence.quote);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getSourceIcon = (type?: ResourceType) => {
    switch (type) {
      case 'youtube_video': return <Youtube size={18} color="#ef4444" />;
      case 'pdf':
      case 'research_paper': return <FileText size={18} color="#f59e0b" />;
      case 'github_repository': return <GitBranch size={18} color="var(--accent-indigo)" />;
      default: return <Globe size={18} color="var(--accent-cyan)" />;
    }
  };

  const quoteLines = (evidence.quote || '').split('\n');

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
      padding: 20
    }} onClick={onClose}>
      <div style={{
        width: '100%',
        maxWidth: 780,
        background: '#090d16',
        border: '1px solid var(--border-subtle)',
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
        display: 'flex',
        flexDirection: 'column',
        maxHeight: '90vh'
      }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '18px 24px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'rgba(15, 23, 42, 0.6)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {getSourceIcon(evidence.resourceType)}
            <div>
              <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                {evidence.resourceTitle || evidence.repo || 'Source Evidence'}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {evidence.formattedCitation || evidence.filePath || 'Verified Source Excerpt'}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: '0.75rem',
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 6,
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#10b981',
              border: '1px solid rgba(16, 185, 129, 0.3)'
            }}>
              <CheckCircle2 size={13} />
              <span>Verified Fact</span>
            </span>

            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 4
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content Box */}
        <div style={{ padding: 24, overflowY: 'auto' }}>
          {/* Locators Details */}
          {evidence.locator && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 12,
              marginBottom: 16,
              padding: '10px 14px',
              borderRadius: 8,
              background: 'rgba(15, 23, 42, 0.8)',
              border: '1px solid var(--border-subtle)',
              fontSize: '0.8rem'
            }}>
              {evidence.locator.timestampLabel && (
                <div><span style={{ color: 'var(--text-muted)' }}>Timestamp:</span> <strong style={{ color: '#ef4444' }}>{evidence.locator.timestampLabel}</strong></div>
              )}
              {evidence.locator.pageNumber && (
                <div><span style={{ color: 'var(--text-muted)' }}>Page:</span> <strong style={{ color: '#f59e0b' }}>Page {evidence.locator.pageNumber}</strong></div>
              )}
              {evidence.locator.sectionHeading && (
                <div><span style={{ color: 'var(--text-muted)' }}>Section:</span> <strong style={{ color: 'var(--accent-cyan)' }}>{evidence.locator.sectionHeading}</strong></div>
              )}
              {evidence.lines && (
                <div><span style={{ color: 'var(--text-muted)' }}>Lines:</span> <strong style={{ color: 'var(--accent-indigo)' }}>{evidence.lines}</strong></div>
              )}
            </div>
          )}

          {/* Quote Preview */}
          <div style={{
            background: '#040711',
            borderRadius: 8,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: 16,
            fontFamily: 'monospace',
            fontSize: '0.85rem',
            lineHeight: 1.6,
            color: '#e2e8f0',
            whiteSpace: 'pre-wrap',
            maxHeight: 380,
            overflowY: 'auto'
          }}>
            {quoteLines.map((line, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 12 }}>
                <span style={{ color: 'rgba(255, 255, 255, 0.25)', userSelect: 'none', width: 28, textAlign: 'right' }}>
                  {idx + 1}
                </span>
                <span>{line}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(15, 23, 42, 0.5)'
        }}>
          {evidence.sourceUrl ? (
            <a
              href={evidence.sourceUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: '0.85rem',
                color: 'var(--accent-cyan)',
                textDecoration: 'none'
              }}
            >
              <ExternalLink size={14} />
              <span>Open Original Source</span>
            </a>
          ) : (
            <div />
          )}

          <button
            onClick={handleCopy}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 6,
              background: 'rgba(30, 41, 59, 0.6)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-primary)',
              fontSize: '0.8rem',
              cursor: 'pointer'
            }}
          >
            {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
            <span>{copied ? 'Copied' : 'Copy Excerpt'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
