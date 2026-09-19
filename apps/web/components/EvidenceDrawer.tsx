'use client';

import React from 'react';
import { X, CheckCircle2, FileCode, Copy, Check, ShieldCheck, Layers } from 'lucide-react';

export interface EvidenceItem {
  repo: string;
  filePath: string;
  lines?: string;
  quote: string;
  symbolName?: string;
  verified: boolean;
  evidenceStrength?: string;
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

  // Determine starting line from evidence.lines (e.g. "L12-L34" or "12")
  let startLineNum = 1;
  if (evidence.lines) {
    const match = evidence.lines.match(/(\d+)/);
    if (match) {
      startLineNum = parseInt(match[1], 10);
    }
  }

  const quoteLines = (evidence.quote || '').split('\n');

  // Strength badge styling
  const strength = evidence.evidenceStrength || 'DIRECT_IMPLEMENTATION';
  const strengthMeta: Record<string, { label: string; bg: string; color: string; border: string }> = {
    DIRECT_IMPLEMENTATION: {
      label: 'Direct Implementation',
      bg: 'rgba(139, 92, 246, 0.15)',
      color: '#a78bfa',
      border: 'rgba(139, 92, 246, 0.3)'
    },
    DIRECT_INTERFACE: {
      label: 'Direct Interface',
      bg: 'rgba(56, 189, 248, 0.15)',
      color: '#38bdf8',
      border: 'rgba(56, 189, 248, 0.3)'
    },
    DOCUMENTATION: {
      label: 'Documentation',
      bg: 'rgba(245, 158, 11, 0.15)',
      color: '#fbbf24',
      border: 'rgba(245, 158, 11, 0.3)'
    },
    EXAMPLE: {
      label: 'Example Code',
      bg: 'rgba(20, 184, 166, 0.15)',
      color: '#2dd4bf',
      border: 'rgba(20, 184, 166, 0.3)'
    },
    INFERRED: {
      label: 'Inferred',
      bg: 'rgba(100, 116, 139, 0.15)',
      color: '#94a3b8',
      border: 'rgba(100, 116, 139, 0.3)'
    }
  };

  const badge = strengthMeta[strength] || strengthMeta.DIRECT_IMPLEMENTATION;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
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
        maxWidth: 760,
        background: '#090d16',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8)',
        overflow: 'hidden',
        animation: 'fadeIn 0.2s ease'
      }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: 'rgba(15, 23, 42, 0.7)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileCode size={20} color="var(--accent-cyan)" />
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Verified Source Evidence
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {evidence.repo}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Strength Badge */}
            <span style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: '0.725rem',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 6,
              background: badge.bg,
              color: badge.color,
              border: `1px solid ${badge.border}`
            }}>
              <Layers size={12} />
              {badge.label}
            </span>

            {/* Verified Badge */}
            <span style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              fontSize: '0.725rem',
              fontWeight: 600,
              padding: '4px 10px',
              borderRadius: 6,
              background: 'rgba(16, 185, 129, 0.12)',
              color: '#34d399',
              border: '1px solid rgba(16, 185, 129, 0.25)'
            }}>
              <CheckCircle2 size={13} />
              AST Verified
            </span>

            <button
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: 4,
                borderRadius: 4
              }}
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* File location bar */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.5)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem' }}>
              <span style={{ color: 'var(--text-muted)' }}>File:</span>
              <span style={{ color: 'var(--accent-cyan)', fontFamily: 'var(--font-mono)' }}>
                {evidence.filePath}
              </span>
              {evidence.lines && (
                <span style={{
                  color: 'var(--accent-amber)',
                  fontFamily: 'var(--font-mono)',
                  background: 'rgba(245, 158, 11, 0.1)',
                  padding: '2px 6px',
                  borderRadius: 4,
                  fontSize: '0.75rem'
                }}>
                  {evidence.lines}
                </span>
              )}
            </div>

            {evidence.symbolName && (
              <span style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)',
                background: 'rgba(255, 255, 255, 0.05)',
                padding: '2px 8px',
                borderRadius: 4
              }}>
                Symbol: <strong style={{ color: 'var(--text-primary)' }}>{evidence.symbolName}</strong>
              </span>
            )}
          </div>

          {/* Code Snippet with Line Numbers */}
          <div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8
            }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShieldCheck size={14} color="#34d399" />
                Grounded Excerpt (Strict Non-Hallucinated Code):
              </span>
              <button
                onClick={handleCopy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.75rem',
                  color: copied ? '#34d399' : 'var(--text-muted)',
                  background: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid var(--border-subtle)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  cursor: 'pointer'
                }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied to Clipboard' : 'Copy Code'}
              </button>
            </div>

            <div style={{
              background: '#030712',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: 16,
              fontSize: '0.825rem',
              color: '#f1f5f9',
              maxHeight: 340,
              overflowY: 'auto',
              fontFamily: 'var(--font-mono)',
              lineHeight: 1.6
            }}>
              <div style={{ display: 'flex', gap: 14 }}>
                {/* Line number gutter */}
                <div style={{
                  userSelect: 'none',
                  color: '#475569',
                  textAlign: 'right',
                  paddingRight: 12,
                  borderRight: '1px solid rgba(255, 255, 255, 0.08)',
                  minWidth: 32
                }}>
                  {quoteLines.map((_, idx) => (
                    <div key={idx}>{startLineNum + idx}</div>
                  ))}
                </div>

                {/* Code body */}
                <div style={{ flex: 1, overflowX: 'auto', whiteSpace: 'pre', color: '#e2e8f0' }}>
                  {quoteLines.map((line, idx) => (
                    <div key={idx}>{line || ' '}</div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
