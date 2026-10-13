'use client';

import React, { useRef } from 'react';
import { X, CheckCircle2, Copy, Check, ArrowUpRight, AlertTriangle } from 'lucide-react';
import { ResourceLocatorType, ResourceType } from '@repo/shared';
import { SourceIcon } from '@/components/Primitives';
import { useDialog } from '@/lib/ui/useDialog';
import { buildGithubBlobUrl, fileBaseName, lineRangeLabel } from '@/lib/ui/github';

export interface EvidenceItem {
  /** owner/repo */
  repo?: string;
  resourceTitle?: string;
  resourceType?: ResourceType;
  /** Direct link to the source (GitHub blob URL with #L anchors, or a web URL). */
  url?: string;
  sourceUrl?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  /** Legacy "L10-L20" label, used when startLine is unknown. */
  lines?: string;
  quote: string;
  symbolName?: string;
  verified: boolean;
  /** Used to build a GitHub link when no url is supplied. */
  commitHash?: string | null;
  defaultBranch?: string | null;
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

function parseLegacyLines(lines?: string): { start?: number; end?: number } {
  if (!lines) return {};
  const m = lines.match(/L?(\d+)(?:\s*[-–]\s*L?(\d+))?/);
  if (!m) return {};
  return { start: Number(m[1]), end: m[2] ? Number(m[2]) : undefined };
}

export const EvidenceDrawer: React.FC<EvidenceDrawerProps> = ({ isOpen, evidence, onClose }) => {
  const [copied, setCopied] = React.useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, onClose, isOpen && Boolean(evidence));

  if (!isOpen || !evidence) return null;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(evidence.quote);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const legacy = parseLegacyLines(evidence.lines);
  const startLine = evidence.startLine || evidence.locator?.startLine || legacy.start;
  const endLine = evidence.endLine || evidence.locator?.endLine || legacy.end;
  const filePath = evidence.filePath || evidence.locator?.filePath;
  const symbol = evidence.symbolName || evidence.locator?.symbolName;
  const lineLabel = lineRangeLabel(startLine, endLine) || evidence.lines;

  const githubUrl =
    (evidence.url && evidence.url.includes('github.com') ? evidence.url : null) ||
    buildGithubBlobUrl({
      repo: evidence.repo,
      path: filePath,
      ref: evidence.commitHash || evidence.defaultBranch,
      startLine,
      endLine
    });
  const otherUrl = !githubUrl ? evidence.url || evidence.sourceUrl : null;

  const firstLine = startLine && startLine > 0 ? startLine : 1;
  const quoteLines = (evidence.quote || '').replace(/\n$/, '').split('\n');
  const resourceType = evidence.resourceType || (evidence.repo ? 'github_repository' : undefined);

  const fields: Array<{ label: string; value: string; mono?: boolean }> = [];
  if (evidence.repo) fields.push({ label: 'Repository', value: evidence.repo, mono: true });
  if (filePath) fields.push({ label: 'Path', value: filePath, mono: true });
  if (lineLabel) fields.push({ label: 'Lines', value: lineLabel, mono: true });
  if (symbol) fields.push({ label: 'Symbol', value: symbol, mono: true });
  if (evidence.locator?.timestampLabel) fields.push({ label: 'Timestamp', value: String(evidence.locator.timestampLabel) });
  if (evidence.locator?.pageNumber) fields.push({ label: 'Page', value: String(evidence.locator.pageNumber) });
  if (evidence.locator?.sectionHeading) fields.push({ label: 'Section', value: String(evidence.locator.sectionHeading) });

  const title = filePath ? fileBaseName(filePath) : evidence.resourceTitle || evidence.repo || 'Source evidence';

  return (
    <div
      className="overlay"
      style={{ zIndex: 100 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        style={{ maxWidth: 780, padding: 0, display: 'flex', flexDirection: 'column', maxHeight: '90vh', overflow: 'hidden' }}
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
                {title}
              </h2>
            </div>

            <button type="button" className="btn btn-secondary btn-icon" onClick={onClose} aria-label="Close evidence">
              <X size={18} aria-hidden="true" />
            </button>
          </div>

          <div style={{ marginTop: 'var(--s-3)' }}>
            {evidence.verified ? (
              <span className="badge badge-verified">
                <CheckCircle2 size={12} aria-hidden="true" />
                <span>Verified</span>
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
          {fields.length > 0 && (
            <dl className="evidence-fields">
              {fields.map((f) => (
                <div key={f.label}>
                  <dt className="label">{f.label}</dt>
                  <dd className={f.mono ? 'mono' : undefined}>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}

          {!evidence.verified && (
            <p className="small muted">
              Open Eye could not match this excerpt to the exact lines in the source. Read it as a lead, not a fact.
            </p>
          )}

          <div className="quote-well" style={{ whiteSpace: 'pre-wrap' }} aria-label={lineLabel ? `Excerpt, ${lineLabel}` : 'Excerpt'}>
            {quoteLines.map((line, idx) => (
              <div key={idx} className="quote-line">
                <span className="ln" aria-hidden="true">{firstLine + idx}</span>
                <span style={{ minWidth: 0 }}>{line}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="row between wrap gap-3" style={{ padding: 'var(--s-3) var(--s-5)', borderTop: 'var(--bw) solid var(--line)' }}>
          {githubUrl ? (
            <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="link-quiet">
              <span>Open {filePath ? `${fileBaseName(filePath)}${startLine ? `:${startLine}` : ''}` : 'file'} on GitHub</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          ) : otherUrl ? (
            <a href={otherUrl} target="_blank" rel="noopener noreferrer" className="link-quiet">
              <span>Open original source</span>
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          ) : (
            <span />
          )}

          <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopy}>
            {copied ? <Check size={14} aria-hidden="true" style={{ color: 'var(--verified)' }} /> : <Copy size={14} aria-hidden="true" />}
            <span aria-live="polite">{copied ? 'Copied' : 'Copy excerpt'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
