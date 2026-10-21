'use client';

import React from 'react';
import Link from 'next/link';
import { AlertCircle, ArrowUpRight, CheckCircle2, MinusCircle } from 'lucide-react';
import { BlueprintComponent, BlueprintItem, BlueprintSource, BriefBlueprint, EngineeringBlueprint } from '@repo/shared';
import { IndexingProgress } from '@/components/IndexingState';
import { Feedback } from '@/components/briefs/Feedback';

const DECISION_LABEL: Record<string, string> = { reuse: 'Reuse', adapt: 'Adapt', investigate: 'Investigate', build: 'Build' };
const DECISION_TONE: Record<string, string> = { reuse: 'badge-verified', adapt: 'badge-inferred', investigate: 'badge-neutral', build: 'badge-outline' };
// Evidence grades (PRODUCT_DEFINITION 5.1)
const GRADE_TONE: Record<string, string> = { E1: 'badge-verified', E2: 'badge-verified', E3: 'badge-neutral', E4: 'badge-inferred', E5: 'badge-outline' };
const GRADE_HELP: Record<string, string> = {
  E1: 'Executed: observed by running the code',
  E2: 'Verified in code at a file, lines and commit',
  E3: 'Officially documented or reported by the platform',
  E4: 'Claimed by a README or article; not yet checked',
  E5: 'Inferred by Open Eye'
};
const EVIDENCE_LABEL: Record<string, string> = { verified: 'verified in code', unconfirmed: 'unconfirmed', none: '' };

/** Verification progress, then the blueprint: what to reuse, how to integrate it, what is left to build. */
export const BlueprintSection: React.FC<{ blueprint: BriefBlueprint }> = ({ blueprint }) => {
  const sources = new Map((blueprint.blueprint?.sources || []).map((s) => [s.id, s]));

  return (
    <section style={{ marginBottom: 'var(--s-7)' }} aria-labelledby="blueprint-heading">
      <div className="rule-head">
        <h2 id="blueprint-heading" className="label">Engineering blueprint</h2>
      </div>

      {blueprint.status === 'WAITING' && <Verification blueprint={blueprint} />}

      {blueprint.status === 'RUNNING' && (
        <div className="loading-line" role="status">
          <span className="dot dot-pulse" aria-hidden="true" />
          Writing the blueprint from the verified evidence&hellip;
        </div>
      )}

      {blueprint.status === 'FAILED' && (
        <div className="callout callout-danger" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <div>
            <div className="callout-title">The blueprint could not be written.</div>
            <div>{blueprint.errorMessage || 'Run discovery again to retry.'}</div>
          </div>
        </div>
      )}

      {blueprint.status === 'COMPLETED' && blueprint.blueprint && <Blueprint data={blueprint.blueprint} sources={sources} />}
    </section>
  );
};

const Verification: React.FC<{ blueprint: BriefBlueprint }> = ({ blueprint }) => (
  <div className="stack gap-3">
    <p className="small muted">
      Reading the code of the strongest starting points to check what their READMEs claim. The blueprint is written
      when they are done.
    </p>
    {blueprint.verification.length === 0 && <p className="small muted">No repository could be verified; the blueprint will rest on README assessments.</p>}
    {blueprint.verification.map((v) => {
      const status = v.state === 'skipped' ? 'SKIPPED' : v.repositoryStatus || 'PENDING';
      const done = status === 'READY' || status === 'FAILED' || status === 'SKIPPED';
      return (
        <div key={v.fullName} className="card-sunk stack gap-2" style={{ padding: 'var(--s-3) var(--s-4)', borderRadius: 'var(--r-md)' }}>
          <div className="row between gap-3">
            <strong className="mono small">{v.fullName}</strong>
            <span className="small muted row gap-1">
              {status === 'READY' && <><CheckCircle2 size={13} aria-hidden="true" /> verified</>}
              {status === 'FAILED' && <><AlertCircle size={13} aria-hidden="true" /> indexing failed</>}
              {status === 'SKIPPED' && <><MinusCircle size={13} aria-hidden="true" /> not indexable</>}
              {v.state === 'reused' && status === 'READY' && ' (already in the library)'}
            </span>
          </div>
          {!done && <IndexingProgress status={status} step={v.jobStep} resourceType="github_repository" compact />}
          {v.state === 'skipped' && v.reason && <span className="xsmall faint">{v.reason}</span>}
        </div>
      );
    })}
  </div>
);

const Blueprint: React.FC<{ data: EngineeringBlueprint; sources: Map<string, BlueprintSource> }> = ({ data, sources }) => {
  const reused = data.components.filter((c) => c.decision === 'reuse' || c.decision === 'adapt').length;
  const investigate = data.components.filter((c) => c.decision === 'investigate').length;
  return (
    <div className="stack gap-6">
      {data.summary && <p className="lede" style={{ maxWidth: '80ch' }}>{data.summary}</p>}

      <div className="small muted">
        {reused} of {data.components.length} requirements are covered by existing repositories with code evidence
        {investigate > 0 ? `, ${investigate} more need investigation` : ''}.{' '}
        {data.verification.filter((v) => v.status === 'verified').length} of {data.verification.length} recommended repositories were verified against their code.
      </div>

      <div className="stack gap-3">
        <h3 className="label">Requirement by requirement</h3>
        {data.components.map((c) => <ComponentRow key={c.requirement} component={c} sources={sources} />)}
      </div>

      {data.integrationSteps.length > 0 && (
        <div className="stack gap-3">
          <h3 className="label">How to integrate</h3>
          <ol className="stack gap-3" style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
            {data.integrationSteps.map((step, i) => (
              <li key={i}>
                <strong>{step.title}</strong>
                {step.detail && <span className="muted"> &mdash; {step.detail}</span>}
                <Citations ids={step.sources} sources={sources} />
              </li>
            ))}
          </ol>
        </div>
      )}

      {data.toBuild.length > 0 && <ItemList title="Left to build" items={data.toBuild} sources={sources} />}
      {data.risks.length > 0 && <ItemList title="Risks" items={data.risks} sources={sources} />}

      {data.sources.length > 0 && (
        <details className="disclosure">
          <summary className="label">Sources ({data.sources.length})</summary>
          <ol className="stack gap-2" style={{ listStyle: 'none', padding: 0, marginTop: 'var(--s-3)' }}>
            {data.sources.map((s) => (
              <li key={s.id} id={`source-${s.id}`} className="small">
                <span className="mono">[{s.id}]</span>{' '}
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="link">
                  {s.repo}{s.filePath ? ` · ${s.filePath}${s.startLine ? `:${s.startLine}${s.endLine && s.endLine !== s.startLine ? `-${s.endLine}` : ''}` : ''}` : ''}
                  <ArrowUpRight size={12} aria-hidden="true" />
                </a>{' '}
                <span className="faint">{s.kind === 'code' ? 'verified code' : s.kind === 'readme' ? 'README' : 'limitation'}</span>
                {s.grade && <span className={`badge ${GRADE_TONE[s.grade] || 'badge-outline'}`} title={GRADE_HELP[s.grade]} style={{ marginLeft: 6 }}>{s.grade}</span>}
                {s.claimStatus === 'needs_revalidation' && <span className="badge badge-inferred" style={{ marginLeft: 6 }}>source changed since verified</span>}
                <div className="muted">{s.title}{s.text ? `: ${s.text}` : ''}</div>
                {s.quote && <pre className="quote-well mono xsmall" style={{ whiteSpace: 'pre-wrap', margin: 'var(--s-1) 0 0' }}>{s.quote}</pre>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
};

const ComponentRow: React.FC<{ component: BlueprintComponent; sources: Map<string, BlueprintSource> }> = ({ component: c, sources }) => (
  <div className="row gap-3" style={{ alignItems: 'flex-start' }}>
    <span className={`badge ${DECISION_TONE[c.decision]}`} style={{ flexShrink: 0, minWidth: 64, justifyContent: 'center' }}>
      {DECISION_LABEL[c.decision]}
    </span>
    <div className="stack gap-1" style={{ minWidth: 0 }}>
      <div className="row wrap gap-2">
        <strong>{c.requirement}</strong>
        {c.isConstraint && <span className="tag">constraint</span>}
        {c.repo && (
          <a href={`https://github.com/${c.repo}`} target="_blank" rel="noopener noreferrer" className="link mono small">
            {c.repo}
          </a>
        )}
        {EVIDENCE_LABEL[c.evidence] && <span className="xsmall faint">{EVIDENCE_LABEL[c.evidence]}</span>}
        <Feedback kind="blueprint_decision" target={c.requirement} subject={`the decision for ${c.requirement}`} />
      </div>
      {c.how && <span className="small muted">{c.how}</span>}
      <Citations ids={c.sources} sources={sources} />
    </div>
  </div>
);

const ItemList: React.FC<{ title: string; items: BlueprintItem[]; sources: Map<string, BlueprintSource> }> = ({ title, items, sources }) => (
  <div className="stack gap-3">
    <h3 className="label">{title}</h3>
    <ul className="stack gap-2" style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
      {items.map((item, i) => (
        <li key={i}>
          <strong>{item.title}</strong>
          {item.detail && <span className="muted"> &mdash; {item.detail}</span>}
          <Citations ids={item.sources} sources={sources} />
        </li>
      ))}
    </ul>
  </div>
);

const Citations: React.FC<{ ids?: string[]; sources: Map<string, BlueprintSource> }> = ({ ids, sources }) => {
  if (!ids || ids.length === 0) return null;
  return (
    <span className="row wrap gap-1" style={{ display: 'inline-flex', marginLeft: 6 }}>
      {ids.map((id) => {
        const s = sources.get(id);
        if (!s) return null;
        return (
          <Link
            key={id}
            href={`#source-${id}`}
            className="cite-ref mono xsmall"
            title={`${s.repo}${s.filePath ? ` · ${s.filePath}` : ''}: ${s.title}`}
            onClick={() => {
              const details = document.getElementById(`source-${id}`)?.closest('details');
              if (details) details.open = true;
            }}
          >
            [{id}]
          </Link>
        );
      })}
    </span>
  );
};
