'use client';

import React from 'react';
import { ArchitectureGraphData } from '@repo/shared';
import { Server, Cpu, Database, ArrowRight, Layers } from 'lucide-react';

interface ArchitectureGraphProps {
  data: ArchitectureGraphData;
}

export const ArchitectureGraph: React.FC<ArchitectureGraphProps> = ({ data }) => {
  if (!data || !data.nodes || data.nodes.length === 0) {
    return null;
  }

  return (
    <div style={{
      margin: '20px 0',
      padding: '20px',
      borderRadius: 'var(--radius-md)',
      background: 'rgba(15, 23, 42, 0.75)',
      border: '1px solid var(--border-subtle)',
      backdropFilter: 'blur(12px)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <Layers size={16} color="var(--accent-indigo)" />
        <h4 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Composed System Architecture ({data.nodes.length} Components)
        </h4>
      </div>

      {/* Nodes and Edges Layout */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 16,
        padding: '12px 0'
      }}>
        {data.nodes.map((node, index) => {
          const edge = data.edges.find(e => e.from === node.id);

          return (
            <React.Fragment key={node.id}>
              {/* Component Node */}
              <div style={{
                background: 'rgba(30, 41, 59, 0.8)',
                border: '1px solid rgba(99, 102, 241, 0.3)',
                borderRadius: 12,
                padding: '14px 18px',
                minWidth: 200,
                maxWidth: 260,
                boxShadow: '0 4px 14px rgba(0, 0, 0, 0.3)',
                position: 'relative',
                transition: 'all 0.2s ease'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <Cpu size={15} color="var(--accent-cyan)" />
                  <span style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {node.label}
                  </span>
                </div>

                <div style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', marginBottom: 8 }}>
                  {node.role}
                </div>

                {node.domain && (
                  <span style={{
                    fontSize: '0.675rem',
                    padding: '2px 8px',
                    borderRadius: 4,
                    background: 'rgba(6, 182, 212, 0.12)',
                    color: '#67e8f9',
                    border: '1px solid rgba(6, 182, 212, 0.25)',
                    fontFamily: 'var(--font-mono)'
                  }}>
                    {node.domain}
                  </span>
                )}
              </div>

              {/* Edge / Boundary Connector */}
              {edge && (
                <div style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: '0 4px'
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: '0.725rem',
                    color: 'var(--accent-cyan)',
                    background: 'rgba(6, 182, 212, 0.08)',
                    padding: '3px 8px',
                    borderRadius: 6,
                    border: '1px solid rgba(6, 182, 212, 0.2)'
                  }}>
                    <span>{edge.label || edge.relationship}</span>
                    <ArrowRight size={13} />
                  </div>
                  {edge.boundary && (
                    <span style={{
                      fontSize: '0.65rem',
                      color: 'var(--text-muted)',
                      fontFamily: 'var(--font-mono)'
                    }}>
                      [{edge.boundary}]
                    </span>
                  )}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
