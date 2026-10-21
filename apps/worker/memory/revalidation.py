"""
Revalidation of semantic memory (PRODUCT_DEFINITION 8.2, SYSTEM_DESIGN 8.2 "Revalidation is cheap").

Run by the worker when idle, at most every REVALIDATE_INTERVAL_SECONDS. It picks subjects used by recent
briefs that have claims past revalidate_after or marked needs_revalidation, and checks each subject's
current state on GitHub (one metered call for the repository; a second, for the head commit, only when
something was pushed since the claims were last seen):

  unchanged  claims stay current; revalidate_after moves forward; revalidated_at is set
  changed    E2/E3 code claims at the old commit are marked needs_revalidation (never shown as current),
             API facts (licence, last push) are rewritten, and the repository is queued for re-indexing
             through the normal indexer; once that index is READY its claims are rewritten from the new
             commit (apply_reindexed)
  missing    the repository is gone or private: its claims are marked needs_revalidation
"""
import sys
import time
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional

import httpx

from .. import claims as claim_writer
from ..discovery.github_search import GitHubRateLimited, GitHubSearchClient
from ..providers import ledger
from . import semantic

REVALIDATE_INTERVAL_SECONDS = 300
MAX_SUBJECTS_PER_PASS = 10
RECENT_BRIEF_DAYS = 30
RECHECK_HOURS = 24
# Claims about the code at a commit: these need the code re-read when the commit changes
CODE_KINDS = ("capability", "limitation")


class GitHubStateClient(GitHubSearchClient):
    """The two cheap state reads revalidation needs, metered like every GitHub call."""

    def repo_state(self, full_name: str) -> Optional[Dict[str, Any]]:
        resp = self._get("revalidate_repo", f"https://api.github.com/repos/{full_name}", headers=self.headers)
        self._raise_for_rate_limit(resp)
        if resp.status_code in (404, 451) or (resp.status_code == 200 and resp.json().get("private")):
            return None
        resp.raise_for_status()
        data = resp.json()
        return {"pushed_at": data.get("pushed_at"), "default_branch": data.get("default_branch") or "main",
                "license": (data.get("license") or {}).get("spdx_id"), "archived": bool(data.get("archived")),
                "full_name": data.get("full_name") or full_name}

    def head_sha(self, full_name: str, branch: str) -> Optional[str]:
        resp = self._get("revalidate_head", f"https://api.github.com/repos/{full_name}/commits/{branch}",
                         headers={**self.headers, "Accept": "application/vnd.github.sha"})
        self._raise_for_rate_limit(resp)
        if resp.status_code in (404, 409, 422):
            return None
        resp.raise_for_status()
        return resp.text.strip()[:40] or None


def due_subjects(cur, limit: int = MAX_SUBJECTS_PER_PASS) -> List[str]:
    """Subjects of recent briefs' candidates with a claim due for revalidation, shortlisted ones and the
    most overdue first; a subject checked in the last RECHECK_HOURS waits."""
    cur.execute(
        """
        WITH used AS (
            SELECT 'github:' || lower(c.full_name) AS subject, bool_or(c.shortlisted) AS shortlisted
            FROM brief_candidates c JOIN briefs b ON b.id = c.brief_id
            WHERE b.updated_at > NOW() - make_interval(days => %s)
            GROUP BY 1
        )
        SELECT u.subject FROM used u JOIN claims cl ON cl.subject = u.subject
        WHERE ((cl.status = 'current' AND cl.revalidate_after < NOW()) OR cl.status = 'needs_revalidation')
          AND NOT EXISTS (SELECT 1 FROM revalidation_checks rc WHERE rc.subject = u.subject AND rc.checked_at > NOW() - make_interval(hours => %s))
        GROUP BY u.subject, u.shortlisted
        ORDER BY u.shortlisted DESC, MIN(cl.revalidate_after) ASC NULLS LAST
        LIMIT %s
        """,
        (RECENT_BRIEF_DAYS, RECHECK_HOURS, limit)
    )
    return [r[0] for r in cur.fetchall()]


def _parse(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def _days_case() -> str:
    cases = " ".join(f"WHEN '{k}' THEN {int(v)}" for k, v in claim_writer.REVALIDATE_DAYS.items())
    return f"CASE kind {cases} ELSE 30 END"


def check_subject(cur, client: GitHubStateClient, subject: str) -> Dict[str, Any]:
    """Revalidates one subject in the caller's transaction. Returns the recorded check."""
    full_name = subject.split(":", 1)[1]
    cur.execute(
        """
        SELECT id::text, latest_commit_hash, default_branch, status, resource_id::text FROM repositories
        WHERE lower(owner || '/' || name) = %s ORDER BY updated_at DESC LIMIT 1
        """,
        (full_name,)
    )
    repo = cur.fetchone()
    cur.execute(
        """
        SELECT MAX(COALESCE(revalidated_at, observed_at)),
               (SELECT subject_version FROM claims WHERE subject = %s AND kind = ANY(%s) AND subject_version IS NOT NULL
                ORDER BY observed_at DESC LIMIT 1)
        FROM claims WHERE subject = %s AND status <> 'refuted'
        """,
        (subject, list(CODE_KINDS), subject)
    )
    last_seen, claimed_version = cur.fetchone()
    stored_version = (repo[1] if repo else None) or claimed_version

    state = client.repo_state(full_name)
    if state is None:
        affected = _mark(cur, subject, "status = 'current'")
        return _record(cur, subject, "missing", stored_version, None, None, affected, repo)

    pushed = _parse(state["pushed_at"])
    api = {"method": "platform_api", "sourceUrl": f"https://api.github.com/repos/{full_name}"}
    push_changed = _refresh_fact(cur, subject, "maintenance", f"Last push on {str(state['pushed_at'])[:10]}" if state["pushed_at"] else None, api)
    _refresh_fact(cur, subject, "licence", f"Licensed under {state['license']}" if state["license"] and state["license"] != "NOASSERTION" else None, api)

    head = stored_version
    if stored_version:
        if pushed is None or last_seen is None or pushed > last_seen:
            head = client.head_sha(full_name, state["default_branch"]) or stored_version
        changed = head != stored_version
    else:
        changed = push_changed

    if not changed:
        cur.execute(
            f"""
            UPDATE claims SET revalidate_after = NOW() + make_interval(days => {_days_case()}), revalidated_at = NOW(),
                status = CASE WHEN status = 'needs_revalidation' AND subject_version IS NOT DISTINCT FROM %s AND %s THEN 'current' ELSE status END,
                updated_at = NOW()
            WHERE subject = %s AND status IN ('current', 'needs_revalidation')
            """,
            (head, bool(head), subject)
        )
        return _record(cur, subject, "unchanged", stored_version, head, pushed, cur.rowcount, repo)

    affected = 0
    reindex = None
    if stored_version:
        affected = _mark(cur, subject, "status = 'current' AND kind = ANY(%s) AND grade IN ('E2', 'E3') AND subject_version IS DISTINCT FROM %s",
                         (list(CODE_KINDS), head))
        cur.execute("UPDATE experiences SET status = 'needs_revalidation', updated_at = NOW() WHERE %s = ANY(subjects) AND status = 'current'", (subject,))
        if repo:
            reindex = queue_reindex(cur, repo[0], repo[4])
    return _record(cur, subject, "changed", stored_version, head, pushed, affected, repo, reindex)


def _refresh_fact(cur, subject: str, kind: str, statement: Optional[str], evidence: Dict[str, Any]) -> bool:
    """Writes the current API fact (E3) and supersedes the subject's other statements of that kind.
    True when an earlier, different statement existed."""
    if not statement:
        return False
    key = claim_writer.statement_key(statement)
    claim_writer.upsert_claim(cur, subject, kind, statement, "E3", evidence)
    cur.execute(
        """
        UPDATE claims SET status = 'superseded', updated_at = NOW()
        WHERE subject = %s AND kind = %s AND brief_id IS NULL AND statement_key <> %s AND status IN ('current', 'needs_revalidation')
        """,
        (subject, kind, key)
    )
    return cur.rowcount > 0


def _mark(cur, subject: str, condition: str, params: tuple = ()) -> int:
    """Marks matching claims needs_revalidation and counts them as stale against their sources."""
    cur.execute(
        f"UPDATE claims SET status = 'needs_revalidation', updated_at = NOW() WHERE subject = %s AND {condition} RETURNING evidence_json",
        (subject,) + params
    )
    rows = cur.fetchall()
    for (evidence,) in rows:
        semantic.record_claim_event(cur, subject, evidence, "stale")
    return len(rows)


def queue_reindex(cur, repository_id: str, resource_id: Optional[str]) -> str:
    """Queues the repository through the normal indexer (the job-queue rules of BriefStore.queue_verification:
    repository row locked, no second job while one is queued or running)."""
    cur.execute("SELECT id FROM repositories WHERE id = %s FOR UPDATE", (repository_id,))
    cur.execute("SELECT 1 FROM ingestion_jobs WHERE repository_id = %s AND status IN ('QUEUED', 'RUNNING')", (repository_id,))
    if cur.fetchone():
        return "queued"
    cur.execute("UPDATE repositories SET status = 'PENDING', error_message = NULL, updated_at = NOW() WHERE id = %s", (repository_id,))
    cur.execute(
        "INSERT INTO ingestion_jobs (repository_id, resource_id, status, step) VALUES (%s, %s, 'QUEUED', 'QUEUED')",
        (repository_id, resource_id)
    )
    return "queued"


def _record(cur, subject, outcome, previous, current, pushed, affected, repo, reindex=None, error=None) -> Dict[str, Any]:
    cur.execute(
        """
        INSERT INTO revalidation_checks (subject, outcome, previous_version, current_version, pushed_at, claims_affected,
                                         repository_id, reindex_status, error_message)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id::text
        """,
        (subject, outcome, previous, current, pushed, affected, repo[0] if repo else None, reindex, error)
    )
    return {"id": cur.fetchone()[0], "subject": subject, "outcome": outcome, "previousVersion": previous,
            "currentVersion": current, "claimsAffected": affected, "reindex": reindex}


def apply_reindexed(cur) -> int:
    """Re-indexes queued by revalidation that finished: claims are rewritten from the new commit (older
    ones stay needs_revalidation), and README coverage claims backed by the new code are corroborated."""
    cur.execute(
        """
        SELECT rc.id, rc.subject, r.id::text, r.status FROM revalidation_checks rc JOIN repositories r ON r.id = rc.repository_id
        WHERE rc.reindex_status = 'queued' AND r.status IN ('READY', 'FAILED')
        """
    )
    applied = 0
    for check_id, subject, repo_id, status in cur.fetchall():
        if status == "READY":
            claim_writer.claims_from_repository(cur, repo_id)
            semantic.corroborate_coverage(cur, subject)
            applied += 1
        cur.execute("UPDATE revalidation_checks SET reindex_status = %s WHERE id = %s", ("applied" if status == "READY" else "failed", check_id))
    return applied


def run_pass(db, client: Optional[GitHubStateClient] = None, limit: int = MAX_SUBJECTS_PER_PASS) -> Dict[str, Any]:
    """One revalidation pass, each subject in its own transaction. Stops at GitHub's rate limit."""
    own = client is None
    client = client or GitHubStateClient()
    results: List[Dict[str, Any]] = []
    try:
        with ledger.ledger_scope(scope_type="memory", scope_id="revalidation", purpose="revalidation"):
            conn = db.get_connection()
            try:
                with conn.cursor() as cur:
                    applied = apply_reindexed(cur)
                    subjects = due_subjects(cur, limit)
                    conn.commit()
                for subject in subjects:
                    try:
                        with conn.cursor() as cur:
                            results.append(check_subject(cur, client, subject))
                            conn.commit()
                    except GitHubRateLimited:
                        conn.rollback()
                        break
                    except (httpx.HTTPError, ValueError) as e:
                        conn.rollback()
                        with conn.cursor() as cur:
                            results.append(_record(cur, subject, "error", None, None, None, 0, None, error=str(e)[:500]))
                            conn.commit()
            finally:
                conn.close()
    finally:
        if own:
            client.close()
    return {"applied": applied, "checked": results}


class MemoryMaintenance:
    """Idle-time upkeep of memory, rate-limited: revalidation, applying finished re-indexes, distillation."""

    def __init__(self, db, interval_seconds: int = REVALIDATE_INTERVAL_SECONDS, clock: Callable[[], float] = time.monotonic,
                 client_factory: Callable[[], GitHubStateClient] = GitHubStateClient):
        self.db = db
        self.interval = interval_seconds
        self.clock = clock
        self.client_factory = client_factory
        self.last: Optional[float] = None

    def maybe_run(self) -> Optional[Dict[str, Any]]:
        now = self.clock()
        if self.last is not None and now - self.last < self.interval:
            return None
        self.last = now
        try:
            client = self.client_factory()
            try:
                summary = run_pass(self.db, client)
            finally:
                client.close()
            from .procedural import distill
            conn = self.db.get_connection()
            try:
                with conn.cursor() as cur:
                    summary.update(distill(cur))
                    conn.commit()
            finally:
                conn.close()
            if summary["checked"] or summary["applied"] or summary.get("proposed"):
                outcomes = [c["outcome"] for c in summary["checked"]]
                print(f"[Memory] Revalidated {len(outcomes)} subjects ({', '.join(f'{o} {outcomes.count(o)}' for o in sorted(set(outcomes)))}); "
                      f"{summary['applied']} re-indexes applied; {summary.get('proposed', 0)} procedures proposed", flush=True)
            return summary
        except Exception as e:
            print(f"[Memory] Maintenance pass failed: {e}", file=sys.stderr, flush=True)
            return None
