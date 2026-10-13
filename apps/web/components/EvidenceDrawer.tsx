'use client';

import React from 'react';
import { X, CheckCircle2, Copy, Check, ArrowUpRight, AlertTriangle } from 'lucide-react';
import { ResourceLocatorType, ResourceType } from '@repo/shared';
import { SourceIcon } from '@/components/Primitives';

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

  const quoteLines = (evidence.quote || '').split('\n');
  const resourceType = evidence.resourceType || (evidence.repo ? 'github_repository' : undefined);

  const locatorEntries: Array<{ label: string; value: string }> = [];
  if (evidence.locator?.timestampLabel) locatorEntries.push({ label: 'Timestamp', value: String(evidence.locator.timestampLabel) });
  if (evidence.locator?.pageNumber) locatorEntries.push({ label: 'Page', value: String(evidence.locator.pageNumber) });
  if (evidence.locator?.sectionHeading) locatorEntries.push({ label: 'Section', value: String(evidence.locator.sectionHeading) });
  if (evidence.lines) locatorEntries.push({ label: 'Lines', value: evidence.lines });
  if (evidence.symbolName) locatorEntries.push({ label: 'Symbol', value: evidence.symbolName });

  return (
    <div className="overlay" style={{ zIndex: 100 }} onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        style={{ maxWidth: 780, padding: 0, display: 'flex', flexDirection: 'column', maxHeight: '90vh', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: 'var(--s-5) var(--s-5) var(--s-4)', borderBottom: 'var(--bw) solid var(--ink)' }}>
          <div className="row between gap-3" style={{ alignItems: 'flex-start' }}>
            <div className="stack gap-2" style={{ minWidth: 0 }}>
              <span className="res-type">
                <SourceIcon type={resourceType} size={13} />
                <span>Evidence</span>
              </span>
              <h2 id="evidence-title" className="display" style={{ fontSize: 'var(--fs-xl)', overflowWrap: 'anywhere' }}>
                {evidence.resourceTitle || evidence.repo || 'Source evidence'}
              </h2>
              <span className="mono small muted" style={{ overflowWrap: 'anywhere' }}>
                {evidence.formattedCitation || evidence.filePath || 'Source excerpt'}
              </span>
            </div>

            <button type="button" className="btn btn-secondary btn-icon" onClick={onClose} aria-label="Close evidence">
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div style={{ marginTop: 'var(--s-3)' }}>
            {evidence.verified ? (
              <span className="badge badge-verified">
                <CheckCircle2 size={12} aria-hidden="true" />
                <span>Verified Fact</span>
              </span>
            ) : (
              <span className="badge badge-inferred">
                <AlertTriangle size={12} aria-hidden="true" />
                <span>Inferred (not verified)</span>
              </span>
            )}
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: 'var(--s-5)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 'var(--s-4)' }}>
          {locatorEntries.length > 0 && (
            <dl className="meta-row" style={{ gap: 'var(--s-2) var(--s-6)' }}>
              {locatorEntries.map((entry) => (
                <div key={entry.label} className="row gap-2">
                  <dt className="faint">{entry.label}</dt>
                  <dd style={{ color: 'var(--ink)', fontWeight: 600 }}>{entry.value}</dd>
                </div>
              ))}
            </dl>
          )}

          <div className="quote-well" style={{ whiteSpace: 'pre-wrap' }}>
            {quoteLines.map((line, idx) => (
              <div key={idx} className="quote-line">
                <span className="ln">{idx + 1}</span>
                <span style={{ minWidth: 0 }}>{line}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="row between gap-3" style={{ padding: 'var(--s-3) var(--s-5)', borderTop: 'var(--bw) solid var(--line)' }}>
          {evidence.sourceUrl ? (
            <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="link-quiet">
              <span>Open original source</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          ) : (
            <span />
          )}

          <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopy}>
            {copied ? <Check size={14} aria-hidden="true" style={{ color: 'var(--verified)' }} /> : <Copy size={14} aria-hidden="true" />}
            <span>{copied ? 'Copied' : 'Copy excerpt'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
