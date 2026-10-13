'use client';

import React from 'react';
import Link from 'next/link';
import { OpenRequirement, CandidateScore } from '@repo/shared';
import { AlertTriangle, ArrowUpRight, Code, Star, AlertCircle } from 'lucide-react';

// Requirement Card
export const RequirementCard: React.FC<{ requirement: OpenRequirement }> = ({ requirement }) => {
  const isMust = requirement.criticality === 'MUST';
  const confidence = requirement.confidence;

  return (
    <div className={`card stack gap-2${isMust ? ' card-ink' : ''}`} style={{ padding: 'var(--s-3) var(--s-4)' }}>
      <div className="row between gap-3">
        <span style={{ fontWeight: 600 }}>{requirement.name}</span>
        <span className={`badge ${isMust ? 'badge-signal' : 'badge-outline'}`}>
          {requirement.criticality}
        </span>
      </div>
      <p className="small muted">{requirement.description}</p>
      <div className="meta-row">
        <span>type <strong style={{ color: 'var(--ink)' }}>{requirement.type}</strong></span>
        {confidence !== undefined && confidence !== null && (
          <span>
            confidence{' '}
            <strong style={{ color: 'var(--ink)' }}>
              {typeof confidence === 'string' ? confidence : `${Math.round(confidence * 100)}%`}
            </strong>
          </span>
        )}
      </div>
    </div>
  );
};

// Candidate Repository Card
export const CandidateRepoCard: React.FC<{
  candidate: CandidateScore;
  onAskAboutRepo?: (repoName: string) => void;
}> = ({ candidate, onAskAboutRepo }) => {
  return (
    <div className="card res-card">
      <div className="stack gap-3">
        <div className="res-card-top" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0 }}>
            <span className="mono xsmall muted">{candidate.owner}</span>
            <Link href={`/repositories/${candidate.repositoryId}`} className="res-title link" style={{ display: 'block', fontSize: 'var(--fs-md)' }}>
              {candidate.repositoryName}
            </Link>
          </div>

          <div className="row gap-1" style={{ flexShrink: 0 }}>
            {candidate.distinctiveTermBoost && candidate.distinctiveTermBoost > 0 && (
              <span className="badge badge-outline">
                +<span className="num">{Math.round(candidate.distinctiveTermBoost * 100)}%</span> keyword
              </span>
            )}
            <span className="badge badge-neutral">
              score <span className="num">{Math.round(candidate.finalScore * 100)}</span>
            </span>
          </div>
        </div>

        {candidate.matchedCapabilities && candidate.matchedCapabilities.length > 0 && (
          <div className="row wrap gap-1">
            {candidate.matchedCapabilities.map((cap, i) => (
              <span key={i} className="tag">{cap}</span>
            ))}
          </div>
        )}
      </div>

      <div className="card-foot">
        <div className="meta-row">
          {candidate.primaryLanguage && (
            <span><Code size={13} aria-hidden="true" />{candidate.primaryLanguage}</span>
          )}
          {candidate.stars !== undefined && (
            <span><Star size={13} aria-hidden="true" />{candidate.stars.toLocaleString()}</span>
          )}
        </div>

        <div className="row gap-2">
          <Link href={`/repositories/${candidate.repositoryId}`} className="link-quiet">
            View repo
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
          {onAskAboutRepo && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onAskAboutRepo(`${candidate.owner}/${candidate.repositoryName}`)}
            >
              Ask
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Overlap & Redundancy Notice
export const OverlapNotice: React.FC<{
  capabilityOrFeature: string;
  overlappingRepositories: string[];
  recommendation: string;
}> = ({ capabilityOrFeature, overlappingRepositories, recommendation }) => {
  return (
    <div className="callout callout-inferred" style={{ margin: 'var(--s-2) 0' }}>
      <AlertTriangle size={17} aria-hidden="true" />
      <div className="stack gap-1">
        <div className="callout-title">Overlap: {capabilityOrFeature}</div>
        <div>
          Shared by <strong>{overlappingRepositories.join(', ')}</strong>
        </div>
        <div className="muted">{recommendation}</div>
      </div>
    </div>
  );
};

// Missing Capability Notice
export const MissingCapabilityNotice: React.FC<{
  uncoveredRequirements: OpenRequirement[];
}> = ({ uncoveredRequirements }) => {
  if (!uncoveredRequirements || uncoveredRequirements.length === 0) return null;

  return (
    <div className="callout callout-danger" style={{ margin: 'var(--s-3) 0' }}>
      <AlertCircle size={17} aria-hidden="true" />
      <div className="stack gap-1">
        <div className="callout-title">Not covered by the library</div>
        <div>No indexed repository handles these yet:</div>
        <ul style={{ marginTop: 'var(--s-1)' }}>
          {uncoveredRequirements.map((r, i) => (
            <li key={i} style={{ marginBottom: 2 }}>
              <strong>{r.name}</strong> ({r.criticality}) &mdash; {r.description}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};
