'use client';

import React from 'react';
import { ArchitectureGraphData } from '@repo/shared';
import { ArrowRight } from 'lucide-react';

interface ArchitectureGraphProps {
  data: ArchitectureGraphData;
}

export const ArchitectureGraph: React.FC<ArchitectureGraphProps> = ({ data }) => {
  if (!data || !data.nodes || data.nodes.length === 0) {
    return null;
  }

  const nodeLabels = new Map(data.nodes.map((n) => [n.id, n.label]));

  return (
    <section className="arch" aria-label="Proposed architecture">
      <div className="rule-head" style={{ marginBottom: 0 }}>
        <span className="label">Proposed architecture</span>
        <span className="count">
          {data.nodes.length} {data.nodes.length === 1 ? 'component' : 'components'}
        </span>
      </div>

      <div className="arch-nodes">
        {data.nodes.map((node) => (
          <div key={node.id} className="arch-node">
            <span className="arch-node-label">{node.label}</span>
            {node.role && <span className="small muted">{node.role}</span>}
            {node.domain && (
              <span className="tag tag-mono" style={{ alignSelf: 'flex-start', marginTop: 'var(--s-1)' }}>
                {node.domain}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Edges: each drawn between its real endpoints (never inferred from node order) */}
      {(data.edges || []).length > 0 && (
        <div className="arch-edges">
          {data.edges.map((edge, index) => {
            const from = nodeLabels.get(edge.from) || edge.from;
            const to = nodeLabels.get(edge.to) || edge.to;
            return (
              <div key={`${edge.from}-${edge.to}-${index}`} className="arch-edge">
                <strong style={{ fontWeight: 600 }}>{from}</strong>
                <span className="arch-edge-rel">
                  <span>{edge.label || edge.relationship}</span>
                  <ArrowRight size={13} aria-hidden="true" style={{ color: 'var(--signal-text)' }} />
                </span>
                <strong style={{ fontWeight: 600 }}>{to}</strong>
                {edge.boundary && (
                  <span className="badge badge-outline">{edge.boundary}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
