'use client';

import React from 'react';
import { CheckCircle2, AlertTriangle, ArrowUpRight, BookmarkPlus, Check } from 'lucide-react';
import { ChatSource } from '@/lib/ui/chat';
import { shortLocation } from '@/lib/ui/github';
import { describeSource } from './AnswerBody';

interface SourceListProps {
  sources: ChatSource[];
  onOpenSource: (source: ChatSource) => void;
  onSaveWeb?: (url: string) => void;
  savingUrls?: Set<string>;
  savedUrls?: Set<string>;
}

function hostOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Numbered sources under an answer; numbers match the inline [n] / [Wn] references. */
export const SourceList: React.FC<SourceListProps> = ({ sources, onOpenSource, onSaveWeb, savingUrls, savedUrls }) => {
  if (sources.length === 0) return null;
  const inferredCount = sources.filter((s) => s.kind !== 'web' && !s.verified).length;

  return (
    <section aria-label="Sources">
      <div className="rule-head">
        <span className="label">Sources</span>
        <span className="count">
          {sources.length}
          {inferredCount > 0 ? ` · ${inferredCount} inferred` : ''}
        </span>
      </div>
      <ol className="source-list">
        {sources.map((s) => {
          if (s.kind === 'web') {
            const saved = s.url ? savedUrls?.has(s.url) : false;
            const saving = s.url ? savingUrls?.has(s.url) : false;
            return (
              <li key={s.id} className="source-item">
                <span className="source-num" aria-hidden="true">{s.id}</span>
                <div className="source-body">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cite cite-web"
                    aria-label={`${describeSource(s)}, opens in a new tab`}
                    title={s.url}
                  >
                    <span className="cite-main">{s.title || hostOf(s.url) || s.url}</span>
                    <span className="cite-sub">{hostOf(s.url)}</span>
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </a>
                  {onSaveWeb && s.url && (
                    <button
                      type="button"
                      className="link-quiet xsmall"
                      onClick={() => onSaveWeb(s.url!)}
                      disabled={saved || saving}
                    >
                      {saved ? <Check size={12} aria-hidden="true" /> : <BookmarkPlus size={12} aria-hidden="true" />}
                      <span>{saved ? 'Saved' : saving ? 'Saving…' : 'Save to library'}</span>
                    </button>
                  )}
                </div>
              </li>
            );
          }
          return (
            <li key={s.id} className="source-item">
              <span className="source-num" aria-hidden="true">{s.id}</span>
              <div className="source-body">
                <button
                  type="button"
                  className={`cite ${s.verified ? 'is-verified' : 'is-inferred'}`}
                  aria-label={describeSource(s)}
                  title={s.filePath ? `${s.repository ? `${s.repository} · ` : ''}${s.filePath}` : s.title}
                  onClick={() => onOpenSource(s)}
                >
                  {s.verified ? <CheckCircle2 size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
                  <span className="cite-main">{s.filePath ? shortLocation(s.filePath, s.startLine) : s.title || 'Excerpt'}</span>
                  {s.repository && <span className="cite-sub">{s.repository}</span>}
                </button>
                {!s.verified && <span className="badge badge-inferred">Inferred</span>}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
