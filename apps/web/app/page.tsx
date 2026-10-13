'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowUp,
  ArrowRight,
  ArrowUpRight,
  BookmarkPlus,
  Check,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { AddResourceModal } from '@/components/AddResourceModal';
import { ArchitectureGraph } from '@/components/ArchitectureGraph';
import { EvidenceDrawer, EvidenceItem } from '@/components/EvidenceDrawer';
import { SourceIcon } from '@/components/Primitives';
import {
  OpenQueryRequirements,
  CompositionPlan,
  ArchitectureGraphData,
  ResourceCitation,
  WebSearchResult,
  ChatSourceMode
} from '@repo/shared';

const STARTER_QUESTIONS = [
  'What can the indexed repositories do together?',
  'Which repository handles authentication, and in which files?',
  'Plan a research agent with browser automation using the repos we have.'
];

const MODE_LABELS: Record<ChatSourceMode, string> = {
  INTERNAL: 'Library',
  WEB: 'Web',
  BOTH: 'Both'
};

// The API reports sources as 'OPEN EYE' | 'WEB' | 'OPEN EYE + WEB'; show them in the UI's vocabulary.
const formatSources = (s?: string) => (s || 'OPEN EYE').replace('OPEN EYE', 'Library').replace('WEB', 'Web');

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  requirements?: OpenQueryRequirements;
  composition?: CompositionPlan;
  architectureGraph?: ArchitectureGraphData;
  citations?: ResourceCitation[];
  webSources?: WebSearchResult[];
  sourcesUsed?: 'OPEN EYE' | 'WEB' | 'OPEN EYE + WEB';
}

function StudioChatContent() {
  const searchParams = useSearchParams();
  const [resources, setResources] = useState<any[]>([]);
  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputQuery, setInputQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);
  const [sourceMode, setSourceMode] = useState<ChatSourceMode>('BOTH');
  const [savingWebUrls, setSavingWebUrls] = useState<Set<string>>(new Set());
  const [savedWebUrls, setSavedWebUrls] = useState<Set<string>>(new Set());

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch initial resources and capabilities
  const fetchResources = async () => {
    try {
      const res = await fetch('/api/resources');
      if (res.ok) {
        const data = await res.json();
        setResources(data.items || []);
      }
    } catch (err) {
      console.error('Error fetching resources:', err);
    }
  };

  const fetchCapabilities = async () => {
    try {
      const res = await fetch('/api/capabilities');
      if (res.ok) {
        const data = await res.json();
        setCapabilities(data.capabilities || []);
      }
    } catch (err) {
      console.error('Error fetching capabilities:', err);
    }
  };

  useEffect(() => {
    fetchResources();
    fetchCapabilities();
  }, []);

  // Handle prompt query param if passed from /resources
  useEffect(() => {
    const prompt = searchParams.get('prompt');
    if (prompt) {
      setInputQuery(prompt);
      handleSendMessage(prompt);
    }
  }, [searchParams]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (queryText?: string) => {
    const textToSend = queryText || inputQuery;
    if (!textToSend.trim() || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: textToSend
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputQuery('');
    setIsLoading(true);

    const assistantMsgId = (Date.now() + 1).toString();
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      sourcesUsed: sourceMode === 'INTERNAL' ? 'OPEN EYE' : sourceMode === 'WEB' ? 'WEB' : 'OPEN EYE + WEB'
    };

    setMessages((prev) => [...prev, assistantMsg]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: textToSend,
          mode: sourceMode,
          history: messages.map((m) => ({ role: m.role, content: m.content }))
        })
      });

      if (!response.ok) {
        throw new Error('Failed to start chat stream');
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          if (!block.trim()) continue;
          const eventMatch = block.match(/^event: (.*)$/m);
          const dataMatch = block.match(/^data: (.*)$/m);

          if (eventMatch && dataMatch) {
            const event = eventMatch[1];
            const data = JSON.parse(dataMatch[1]);

            if (event === 'metadata') {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        requirements: data.requirements,
                        composition: data.composition,
                        architectureGraph: data.architectureGraph,
                        citations: data.citations,
                        webSources: data.webSources,
                        sourcesUsed: data.sourcesUsed
                      }
                    : msg
                )
              );
            } else if (event === 'message') {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? { ...msg, content: msg.content + data.text }
                    : msg
                )
              );
            } else if (event === 'error') {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? { ...msg, content: `${msg.content}${msg.content ? '\n\n' : ''}Error: ${data.error}` }
                    : msg
                )
              );
            }
          }
        }
      }
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMsgId
            ? { ...msg, content: `Error: ${err.message || 'Something went wrong'}` }
            : msg
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveWebSource = async (webResult: WebSearchResult) => {
    if (savedWebUrls.has(webResult.url) || savingWebUrls.has(webResult.url)) return;

    setSavingWebUrls(prev => new Set(prev).add(webResult.url));
    try {
      const res = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webResult.url })
      });
      if (res.ok) {
        setSavedWebUrls(prev => new Set(prev).add(webResult.url));
        fetchResources();
      }
    } catch (err) {
      console.error('Error saving web resource:', err);
    } finally {
      setSavingWebUrls(prev => {
        const next = new Set(prev);
        next.delete(webResult.url);
        return next;
      });
    }
  };

  let questionNumber = 0;

  return (
    <div className="studio">
      <Navbar
        onOpenAddModal={() => setIsAddModalOpen(true)}
        resourceCount={resources.length}
      />

      <div className="studio-body">
        {/* Left: the library shelf */}
        <aside className="shelf" aria-label="Library">
          <div className="shelf-head">
            <span className="label">Library <span className="num">({resources.length})</span></span>
            <Link href="/resources" className="link-quiet xsmall">
              View all
              <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          </div>

          <div className="shelf-list">
            {resources.length === 0 ? (
              <p className="small muted" style={{ paddingTop: 'var(--s-3)', borderTop: 'var(--bw) solid var(--ink)' }}>
                Nothing indexed yet. Add a GitHub repository to give Open Eye something to read.
              </p>
            ) : (
              resources.slice(0, 10).map((r) => (
                <div key={r.id} className="shelf-item">
                  <div className="shelf-item-title">
                    <SourceIcon type={r.resourceType} />
                    <span className="truncate">{r.title}</span>
                  </div>
                  {(r.problemsSolved?.[0] || r.sourceDomain) && (
                    <div className="shelf-item-sub clamp-2">
                      {r.problemsSolved?.[0] || r.sourceDomain}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Starter questions live in the intro until a conversation starts */}
          {messages.length > 0 && (
            <div className="shelf-foot">
              <span className="label" style={{ marginBottom: 'var(--s-2)' }}>Try asking</span>
              <div className="prompt-list compact" style={{ borderTop: 0 }}>
                {STARTER_QUESTIONS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="prompt-item"
                    onClick={() => handleSendMessage(q)}
                    disabled={isLoading}
                  >
                    <span>{q}</span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </aside>

        {/* Center: the reading surface */}
        <main className="studio-main">
          <div className="studio-scroll">
            <div className="studio-column">
              {messages.length === 0 ? (
                <section className="studio-intro">
                  <span className="eyebrow">Studio</span>
                  <h1 className="h-page">Ask your repositories.</h1>
                  <p className="lede">
                    Open Eye reads the GitHub repositories you index and answers with the files and
                    lines behind each claim. Anything it can&apos;t verify is marked as inferred.
                  </p>

                  {resources.length === 0 && (
                    <div className="row wrap gap-3">
                      <button type="button" className="btn btn-primary" onClick={() => setIsAddModalOpen(true)}>
                        Add your first repository
                      </button>
                      <span className="small muted">Paste any public GitHub URL.</span>
                    </div>
                  )}

                  <div style={{ marginTop: 'var(--s-4)' }}>
                    <span className="label" style={{ marginBottom: 'var(--s-2)' }}>Try asking</span>
                    <div className="prompt-list">
                      {STARTER_QUESTIONS.map((q) => (
                        <button
                          key={q}
                          type="button"
                          className="prompt-item"
                          onClick={() => handleSendMessage(q)}
                          disabled={isLoading}
                        >
                          <span>{q}</span>
                          <ArrowRight size={16} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </div>
                </section>
              ) : (
                <div>
                  {messages.map((msg) => {
                    if (msg.role === 'user') {
                      questionNumber += 1;
                      return (
                        <section key={msg.id} className="turn" aria-label={`Question ${questionNumber}`}>
                          <div className="turn-meta">
                            <span className="label">Q{questionNumber} &middot; You asked</span>
                          </div>
                          <h2 className="turn-question">{msg.content}</h2>
                        </section>
                      );
                    }

                    return (
                      <article key={msg.id} className="answer" style={{ marginTop: 'var(--s-5)' }}>
                        <div className="turn-meta">
                          <span className="label" style={{ color: 'var(--ink)' }}>Open Eye</span>
                          <span className="badge badge-outline">Sources: {formatSources(msg.sourcesUsed)}</span>
                        </div>

                        {/* Answer */}
                        <div className={`prose${msg.content ? '' : ' is-pending'}`} aria-live="polite">
                          {msg.content || (
                            <>
                              <span className="dot dot-pulse" aria-hidden="true" />
                              Reading sources&hellip;
                            </>
                          )}
                        </div>

                        {/* Evidence */}
                        {msg.citations && msg.citations.length > 0 && (
                          <div>
                            <div className="rule-head">
                              <span className="label">Evidence</span>
                              <span className="count">{msg.citations.length}</span>
                            </div>
                            <div className="row wrap gap-2">
                              {msg.citations.map((c, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  className={`cite ${c.isVerified ? 'is-verified' : 'is-inferred'}`}
                                  title={c.isVerified ? 'Verified against source' : 'Inferred, not verified'}
                                  onClick={() => setSelectedEvidence({
                                    resourceTitle: c.resourceTitle,
                                    resourceType: c.resourceType,
                                    sourceUrl: c.sourceUrl,
                                    filePath: c.formattedCitation,
                                    quote: c.snippet,
                                    verified: c.isVerified,
                                    locator: c.locator,
                                    formattedCitation: c.formattedCitation
                                  })}
                                >
                                  {c.isVerified
                                    ? <CheckCircle2 size={13} aria-hidden="true" />
                                    : <AlertTriangle size={13} aria-hidden="true" />}
                                  <span>{c.formattedCitation}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Architecture graph */}
                        {msg.architectureGraph && msg.architectureGraph.nodes.length > 0 && (
                          <ArchitectureGraph data={msg.architectureGraph} />
                        )}

                        {/* Web results */}
                        {msg.webSources && msg.webSources.length > 0 && (
                          <div>
                            <div className="rule-head">
                              <span className="label">From the web</span>
                              <span className="count">{msg.webSources.length}</span>
                            </div>
                            <div className="web-list" style={{ borderTop: 0 }}>
                              {msg.webSources.map((w, idx) => {
                                const isSaved = savedWebUrls.has(w.url);
                                const isSaving = savingWebUrls.has(w.url);

                                return (
                                  <div key={idx} className="web-item">
                                    <div style={{ minWidth: 0 }}>
                                      <a href={w.url} target="_blank" rel="noreferrer" className="web-item-title link">
                                        {w.title}
                                      </a>
                                      <div className="mono xsmall faint truncate" style={{ marginTop: 2 }}>{w.domain}</div>
                                      <p className="small muted clamp-2" style={{ marginTop: 'var(--s-1)' }}>
                                        {w.content}
                                      </p>
                                    </div>

                                    <div className="web-item-actions">
                                      <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => handleSaveWebSource(w)}
                                        disabled={isSaved || isSaving}
                                        style={isSaved ? { color: 'var(--verified)', borderColor: 'var(--verified)', background: 'var(--verified-tint)' } : undefined}
                                      >
                                        {isSaved ? <Check size={13} aria-hidden="true" /> : <BookmarkPlus size={13} aria-hidden="true" />}
                                        <span>{isSaved ? 'Saved' : isSaving ? 'Saving…' : 'Save to library'}</span>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </article>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="composer">
            <div className="composer-inner">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="composer-row"
              >
                <label htmlFor="studio-input" className="sr-only">Ask a question</label>
                <input
                  id="studio-input"
                  type="text"
                  className="field"
                  placeholder="Ask about the code: how it works, where it lives, what to reuse"
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  disabled={isLoading}
                  autoComplete="off"
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isLoading || !inputQuery.trim()}
                >
                  <ArrowUp size={16} strokeWidth={2.5} aria-hidden="true" />
                  <span>Ask</span>
                </button>
              </form>

              <div className="composer-meta">
                <div className="row gap-2">
                  <span className="label" id="source-mode-label">Search in</span>
                  <div className="segmented" role="group" aria-labelledby="source-mode-label">
                    {(['INTERNAL', 'WEB', 'BOTH'] as ChatSourceMode[]).map((m) => (
                      <button
                        key={m}
                        type="button"
                        aria-pressed={sourceMode === m}
                        onClick={() => setSourceMode(m)}
                      >
                        {MODE_LABELS[m]}
                      </button>
                    ))}
                  </div>
                </div>
                <span className="composer-hint mono xsmall faint">Enter to send</span>
              </div>
            </div>
          </div>
        </main>
      </div>

      <EvidenceDrawer
        isOpen={Boolean(selectedEvidence)}
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
      />

      <AddResourceModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onResourceAdded={() => {
          fetchResources();
        }}
      />
    </div>
  );
}

export default function StudioChatPage() {
  return (
    <React.Suspense fallback={
      <div className="app-shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <span className="loading-line">
          <span className="dot dot-pulse" aria-hidden="true" />
          Opening Studio&hellip;
        </span>
      </div>
    }>
      <StudioChatContent />
    </React.Suspense>
  );
}
