'use client';

import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, GitBranch, Youtube, Linkedin, FileText, BookOpen, Globe } from 'lucide-react';

/** The Open Eye mark: an ink almond with a vermilion pupil, glancing slightly forward. */
export const EyeMark: React.FC<{ size?: number; className?: string }> = ({ size = 30, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    aria-hidden="true"
    focusable="false"
    className={className}
  >
    <path
      d="M3 16C7.5 8.5 24.5 8.5 29 16C24.5 23.5 7.5 23.5 3 16Z"
      stroke="var(--ink)"
      strokeWidth="2.25"
      strokeLinejoin="round"
    />
    <circle cx="17.5" cy="16" r="4.6" fill="var(--signal)" stroke="var(--ink)" strokeWidth="2" />
  </svg>
);

type Tone = 'verified' | 'inferred' | 'danger' | 'neutral' | 'outline';

export function statusTone(status?: string): Tone {
  const s = (status || '').toUpperCase();
  if (s === 'READY' || s === 'DONE') return 'verified';
  if (s === 'FAILED' || s === 'BLOCKED') return 'danger';
  if (s === 'PARTIAL') return 'inferred';
  if (s === 'CANCELLED') return 'outline';
  return 'neutral';
}

/** Status badge with semantic color. In-flight states get a quiet pulsing dot. */
export const StatusBadge: React.FC<{ status?: string; className?: string }> = ({ status, className }) => {
  if (!status) return null;
  const tone = statusTone(status);
  return (
    <span className={`badge badge-${tone}${className ? ` ${className}` : ''}`}>
      {tone === 'verified' && <CheckCircle2 size={12} aria-hidden="true" />}
      {tone === 'danger' && <XCircle size={12} aria-hidden="true" />}
      {tone === 'inferred' && <AlertTriangle size={12} aria-hidden="true" />}
      {tone === 'neutral' && <span className="dot dot-pulse" aria-hidden="true" />}
      {status.replace(/_/g, ' ')}
    </span>
  );
};

/** Monochrome source-type icon; color comes from the surrounding text. */
export const SourceIcon: React.FC<{ type?: string; size?: number }> = ({ type, size = 14 }) => {
  switch (type) {
    case 'github_repository':
      return <GitBranch size={size} aria-hidden="true" />;
    case 'youtube_video':
      return <Youtube size={size} aria-hidden="true" />;
    case 'linkedin_post':
      return <Linkedin size={size} aria-hidden="true" />;
    case 'pdf':
    case 'research_paper':
      return <FileText size={size} aria-hidden="true" />;
    case 'documentation_site':
      return <BookOpen size={size} aria-hidden="true" />;
    default:
      return <Globe size={size} aria-hidden="true" />;
  }
};
