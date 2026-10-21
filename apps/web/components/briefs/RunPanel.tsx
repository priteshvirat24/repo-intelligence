'use client';

import React, { useState } from 'react';
import { AlertTriangle, CheckCircle2, Circle, CircleDot, Clock, PauseCircle, XCircle } from 'lucide-react';
import { BriefBudget, BriefDetail, BriefTask } from '@repo/shared';
import { readJsonSafe } from '@/lib/ui/api';
import { compactNumber } from '@/lib/ui/briefs';

const TASK_LABEL: Record<BriefTask['type'], string> = {
  understand: 'Understand the brief',
  discover: 'Discover existing solutions',
  verify: 'Verify against code',
  docs: 'Check docs, advisories and forums',
  blueprint: 'Write the blueprint'
};

function TaskIcon({ status }: { status: BriefTask['status'] }) {
  if (status === 'done') return <CheckCircle2 size={14} aria-hidden="true" style={{ color: 'var(--verified)' }} />;
  if (status === 'failed') return <XCircle size={14} aria-hidden="true" style={{ color: 'var(--danger)' }} />;
  if (status === 'running') return <CircleDot size={14} aria-hidden="true" className="animate-spin" />;
  if (status === 'waiting') return <Clock size={14} aria-hidden="true" />;
  if (status === 'awaiting_input') return <PauseCircle size={14} aria-hidden="true" style={{ color: 'var(--inferred)' }} />;
  return <Circle size={14} aria-hidden="true" className="faint" />;
}

const STATUS_TEXT: Record<BriefTask['status'], string> = {
  pending: 'waiting for earlier steps',
  stale: 'will re-run (an input changed)',
  running: 'running',
  waiting: 'waiting for repositories to be indexed',
  awaiting_input: 'needs your answer',
  done: 'done',
  failed: 'failed',
  cancelled: 'cancelled'
};

/** The run graph as a timeline: what has happened, what is running, what waits on what. */
export const TaskTimeline: React.FC<{ tasks: BriefTask[] }> = ({ tasks }) => (
  <ol className="stack gap-2" style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-label="Run progress">
    {tasks.map((t) => (
      <li key={t.type} className="row gap-2 small" style={{ alignItems: 'flex-start' }}>
        <TaskIcon status={t.status} />
        <div className="stack">
          <span>
            <strong>{TASK_LABEL[t.type] || t.type}</strong> <span className="muted">· {STATUS_TEXT[t.status] || t.status}</span>
          </span>
          {t.status === 'failed' && t.errorMessage && <span className="xsmall" style={{ color: 'var(--danger)' }}>{t.errorMessage.slice(0, 240)}</span>}
        </div>
      </li>
    ))}
  </ol>
);

async function patchBrief(id: string, body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch(`/api/briefs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) return null;
    const data: any = await readJsonSafe(res);
    return data?.error || 'The change could not be saved.';
  } catch {
    return 'Could not reach Open Eye.';
  }
}

/** What Open Eye understood: acceptance criteria, assumptions and the questions whose answers would change the outcome. */
export const UnderstandingPanel: React.FC<{ brief: BriefDetail; onChanged: () => void }> = ({ brief, onChanged }) => {
  const u = brief.understanding;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!u) return null;
  const unanswered = u.clarifyingQuestions.filter((q) => !brief.answers?.[q.question]);
  const submit = async () => {
    setBusy(true);
    setError(await patchBrief(brief.id, { answers }));
    setBusy(false);
    setAnswers({});
    onChanged();
  };
  return (
    <div className="stack gap-4">
      {u.mode === 'heuristic' && (
        <div className="callout callout-inferred">
          <AlertTriangle size={16} aria-hidden="true" />
          <div>The AI provider gave no usable answer, so requirements were taken sentence by sentence from the brief.</div>
        </div>
      )}
      {u.acceptanceCriteria.length > 0 && (
        <div className="stack gap-2">
          <h3 className="label">Done when</h3>
          <ul className="stack gap-1 small" style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
            {u.acceptanceCriteria.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}
      {u.assumptions.length > 0 && (
        <div className="stack gap-2">
          <h3 className="label">Assumed</h3>
          <ul className="stack gap-1 small muted" style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
            {u.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      )}
      {u.clarifyingQuestions.length > 0 && (
        <div className="stack gap-2">
          <h3 className="label">Questions</h3>
          {u.clarifyingQuestions.map((q) => {
            const answered = brief.answers?.[q.question];
            return (
              <div key={q.question} className="stack gap-1 small">
                <span>
                  <strong>{q.question}</strong>
                  {q.blocking && !answered && <span className="badge badge-inferred" style={{ marginLeft: 6 }}>research waits for this</span>}
                </span>
                {q.why && <span className="muted xsmall">{q.why}</span>}
                {answered ? (
                  <span className="xsmall">Your answer: {answered}</span>
                ) : (
                  <input
                    className="field"
                    aria-label={`Answer: ${q.question}`}
                    placeholder={q.blocking ? 'Answer to continue' : 'Optional: answer to refine the research'}
                    value={answers[q.question] || ''}
                    onChange={(e) => setAnswers((prev) => ({ ...prev, [q.question]: e.target.value }))}
                  />
                )}
              </div>
            );
          })}
          {unanswered.length > 0 && (
            <div className="row gap-3">
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !Object.values(answers).some((a) => a.trim())} onClick={submit}>
                {busy ? 'Saving…' : 'Send answers'}
              </button>
              <span className="xsmall faint">Only the steps affected by your answers run again.</span>
            </div>
          )}
          {error && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</span>}
        </div>
      )}
    </div>
  );
};

const CONSTRAINT_FIELDS: Array<{ key: string; label: string; placeholder: string }> = [
  { key: 'languages', label: 'Languages', placeholder: 'e.g. TypeScript, Python' },
  { key: 'infrastructure', label: 'Infrastructure', placeholder: 'e.g. AWS, self-hosted, Postgres' },
  { key: 'prefer', label: 'Prefer', placeholder: 'Technologies to favour' },
  { key: 'avoid', label: 'Avoid', placeholder: 'Technologies to rule out' }
];

/** Constraints form, used when creating a brief and when revising one. */
export const ConstraintFields: React.FC<{ value: Record<string, string>; onChange: (v: Record<string, string>) => void }> = ({ value, onChange }) => (
  <div className="stack gap-3">
    <div className="grid-2" style={{ gap: 'var(--s-3)' }}>
      {CONSTRAINT_FIELDS.map((f) => (
        <label key={f.key} className="stack gap-1 small">
          <span className="label">{f.label}</span>
          <input className="field" placeholder={f.placeholder} value={value[f.key] || ''} onChange={(e) => onChange({ ...value, [f.key]: e.target.value })} />
        </label>
      ))}
    </div>
    <label className="stack gap-1 small" style={{ maxWidth: 360 }}>
      <span className="label">Licences</span>
      <select className="field" value={value.licencePolicy || 'copyleft-flagged'} onChange={(e) => onChange({ ...value, licencePolicy: e.target.value })}>
        <option value="copyleft-flagged">Any open licence; flag copyleft</option>
        <option value="permissive-only">Permissive licences only</option>
        <option value="any">Any licence</option>
      </select>
    </label>
  </div>
);

export const ConstraintsEditor: React.FC<{ brief: BriefDetail; onChanged: () => void }> = ({ brief, onChanged }) => {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<Record<string, string>>(brief.constraints || {});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shown = Object.entries(brief.constraints || {}).filter(([, v]) => v);
  if (!editing) {
    return (
      <div className="row wrap between gap-3 small">
        <span className="muted">
          {shown.length ? shown.map(([k, v]) => `${k}: ${v}`).join(' · ') : 'No constraints set.'}
        </span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setValue(brief.constraints || {}); setEditing(true); }}>
          Change constraints
        </button>
      </div>
    );
  }
  return (
    <div className="stack gap-3">
      <ConstraintFields value={value} onChange={setValue} />
      <div className="row gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const err = await patchBrief(brief.id, { constraints: value });
            setBusy(false);
            setError(err);
            if (!err) {
              setEditing(false);
              onChanged();
            }
          }}
        >
          {busy ? 'Saving…' : 'Save and re-run what changes'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
      </div>
      {error && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
};

const BUDGET_LABEL: Record<keyof BriefBudget['limits'], string> = {
  llmCalls: 'AI calls',
  tokens: 'Tokens',
  githubRequests: 'GitHub requests',
  sourceRequests: 'Source requests'
};

function meter(used: number, limit: number) {
  return `${compactNumber(used)} / ${compactNumber(limit)}`;
}

/** Budget used by this run, and a way to raise it when the run stopped on budget. */
export const BudgetPanel: React.FC<{ briefId: string; budget: BriefBudget; stopped: boolean; onChanged: () => void }> = ({ briefId, budget, stopped, onChanged }) => {
  const [limits, setLimits] = useState(budget.limits);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="stack gap-2 small">
      <span className="muted">
        Budget used: AI calls {meter(budget.used.llmCalls, budget.limits.llmCalls)} · tokens {meter(budget.used.tokens, budget.limits.tokens)} ·
        GitHub requests {meter(budget.used.githubRequests, budget.limits.githubRequests)} ·
        source requests {meter(budget.used.sourceRequests ?? 0, budget.limits.sourceRequests ?? 0)}
      </span>
      {stopped && (
        <div className="stack gap-2">
          <div className="callout callout-inferred">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>The run stopped because its budget was used up. Raise the limits to continue from where it stopped.</div>
          </div>
          <div className="row wrap gap-2">
            {(['llmCalls', 'tokens', 'githubRequests', 'sourceRequests'] as const).map((key) => (
              <label key={key} className="stack gap-1 xsmall">
                <span className="label">{BUDGET_LABEL[key]}</span>
                <input className="field" type="number" min={1} value={limits[key]} onChange={(e) => setLimits({ ...limits, [key]: Number(e.target.value) })} style={{ width: 140 }} />
              </label>
            ))}
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ alignSelf: 'flex-end' }}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(await patchBrief(briefId, { budget: limits }));
                setBusy(false);
                onChanged();
              }}
            >
              {busy ? 'Saving…' : 'Raise budget and continue'}
            </button>
          </div>
          {error && <span role="alert" style={{ color: 'var(--danger)' }}>{error}</span>}
        </div>
      )}
    </div>
  );
};
