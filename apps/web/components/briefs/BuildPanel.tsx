'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, GitPullRequest, Hammer, XCircle } from 'lucide-react';
import { BuildDetail, BuildRoadmapItem, BuildStatus, BuildSummary } from '@repo/shared';
import { readJsonSafe, shortDate } from '@/lib/ui/api';

// Build mode (PRODUCT_DEFINITION 5.8): a maintainer authorises a build for chosen roadmap items or requirements,
// the worker codes and tests it in the sandbox, and the change is downloaded as a diff or delivered as a pull
// request after explicit approval.

interface BuildList {
  builds: BuildSummary[];
  roadmap: BuildRoadmapItem[];
  requirements: string[];
  blueprintReady: boolean;
  canBuild: boolean;
  pullRequestDelivery: boolean;
}

const STATUS: Record<BuildStatus, { label: string; tone: string }> = {
  queued: { label: 'queued', tone: 'badge-neutral' },
  running: { label: 'running', tone: 'badge-neutral' },
  succeeded: { label: 'all tests pass', tone: 'badge-verified' },
  awaiting_approval: { label: 'needs a person', tone: 'badge-inferred' },
  failed: { label: 'failed', tone: 'badge-danger' },
  delivered: { label: 'pull request opened', tone: 'badge-verified' }
};
const STEP: Record<string, string> = { STARTING: 'Starting', CODING: 'Writing code', TESTING: 'Installing and testing in the sandbox', DONE: 'Done' };
const active = (s?: BuildStatus) => s === 'queued' || s === 'running';

export const BuildPanel: React.FC<{ briefId: string }> = ({ briefId }) => {
  const [list, setList] = useState<BuildList | null>(null);
  const [detail, setDetail] = useState<BuildDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/briefs/${briefId}/build`, { cache: 'no-store' });
      const data: any = await readJsonSafe(res);
      if (!res.ok || !data) return setError(data?.error || 'Could not load builds.');
      setList(data);
      const latest: BuildSummary | undefined = data.builds[0];
      if (latest) {
        const d = await fetch(`/api/briefs/${briefId}/build/${latest.id}`, { cache: 'no-store' });
        const body: any = await readJsonSafe(d);
        if (d.ok && body) setDetail(body);
      } else {
        setDetail(null);
      }
    } catch {
      setError('Could not reach Open Eye.');
    }
  }, [briefId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!active(list?.builds[0]?.status)) return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [list, load]);

  if (!list) return error ? <p className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</p> : null;
  if (!list.blueprintReady) return null;
  const latest = list.builds[0];

  return (
    <section style={{ marginBottom: 'var(--s-7)' }} aria-labelledby="build-heading">
      <div className="rule-head">
        <h2 id="build-heading" className="label">Build</h2>
        {list.builds.length > 0 && <span className="count">{list.builds.length}</span>}
      </div>
      <div className="stack gap-4">
        {list.canBuild ? (
          !active(latest?.status) && <AuthoriseForm briefId={briefId} list={list} onStarted={load} />
        ) : (
          <p className="small muted">Only a workspace maintainer can authorise a build.</p>
        )}
        {latest && <BuildView build={detail && detail.id === latest.id ? detail : null} summary={latest} briefId={briefId} list={list} onChanged={load} />}
        {list.builds.length > 1 && (
          <p className="xsmall faint">
            Earlier builds: {list.builds.slice(1).map((b) => `${shortDate(b.createdAt)} ${STATUS[b.status]?.label || b.status}`).join(' · ')}
          </p>
        )}
      </div>
    </section>
  );
};

const AuthoriseForm: React.FC<{ briefId: string; list: BuildList; onStarted: () => void }> = ({ briefId, list, onStarted }) => {
  const [tasks, setTasks] = useState<string[]>([]);
  const [requirements, setRequirements] = useState<string[]>([]);
  const [authorised, setAuthorised] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (value: string, set: React.Dispatch<React.SetStateAction<string[]>>) =>
    set((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
  const chosen = tasks.length + requirements.length;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/briefs/${briefId}/build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authorize: authorised, roadmapTaskIds: tasks, requirements })
      });
      const data: any = await readJsonSafe(res);
      if (!res.ok) setError(data?.error || 'The build could not be started.');
      else {
        setTasks([]);
        setRequirements([]);
        setAuthorised(false);
        onStarted();
      }
    } catch {
      setError('Could not reach Open Eye.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack gap-3">
      <p className="small muted">
        Choose what to build. Open Eye writes the code and its tests, installs the dependencies and runs the tests in an isolated
        sandbox, feeding failures back for a few rounds. Nothing is pushed anywhere until you approve it below.
      </p>
      {list.roadmap.length > 0 && (
        <fieldset className="stack gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">{list.roadmap[0].source === 'roadmap' ? 'Roadmap tasks' : 'To build'}</legend>
          {list.roadmap.map((item) => (
            <label key={item.id} className="row gap-2 small" style={{ alignItems: 'flex-start' }}>
              <input type="checkbox" checked={tasks.includes(item.id)} onChange={() => toggle(item.id, setTasks)} style={{ marginTop: 3 }} />
              <span className="stack">
                <strong>{item.title}</strong>
                {item.detail && <span className="xsmall muted">{item.detail}</span>}
                {item.acceptanceCriteria.length > 0 && <span className="xsmall faint">Done when: {item.acceptanceCriteria.join('; ')}</span>}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {list.requirements.length > 0 && (
        <fieldset className="stack gap-2" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label">Requirements</legend>
          <div className="row wrap gap-3">
            {list.requirements.map((name) => (
              <label key={name} className="row gap-1 small">
                <input type="checkbox" checked={requirements.includes(name)} onChange={() => toggle(name, setRequirements)} />
                <span>{name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <label className="row gap-2 small" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={authorised} onChange={(e) => setAuthorised(e.target.checked)} style={{ marginTop: 3 }} />
        <span>
          I authorise this build: generated code and the packages it depends on will be installed and run in the sandbox (no secrets, no
          network while tests run), and it counts against this brief&apos;s budget.
        </span>
      </label>
      <div className="row gap-3">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || !authorised || chosen === 0 || chosen > 5} onClick={start}>
          <Hammer size={13} aria-hidden="true" />
          <span>{busy ? 'Starting…' : 'Start build'}</span>
        </button>
        {chosen > 5 && <span className="xsmall" style={{ color: 'var(--danger)' }}>At most 5 items per build.</span>}
      </div>
      {error && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
};

const BuildView: React.FC<{ build: BuildDetail | null; summary: BuildSummary; briefId: string; list: BuildList; onChanged: () => void }> = ({
  build,
  summary,
  briefId,
  list,
  onChanged
}) => {
  const status = STATUS[summary.status] || { label: summary.status, tone: 'badge-outline' };
  const report = build?.report;
  const scope = [...summary.scope.roadmapTaskIds.map((id) => list.roadmap.find((r) => r.id === id)?.title || id), ...summary.scope.requirements];
  const diffUrl = `/api/briefs/${briefId}/build/${summary.id}?format=diff`;
  return (
    <article className="card stack gap-3" aria-label="Latest build">
      <div className="row wrap between gap-3">
        <div className="row wrap gap-2">
          <span className={`badge ${status.tone}`}>
            {active(summary.status) && <span className="dot dot-pulse" aria-hidden="true" />}
            {status.label}
          </span>
          <span className="small">{scope.join(' · ')}</span>
        </div>
        <span className="xsmall faint mono">
          iteration {summary.iterations}/{summary.maxIterations} · {shortDate(summary.createdAt)}
        </span>
      </div>
      {active(summary.status) && <p className="small muted">{STEP[summary.step || 'STARTING'] || 'Working'}&hellip;</p>}
      {summary.errorMessage && (
        <div className="callout callout-danger">
          <XCircle size={16} aria-hidden="true" />
          <div>{summary.errorMessage}</div>
        </div>
      )}
      {report && report.outcome !== 'not_run' && <Report report={report} />}
      {build?.diff && (
        <>
          <DiffViewer diff={build.diff} files={build.files} />
          <div className="row wrap gap-3">
            <a className="btn btn-secondary btn-sm" href={diffUrl} download>
              <Download size={13} aria-hidden="true" />
              <span>Download diff</span>
            </a>
            <span className="xsmall faint">Apply with <code>git apply</code> at your repository root; files land in {report?.pathPrefix}/.</span>
          </div>
        </>
      )}
      {summary.delivery?.pullRequestUrl ? (
        <div className="callout callout-verified">
          <GitPullRequest size={16} aria-hidden="true" />
          <div>
            Draft pull request opened on {summary.delivery.repo} ({summary.delivery.branch} into {summary.delivery.baseBranch}):{' '}
            <a className="link" href={summary.delivery.pullRequestUrl} target="_blank" rel="noopener noreferrer">
              #{summary.delivery.pullRequestNumber}
            </a>
          </div>
        </div>
      ) : (
        list.canBuild &&
        build?.diff &&
        (summary.status === 'succeeded' || summary.status === 'awaiting_approval') && (
          <DeliverForm briefId={briefId} build={summary} prDelivery={list.pullRequestDelivery} diffUrl={diffUrl} onDelivered={onChanged} />
        )
      )}
    </article>
  );
};

const Report: React.FC<{ report: NonNullable<BuildDetail['report']> }> = ({ report }) => {
  const t = report.totals;
  const groups: Array<{ title: string; items?: string[]; icon: React.ReactNode }> = [
    { title: 'Passed', items: report.passed, icon: <CheckCircle2 size={13} aria-hidden="true" style={{ color: 'var(--verified)' }} /> },
    { title: 'Failed', items: report.failed, icon: <XCircle size={13} aria-hidden="true" style={{ color: 'var(--danger)' }} /> },
    { title: 'Untested', items: report.untested, icon: <AlertTriangle size={13} aria-hidden="true" /> },
    { title: 'Needs a human', items: report.needsHuman, icon: <AlertTriangle size={13} aria-hidden="true" style={{ color: 'var(--inferred)' }} /> }
  ];
  return (
    <div className="stack gap-3">
      <span className="small">
        {t ? `${t.passed} passed, ${t.failed} failed, ${t.error} errors, ${t.skipped} skipped` : 'No test results'} after {report.iterations}{' '}
        iteration(s) · stopped: {(report.stopReason || '').replace(/_/g, ' ')}
        {report.runtime && <span className="muted"> · {report.runtime} in {report.image}</span>}
      </span>
      {report.testCommand && (
        <span className="xsmall faint mono">
          {report.testCommand} ({report.network})
        </span>
      )}
      <div className="grid-2" style={{ gap: 'var(--s-4)' }}>
        {groups
          .filter((g) => g.items && g.items.length)
          .map((g) => (
            <div key={g.title} className="stack gap-1">
              <h3 className="label row gap-1">
                {g.icon}
                {g.title}
              </h3>
              <ul className="stack gap-1 small" style={{ paddingLeft: 'var(--s-5)', margin: 0 }}>
                {g.items!.map((i) => <li key={i}>{i}</li>)}
              </ul>
            </div>
          ))}
      </div>
      {report.history && report.history.length > 0 && (
        <details>
          <summary className="xsmall muted">Iterations</summary>
          <ol className="stack gap-2 xsmall" style={{ paddingLeft: 'var(--s-5)' }}>
            {report.history.map((h) => (
              <li key={h.iteration}>
                {h.phase === 'test' && h.totals
                  ? `tests: ${h.totals.passed} passed, ${h.totals.failed + h.totals.error} failing (exit ${h.exitCode})`
                  : h.phase === 'install'
                    ? `dependencies did not install (exit ${h.exitCode})`
                    : h.error}
                {h.notes && <span className="muted"> · {h.notes}</span>}
                {h.output && <pre className="mono xsmall card-sunk" style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflow: 'auto', padding: 'var(--s-2)' }}>{h.output}</pre>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
};

const DiffViewer: React.FC<{ diff: string; files: string[] }> = ({ diff, files }) => {
  const [open, setOpen] = useState(false);
  const lines = useMemo(() => diff.split('\n').slice(0, open ? 4000 : 0), [diff, open]);
  return (
    <div className="stack gap-2">
      <button type="button" className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide the change' : `Show the change (${files.length} files)`}
      </button>
      {open && (
        <pre className="mono xsmall card-sunk" style={{ maxHeight: 480, overflow: 'auto', padding: 'var(--s-3)', margin: 0 }} aria-label="Unified diff">
          {lines.map((line, i) => (
            <div
              key={i}
              style={{
                color: line.startsWith('+') && !line.startsWith('+++') ? 'var(--verified)' : line.startsWith('diff --git') ? 'var(--ink)' : undefined,
                fontWeight: line.startsWith('diff --git') ? 600 : undefined
              }}
            >
              {line || ' '}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
};

const DeliverForm: React.FC<{ briefId: string; build: BuildSummary; prDelivery: boolean; diffUrl: string; onDelivered: () => void }> = ({
  briefId,
  build,
  prDelivery,
  diffUrl,
  onDelivered
}) => {
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState(`open-eye/build-${build.id.slice(0, 8)}`);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(build.delivery?.state === 'failed' ? build.delivery.error || 'The last delivery failed.' : null);

  if (!prDelivery) {
    return (
      <p className="xsmall muted">
        Pull-request delivery is not configured on this server (GITHUB_BUILD_TOKEN). <a className="link" href={diffUrl} download>Download the diff</a> and
        open the pull request yourself.
      </p>
    );
  }
  const deliver = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/briefs/${briefId}/build/${build.id}/deliver`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo, branch, approve: approved })
      });
      const data: any = await readJsonSafe(res);
      if (!res.ok) setError(data?.error || 'Delivery failed.');
      else onDelivered();
    } catch {
      setError('Could not reach Open Eye.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack gap-2">
      <h3 className="label">Deliver as a pull request</h3>
      <div className="row wrap gap-2">
        <input className="field" aria-label="Target repository" placeholder="owner/name" value={repo} onChange={(e) => setRepo(e.target.value)} style={{ width: 220 }} />
        <input className="field" aria-label="New branch" value={branch} onChange={(e) => setBranch(e.target.value)} style={{ width: 260 }} />
      </div>
      <label className="row gap-2 small" style={{ alignItems: 'flex-start' }}>
        <input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} style={{ marginTop: 3 }} />
        <span>
          I reviewed the change and the test report, and approve pushing it to a new branch of this repository and opening a draft pull request.
          {build.status === 'awaiting_approval' && ' Not every test passes.'}
        </span>
      </label>
      <div className="row gap-3">
        <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !approved || !repo.trim() || !branch.trim()} onClick={deliver}>
          <GitPullRequest size={13} aria-hidden="true" />
          <span>{busy ? 'Opening…' : 'Open pull request'}</span>
        </button>
        <span className="xsmall faint">The default branch is never pushed to.</span>
      </div>
      {error && <span className="small" role="alert" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
};
