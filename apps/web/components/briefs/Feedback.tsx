'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ThumbsDown, ThumbsUp } from 'lucide-react';
import type { FeedbackEntry, FeedbackTargetKind, FeedbackVerdict } from '@repo/shared';
import { readJsonSafe } from '@/lib/ui/api';

// One request per brief page for the caller's earlier verdicts, shared by every control on it
const loaded = new Map<string, Promise<FeedbackEntry[]>>();

function earlierVerdicts(briefId: string): Promise<FeedbackEntry[]> {
  if (!loaded.has(briefId)) {
    loaded.set(briefId, fetch(`/api/feedback?briefId=${encodeURIComponent(briefId)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? readJsonSafe<{ feedback: FeedbackEntry[] }>(r) : null))
      .then((body) => body?.feedback || [])
      .catch(() => []));
  }
  return loaded.get(briefId)!;
}

const LABELS: Record<FeedbackTargetKind, { up: FeedbackVerdict; down: FeedbackVerdict; upLabel: string; downLabel: string }> = {
  candidate: { up: 'useful', down: 'not_useful', upLabel: 'Useful', downLabel: 'Not useful' },
  blueprint_decision: { up: 'correct', down: 'wrong', upLabel: 'Right decision', downLabel: 'Wrong decision' },
  claim: { up: 'correct', down: 'wrong', upLabel: 'Correct', downLabel: 'Wrong' }
};

/**
 * Thumbs up or down on one result of the brief on this page (PRODUCT_DEFINITION 9.2): how Open Eye learns
 * what was right. Pressing the selected thumb again clears the verdict.
 */
export const Feedback: React.FC<{ kind: FeedbackTargetKind; target: string; subject?: string }> = ({ kind, target, subject }) => {
  const params = useParams();
  const briefId = String((params as any)?.id || '');
  const [verdict, setVerdict] = useState<FeedbackVerdict | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = LABELS[kind];

  useEffect(() => {
    if (!briefId) return;
    let live = true;
    earlierVerdicts(briefId).then((entries) => {
      const mine = entries.find((e) => e.targetKind === kind && e.targetId.toLowerCase() === target.toLowerCase());
      if (live && mine) setVerdict(mine.verdict);
    });
    return () => {
      live = false;
    };
  }, [briefId, kind, target]);

  const send = async (next: FeedbackVerdict) => {
    const value = verdict === next ? null : next;
    const before = verdict;
    setVerdict(value);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefId, targetKind: kind, targetId: target, verdict: value })
      });
      if (!res.ok) {
        const body = await readJsonSafe<{ error?: string }>(res);
        throw new Error(body?.error || 'Not saved');
      }
      loaded.delete(briefId);
    } catch (e: any) {
      setVerdict(before);
      setError(e?.message || 'Not saved');
    } finally {
      setBusy(false);
    }
  };

  if (!briefId) return null;
  const about = subject || target;
  return (
    <span className="row gap-2" style={{ display: 'inline-flex', alignItems: 'center' }}>
      <span className="segmented" role="group" aria-label={`Your verdict on ${about}`}>
        <button type="button" aria-pressed={verdict === labels.up} disabled={busy} onClick={() => send(labels.up)}
          title={labels.upLabel} aria-label={`${labels.upLabel}: ${about}`}>
          <ThumbsUp size={13} aria-hidden="true" />
        </button>
        <button type="button" aria-pressed={verdict === labels.down} disabled={busy} onClick={() => send(labels.down)}
          title={labels.downLabel} aria-label={`${labels.downLabel}: ${about}`}>
          <ThumbsDown size={13} aria-hidden="true" />
        </button>
      </span>
      {error && <span className="xsmall" role="status" style={{ color: 'var(--danger)' }}>{error}</span>}
    </span>
  );
};
