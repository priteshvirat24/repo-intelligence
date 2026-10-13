'use client';

import React, { useMemo, useRef } from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CITE_HREF_PREFIX, ChatSource, linkifyCitations } from '@/lib/ui/chat';
import { lineRangeLabel } from '@/lib/ui/github';

export function describeSource(s: ChatSource): string {
  if (s.kind === 'web') return `Web source ${s.id}: ${s.title || s.url || 'web page'}`;
  const lines = lineRangeLabel(s.startLine, s.endLine);
  const where = [s.repository, s.filePath].filter(Boolean).join(' ');
  return `Source ${s.id}: ${where || s.title || 'excerpt'}${lines ? `, ${lines.replace('–', ' to ')}` : ''}${s.verified ? '' : ' (inferred, not verified)'}`;
}

interface AnswerBodyProps {
  content: string;
  sources?: ChatSource[];
  onOpenSource: (source: ChatSource) => void;
}

/**
 * Model output is Markdown. react-markdown never renders raw HTML, so streamed text cannot inject
 * markup. Inline references ([1], [W2]) become small numbered controls that open their source.
 */
const REMARK_PLUGINS = [remarkGfm];

export const AnswerBody: React.FC<AnswerBodyProps> = React.memo(function AnswerBody({ content, sources, onOpenSource }) {
  const byId = useMemo(() => new Map((sources || []).map((s) => [s.id, s])), [sources]);
  const text = useMemo(() => linkifyCitations(content, new Set(byId.keys())), [content, byId]);
  // Keep renderer identity stable: a new component type on each render would remount every
  // citation button, dropping focus (and the dialog's return-focus target) mid-interaction.
  const openRef = useRef(onOpenSource);
  openRef.current = onOpenSource;

  const components = useMemo<Components>(() => ({
        a: ({ node, href, children, ...props }) => {
          if (href && href.startsWith(CITE_HREF_PREFIX)) {
            const id = href.slice(CITE_HREF_PREFIX.length);
            const source = byId.get(id);
            if (!source) return <>[{id}]</>;
            const cls = `cite-ref${source.kind === 'web' ? ' is-web' : source.verified ? ' is-verified' : ' is-inferred'}`;
            if (source.kind === 'web' && source.url) {
              return (
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cls}
                  aria-label={`${describeSource(source)}, opens in a new tab`}
                  title={source.title || source.url}
                >
                  {id}
                </a>
              );
            }
            return (
              <button
                type="button"
                className={cls}
                aria-label={describeSource(source)}
                title={source.filePath ? `${source.repository ? `${source.repository} · ` : ''}${source.filePath}` : undefined}
                onClick={() => openRef.current(source)}
              >
                {id}
              </button>
            );
          }
          return <a href={href} {...props} target="_blank" rel="noopener noreferrer">{children}</a>;
        }
  }), [byId]);

  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
      {text}
    </ReactMarkdown>
  );
});
