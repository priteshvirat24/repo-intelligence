'use client';

import React from 'react';
import Link from 'next/link';
import { OpenRequirement, CandidateScore } from '@repo/shared';
import {
  CheckCircle2,
  AlertTriangle,
  Info,
  ArrowUpRight,
  Code,
  Star,
  Layers,
  AlertCircle
} from 'lucide-react';

// Requirement Card
export const RequirementCard: React.FC<{ requirement: OpenRequirement }> = ({ requirement }) => {
  const isMust = requirement.criticality === 'MUST';

  return (
    <div style={{
      background: 'rgba(15, 23, 42, 0.7)',
      border: `1px solid ${isMust ? 'rgba(99, 102, 241, 0.35)' : 'var(--border-subtle)'}`,
      borderRadius: 10,
      padding: '12px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          {requirement.name}
        </span>
        <span style={{
          fontSize: '0.675rem',
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 4,
          background: isMust ? 'rgba(99, 102, 241, 0.2)' : 'rgba(100, 116, 139, 0.2)',
          color: isMust ? '#a5b4fc' : '#cbd5e1',
          border: `1px solid ${isMust ? 'rgba(99, 102, 241, 0.4)' : 'rgba(100, 116, 139, 0.3)'}`
        }}>
          {requirement.criticality}
        </span>
      </div>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
        {requirement.description}
      </p>
      <div style={{ display: 'flex', gap: 10, marginTop: 4, fontSize: '0.725rem', color: 'var(--text-muted)' }}>
        <span>Type: <strong style={{ color: 'var(--text-secondary)' }}>{requirement.type}</strong></span>
        <span>Confidence: <strong style={{ color: 'var(--accent-cyan)' }}>{Math.round(requirement.confidence * 100)}%</strong></span>
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
    <div style={{
      background: 'rgba(15, 23, 42, 0.75)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 12,
      padding: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
      transition: 'border-color 0.2s'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{candidate.owner}</div>
          <Link
            href={`/repositories/${candidate.repositoryId}`}
            style={{
              fontSize: '1rem',
              fontWeight: 600,
              color: 'var(--text-primary)',
              display: 'flex',
              alignItems: 'center',
              gap: 6
            }}
          >
            {candidate.repositoryName}
            <ArrowUpRight size={14} color="var(--accent-cyan)" />
          </Link>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {candidate.distinctiveTermBoost && candidate.distinctiveTermBoost > 0 && (
            <span style={{
              fontSize: '0.675rem',
              fontWeight: 700,
              padding: '2px 6px',
              borderRadius: 4,
              background: 'rgba(168, 85, 247, 0.15)',
              color: '#c084fc',
              border: '1px solid rgba(168, 85, 247, 0.3)'
            }}>
              +{Math.round(candidate.distinctiveTermBoost * 100)}% Keyword
            </span>
          )}
          <div style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            padding: '4px 8px',
            borderRadius: 6,
            background: 'rgba(6, 182, 212, 0.12)',
            color: '#22d3ee',
            border: '1px solid rgba(6, 182, 212, 0.3)'
          }}>
            Score: {Math.round(candidate.finalScore * 100)}
          </div>
        </div>
      </div>

      {/* Matched capabilities */}
      {candidate.matchedCapabilities && candidate.matchedCapabilities.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {candidate.matchedCapabilities.map((cap, i) => (
            <span
              key={i}
              style={{
                fontSize: '0.7rem',
                padding: '2px 8px',
                borderRadius: 4,
                background: 'rgba(99, 102, 241, 0.15)',
                color: '#c7d2fe',
                border: '1px solid rgba(99, 102, 241, 0.3)'
              }}
            >
              {cap}
            </span>
          ))}
        </div>
      )}

      {/* Actionable Buttons Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingTop: 8,
        borderTop: '1px solid var(--border-subtle)',
        fontSize: '0.775rem',
        color: 'var(--text-muted)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {candidate.primaryLanguage && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Code size={13} color="var(--accent-cyan)" />
              {candidate.primaryLanguage}
            </span>
          )}
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Star size={13} color="var(--accent-amber)" />
            {candidate.stars.toLocaleString()}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <Link
            href={`/repositories/${candidate.repositoryId}`}
            style={{
              fontSize: '0.725rem',
              color: 'var(--accent-cyan)',
              padding: '3px 8px',
              borderRadius: 4,
              background: 'rgba(6, 182, 212, 0.08)',
              border: '1px solid rgba(6, 182, 212, 0.25)',
              textDecoration: 'none'
            }}
          >
            View Repo
          </Link>
          {onAskAboutRepo && (
            <button
              onClick={() => onAskAboutRepo(`${candidate.owner}/${candidate.repositoryName}`)}
              style={{
                fontSize: '0.725rem',
                color: '#a5b4fc',
                padding: '3px 8px',
                borderRadius: 4,
                background: 'rgba(99, 102, 241, 0.1)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                cursor: 'pointer'
              }}
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
    <div style={{
      background: 'rgba(245, 158, 11, 0.08)',
      border: '1px solid rgba(245, 158, 11, 0.25)',
      borderRadius: 8,
      padding: '12px 16px',
      margin: '8px 0',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12
    }}>
      <AlertTriangle size={18} color="var(--accent-amber)" style={{ flexShrink: 0, marginTop: 2 }} />
      <div style={{ fontSize: '0.85rem' }}>
        <div style={{ fontWeight: 600, color: 'var(--accent-amber)', marginBottom: 2 }}>
          Redundancy Detected: {capabilityOrFeature}
        </div>
        <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>
          Shared by: <strong>{overlappingRepositories.join(', ')}</strong>
        </div>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          {recommendation}
        </div>
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
    <div style={{
      background: 'rgba(244, 63, 94, 0.08)',
      border: '1px solid rgba(244, 63, 94, 0.25)',
      borderRadius: 8,
      padding: '12px 16px',
      margin: '12px 0',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 12
    }}>
      <AlertCircle size={18} color="var(--accent-rose)" style={{ flexShrink: 0, marginTop: 2 }} />
      <div>
        <div style={{ fontWeight: 600, color: 'var(--accent-rose)', marginBottom: 4 }}>
          Uncovered Requirements in Indexed Collection
        </div>
        <div style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', marginBottom: 6 }}>
          No indexed repository currently satisfies the following requirements:
        </div>
        <ul style={{ paddingLeft: 18, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
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
