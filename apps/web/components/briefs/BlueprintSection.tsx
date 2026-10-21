'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, ArrowUpRight, CheckCircle2, MinusCircle, Search, MessageSquare } from 'lucide-react';
import {
  BlueprintArchitecture,
  BlueprintChallenge,
  BlueprintChallengeResponse,
  BlueprintComponent,
  BlueprintFocus,
  BlueprintInventoryEntry,
  BlueprintItem,
  BlueprintRoadmapTask,
  BlueprintSource,
  BlueprintUncertainty,
  BriefBlueprint,
  BuildReuseClass,
  EngineeringBlueprint
} from '@repo/shared';
import { IndexingProgress } from '@/components/IndexingState';
import { formatRetryAfter, httpErrorTitle, readJsonSafe, retryAfterSeconds } from '@/lib/ui/api';

// Build-versus-reuse classes (PRODUCT_DEFINITION 5.4)
const CLASS_LABEL: Record<BuildReuseClass, string> = {
  1: 'Available and verified',
  2: 'Available, needs configuration',
  3: 'Available, needs modification',
  4: 'Partially solved',
  5: 'Missing, must be built',
  6: 'Unresolved'
};
const CLASS_TONE: Record<BuildReuseClass, string> = {
  1: 'badge-verified',
  2: 'badge-verified',
  3: 'badge-inferred',
  4: 'badge-inferred',
  5: 'badge-outline',
  6: 'badge-neutral'
};
// Blueprints written before Phase 3 have only a decision
const LEGACY_CLASS: Record<string, BuildReuseClass> = { reuse: 1, adapt: 3, build: 5, investigate: 6 };
const ACTION_TONE: Record<string, string> = { reuse: 'badge-verified', adapt: 'badge-inferred', investigate: 'badge-neutral', reject: 'badge-outline' };
const LICENCE_TONE: Record<string, string> = { compatible: 'badge-verified', flagged: 'badge-inferred', unknown: 'badge-inferred', conflict: 'badge-danger', missing: 'badge-danger' };
const ORIGIN_TONE: Record<string, string> = { reused: 'badge-verified', adapted: 'badge-inferred', new: 'badge-outline' };
// Evidence grades (PRODUCT_DEFINITION 5.1)
const GRADE_TONE: Record<string, string> = { E1: 'badge-verified', E2: 'badge-verified', E3: 'badge-neutral', E4: 'badge-inferred', E5: 'badge-outline' };
const GRADE_HELP: Record<string, string> = {
  E1: 'Executed: observed by running the code',
  E2: 'Verified in code at a file, lines and commit',
  E3: 'Officially documented or reported by the platform',
  E4: 'Claimed by a README or article; not yet checked',
  E5: 'Inferred by Open Eye'
};
const EVIDENCE_LABEL: Record<string, string> = { verified: 'verified in code', unconfirmed: 'unconfirmed', none: 'no evidence' };
const PHASE_LABEL: Record<string, string> = {
  prerequisites: 'Prerequisites',
  install: 'Install',
  configuration: 'Configuration',
  integration: 'Integration',
  verification: 'Verification'
};

type Sources = Map<string, BlueprintSource>;

interface Props {
  blueprint: BriefBlueprint;
  briefId?: string;
  /** Challenges stored on the brief; those the blueprint has not answered yet are shown as queued */
  challenges?: BlueprintChallenge[];
  focus?: BlueprintFocus[];
  /** false while a run is active: iterating then would only queue behind it */
  canIterate?: boolean;
  onChanged?: () => void;
}

const classOf = (c: BlueprintComponent): BuildReuseClass => c.class || LEGACY_CLASS[c.decision] || 5;

/** Verification progress, then the blueprint (PRODUCT_DEFINITION 5): recommendation, build-versus-reuse,
 * inventory, architecture, integration guide, roadmap, uncertainty and the sources behind all of them. */
export const BlueprintSection: React.FC<Props> = ({ blueprint, briefId, challenges = [], focus = [], canIterate = true, onChanged }) => {
  const data = blueprint.blueprint;
  const sources: Sources = new Map((data?.sources || []).map((s) => [s.id, s]));
  const answered = new Set((data?.challenges || []).map((c) => c.id).filter(Boolean));
  const queued = blueprint.status === 'COMPLETED' ? challenges.filter((c) => !answered.has(c.id)) : [];
  const revising = (blueprint.status === 'WAITING' || blueprint.status === 'RUNNING') && Boolean(data?.components?.length);

  return (
    <section style={{ marginBottom: 'var(--s-7)' }} aria-labelledby="blueprint-heading">
      <div className="rule-head">
        <h2 id="blueprint-heading" className="label">Engineering blueprint</h2>
        {data?.revision && data.revision > 1 && <span className="count">revision {data.revision}</span>}
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

      {queued.length > 0 && (
        <div className="callout callout-info" role="status" style={{ marginBottom: 'var(--s-4)' }}>
          <MessageSquare size={16} aria-hidden="true" />
          <div>{queued.length === 1 ? 'A challenge is' : `${queued.length} challenges are`} waiting for the blueprint to be written again.</div>
        </div>
      )}

      {revising && (
        <p className="small muted" role="status" style={{ margin: 'var(--s-4) 0' }}>
          Being revised. The previous blueprint is shown below until the new one replaces it.
        </p>
      )}

      {data && (blueprint.status === 'COMPLETED' || revising) && (
        <div style={revising ? { opacity: 0.7 } : undefined}>
          <Blueprint data={data} sources={sources} briefId={briefId} focus={focus} canIterate={canIterate && !revising} onChanged={onChanged} />
        </div>
      )}
    </section>
  );
};

const Verification: React.FC<{ blueprint: BriefBlueprint }> = ({ blueprint }) => (
  <div className="stack gap-3" style={{ marginBottom: 'var(--s-5)' }}>
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

const Blueprint: React.FC<{ data: EngineeringBlueprint; sources: Sources; briefId?: string; focus: BlueprintFocus[]; canIterate: boolean; onChanged?: () => void }> = ({
  data, sources, briefId, focus, canIterate, onChanged
}) => {
  const reused = data.components.filter((c) => c.decision === 'reuse' || c.decision === 'adapt').length;
  const investigate = data.components.filter((c) => c.decision === 'investigate').length;
  return (
    <div className="stack gap-6">
      <Executive data={data} sources={sources} />

      <div className="small muted">
        {reused} of {data.components.length} requirements are covered by existing repositories with code evidence
        {investigate > 0 ? `, ${investigate} more need investigation` : ''}.{' '}
        {data.verification.filter((v) => v.status === 'verified').length} of {data.verification.length} recommended repositories were verified against their code.
        {data.stages && Object.values(data.stages).includes('fallback') && ' Some sections were built from the evidence alone because the model output was unusable.'}
      </div>

      {(data.challenges?.length || 0) > 0 && <ChallengeAnswers answers={data.challenges!} sources={sources} />}
      {(data.changes?.length || 0) > 0 && (
        <Block title="What changed since the previous blueprint">
          <ul className="stack gap-2" style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
            {data.changes!.map((c) => (
              <li key={c.requirement} className="small">
                <strong>{c.requirement}</strong>:{' '}
                {c.from ? `class ${c.from.class ?? '?'}${c.from.repo ? ` (${c.from.repo})` : ''}` : 'new'} &rarr; class {c.to.class}
                {c.to.repo ? ` (${c.to.repo})` : ''}
                <span className="muted"> &mdash; {c.reason}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}

      <BuildVersusReuse data={data} sources={sources} briefId={briefId} focus={focus} canIterate={canIterate} onChanged={onChanged} />
      {data.inventory && data.inventory.length > 0 && <Inventory entries={data.inventory} sources={sources} policy={data.licencePolicy} />}
      {data.architecture && <Architecture arch={data.architecture} sources={sources} />}
      <IntegrationGuide steps={data.integrationSteps} sources={sources} />
      {data.roadmap ? <Roadmap tasks={data.roadmap} /> : data.toBuild.length > 0 && <ItemList title="Left to build" items={data.toBuild} sources={sources} />}
      {data.uncertainty && <Uncertainty report={data.uncertainty} sources={sources} />}
      {data.risks.length > 0 && <ItemList title="Risks" items={data.risks} sources={sources} />}
      <SourceList data={data} />
    </div>
  );
};

const Block: React.FC<{ title: string; note?: string; children: React.ReactNode }> = ({ title, note, children }) => (
  <div className="stack gap-3">
    <div className="row wrap between gap-2">
      <h3 className="label">{title}</h3>
      {note && <span className="xsmall faint">{note}</span>}
    </div>
    {children}
  </div>
);

const Executive: React.FC<{ data: EngineeringBlueprint; sources: Sources }> = ({ data, sources }) => {
  const exec = data.executive;
  if (!exec) return data.summary ? <p className="lede" style={{ maxWidth: '80ch' }}>{data.summary}</p> : null;
  return (
    <div className="card stack gap-4" aria-labelledby="executive-heading">
      <h3 id="executive-heading" className="label">Executive recommendation</h3>
      <p className="lede" style={{ maxWidth: '80ch', margin: 0 }}>{exec.strategy}</p>
      <div className="grid-2" style={{ gap: 'var(--s-4)', alignItems: 'start' }}>
        <div className="stack gap-2 small">
          <span className="label">Strongest building blocks</span>
          {exec.buildingBlocks.length ? (
            <div className="row wrap gap-2">
              {exec.buildingBlocks.map((repo) => (
                <a key={repo} href={`https://github.com/${repo}`} target="_blank" rel="noopener noreferrer" className="tag tag-mono">{repo}</a>
              ))}
            </div>
          ) : <span className="muted">None with code evidence.</span>}
          <span className="label" style={{ marginTop: 'var(--s-2)' }}>Main technical challenges</span>
          <ul style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
            {exec.challenges.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
          <span className="label" style={{ marginTop: 'var(--s-2)' }}>Remaining work <span className="badge badge-outline">estimate</span></span>
          <span>{exec.remainingWork.estimate}</span>
        </div>
        <div className="stack gap-2 small">
          <span className="label">Top risks</span>
          <ol style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
            {exec.topRisks.map((r) => (
              <li key={r.id}>
                <strong>{r.title}</strong>
                {r.detail && <span className="muted"> &mdash; {r.detail}</span>}
                <Citations ids={r.sources} sources={sources} />
              </li>
            ))}
          </ol>
          <span className="label" style={{ marginTop: 'var(--s-2)' }}>Decisions that need a person</span>
          {exec.humanDecisions.length ? (
            <ul style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
              {exec.humanDecisions.map((d) => <li key={d.id}><strong>{d.title}</strong> <span className="muted">&mdash; {d.detail}</span></li>)}
            </ul>
          ) : <span className="muted">None identified.</span>}
        </div>
      </div>
    </div>
  );
};

const ChallengeAnswers: React.FC<{ answers: BlueprintChallengeResponse[]; sources: Sources }> = ({ answers, sources }) => (
  <Block title="Challenges answered">
    <ul className="stack gap-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {answers.map((a) => (
        <li key={a.id || a.ref} className="card-sunk stack gap-1" style={{ padding: 'var(--s-3) var(--s-4)', borderRadius: 'var(--r-md)' }}>
          <div className="row wrap gap-2 small">
            <span className={`badge ${a.outcome === 'changed' ? 'badge-signal' : 'badge-neutral'}`}>{a.outcome === 'changed' ? 'Decision changed' : 'Decision upheld'}</span>
            <strong>{a.requirement}</strong>
            {a.repo && <span className="mono">why not {a.repo}?</span>}
            <span className="faint">class {a.previousClass ?? '?'} &rarr; {a.newClass}</span>
          </div>
          {a.note && <span className="small muted">&ldquo;{a.note}&rdquo;</span>}
          <span className="small">{a.response}</span>
          {a.evidenceNote && (
            <span className="small muted">
              {a.evidenceNote}
              <Citations ids={a.sources} sources={sources} />
            </span>
          )}
        </li>
      ))}
    </ul>
  </Block>
);

const BuildVersusReuse: React.FC<{ data: EngineeringBlueprint; sources: Sources; briefId?: string; focus: BlueprintFocus[]; canIterate: boolean; onChanged?: () => void }> = ({
  data, sources, briefId, focus, canIterate, onChanged
}) => {
  const [open, setOpen] = useState<string | null>(null);
  const focused = new Set(focus.map((f) => f.requirement));
  return (
    <Block title="Build versus reuse" note="Classes 1-3 require code or documentation evidence (E1-E3) about the requirement">
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">One build-versus-reuse class per requirement, with the reason and its evidence</caption>
          <thead>
            <tr>
              <th scope="col">Requirement</th>
              <th scope="col">Class</th>
              <th scope="col">Repository</th>
              <th scope="col">Reason and evidence</th>
              {briefId && <th scope="col"><span className="sr-only">Actions</span></th>}
            </tr>
          </thead>
          <tbody>
            {data.components.map((c) => {
              const cls = classOf(c);
              const detail = c.setup ? `Setup: ${c.setup}` : c.change ? `Change: ${c.change}` : c.uncovered ? `Not covered: ${c.uncovered}` : c.resolveBy ? `Would resolve it: ${c.resolveBy}` : '';
              return (
                <React.Fragment key={c.requirement}>
                  <tr>
                    <td>
                      <strong>{c.requirement}</strong>
                      <div className="row wrap gap-1" style={{ marginTop: 4 }}>
                        <span className="tag">{c.criticality.replace(/_/g, ' ')}</span>
                        {c.isConstraint && <span className="tag">constraint</span>}
                        {focused.has(c.requirement) && <span className="tag">investigated deeper</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${CLASS_TONE[cls]}`} title={CLASS_LABEL[cls]}>{cls} &middot; {CLASS_LABEL[cls]}</span>
                    </td>
                    <td>
                      {c.repo ? (
                        <a href={`https://github.com/${c.repo}`} target="_blank" rel="noopener noreferrer" className="link mono small">{c.repo}</a>
                      ) : <span className="faint">&mdash;</span>}
                    </td>
                    <td className="small">
                      <span>{c.reason || c.how}</span>
                      {detail && <div className="muted">{detail}</div>}
                      {c.searched && c.searched.length > 0 && <div className="faint xsmall">Searched: {c.searched.join(', ')}</div>}
                      <div className="row wrap gap-1" style={{ marginTop: 4 }}>
                        {EVIDENCE_LABEL[c.evidence] && <span className="xsmall faint">{EVIDENCE_LABEL[c.evidence]}</span>}
                        {(c.evidenceGrades || []).map((g) => <GradeBadge key={g} grade={g} />)}
                        <Citations ids={c.sources} sources={sources} />
                      </div>
                    </td>
                    {briefId && (
                      <td>
                        <div className="stack gap-1">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            aria-expanded={open === c.requirement}
                            aria-controls={`challenge-${slug(c.requirement)}`}
                            disabled={!canIterate}
                            onClick={() => setOpen(open === c.requirement ? null : c.requirement)}
                          >
                            <MessageSquare size={13} aria-hidden="true" />
                            <span>Challenge this decision</span>
                          </button>
                          <DeepenButton briefId={briefId} requirement={c.requirement} disabled={!canIterate} onChanged={onChanged} />
                        </div>
                      </td>
                    )}
                  </tr>
                  {briefId && open === c.requirement && (
                    <tr>
                      <td colSpan={5} id={`challenge-${slug(c.requirement)}`}>
                        <ChallengeForm briefId={briefId} component={c} onDone={() => { setOpen(null); onChanged?.(); }} onCancel={() => setOpen(null)} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Block>
  );
};

const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');

async function post(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const data: any = (await readJsonSafe(res)) || {};
    return res.status === 429 ? formatRetryAfter(retryAfterSeconds(res, data)) : data.error || httpErrorTitle(res.status);
  } catch {
    return 'Could not reach Open Eye.';
  }
}

const ChallengeForm: React.FC<{ briefId: string; component: BlueprintComponent; onDone: () => void; onCancel: () => void }> = ({ briefId, component, onDone, onCancel }) => {
  const [repo, setRepo] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = slug(component.requirement);
  return (
    <form
      className="stack gap-3"
      style={{ padding: 'var(--s-3) 0' }}
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const err = await post(`/api/briefs/${briefId}/challenge`, { requirement: component.requirement, repo: repo.trim() || undefined, note: note.trim() });
        setBusy(false);
        setError(err);
        if (!err) onDone();
      }}
    >
      <p className="small muted" style={{ margin: 0 }}>
        Only the blueprint is written again; it answers the challenge from the evidence and says whether the decision changed.
      </p>
      <label className="stack gap-1 small" htmlFor={`repo-${id}`}>
        <span className="label">Why not this repository? (optional, owner/name)</span>
        <input id={`repo-${id}`} className="field mono" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name" maxLength={200} />
      </label>
      <label className="stack gap-1 small" htmlFor={`note-${id}`}>
        <span className="label">Your reasoning</span>
        <textarea id={`note-${id}`} className="field" rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
          placeholder={`What is wrong with "${CLASS_LABEL[classOf(component)]}" for ${component.requirement}?`} />
      </label>
      <div className="row gap-2">
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || (!note.trim() && !repo.trim())}>
          {busy ? 'Sending…' : 'Challenge and rewrite the blueprint'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
      {error && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</span>}
    </form>
  );
};

const DeepenButton: React.FC<{ briefId: string; requirement: string; disabled: boolean; onChanged?: () => void }> = ({ briefId, requirement, disabled, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={disabled || busy}
        title="Search again with extra queries for this requirement; discovery and what follows it re-run"
        onClick={async () => {
          setBusy(true);
          const err = await post(`/api/briefs/${briefId}/deepen`, { requirement });
          setBusy(false);
          setError(err);
          if (!err) onChanged?.();
        }}
      >
        <Search size={13} aria-hidden="true" />
        <span>{busy ? 'Queuing…' : 'Investigate deeper'}</span>
      </button>
      {error && <span className="xsmall" role="alert" style={{ color: 'var(--danger)' }}>{error}</span>}
    </>
  );
};

const Inventory: React.FC<{ entries: BlueprintInventoryEntry[]; sources: Sources; policy?: string }> = ({ entries, sources, policy }) => (
  <Block title="Existing solutions" note={policy ? `licence policy: ${policy}` : undefined}>
    <div className="stack gap-3">
      {entries.map((e) => (
        <article key={e.repo} className="card-sunk stack gap-2" style={{ padding: 'var(--s-3) var(--s-4)', borderRadius: 'var(--r-md)' }} aria-label={e.repo}>
          <div className="row wrap between gap-2">
            <div className="row wrap gap-2">
              <span className={`badge ${ACTION_TONE[e.action]}`}>{e.action === 'investigate' ? 'Investigate further' : e.action[0].toUpperCase() + e.action.slice(1)}</span>
              <a href={e.url || `https://github.com/${e.repo}`} target="_blank" rel="noopener noreferrer" className="link mono small">
                {e.repo}
                <ArrowUpRight size={12} aria-hidden="true" />
              </a>
              <span className="xsmall faint">{e.version.commit ? `commit ${e.version.commit.slice(0, 10)}` : e.version.basis}</span>
            </div>
            <div className="row wrap gap-2 xsmall">
              <span className={`badge ${LICENCE_TONE[e.licence.status] || 'badge-outline'}`} title={e.licence.note}>
                {e.licence.licence || 'no licence'} &middot; {e.licence.status}
              </span>
              {e.licence.grade && <GradeBadge grade={e.licence.grade} />}
              <span className="faint" title={e.maintenance.basis}>maintenance risk {e.maintenance.risk}</span>
            </div>
          </div>
          <span className="small">{e.reason}</span>
          {e.licence.status !== 'compatible' && <span className="small muted">{e.licence.note}</span>}
          <div className="small muted">
            {e.capabilities.length > 0 ? <>Capabilities: <Citations ids={e.capabilities} sources={sources} /></> : 'No cited capability.'}
            {e.limitations.length > 0 && <> &middot; Limitations: <Citations ids={e.limitations} sources={sources} /></>}
            {e.limitationsNote && <> &middot; {e.limitationsNote}</>}
          </div>
          {e.modules.length > 0 && (
            <div className="row wrap gap-1">
              {e.modules.map((m) => (
                <a key={m.filePath} href={m.url} target="_blank" rel="noopener noreferrer" className="tag tag-mono" title={`Reusable module, from [${m.source}]`}>
                  {m.filePath}{m.symbol ? ` · ${m.symbol}` : ''}
                </a>
              ))}
            </div>
          )}
          <span className="xsmall faint">
            {e.maintenance.detail}
            {e.missing.length > 0 && ` README says it does not cover: ${e.missing.join(', ')}.`}
            {e.verification !== 'verified' && ' Not verified against its code.'}
          </span>
        </article>
      ))}
    </div>
  </Block>
);

const Architecture: React.FC<{ arch: BlueprintArchitecture; sources: Sources }> = ({ arch, sources }) => {
  const operations: Array<[string, string]> = [
    ['Authentication and permissions', arch.auth],
    ['Failure handling', arch.failureHandling],
    ['Observability', arch.observability],
    ['Deployment', arch.deployment],
    ['Scaling', arch.scaling]
  ];
  return (
    <Block title="Recommended architecture" note="Design recommendation, not a graded fact">
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">Architecture components</caption>
          <thead>
            <tr><th scope="col">Component</th><th scope="col">Origin</th><th scope="col">Responsibility</th><th scope="col">Requirements</th></tr>
          </thead>
          <tbody>
            {arch.components.map((a) => (
              <tr key={a.name}>
                <td><strong>{a.name}</strong>{a.repo && <div className="mono xsmall">{a.repo}</div>}</td>
                <td><span className={`badge ${ORIGIN_TONE[a.origin]}`}>{a.origin}</span></td>
                <td className="small">{a.responsibility}<Citations ids={a.sources} sources={sources} /></td>
                <td className="small muted">{a.requirements.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {arch.dataFlows.length > 0 && (
        <div className="stack gap-1 small">
          <span className="label">Data flows</span>
          <ul style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
            {arch.dataFlows.map((f, i) => <li key={i}><strong>{f.from}</strong> &rarr; <strong>{f.to}</strong>: {f.data}{f.contract && <span className="muted"> ({f.contract})</span>}</li>)}
          </ul>
        </div>
      )}
      {arch.interfaces.length > 0 && (
        <div className="stack gap-1 small">
          <span className="label">Interfaces and data contracts</span>
          <ul style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
            {arch.interfaces.map((f, i) => (
              <li key={i}><strong>{f.name}</strong>{f.provider && <span className="muted"> ({f.provider}{f.consumer ? ` → ${f.consumer}` : ''})</span>}: {f.contract}<Citations ids={f.sources} sources={sources} /></li>
            ))}
          </ul>
        </div>
      )}
      {(arch.storage.length > 0 || arch.externalDependencies.length > 0) && (
        <div className="grid-2 small" style={{ gap: 'var(--s-4)', alignItems: 'start' }}>
          {arch.storage.length > 0 && (
            <div className="stack gap-1">
              <span className="label">Storage and retrieval</span>
              <ul style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>{arch.storage.map((s, i) => <li key={i}><strong>{s.name}</strong>{s.technology && ` (${s.technology})`}: {s.purpose}</li>)}</ul>
            </div>
          )}
          {arch.externalDependencies.length > 0 && (
            <div className="stack gap-1">
              <span className="label">External dependencies</span>
              <ul style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>{arch.externalDependencies.map((d, i) => <li key={i}><strong>{d.name}</strong>: {d.purpose}<Citations ids={d.sources} sources={sources} /></li>)}</ul>
            </div>
          )}
        </div>
      )}
      {operations.some(([, v]) => v) && (
        <div className="def-list">
          {operations.filter(([, v]) => v).map(([k, v]) => <div key={k} className="def-item"><strong>{k}.</strong> {v}</div>)}
        </div>
      )}
      {arch.tradeoffs.length > 0 && (
        <div className="stack gap-1 small">
          <span className="label">Trade-offs</span>
          <ul style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
            {arch.tradeoffs.map((t, i) => <li key={i}><strong>{t.decision}</strong>: {t.reason}{t.alternatives.length > 0 && <span className="muted"> (instead of {t.alternatives.join(', ')})</span>}</li>)}
          </ul>
        </div>
      )}
      {arch.rejectedAlternatives.length > 0 && (
        <div className="stack gap-1 small">
          <span className="label">Rejected alternatives</span>
          <ul style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
            {arch.rejectedAlternatives.map((r, i) => <li key={i}><strong className="mono">{r.option}</strong>: <span className="muted">{r.reason}</span></li>)}
          </ul>
        </div>
      )}
    </Block>
  );
};

const IntegrationGuide: React.FC<{ steps: BlueprintItem[]; sources: Sources }> = ({ steps, sources }) => {
  if (steps.length === 0) return null;
  return (
    <Block title="Integration guide" note="No step has been executed yet">
      <ol className="stack gap-3" style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
        {steps.map((step, i) => (
          <li key={i}>
            <div className="row wrap gap-2">
              {step.phase && <span className="tag">{PHASE_LABEL[step.phase] || step.phase}</span>}
              <strong>{step.title}</strong>
              {step.executed === false && <span className="badge badge-outline">unexecuted</span>}
              {step.basis === 'inferred' && <span className="badge badge-outline" title={GRADE_HELP.E5}>inferred, no source</span>}
              {step.version && <span className="tag tag-mono">{step.version}</span>}
            </div>
            {step.detail && <div className="small muted">{step.detail}<Citations ids={step.sources} sources={sources} /></div>}
            {!step.detail && <Citations ids={step.sources} sources={sources} />}
            {step.envVars && step.envVars.length > 0 && (
              <div className="row wrap gap-1 xsmall" style={{ marginTop: 4 }}>
                <span className="faint">Environment variables:</span>
                {step.envVars.map((name) => {
                  const proposed = step.envVarsProposed?.includes(name);
                  return (
                    <code key={name} className="tag tag-mono" title={proposed ? 'Proposed name: no cited source mentions it' : 'Named in a cited source'}>
                      {name}{proposed ? ' (proposed)' : ''}
                    </code>
                  );
                })}
              </div>
            )}
            {step.code && <pre className="quote-well mono xsmall" style={{ whiteSpace: 'pre-wrap', margin: 'var(--s-1) 0 0' }}>{step.code}</pre>}
          </li>
        ))}
      </ol>
    </Block>
  );
};

const Roadmap: React.FC<{ tasks: BlueprintRoadmapTask[] }> = ({ tasks }) => (
  <Block title="Implementation roadmap" note="Complexity and uncertainty are estimates">
    <ol className="stack gap-3" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {tasks.map((t) => (
        <li key={t.id} className="card-sunk stack gap-2" style={{ padding: 'var(--s-3) var(--s-4)', borderRadius: 'var(--r-md)' }}>
          <div className="row wrap between gap-2">
            <div className="row wrap gap-2">
              <span className="mono xsmall faint">{t.id}</span>
              <strong>{t.title}</strong>
              <span className={`badge ${t.priority === 1 ? 'badge-signal' : 'badge-neutral'}`}>P{t.priority}</span>
            </div>
            <span className="xsmall faint" title={t.estimateBasis}>
              estimate: complexity {t.complexity}, uncertainty {t.uncertainty}
            </span>
          </div>
          {t.description && <span className="small">{t.description}</span>}
          <span className="xsmall muted">
            {t.requirements.length > 0 && `For ${t.requirements.join(', ')}. `}
            {t.dependsOn.length > 0 && `After ${t.dependsOn.join(', ')}. `}
            {t.output && `Output: ${t.output}`}
          </span>
          <div className="grid-2 small" style={{ gap: 'var(--s-3)', alignItems: 'start' }}>
            <div className="stack gap-1">
              <span className="label">Acceptance criteria{t.acceptanceGenerated ? ' (derived from the requirement)' : ''}</span>
              <ul style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>{t.acceptanceCriteria.map((a, i) => <li key={i}>{a}</li>)}</ul>
            </div>
            <div className="stack gap-1">
              <span className="label">Tests{t.testsGenerated ? ' (derived from the requirement)' : ''}</span>
              {t.tests.length ? <ul style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>{t.tests.map((a, i) => <li key={i}>{a}</li>)}</ul> : <span className="muted">An investigation; no code to test.</span>}
            </div>
          </div>
          {t.risks.length > 0 && (
            <span className="xsmall muted">Risks: {t.risks.map((r) => `${r.risk}${r.mitigation ? ` (mitigation: ${r.mitigation})` : ''}`).join('; ')}</span>
          )}
        </li>
      ))}
    </ol>
  </Block>
);

const Uncertainty: React.FC<{ report: BlueprintUncertainty; sources: Sources }> = ({ report, sources }) => {
  const groups: Array<[string, Array<{ title: string; detail: string; sources?: string[] }>]> = [
    ['Decisions needing a person', report.humanDecisions.map((d) => ({ title: d.title, detail: d.detail }))],
    ['Conflicting evidence', report.conflicts],
    ['Sources needing revalidation', report.stale],
    ['Resting on claims or inference (E4/E5)', report.weakDependencies.map((w) => ({ title: w.requirement || 'Integration guide', detail: w.detail, sources: w.sources }))],
    ['Missing verification', report.missingVerification.map((m) => ({ title: m.repo || 'Execution', detail: m.detail }))],
    ['Incomplete research', report.incompleteResearch]
  ];
  return (
    <Block title="Evidence and uncertainty" note="Generated from the evidence, not written by the model">
      <div className="stack gap-3">
        {groups.filter(([, items]) => items.length > 0).map(([title, items]) => (
          <div key={title} className="stack gap-1 small">
            <span className="label row gap-1">{title === 'Decisions needing a person' && <AlertTriangle size={13} aria-hidden="true" />}{title}</span>
            <ul style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
              {items.map((item, i) => (
                <li key={i}><strong>{item.title}</strong> <span className="muted">&mdash; {item.detail}</span><Citations ids={item.sources} sources={sources} /></li>
              ))}
            </ul>
          </div>
        ))}
        {report.traceability.length > 0 && (
          <details className="disclosure">
            <summary className="label">Traceability ({report.traceability.length} recommendations)</summary>
            <ul className="stack gap-1 small" style={{ paddingLeft: 'var(--s-5)', marginTop: 'var(--s-3)' }}>
              {report.traceability.map((t, i) => (
                <li key={i}>{t.recommendation} {t.grades.map((g) => <GradeBadge key={g} grade={g} />)}<Citations ids={t.sources} sources={sources} /></li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </Block>
  );
};

const ItemList: React.FC<{ title: string; items: BlueprintItem[]; sources: Sources }> = ({ title, items, sources }) => (
  <Block title={title}>
    <ul className="stack gap-2" style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
      {items.map((item, i) => (
        <li key={i}>
          <strong>{item.title}</strong>
          {item.detail && <span className="muted"> &mdash; {item.detail}</span>}
          <Citations ids={item.sources} sources={sources} />
        </li>
      ))}
    </ul>
  </Block>
);

const SourceList: React.FC<{ data: EngineeringBlueprint }> = ({ data }) => {
  if (data.sources.length === 0) return null;
  return (
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
            {s.grade && <GradeBadge grade={s.grade} />}
            {s.claimStatus === 'needs_revalidation' && <span className="badge badge-inferred" style={{ marginLeft: 6 }}>source changed since verified</span>}
            {s.claimStatus === 'refuted' && <span className="badge badge-danger" style={{ marginLeft: 6 }}>refuted</span>}
            <div className="muted">{s.title}{s.text ? `: ${s.text}` : ''}</div>
            {s.quote && <pre className="quote-well mono xsmall" style={{ whiteSpace: 'pre-wrap', margin: 'var(--s-1) 0 0' }}>{s.quote}</pre>}
          </li>
        ))}
      </ol>
    </details>
  );
};

const GradeBadge: React.FC<{ grade: string }> = ({ grade }) => (
  <span className={`badge ${GRADE_TONE[grade] || 'badge-outline'}`} title={GRADE_HELP[grade]} style={{ marginLeft: 6 }}>
    {grade}
    <span className="sr-only">: {GRADE_HELP[grade]}</span>
  </span>
);

const Citations: React.FC<{ ids?: string[]; sources: Sources }> = ({ ids, sources }) => {
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
