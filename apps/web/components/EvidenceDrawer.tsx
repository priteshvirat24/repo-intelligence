'use client';

import React from 'react';
import { X, CheckCircle2, FileCode, Copy, Check } from 'lucide-react';

export interface EvidenceItem {
  repo: string;
  filePath: string;
  lines?: string;
  quote: string;
  symbolName?: string;
  verified: boolean;
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

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.65)',
      backdropFilter: 'blur(6px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
      padding: 20
    }} onClick={onClose}>
      <div style={{
        width: '100%',
        maxWidth: 680,
        background: '#090d16',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.7)',
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
          background: 'rgba(15, 23, 42, 0.6)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <FileCode size={18} color="var(--accent-cyan)" />
            <div>
              <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                Verified Source Evidence
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {evidence.repo}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
              Verified by AST & Source
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

        {/* Content */}
        <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* File location */}
          <div style={{
            background: 'rgba(15, 23, 42, 0.5)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
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
                  borderRadius: 4
                }}>
                  {evidence.lines}
                </span>
              )}
            </div>

            {evidence.symbolName && (
              <span style={{
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono)'
              }}>
                Symbol: <strong>{evidence.symbolName}</strong>
              </span>
            )}
          </div>

          {/* Snippet */}
          <div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: 8
            }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Extracted Code Snippet:
              </span>
              <button
                onClick={handleCopy}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: '0.75rem',
                  color: copied ? '#34d399' : 'var(--text-muted)',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            <pre style={{
              background: '#040711',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              padding: 16,
              fontSize: '0.85rem',
              color: '#f1f5f9',
              maxHeight: 280,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}>
              {evidence.quote}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
