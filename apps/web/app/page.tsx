'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
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
  RefreshCw
} from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { AddRepositoryModal } from '@/components/AddRepositoryModal';
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
  CandidateScore
} from '@repo/shared';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  requirements?: OpenQueryRequirements;
  composition?: CompositionPlan;
  architectureGraph?: ArchitectureGraphData;
  citations?: EvidenceItem[];
}

export default function StudioChatPage() {
  const [repositories, setRepositories] = useState<any[]>([]);
  const [capabilities, setCapabilities] = useState<any[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputQuery, setInputQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState<EvidenceItem | null>(null);
  const [repoSearch, setRepoSearch] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch initial repositories and capabilities
  const fetchRepositories = async () => {
    try {
      const res = await fetch('/api/repositories');
      if (res.ok) {
        const data = await res.json();
        setRepositories(data.repositories || []);
      }
    } catch (err) {
      console.error('Error fetching repositories:', err);
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
    fetchRepositories();
    fetchCapabilities();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = async (queryText?: string) => {
    const textToSend = queryText || inputQuery;
    if (!textToSend.trim() || isLoading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: textToSend.trim()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputQuery('');
    setIsLoading(true);

    const assistantMsgId = (Date.now() + 1).toString();
    const assistantMsg: Message = {
      id: assistantMsgId,
      role: 'assistant',
      content: ''
    };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      const historyPayload = messages.map(m => ({ role: m.role, content: m.content }));
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: textToSend, history: historyPayload })
      });

      if (!response.ok || !response.body) {
        throw new Error('Failed to start chat stream');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const block of lines) {
          const trimmed = block.trim();
          if (!trimmed) continue;

          const eventMatch = trimmed.match(/^event:\s*(\w+)/);
          const dataMatch = trimmed.match(/data:\s*(.+)$/m);
          if (!dataMatch) continue;

          const eventType = eventMatch ? eventMatch[1] : 'message';
          const payload = JSON.parse(dataMatch[1]);

          if (eventType === 'metadata') {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      requirements: payload.requirements,
                      composition: payload.composition,
                      architectureGraph: payload.architectureGraph,
                      citations: payload.citations
                    }
                  : m
              )
            );
          } else if (eventType === 'message') {
            setMessages(prev =>
              prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, content: m.content + (payload.text || '') }
                  : m
              )
            );
          }
        }
      }
    } catch (err: any) {
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantMsgId
            ? { ...m, content: `Error generating response: ${err.message}` }
            : m
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const filteredRepos = repositories.filter(r => {
    const full = `${r.owner}/${r.name} ${r.description || ''}`.toLowerCase();
    return full.includes(repoSearch.toLowerCase());
  });

  const exampleQueries = [
    'Track satellites on an interactive 3D globe and detect objects from imagery',
    'Monitor construction progress using satellite imagery and temporal change detection',
    'Build an autonomous research agent with persistent memory and web crawling',
    'What can our collection do?',
    'What capabilities are missing from our current repository collection?'
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <Navbar onOpenAddModal={() => setIsAddModalOpen(true)} repoCount={repositories.length} />

      {/* Main Studio Split Layout */}
      <div style={{
        display: 'flex',
        flex: 1,
        maxWidth: 1600,
        margin: '0 auto',
        width: '100%',
        padding: '20px 24px',
        gap: 24,
        overflow: 'hidden'
      }}>
        {/* Left Sidebar: Repositories & Discovered Capabilities */}
        <aside style={{
          width: 340,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 20
        }}>
          {/* Indexed Repositories Panel */}
          <div className="glass-panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', maxHeight: '50vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', fontWeight: 600 }}>
                <Database size={16} color="var(--accent-cyan)" />
                <span>Indexed Repositories ({repositories.length})</span>
              </div>
              <button
                onClick={fetchRepositories}
                style={{ color: 'var(--text-muted)', padding: 4 }}
                title="Refresh repositories"
              >
                <RefreshCw size={14} />
              </button>
            </div>

            {/* Filter Search */}
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                placeholder="Filter repositories..."
                value={repoSearch}
                onChange={e => setRepoSearch(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 10px 8px 30px',
                  borderRadius: 6,
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.8rem',
                  outline: 'none'
                }}
              />
            </div>

            {/* Repositories List */}
            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredRepos.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                  No indexed repositories match.
                </div>
              ) : (
                filteredRepos.map(r => (
                  <Link
                    key={r.id}
                    href={`/repositories/${r.id}`}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      padding: '10px 12px',
                      borderRadius: 8,
                      background: 'rgba(30, 41, 59, 0.4)',
                      border: '1px solid var(--border-subtle)',
                      transition: 'background 0.2s',
                      textDecoration: 'none'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {r.name}
                      </span>
                      <span className={`badge-${r.status.toLowerCase()}`} style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: 4 }}>
                        {r.status}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.725rem', color: 'var(--text-muted)' }}>
                      {r.primaryLanguage && <span>{r.primaryLanguage}</span>}
                      <span>★ {r.stars || 0}</span>
                      {r.domainTags?.[0] && (
                        <span style={{ color: 'var(--accent-cyan)' }}>#{r.domainTags[0]}</span>
                      )}
                    </div>
                  </Link>
                ))
              )}
            </div>
          </div>

          {/* Discovered Capabilities Panel */}
          <div className="glass-panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', flex: 1, minHeight: 220 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.9rem', fontWeight: 600 }}>
                <Layers size={16} color="var(--accent-indigo)" />
                <span>Discovered Capabilities</span>
              </div>
              <Link href="/capabilities" style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: 4 }}>
                View All
                <ArrowUpRight size={12} />
              </Link>
            </div>

            <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
              {capabilities.length === 0 ? (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', padding: '20px 0' }}>
                  Ingest repositories to discover capabilities.
                </div>
              ) : (
                capabilities.slice(0, 10).map((cap, i) => (
                  <div
                    key={i}
                    onClick={() => handleSendMessage(`Which repository provides '${cap.name}' and how is it implemented?`)}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '7px 10px',
                      borderRadius: 6,
                      background: 'rgba(15, 23, 42, 0.4)',
                      border: '1px solid var(--border-subtle)',
                      cursor: 'pointer',
                      fontSize: '0.775rem'
                    }}
                  >
                    <span style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                      {cap.name}
                    </span>
                    <span style={{
                      fontSize: '0.675rem',
                      padding: '2px 6px',
                      borderRadius: 4,
                      background: 'rgba(99, 102, 241, 0.15)',
                      color: '#a5b4fc',
                      fontFamily: 'var(--font-mono)'
                    }}>
                      {cap.repoCount} {cap.repoCount === 1 ? 'repo' : 'repos'}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </aside>

        {/* Center / Main Chat Studio */}
        <main className="glass-panel" style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative'
        }}>
          {/* Chat Messages Stream */}
          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 24
          }}>
            {messages.length === 0 ? (
              <div style={{
                margin: 'auto 0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: 16,
                padding: '40px 20px'
              }}>
                <div style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.2) 0%, rgba(6, 182, 212, 0.2) 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid rgba(99, 102, 241, 0.4)'
                }}>
                  <Sparkles size={28} color="var(--accent-cyan)" />
                </div>
                <div>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 700, marginBottom: 8 }}>
                    Open-World Repository Intelligence Studio
                  </h2>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', maxWidth: 580, margin: '0 auto' }}>
                    Describe any technical problem. Repo Intelligence identifies domain requirements, evaluates indexed repositories, reasons across multi-repository architectures, and grounds conclusions in verified code evidence.
                  </p>
                </div>

                {/* Example Query Pills */}
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 10,
                  maxWidth: 720,
                  justifyContent: 'center',
                  marginTop: 12
                }}>
                  {exampleQueries.map((q, i) => (
                    <button
                      key={i}
                      onClick={() => handleSendMessage(q)}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 20,
                        background: 'rgba(30, 41, 59, 0.6)',
                        border: '1px solid var(--border-subtle)',
                        color: 'var(--text-primary)',
                        fontSize: '0.8rem',
                        transition: 'all 0.2s',
                        textAlign: 'left'
                      }}
                      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-cyan)')}
                      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border-subtle)')}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map(msg => (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    gap: 12,
                    maxWidth: '100%'
                  }}
                >
                  {/* Message Bubble */}
                  <div style={{
                    maxWidth: msg.role === 'user' ? '80%' : '100%',
                    width: msg.role === 'user' ? 'auto' : '100%',
                    padding: msg.role === 'user' ? '12px 18px' : '20px 24px',
                    borderRadius: 14,
                    background: msg.role === 'user'
                      ? 'linear-gradient(135deg, #4f46e5 0%, #4338ca 100%)'
                      : 'rgba(15, 23, 42, 0.65)',
                    border: msg.role === 'user' ? 'none' : '1px solid var(--border-subtle)',
                    color: '#ffffff',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.2)'
                  }}>
                    {msg.role === 'user' ? (
                      <div style={{ fontSize: '0.95rem', lineHeight: 1.5 }}>
                        {msg.content}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {/* 1. Requirements Section (if present) */}
                        {msg.requirements && msg.requirements.requirements.length > 0 && (
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-indigo)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                              Discovered Domain Requirements ({msg.requirements.domains.join(', ')})
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
                              {msg.requirements.requirements.map((r, i) => (
                                <RequirementCard key={i} requirement={r} />
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 2. Candidate Repositories */}
                        {msg.composition && msg.composition.recommendedRepositories.length > 0 && (
                          <div>
                            <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--accent-cyan)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                              Recommended Candidate Repositories
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
                              {msg.composition.recommendedRepositories.map((cand, i) => (
                                <CandidateRepoCard key={i} candidate={cand} />
                              ))}
                            </div>
                          </div>
                        )}

                        {/* 3. Architecture Graph */}
                        {msg.architectureGraph && (
                          <ArchitectureGraph data={msg.architectureGraph} />
                        )}

                        {/* 4. Redundancies & Overlaps */}
                        {msg.composition?.redundancies && msg.composition.redundancies.length > 0 && (
                          <div>
                            {msg.composition.redundancies.map((red, i) => (
                              <OverlapNotice
                                key={i}
                                capabilityOrFeature={red.capabilityOrFeature}
                                overlappingRepositories={red.overlappingRepositories}
                                recommendation={red.recommendation}
                              />
                            ))}
                          </div>
                        )}

                        {/* 5. Missing Capabilities */}
                        {msg.composition?.uncoveredRequirements && msg.composition.uncoveredRequirements.length > 0 && (
                          <MissingCapabilityNotice uncoveredRequirements={msg.composition.uncoveredRequirements} />
                        )}

                        {/* 6. Main Reasoning Text (Markdown) */}
                        <div style={{
                          fontSize: '0.925rem',
                          lineHeight: 1.7,
                          color: 'var(--text-primary)',
                          whiteSpace: 'pre-wrap'
                        }}>
                          {msg.content || (isLoading ? 'Analyzing repository knowledge and synthesizing architecture...' : '')}
                        </div>

                        {/* 7. Verified Evidence Citations */}
                        {msg.citations && msg.citations.length > 0 && (
                          <div style={{
                            marginTop: 12,
                            paddingTop: 14,
                            borderTop: '1px solid var(--border-subtle)'
                          }}>
                            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                              <CheckCircle2 size={13} color="var(--accent-emerald)" />
                              <span>Verified Citations (Click to inspect source code evidence):</span>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {msg.citations.map((cite, i) => (
                                <button
                                  key={i}
                                  onClick={() => setSelectedEvidence(cite)}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: '0.725rem',
                                    padding: '4px 10px',
                                    borderRadius: 6,
                                    background: 'rgba(16, 185, 129, 0.1)',
                                    color: '#6ee7b7',
                                    border: '1px solid rgba(16, 185, 129, 0.25)',
                                    cursor: 'pointer'
                                  }}
                                >
                                  <FileCode size={12} />
                                  <span>{cite.repo}#{cite.filePath}{cite.lines ? `:${cite.lines}` : ''}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Chat Input Bar */}
          <div style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border-subtle)',
            background: 'rgba(9, 13, 22, 0.85)',
            backdropFilter: 'blur(12px)'
          }}>
            <form
              onSubmit={e => {
                e.preventDefault();
                handleSendMessage();
              }}
              style={{ display: 'flex', gap: 12, alignItems: 'center' }}
            >
              <input
                type="text"
                placeholder="Describe your engineering problem (e.g. 'Track satellites on 3D globe and detect changes over time')..."
                value={inputQuery}
                onChange={e => setInputQuery(e.target.value)}
                disabled={isLoading}
                style={{
                  flex: 1,
                  padding: '14px 18px',
                  borderRadius: 'var(--radius-md)',
                  background: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-primary)',
                  fontSize: '0.925rem',
                  outline: 'none',
                  boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.4)'
                }}
              />
              <button
                type="submit"
                disabled={isLoading || !inputQuery.trim()}
                style={{
                  padding: '14px 22px',
                  borderRadius: 'var(--radius-md)',
                  background: isLoading || !inputQuery.trim()
                    ? 'rgba(99, 102, 241, 0.3)'
                    : 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.9rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  cursor: isLoading || !inputQuery.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 10px rgba(99, 102, 241, 0.3)'
                }}
              >
                {isLoading ? <Clock size={16} className="animate-spin" /> : <Send size={16} />}
                <span>Send</span>
              </button>
            </form>
          </div>
        </main>
      </div>

      {/* Add Repository Modal */}
      <AddRepositoryModal
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          fetchRepositories();
          fetchCapabilities();
        }}
        onRepositoryAdded={() => {
          fetchRepositories();
          fetchCapabilities();
        }}
      />

      {/* Evidence Drawer Modal */}
      <EvidenceDrawer
        isOpen={Boolean(selectedEvidence)}
        evidence={selectedEvidence}
        onClose={() => setSelectedEvidence(null)}
      />
    </div>
  );
}
