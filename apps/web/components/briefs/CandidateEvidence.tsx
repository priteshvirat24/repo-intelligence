'use client';

import React from 'react';
import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { BriefCandidate, CandidateClaim, CandidateSource } from '@repo/shared';

// Phase 2: where a candidate was found, and the registry, advisory, docs and forum evidence the docs task collected.

const SOURCE_LABEL: Record<CandidateSource, string> = { github: 'GitHub', npm: 'npm', crates: 'crates.io' };
const GRADE_HELP: Record<string, string> = {
  E3: 'Officially documented or reported by the platform',
  E4: 'Claimed by a forum post or article; not yet checked'
};

/** The sources that found the candidate; shown only when a package registry contributed. */
export const CandidateSources: React.FC<{ candidate: BriefCandidate }> = ({ candidate }) => {
  const sources = candidate.sources || ['github'];
  if (sources.length === 1 && sources[0] === 'github') return null;
  const packages = candidate.packages || [];
  return (
    <span className="row gap-1" aria-label="Found through">
      {sources.map((s) => {
        const pkg = packages.find((p) => (s === 'npm' && p.system === 'NPM') || (s === 'crates' && p.system === 'CARGO'));
        return (
          <span key={s} className="tag tag-mono" title={pkg ? `${pkg.name}${pkg.version ? `@${pkg.version}` : ''}` : `Found through ${SOURCE_LABEL[s] || s}`}>
            {SOURCE_LABEL[s] || s}
          </span>
        );
      })}
    </span>
  );
};

function ClaimLink({ claim, children }: { claim: CandidateClaim; children: React.ReactNode }) {
  if (!claim.sourceUrl) return <>{children}</>;
  return (
    <a href={claim.sourceUrl} target="_blank" rel="noopener noreferrer" className="link" style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      {children}
      <ArrowUpRight size={11} aria-hidden="true" />
    </a>
  );
}

/** Advisories, Scorecard, documented capabilities and forum questions, in one compact block. */
export const CandidateEvidence: React.FC<{ candidate: BriefCandidate }> = ({ candidate }) => {
  const claims = candidate.evidence || [];
  if (claims.length === 0) return null;
  const vulnerabilities = claims.filter((c) => c.kind === 'vulnerability' && (c.advisoryIds?.length || 0) > 0);
  const clean = claims.filter((c) => c.kind === 'vulnerability' && !(c.advisoryIds?.length));
  const scorecard = claims.find((c) => c.kind === 'maintenance' && c.statement.startsWith('OpenSSF Scorecard'));
  const docs = claims.filter((c) => c.kind === 'capability');
  const issues = claims.filter((c) => c.kind === 'known_issue');
  const conflicts = claims.filter((c) => c.kind === 'licence_conflict');

  return (
    <div className="stack gap-2 small" aria-label="Registry, advisory and documentation evidence">
      <div className="row wrap gap-2">
        {vulnerabilities.length > 0 && (
          <span className="badge badge-danger" title={vulnerabilities.map((v) => v.statement).join('\n')}>
            {vulnerabilities.length} known {vulnerabilities.length === 1 ? 'advisory' : 'advisories'}
          </span>
        )}
        {vulnerabilities.length === 0 && clean.length > 0 && (
          <span className="badge badge-verified" title={clean.map((c) => c.statement).join('\n')}>No known advisories (OSV)</span>
        )}
        {scorecard && <span className="badge badge-neutral" title={GRADE_HELP.E3}>{scorecard.statement.replace('OpenSSF ', '')}</span>}
        {docs.length > 0 && <span className="badge badge-neutral" title={GRADE_HELP.E3}>{docs.length} documented {docs.length === 1 ? 'capability' : 'capabilities'} · E3</span>}
        {issues.length > 0 && <span className="badge badge-inferred" title={GRADE_HELP.E4}>{issues.length} forum {issues.length === 1 ? 'question' : 'questions'} · E4</span>}
        {conflicts.map((c) => <span key={c.id} className="badge badge-inferred">{c.statement}</span>)}
      </div>
      {(vulnerabilities.length > 0 || docs.length > 0 || issues.length > 0) && (
        <details className="disclosure">
          <summary className="xsmall">
            Evidence details <ChevronDown size={12} aria-hidden="true" />
          </summary>
          <div className="stack gap-2" style={{ marginTop: 'var(--s-2)' }}>
            {vulnerabilities.map((v) => (
              <span key={v.id} className="xsmall">
                <ClaimLink claim={v}>{v.statement}</ClaimLink>
                {v.severity && <span className="faint"> · {v.severity}</span>}
              </span>
            ))}
            {docs.map((d) => (
              <span key={d.id} className="xsmall">
                &ldquo;{d.excerpt || d.statement}&rdquo; <ClaimLink claim={d}>{d.section ? `docs: ${d.section}` : 'docs'}</ClaimLink>
                {d.status === 'needs_revalidation' && <span className="faint"> · needs revalidation</span>}
              </span>
            ))}
            {issues.map((i) => (
              <span key={i.id} className="xsmall muted">
                <ClaimLink claim={i}>{i.statement.replace('Stack Overflow question: ', '')}</ClaimLink>
              </span>
            ))}
          </div>
        </details>
      )}
    </div>
  );
};
