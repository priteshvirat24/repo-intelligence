'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  Send,
  Sparkles,
  Layers,
  Database,
  Search,
  ArrowUpRight,
  Code,
  Star,
  CheckCircle2,
  Clock,
  AlertTriangle,
  FileCode,
  Compass,
  Cpu,
  RefreshCw,
  Globe,
  Youtube,
  FileText,
  Linkedin,
  GitBranch,
  BookmarkPlus,
  ExternalLink,
  BookOpen
} from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { AddResourceModal } from '@/components/AddResourceModal';
import { ArchitectureGraph } from '@/components/ArchitectureGraph';
import { EvidenceDrawer, EvidenceItem } from '@/components/EvidenceDrawer';
import {
  RequirementCard,
  CandidateRepoCard,
  OverlapNotice,
  MissingCapabilityNotice
} from '@/components/ChatCards';
import {
  OpenQueryRequirements,
  CompositionPlan,
  ArchitectureGraphData,
  CandidateScore,
  ResourceCitation,
  WebSearchResult,
  ChatSourceMode,
  ResourceType
} from '@repo/shared';

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

  const getSourceIcon = (type?: string) => {
    switch (type) {
      case 'github_repository': return <GitBranch size={14} color="var(--accent-indigo)" />;
      case 'youtube_video': return <Youtube size={14} color="#ef4444" />;
      case 'linkedin_post': return <Linkedin size={14} color="#0284c7" />;
      case 'pdf':
      case 'research_paper': return <FileText size={14} color="#f59e0b" />;
      default: return <Globe size={14} color="var(--accent-cyan)" />;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      <Navbar
        onOpenAddModal={() => setIsAddModalOpen(true)}
        resourceCount={resources.length}
      />

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left Sidebar: Indexed Knowledge Shelf */}
        <div style={{
          width: 320,
          borderRight: '1px solid var(--border-subtle)',
          background: 'rgba(10, 15, 26, 0.7)',
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 16px',
          gap: 16
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Database size={16} color="var(--accent-cyan)" />
              <span style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                Open Eye Shelf
              </span>
            </div>
            <Link href="/resources" style={{ fontSize: '0.75rem', color: 'var(--accent-indigo)', textDecoration: 'none', fontWeight: 600 }}>
              View All ({resources.length})
            </Link>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {resources.length === 0 ? (
              <div style={{ padding: '30px 10px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                No resources indexed yet.
              </div>
            ) : (
              resources.slice(0, 10).map((r) => (
                <div
                  key={r.id}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: 'rgba(255, 255, 255, 0.03)',
                    border: '1px solid var(--border-subtle)',
                    fontSize: '0.85rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                    {getSourceIcon(r.resourceType)}
                    <span style={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      color: 'var(--text-primary)'
                    }}>
                      {r.title}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {r.problemsSolved?.[0] || r.sourceDomain}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Quick Problem Inspirations */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', display: 'block', marginBottom: 8, textTransform: 'uppercase' }}>
              Try Questions
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button
                onClick={() => handleSendMessage('What can our indexed collection collectively do?')}
                style={{
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-cyan)',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  padding: 2
                }}
              >
                • What can our collection do?
              </button>
              <button
                onClick={() => handleSendMessage('Find open-source tools and tutorials for satellite image segmentation.')}
                style={{
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-cyan)',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  padding: 2
                }}
              >
                • Satellite image segmentation
              </button>
              <button
                onClick={() => handleSendMessage('Build a production research agent with browser automation.')}
                style={{
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-cyan)',
                  fontSize: '0.78rem',
                  cursor: 'pointer',
                  padding: 2
                }}
              >
                • Autonomous research agent
              </button>
            </div>
          </div>
        </div>

        {/* Center: Main Chat Studio */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Chat Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
            {messages.length === 0 ? (
              <div style={{ maxWidth: 760, margin: '60px auto', textAlign: 'center' }}>
                <div style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: 'linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 20px',
                  boxShadow: '0 0 25px rgba(99, 102, 241, 0.4)'
                }}>
                  <span style={{ fontSize: '1.8rem' }}>👁️</span>
                </div>
                <h2 style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 10px', letterSpacing: '-0.02em' }}>
                  Open Eye Studio
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '1rem', lineHeight: 1.6, margin: '0 auto 30px' }}>
                  Universal resource intelligence connecting software repositories, video tutorials, technical articles, and live web discoveries to solve complex engineering challenges.
                </p>

                {/* Mode Selector Pill in Empty State */}
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 8px',
                  borderRadius: 12,
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid var(--border-subtle)',
                  marginBottom: 32
                }}>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', padding: '0 8px', fontWeight: 600 }}>Knowledge Mode:</span>
                  {(['INTERNAL', 'WEB', 'BOTH'] as ChatSourceMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setSourceMode(m)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 8,
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        border: sourceMode === m ? '1px solid rgba(99, 102, 241, 0.5)' : 'none',
                        background: sourceMode === m ? 'rgba(99, 102, 241, 0.25)' : 'transparent',
                        color: sourceMode === m ? '#ffffff' : 'var(--text-secondary)',
                        cursor: 'pointer'
                      }}
                    >
                      {m === 'INTERNAL' ? 'Open Eye' : m === 'WEB' ? 'Live Web' : 'Both (Hybrid)'}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
                {messages.map((msg) => (
                  <div key={msg.id} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {msg.role === 'user' ? (
                      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <div style={{
                          maxWidth: '75%',
                          padding: '14px 20px',
                          borderRadius: '16px 16px 2px 16px',
                          background: 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)',
                          color: '#ffffff',
                          fontSize: '0.95rem',
                          lineHeight: 1.5,
                          boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)'
                        }}>
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {/* Source Indicator Badge */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{
                            padding: '3px 10px',
                            borderRadius: 20,
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            letterSpacing: '0.04em',
                            background: msg.sourcesUsed?.includes('WEB') ? 'rgba(6, 182, 212, 0.15)' : 'rgba(99, 102, 241, 0.15)',
                            color: msg.sourcesUsed?.includes('WEB') ? 'var(--accent-cyan)' : 'var(--accent-indigo)',
                            border: `1px solid ${msg.sourcesUsed?.includes('WEB') ? 'rgba(6, 182, 212, 0.3)' : 'rgba(99, 102, 241, 0.3)'}`
                          }}>
                            SOURCES: {msg.sourcesUsed || 'OPEN EYE'}
                          </span>
                        </div>

                        {/* Live Web Discoveries Section if any */}
                        {msg.webSources && msg.webSources.length > 0 && (
                          <div style={{
                            padding: 16,
                            borderRadius: 12,
                            background: 'rgba(6, 182, 212, 0.05)',
                            border: '1px solid rgba(6, 182, 212, 0.2)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 12
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-cyan)' }}>
                              <Globe size={14} />
                              <span>Live Web Discoveries (Tavily)</span>
                            </div>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
                              {msg.webSources.map((w, idx) => {
                                const isSaved = savedWebUrls.has(w.url);
                                const isSaving = savingWebUrls.has(w.url);

                                return (
                                  <div
                                    key={idx}
                                    style={{
                                      padding: 12,
                                      borderRadius: 8,
                                      background: 'rgba(15, 23, 42, 0.7)',
                                      border: '1px solid var(--border-subtle)',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      justifyContent: 'space-between',
                                      gap: 8
                                    }}
                                  >
                                    <div>
                                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>
                                        {w.title}
                                      </div>
                                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                                        {w.domain}
                                      </div>
                                      <p style={{
                                        fontSize: '0.8rem',
                                        color: 'var(--text-secondary)',
                                        margin: 0,
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden'
                                      }}>
                                        {w.content}
                                      </p>
                                    </div>

                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
                                      <a
                                        href={w.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                                      >
                                        <ExternalLink size={12} />
                                        <span>Open</span>
                                      </a>

                                      <button
                                        onClick={() => handleSaveWebSource(w)}
                                        disabled={isSaved || isSaving}
                                        style={{
                                          display: 'flex',
                                          alignItems: 'center',
                                          gap: 4,
                                          padding: '4px 8px',
                                          borderRadius: 6,
                                          background: isSaved ? 'rgba(16, 185, 129, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                                          border: `1px solid ${isSaved ? 'rgba(16, 185, 129, 0.4)' : 'rgba(99, 102, 241, 0.4)'}`,
                                          color: isSaved ? '#10b981' : '#ffffff',
                                          fontSize: '0.75rem',
                                          fontWeight: 600,
                                          cursor: isSaved || isSaving ? 'default' : 'pointer'
                                        }}
                                      >
                                        <BookmarkPlus size={12} />
                                        <span>{isSaved ? 'Saved to Open Eye' : isSaving ? 'Saving...' : 'Save to Open Eye'}</span>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Synthesis Content */}
                        <div className="glass-panel" style={{ padding: 24, fontSize: '0.95rem', lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                          {msg.content || 'Thinking & reasoning over universal resources...'}
                        </div>

                        {/* Architecture Graph if generated */}
                        {msg.architectureGraph && msg.architectureGraph.nodes.length > 0 && (
                          <div style={{ marginTop: 8 }}>
                            <ArchitectureGraph data={msg.architectureGraph} />
                          </div>
                        )}

                        {/* Citations Box */}
                        {msg.citations && msg.citations.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                              Source-Aware Citations ({msg.citations.length})
                            </span>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {msg.citations.map((c, i) => (
                                <button
                                  key={i}
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
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    padding: '6px 12px',
                                    borderRadius: 6,
                                    background: 'rgba(15, 23, 42, 0.8)',
                                    border: '1px solid rgba(16, 185, 129, 0.3)',
                                    color: '#10b981',
                                    fontSize: '0.8rem',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                  }}
                                >
                                  {getSourceIcon(c.resourceType)}
                                  <span>{c.formattedCitation}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Bottom Chat Input Bar */}
          <div style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'rgba(9, 13, 22, 0.9)'
          }}>
            <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Mode Toggle Controls */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>Knowledge Source:</span>
                  {(['INTERNAL', 'WEB', 'BOTH'] as ChatSourceMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSourceMode(m)}
                      style={{
                        padding: '3px 10px',
                        borderRadius: 6,
                        fontSize: '0.75rem',
                        fontWeight: 600,
                        border: sourceMode === m ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid transparent',
                        background: sourceMode === m ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                        color: sourceMode === m ? '#ffffff' : 'var(--text-secondary)',
                        cursor: 'pointer'
                      }}
                    >
                      {m === 'INTERNAL' ? 'Open Eye' : m === 'WEB' ? 'Web' : 'Both'}
                    </button>
                  ))}
                </div>

                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  Press Enter to send
                </div>
              </div>

              {/* Textarea Input Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleSendMessage();
                }}
                style={{ display: 'flex', gap: 10 }}
              >
                <input
                  type="text"
                  placeholder="Ask Open Eye an architectural question, request web research, or connect resources..."
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  disabled={isLoading}
                  style={{
                    flex: 1,
                    padding: '14px 18px',
                    borderRadius: 10,
                    background: 'rgba(15, 23, 42, 0.85)',
                    border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)',
                    fontSize: '0.95rem',
                    outline: 'none'
                  }}
                />
                <button
                  type="submit"
                  disabled={isLoading || !inputQuery.trim()}
                  style={{
                    padding: '0 24px',
                    borderRadius: 10,
                    background: isLoading || !inputQuery.trim()
                      ? 'rgba(99, 102, 241, 0.4)'
                      : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                    color: '#ffffff',
                    border: 'none',
                    fontWeight: 600,
                    cursor: isLoading || !inputQuery.trim() ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  <Send size={16} />
                  <span>Send</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>

      {/* Evidence Drawer */}
      <EvidenceDrawer
        isOpen={Boolean(selectedEvidence)}
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
      />

      {/* Add Resource Modal */}
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
      <div style={{
        minHeight: '100vh',
        background: '#090d16',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '1rem',
        fontWeight: 600
      }}>
        Loading Open Eye Studio...
      </div>
    }>
      <StudioChatContent />
    </React.Suspense>
  );
}
