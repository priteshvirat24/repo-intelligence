'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowUp,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Square,
  RotateCw,
  Plus,
  ChevronDown,
  ArrowDown
} from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { useLibrary } from '@/components/LibraryProvider';
import { ArchitectureGraph } from '@/components/ArchitectureGraph';
import { EvidenceDrawer, EvidenceItem } from '@/components/EvidenceDrawer';
import { AnswerBody } from '@/components/studio/AnswerBody';
import { SourceList } from '@/components/studio/SourceList';
import { ShelfList, ShelfResource } from '@/components/studio/ShelfList';
import { ArchitectureGraphData, ResourceCitation, WebSearchResult } from '@repo/shared';
import {
  ChatError,
  ChatMode,
  ChatRequestError,
  ChatSource,
  errorTitle,
  sourcesUsedLabel,
  streamChat
} from '@/lib/ui/chat';
import { formatRetryAfter } from '@/lib/ui/api';
import { isTerminalStatus } from '@/lib/ui/status';
import { useIndexingStatus } from '@/lib/ui/useIndexingStatus';
import { parseGithubRepo } from '@/lib/ui/github';

const GENERIC_STARTERS = [
  'What can the indexed repositories do together?',
  'Which repository handles authentication, and in which files?',
  'Where is the main entry point of each repository?'
];

const MODES: Array<{ id: ChatMode; label: string; help: string }> = [
  {
    id: 'INTERNAL',
    label: 'Library',
    help: 'Answers only from your indexed repositories, citing file and line.'
  },
  {
    id: 'WEB',
    label: 'Web',
    help: 'Searches the public web. Answers cite web pages, not your code.'
  },
  {
    id: 'BOTH',
    label: 'Both',
    help: 'Your repositories first, plus the web for anything they do not cover.'
  }
];

const STORAGE_KEY = 'open-eye:studio-thread:v1';

type AnswerState = 'pending' | 'streaming' | 'done' | 'stopped' | 'error';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  state?: AnswerState;
  statusLabel?: string;
  sources?: ChatSource[];
  /** Legacy servers: shown only when `sources` is absent. */
  citations?: ResourceCitation[];
  webSources?: WebSearchResult[];
  sourcesUsed?: string;
  architectureGraph?: ArchitectureGraphData;
  error?: ChatError;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadThread(): Message[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // An answer that was mid-stream when the page went away is partial now.
    return parsed.map((m: Message) =>
      m.role === 'assistant' && (m.state === 'pending' || m.state === 'streaming')
        ? { ...m, state: 'stopped' as AnswerState }
        : m
    );
  } catch {
    return [];
  }
}

function saveThread(messages: Message[]) {
  try {
    if (messages.length === 0) window.sessionStorage.removeItem(STORAGE_KEY);
    else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    /* storage full or blocked: the thread just won't survive a reload */
  }
}

/** Prior turns sent as context. Errored turns (and their questions) are left out. */
function buildHistory(messages: Message[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const answer = messages[i + 1];
    if (!answer || answer.role !== 'assistant') continue;
    if (answer.state === 'error' || !answer.content.trim()) continue;
    history.push({ role: 'user', content: m.content });
    history.push({ role: 'assistant', content: answer.content });
  }
  return history.slice(-12);
}

function sourceToEvidence(s: ChatSource): EvidenceItem {
  return {
    repo: s.repository,
    resourceTitle: s.title || s.repository,
    resourceType: s.repository ? 'github_repository' : undefined,
    filePath: s.filePath,
    startLine: s.startLine,
    endLine: s.endLine,
    symbolName: s.symbol,
    quote: s.snippet || '',
    verified: s.verified,
    url: s.url
  };
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function StudioChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openAddRepository, libraryVersion, notifyLibraryChanged } = useLibrary();

  const [resources, setResources] = useState<ShelfResource[]>([]);
  const [resourcesState, setResourcesState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [inputQuery, setInputQuery] = useState('');
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);
  const [sourceMode, setSourceMode] = useState<ChatMode>('INTERNAL');
  const [savingWebUrls, setSavingWebUrls] = useState<Set<string>>(new Set());
  const [savedWebUrls, setSavedWebUrls] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  const [showJump, setShowJump] = useState(false);

  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const abortRef = useRef<AbortController | null>(null);
  const streamingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingScrollRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const promptConsumedRef = useRef(false);

  const isStreaming = Boolean(streamingId);

  // --- Library data -------------------------------------------------------------------------

  const fetchResources = useCallback(async () => {
    setResourcesState((prev) => (prev === 'ready' ? prev : 'loading'));
    try {
      const res = await fetch('/api/resources', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setResources(data.items || []);
      setResourcesState('ready');
    } catch (err) {
      console.error('Error fetching resources:', err);
      setResourcesState('error');
    }
  }, []);

  const fetchCapabilities = useCallback(async () => {
    try {
      const res = await fetch('/api/capabilities', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        setCapabilities(data.capabilities || []);
      }
    } catch (err) {
      console.error('Error fetching capabilities:', err);
    }
  }, []);

  useEffect(() => {
    fetchResources();
    fetchCapabilities();
  }, [fetchResources, fetchCapabilities, libraryVersion]);

  const indexingIds = resources.filter((r) => !isTerminalStatus(r.status)).map((r) => r.id);
  const { statuses } = useIndexingStatus(indexingIds, { onTerminal: () => notifyLibraryChanged() });

  // Starter questions from what is actually indexed, with generic fallbacks.
  const starterQuestions = useMemo(() => {
    const out: string[] = [];
    const readyRepos = resources
      .filter((r) => r.resourceType === 'github_repository' && r.status === 'READY')
      .map((r) => parseGithubRepo(r.sourceUrl) || r.title);
    const capWithRepo = capabilities.find((c) => c?.name && c.repositories?.length > 0);
    if (capWithRepo) {
      const repo = capWithRepo.repositories[0];
      out.push(`What does ${repo.owner}/${repo.name} do, and where is ${String(capWithRepo.name).toLowerCase()} implemented?`);
    } else if (readyRepos[0]) {
      out.push(`What does ${readyRepos[0]} do, and where is its main logic implemented?`);
    }
    const categoryCounts = new Map<string, number>();
    capabilities.forEach((c) => {
      if (c?.category) categoryCounts.set(c.category, (categoryCounts.get(c.category) || 0) + 1);
    });
    const topCategory = Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (topCategory) out.push(`Which repository handles ${topCategory.toLowerCase()}, and in which files?`);
    if (readyRepos.length >= 2) {
      out.push(`How could ${readyRepos[0]} and ${readyRepos[1]} work together?`);
    } else if (readyRepos[0]) {
      out.push(`What are the entry points of ${readyRepos[0]}, and which files define them?`);
    }
    for (const q of GENERIC_STARTERS) {
      if (out.length >= 3) break;
      if (!out.includes(q)) out.push(q);
    }
    return out.slice(0, 3);
  }, [resources, capabilities]);

  // --- Thread persistence ---------------------------------------------------------------------

  useEffect(() => {
    setMessages(loadThread());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated && !streamingId) saveThread(messages);
  }, [messages, streamingId, hydrated]);

  // --- Scrolling ------------------------------------------------------------------------------

  // Scrolling policy: on send, bring the new question to the top of the reading surface once.
  // After that the page never moves on its own (not while streaming, not on completion); the
  // reader scrolls manually, with an optional "Jump to latest" while the answer runs off-screen.
  const updateJumpVisibility = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 80);
  }, []);

  const handleScroll = () => {
    if (streamingRef.current) updateJumpVisibility();
  };

  useEffect(() => {
    if (pendingScrollRef.current) {
      const target = document.getElementById(`turn-${pendingScrollRef.current}`);
      pendingScrollRef.current = null;
      target?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    }
    if (streamingId) updateJumpVisibility();
    else setShowJump(false);
  }, [messages, streamingId, updateJumpVisibility]);

  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  // --- Composer -------------------------------------------------------------------------------

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [inputQuery]);

  const restoreFocus = () => {
    const active = document.activeElement;
    if (!active || active === document.body || composerRef.current?.contains(active)) {
      textareaRef.current?.focus({ preventScroll: true });
    }
  };

  const updateMessage = (id: string, patch: Partial<Message> | ((m: Message) => Partial<Message>)) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m))
    );
  };

  // --- Sending --------------------------------------------------------------------------------

  const runAnswer = async (assistantId: string, question: string, history: ReturnType<typeof buildHistory>) => {
    const controller = new AbortController();
    abortRef.current = controller;
    streamingRef.current = true;
    setStreamingId(assistantId);
    setAnnouncement('');

    let sourceCount = 0;
    let gotError = false;

    try {
      await streamChat(
        { message: question, mode: sourceMode, history },
        {
          onStatus: (e) => {
            if (e?.label) updateMessage(assistantId, { statusLabel: e.label });
          },
          onMetadata: (data) => {
            const sources: ChatSource[] | undefined = Array.isArray(data?.sources) ? data.sources : undefined;
            sourceCount = sources ? sources.length : Array.isArray(data?.citations) ? data.citations.length : 0;
            updateMessage(assistantId, {
              sources,
              citations: sources ? undefined : data?.citations,
              webSources: data?.webSources,
              sourcesUsed: data?.sourcesUsed,
              architectureGraph: data?.architectureGraph
            });
          },
          onText: (text) => {
            updateMessage(assistantId, (m) => ({ content: m.content + text, state: 'streaming' }));
          },
          onError: (err) => {
            gotError = true;
            updateMessage(assistantId, { state: 'error', error: err });
          }
        },
        controller.signal
      );
      if (!gotError) {
        updateMessage(assistantId, { state: 'done' });
        setAnnouncement(`Answer ready, ${sourceCount} ${sourceCount === 1 ? 'source' : 'sources'}.`);
      } else {
        setAnnouncement('The answer stopped with an error.');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        updateMessage(assistantId, { state: 'stopped' });
        setAnnouncement('Answer stopped.');
      } else if (err instanceof ChatRequestError) {
        updateMessage(assistantId, {
          state: 'error',
          error: { message: err.message, kind: err.kind, retryAfter: err.retryAfter }
        });
      } else {
        updateMessage(assistantId, {
          state: 'error',
          error: { message: 'Check your connection and try again.', kind: 'network' }
        });
      }
    } finally {
      abortRef.current = null;
      streamingRef.current = false;
      setStreamingId(null);
      setTimeout(restoreFocus, 0);
    }
  };

  const handleSendMessage = (queryText?: string) => {
    const text = (queryText ?? inputQuery).trim();
    if (!text || streamingRef.current) return;

    const history = buildHistory(messagesRef.current);
    const userMsg: Message = { id: newId(), role: 'user', content: text };
    const assistantMsg: Message = { id: newId(), role: 'assistant', content: '', state: 'pending' };

    pendingScrollRef.current = userMsg.id;
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    if (queryText === undefined || queryText === inputQuery) setInputQuery('');
    runAnswer(assistantMsg.id, text, history);
  };

  /** Re-asks the same question in place of an errored answer. */
  const handleRetry = (assistantId: string) => {
    if (streamingRef.current) return;
    const current = messagesRef.current;
    const idx = current.findIndex((m) => m.id === assistantId);
    const question = idx > 0 ? current[idx - 1] : null;
    if (!question || question.role !== 'user') return;
    const history = buildHistory(current.slice(0, idx - 1));
    setMessages((prev) =>
      prev.map((m) => (m.id === assistantId ? { id: m.id, role: 'assistant', content: '', state: 'pending' } : m))
    );
    runAnswer(assistantId, question.content, history);
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleNewConversation = () => {
    abortRef.current?.abort();
    setMessages([]);
    saveThread([]);
    setAnnouncement('Started a new conversation.');
    setTimeout(() => textareaRef.current?.focus(), 0);
  };

  // ?prompt= deep link (from Library / repository pages): consume once, then clean the URL.
  useEffect(() => {
    if (!hydrated || promptConsumedRef.current) return;
    const prompt = searchParams.get('prompt');
    if (!prompt) return;
    promptConsumedRef.current = true;
    router.replace('/');
    handleSendMessage(prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, hydrated]);

  const handleSaveWebSource = async (url: string) => {
    if (savedWebUrls.has(url) || savingWebUrls.has(url)) return;
    setSavingWebUrls((prev) => new Set(prev).add(url));
    try {
      const res = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });
      if (res.ok) {
        setSavedWebUrls((prev) => new Set(prev).add(url));
        notifyLibraryChanged();
      }
    } catch (err) {
      console.error('Error saving web resource:', err);
    } finally {
      setSavingWebUrls((prev) => {
        const next = new Set(prev);
        next.delete(url);
        return next;
      });
    }
  };

  const openSource = (s: ChatSource) => {
    if (s.kind === 'web') {
      if (s.url) window.open(s.url, '_blank', 'noopener,noreferrer');
      return;
    }
    setSelectedEvidence(sourceToEvidence(s));
  };

  const activeMode = MODES.find((m) => m.id === sourceMode) || MODES[0];
  const libraryEmpty = resourcesState === 'ready' && resources.length === 0;

  const renderStarters = (compact: boolean) => (
    <div className={`prompt-list${compact ? ' compact' : ''}`} style={compact ? { borderTop: 0 } : undefined}>
      {starterQuestions.map((q) => (
        <button
          key={q}
          type="button"
          className="prompt-item"
          onClick={() => handleSendMessage(q)}
          disabled={isStreaming}
        >
          <span>{q}</span>
          <ArrowRight size={compact ? 14 : 16} aria-hidden="true" />
        </button>
      ))}
    </div>
  );

  let questionNumber = 0;

  return (
    <div className="studio">
      <Navbar />

      <div className="studio-body">
        {/* Left: the library shelf */}
        <aside className="shelf" aria-label="Library">
          <div className="shelf-head">
            <span className="label">
              Library{resourcesState === 'ready' && <> <span className="num">({resources.length})</span></>}
            </span>
            <Link href="/resources" className="link-quiet xsmall">
              View all
              <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          </div>

          <div className="shelf-list">
            <ShelfList items={resources} state={resourcesState} statuses={statuses} onRetry={fetchResources} />
          </div>

          {messages.length > 0 && (
            <div className="shelf-foot">
              <span className="label" style={{ marginBottom: 'var(--s-2)' }}>Try asking</span>
              {renderStarters(true)}
            </div>
          )}
        </aside>

        {/* Center: the reading surface */}
        <main className="studio-main">
          <div className="studio-scroll" ref={scrollRef} onScroll={handleScroll}>
            <div className="studio-column">
              {messages.length === 0 ? (
                <section className="studio-intro">
                  <span className="eyebrow">Studio</span>
                  <h1 className="h-page">Ask your repositories.</h1>
                  <p className="lede">
                    Open Eye reads the GitHub repositories you index and answers with the files and
                    lines behind each claim. Anything it can&apos;t verify is marked as inferred.
                  </p>

                  {resourcesState === 'error' && (
                    <div className="callout callout-danger" role="alert">
                      <AlertCircle size={16} aria-hidden="true" />
                      <div className="grow stack gap-2">
                        <div>
                          <div className="callout-title">Couldn&apos;t load your library.</div>
                          <div>You can still ask; answers may say nothing matched.</div>
                        </div>
                        <div>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={fetchResources}>
                            <RotateCw size={13} aria-hidden="true" />
                            <span>Retry</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {libraryEmpty && (
                    <div className="row wrap gap-3">
                      <button type="button" className="btn btn-primary" onClick={openAddRepository}>
                        Add your first repository
                      </button>
                      <span className="small muted">Paste any public GitHub URL.</span>
                    </div>
                  )}

                  {resourcesState !== 'loading' && (
                    <div style={{ marginTop: 'var(--s-4)' }}>
                      <span className="label" style={{ marginBottom: 'var(--s-2)' }}>Try asking</span>
                      {renderStarters(false)}
                    </div>
                  )}
                </section>
              ) : (
                <div>
                  {messages.map((msg, idx) => {
                    if (msg.role === 'user') {
                      questionNumber += 1;
                      return (
                        <section
                          key={msg.id}
                          id={`turn-${msg.id}`}
                          className="turn"
                          aria-label={`Question ${questionNumber}`}
                        >
                          <div className="turn-meta">
                            <span className="label">Q{questionNumber} &middot; You asked</span>
                          </div>
                          <h2 className="turn-question">{msg.content}</h2>
                        </section>
                      );
                    }

                    const busy = msg.id === streamingId;
                    const usedLabel = sourcesUsedLabel(msg.sourcesUsed);
                    const hasContent = Boolean(msg.content);
                    const graph = msg.architectureGraph;

                    return (
                      <article
                        key={msg.id}
                        className="answer"
                        style={{ marginTop: 'var(--s-5)' }}
                        aria-busy={busy}
                        aria-label={`Answer ${questionNumber}`}
                      >
                        <div className="turn-meta">
                          <span className="label" style={{ color: 'var(--ink)' }}>Open Eye</span>
                          {usedLabel && (
                            <span className={`badge ${msg.sourcesUsed === 'NONE' ? 'badge-inferred' : 'badge-outline'}`}>
                              Sources: {usedLabel}
                            </span>
                          )}
                          {msg.state === 'stopped' && <span className="badge badge-neutral">Stopped</span>}
                        </div>

                        {hasContent ? (
                          <div className="prose prose-md">
                            <AnswerBody content={msg.content} sources={msg.sources} onOpenSource={openSource} />
                          </div>
                        ) : busy ? (
                          <div className="prose is-pending">
                            <span className="dot dot-pulse" aria-hidden="true" />
                            {msg.statusLabel || 'Reading sources'}&hellip;
                          </div>
                        ) : msg.state === 'stopped' ? (
                          <p className="small muted">Stopped before any answer was written.</p>
                        ) : msg.state === 'done' ? (
                          <p className="small muted">No answer was returned.</p>
                        ) : null}

                        {msg.state === 'stopped' && hasContent && (
                          <p className="xsmall muted">Stopped early. The answer above is partial.</p>
                        )}

                        {msg.state === 'error' && msg.error && (
                          <div className="callout callout-danger" role="alert">
                            <AlertCircle size={16} aria-hidden="true" />
                            <div className="grow stack gap-2">
                              <div>
                                <div className="callout-title">{errorTitle(msg.error.kind)}</div>
                                <div>
                                  {msg.error.message}
                                  {msg.error.kind === 'rate_limited' && <> {formatRetryAfter(msg.error.retryAfter)}</>}
                                </div>
                                {hasContent && <div className="xsmall muted">The partial answer above was kept.</div>}
                              </div>
                              <div>
                                <button
                                  type="button"
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleRetry(msg.id)}
                                  disabled={isStreaming}
                                >
                                  <RotateCw size={13} aria-hidden="true" />
                                  <span>Retry</span>
                                </button>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Sources (new contract) */}
                        {msg.sources && msg.sources.length > 0 && (
                          <SourceList
                            sources={msg.sources}
                            onOpenSource={openSource}
                            onSaveWeb={handleSaveWebSource}
                            savingUrls={savingWebUrls}
                            savedUrls={savedWebUrls}
                          />
                        )}

                        {/* Legacy evidence chips */}
                        {!msg.sources && msg.citations && msg.citations.length > 0 && (
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
                                  title={c.formattedCitation}
                                  aria-label={`${c.formattedCitation}${c.isVerified ? ', verified' : ', inferred, not verified'}`}
                                  onClick={() => setSelectedEvidence({
                                    resourceTitle: c.resourceTitle,
                                    resourceType: c.resourceType,
                                    sourceUrl: c.sourceUrl,
                                    filePath: c.locator?.filePath,
                                    startLine: c.locator?.startLine,
                                    endLine: c.locator?.endLine,
                                    symbolName: c.locator?.symbolName,
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

                        {/* Legacy web results (new servers list them in Sources as W1, W2…) */}
                        {!msg.sources && msg.webSources && msg.webSources.length > 0 && (
                          <div>
                            <div className="rule-head">
                              <span className="label">From the web</span>
                              <span className="count">{msg.webSources.length}</span>
                            </div>
                            <div className="web-list" style={{ borderTop: 0 }}>
                              {msg.webSources.map((w, wi) => (
                                <div key={wi} className="web-item">
                                  <div style={{ minWidth: 0 }}>
                                    <a href={w.url} target="_blank" rel="noopener noreferrer" className="web-item-title link">
                                      {w.title}
                                    </a>
                                    <div className="mono xsmall faint truncate" style={{ marginTop: 2 }}>{w.domain}</div>
                                    <p className="small muted clamp-2" style={{ marginTop: 'var(--s-1)' }}>{w.content}</p>
                                  </div>
                                  <div className="web-item-actions">
                                    <button
                                      type="button"
                                      className="btn btn-secondary btn-sm"
                                      onClick={() => handleSaveWebSource(w.url)}
                                      disabled={savedWebUrls.has(w.url) || savingWebUrls.has(w.url)}
                                    >
                                      <span>{savedWebUrls.has(w.url) ? 'Saved' : savingWebUrls.has(w.url) ? 'Saving…' : 'Save to library'}</span>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Composition graph, on request */}
                        {graph && graph.nodes && graph.nodes.length > 0 && !busy && (
                          <details className="disclosure">
                            <summary>
                              <ChevronDown size={14} aria-hidden="true" />
                              <span>Show how these repositories fit together</span>
                            </summary>
                            <div style={{ marginTop: 'var(--s-3)' }}>
                              <ArchitectureGraph data={graph} />
                            </div>
                          </details>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Composer */}
          <div className="composer" ref={composerRef}>
            {showJump && isStreaming && (
              <button type="button" className="btn btn-secondary btn-sm jump-latest" onClick={jumpToLatest}>
                <ArrowDown size={13} aria-hidden="true" />
                <span>Jump to latest</span>
              </button>
            )}
            <div className="composer-inner">
              {/* Small screens: the shelf is hidden, so offer it here */}
              <details className="shelf-mobile">
                <summary>
                  <ChevronDown size={14} aria-hidden="true" />
                  <span>
                    Library{resourcesState === 'ready' && <> (<span className="num">{resources.length}</span>)</>}
                  </span>
                </summary>
                <div className="shelf-mobile-body">
                  <ShelfList items={resources} state={resourcesState} statuses={statuses} onRetry={fetchResources} limit={8} />
                  <Link href="/resources" className="link-quiet xsmall" style={{ marginTop: 'var(--s-2)' }}>
                    View all
                    <ArrowUpRight size={12} aria-hidden="true" />
                  </Link>
                </div>
              </details>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                className="composer-row"
              >
                <label htmlFor="studio-input" className="sr-only">Ask a question</label>
                <textarea
                  id="studio-input"
                  ref={textareaRef}
                  rows={1}
                  className="field composer-field"
                  placeholder="Ask about the code: how it works, where it lives, what to reuse"
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (!isStreaming) handleSendMessage();
                    }
                  }}
                  aria-describedby="composer-hint mode-help"
                  autoComplete="off"
                />
                {isStreaming && (
                  <button type="button" className="btn btn-secondary" onClick={handleStop}>
                    <Square size={14} aria-hidden="true" />
                    <span>Stop</span>
                  </button>
                )}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isStreaming || !inputQuery.trim()}
                >
                  <ArrowUp size={16} strokeWidth={2.5} aria-hidden="true" />
                  <span>Ask</span>
                </button>
              </form>

              <div className="composer-meta">
                <div className="row wrap gap-2">
                  <span className="label" id="source-mode-label">Search in</span>
                  <div className="segmented" role="group" aria-labelledby="source-mode-label">
                    {MODES.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        aria-pressed={sourceMode === m.id}
                        title={m.help}
                        onClick={() => setSourceMode(m.id)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="row gap-3">
                  {messages.length > 0 && (
                    <button type="button" className="link-quiet xsmall" onClick={handleNewConversation}>
                      <Plus size={13} aria-hidden="true" />
                      <span>New conversation</span>
                    </button>
                  )}
                  <span id="composer-hint" className="composer-hint mono xsmall faint">
                    Enter to send, Shift+Enter for a new line
                  </span>
                </div>
              </div>
              <p id="mode-help" className="xsmall muted mode-help">{activeMode.help}</p>
            </div>
          </div>
        </main>
      </div>

      <div className="sr-only" role="status" aria-live="polite">{announcement}</div>

      <EvidenceDrawer
        isOpen={Boolean(selectedEvidence)}
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
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
