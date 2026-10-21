"""
Task scheduling on PostgreSQL (SYSTEM_DESIGN 4.1): the same claim/lock/retry rules as the repository job
queue, generalised to the per-brief run graph.

Lifecycle: pending -> running -> done | waiting (re-claimed after not_before) | awaiting_input | failed.
An input change marks a task and everything downstream stale; a stale task runs again, but when its inputs
fingerprint equals the last one it is marked done without executing and nothing downstream changes.
"""
from typing import Any, Dict, Optional

from psycopg2.extras import Json, RealDictCursor

from ..config import config
from ..db.repository import DatabaseRepository, JobLostError
from ..providers import ledger
from .graph import ORDER, ancestors, digest, downstream

DEFAULT_BUDGET = {"llmCalls": 60, "tokens": 400_000, "githubRequests": 250, "sourceRequests": 300}


def create_run(cur, brief_id: str):
    """Creates the brief's tasks (idempotent)."""
    for task_type in ORDER:
        cur.execute(
            """
            INSERT INTO tasks (brief_id, type, depends_on) VALUES (%s, %s, %s)
            ON CONFLICT (brief_id, type) DO UPDATE SET depends_on = EXCLUDED.depends_on
            """,
            (brief_id, task_type, ancestors(task_type))
        )


def invalidate(cur, brief_id: str, from_type: str, force: bool = False):
    """Marks from_type and everything downstream stale (also when running: the running worker loses
    ownership and its result is discarded). force clears the fingerprint so from_type really re-runs."""
    types = [from_type] + downstream(from_type)
    cur.execute(
        f"""
        UPDATE tasks SET status = 'stale', locked_at = NULL, locked_by = NULL, attempts = 0, not_before = NULL,
            error_message = NULL, updated_at = NOW()
            {", inputs_fingerprint = CASE WHEN type = %s THEN NULL ELSE inputs_fingerprint END" if force else ""}
        WHERE brief_id = %s AND type = ANY(%s)
        """,
        ((from_type,) if force else ()) + (brief_id, types)
    )
    cur.execute("UPDATE briefs SET stop_reason = NULL WHERE id = %s", (brief_id,))
    sync_brief_status(cur, brief_id)


def sync_brief_status(caller_cur, brief_id: str):
    """briefs.status summarises the run for lists: QUEUED, RUNNING, AWAITING_INPUT, COMPLETED, FAILED, STOPPED.
    Runs on its own plain cursor of the caller's connection (same transaction, whatever the caller's row type)."""
    with caller_cur.connection.cursor() as cur:
        _sync_brief_status(cur, brief_id)


def _sync_brief_status(cur, brief_id: str):
    cur.execute("SELECT type, status, error_message FROM tasks WHERE brief_id = %s", (brief_id,))
    tasks = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
    if not tasks:
        return
    cur.execute("SELECT stop_reason, status FROM briefs WHERE id = %s", (brief_id,))
    row = cur.fetchone()
    stop_reason = row[0] if row else None
    previous_status = row[1] if row else None
    statuses = [tasks[t][0] for t in ORDER if t in tasks]
    failed = next((t for t in ORDER if t in tasks and tasks[t][0] == "failed"), None)
    if stop_reason == "budget":
        status, error = "STOPPED", "The run's budget was used up. Raise the budget to continue."
    elif failed:
        status, error = "FAILED", tasks[failed][1]
    elif all(s == "done" for s in statuses):
        status, error = "COMPLETED", None
    elif any(s == "awaiting_input" for s in statuses):
        status, error = "AWAITING_INPUT", None
    elif all(s in ("pending", "stale") for s in statuses):
        status, error = "QUEUED", None
    else:
        status, error = "RUNNING", None
    cur.execute("UPDATE briefs SET status = %s, error_message = %s, updated_at = NOW() WHERE id = %s", (status, error, brief_id))
    if status in ("COMPLETED", "STOPPED", "FAILED") and status != previous_status:
        _record_episode(cur, brief_id, status)


def _record_episode(cur, brief_id: str, status: str):
    """Phase 4 episodic memory: the run ended, so it is remembered. A failure to write the episode never
    fails the task that ended the run (savepoint)."""
    from ..memory import episodic
    cur.execute("SAVEPOINT record_episode")
    try:
        episodic.record_run(cur, brief_id, status)
        cur.execute("RELEASE SAVEPOINT record_episode")
    except Exception as e:
        cur.execute("ROLLBACK TO SAVEPOINT record_episode")
        print(f"[Memory] Could not record the run episode of brief {brief_id}: {e}")


class TaskStore:
    def __init__(self, db: DatabaseRepository):
        self.db = db

    def claim_next(self, worker_id: str) -> Optional[Dict[str, Any]]:
        stale_lock = f"locked_at < NOW() - INTERVAL '{config.JOB_LOCK_TIMEOUT_MINUTES} minutes'"
        conn = self.db.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    f"""
                    UPDATE tasks SET status = 'failed', locked_at = NULL, locked_by = NULL,
                        error_message = COALESCE(error_message, 'Task abandoned after repeated failures'), updated_at = NOW()
                    WHERE attempts >= {config.MAX_JOB_ATTEMPTS} AND (status IN ('pending', 'stale') OR (status = 'running' AND {stale_lock}))
                    RETURNING brief_id
                    """
                )
                for row in cur.fetchall():
                    sync_brief_status(cur, row["brief_id"])
                cur.execute(
                    f"""
                    UPDATE tasks SET status = 'running', locked_at = NOW(), locked_by = %s, attempts = attempts + 1,
                        started_at = COALESCE(started_at, NOW()), updated_at = NOW()
                    WHERE id = (
                        SELECT t.id FROM tasks t
                        WHERE (t.status IN ('pending', 'stale', 'waiting') OR (t.status = 'running' AND t.{stale_lock}))
                          AND (t.not_before IS NULL OR t.not_before <= NOW())
                          AND t.attempts < {config.MAX_JOB_ATTEMPTS}
                          AND NOT EXISTS (
                              SELECT 1 FROM tasks d WHERE d.brief_id = t.brief_id AND d.type = ANY(t.depends_on) AND d.status <> 'done'
                          )
                        ORDER BY t.updated_at ASC
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id, brief_id, type, attempts, inputs_fingerprint, output_json, output_hash
                    """,
                    (worker_id,)
                )
                task = cur.fetchone()
                if task:
                    sync_brief_status(cur, task["brief_id"])
                conn.commit()
                return dict(task) if task else None
        finally:
            conn.close()

    def load_context(self, brief_id: str) -> Dict[str, Any]:
        """The brief and every task's latest output, for building a task's inputs."""
        conn = self.db.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, workspace_id, title, brief_text, constraints_json, answers_json, budget_json,
                           requirements_json, understanding_json, challenges_json, focus_json
                    FROM briefs WHERE id = %s
                    """,
                    (brief_id,)
                )
                brief = cur.fetchone()
                if brief is None:
                    raise JobLostError(f"Brief {brief_id} was deleted")
                cur.execute("SELECT type, status, output_json FROM tasks WHERE brief_id = %s", (brief_id,))
                outputs = {r["type"]: r["output_json"] or {} for r in cur.fetchall()}
                return {"brief": dict(brief), "outputs": outputs}
        finally:
            conn.close()

    def budget_usage(self, brief_id: str, since: Optional[str]) -> Dict[str, int]:
        """What the brief's run has spent since its budget was last reset, from the ledger."""
        sources = sorted(ledger.SOURCE_PROVIDERS)
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COUNT(*) FILTER (WHERE provider <> 'github' AND provider <> ALL(%s) AND operation <> 'embedding'),
                           COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) FILTER (WHERE provider <> 'github' AND provider <> ALL(%s)), 0),
                           COUNT(*) FILTER (WHERE provider = 'github'),
                           COUNT(*) FILTER (WHERE provider = ANY(%s))
                    FROM provider_usage
                    WHERE scope_type = 'brief' AND scope_id = %s AND (%s::timestamptz IS NULL OR created_at >= %s::timestamptz)
                    """,
                    (sources, sources, sources, brief_id, since, since)
                )
                calls, tokens, github, source = cur.fetchone()
                return {"llmCalls": int(calls), "tokens": int(tokens), "githubRequests": int(github), "sourceRequests": int(source)}
        finally:
            conn.close()

    def _owned_update(self, task: Dict[str, Any], worker_id: str, sql: str, params: tuple, after=None):
        """Runs an update of a task this worker still owns, in one transaction with `after(cur)`."""
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM tasks WHERE id = %s AND status = 'running' AND locked_by = %s FOR UPDATE", (task["id"], worker_id))
                if cur.fetchone() is None:
                    conn.rollback()
                    raise JobLostError(f"Task {task['type']} of brief {task['brief_id']} is no longer owned by {worker_id}")
                if after:
                    after(cur)
                cur.execute(sql, params)
                sync_brief_status(cur, task["brief_id"])
                conn.commit()
        finally:
            conn.close()

    def complete(self, task: Dict[str, Any], output: Dict[str, Any], fingerprint: str, worker_id: str, persist=None):
        """Marks the task done. When its output changed, everything downstream becomes stale. persist(cur) runs
        in the same transaction, so a task's side effects and its completion become visible together."""
        new_hash = digest(output)

        def after(cur):
            if persist:
                persist(cur)
            if new_hash != task.get("output_hash"):
                cur.execute(
                    """
                    UPDATE tasks SET status = 'stale', locked_at = NULL, locked_by = NULL, attempts = 0, updated_at = NOW()
                    WHERE brief_id = %s AND type = ANY(%s) AND status <> 'pending'
                    """,
                    (task["brief_id"], downstream(task["type"]))
                )

        self._owned_update(
            task, worker_id,
            """
            UPDATE tasks SET status = 'done', output_json = %s, output_hash = %s, inputs_fingerprint = %s,
                error_message = NULL, attempts = 0, not_before = NULL, locked_at = NULL, locked_by = NULL,
                finished_at = NOW(), updated_at = NOW()
            WHERE id = %s
            """,
            (Json(output), new_hash, fingerprint, task["id"]), after
        )

    def wait(self, task: Dict[str, Any], seconds: int, worker_id: str, progress: Dict[str, Any], fingerprint: str, persist=None):
        """Parks the task until not_before; it is claimed again then. Waiting is not a failed attempt."""
        self._owned_update(
            task, worker_id,
            """
            UPDATE tasks SET status = 'waiting', output_json = %s, inputs_fingerprint = %s, attempts = 0,
                not_before = NOW() + make_interval(secs => %s), locked_at = NULL, locked_by = NULL, updated_at = NOW()
            WHERE id = %s
            """,
            (Json(progress), fingerprint, seconds, task["id"]), persist
        )

    def await_input(self, task: Dict[str, Any], output: Dict[str, Any], fingerprint: str, worker_id: str, persist=None):
        """The task finished but its result needs a person (blocking clarifying questions): downstream waits."""
        self._owned_update(
            task, worker_id,
            """
            UPDATE tasks SET status = 'awaiting_input', output_json = %s, output_hash = %s, inputs_fingerprint = %s,
                attempts = 0, locked_at = NULL, locked_by = NULL, finished_at = NOW(), updated_at = NOW()
            WHERE id = %s
            """,
            (Json(output), digest(output), fingerprint, task["id"]), persist
        )

    def retry(self, task: Dict[str, Any], message: str, delay_seconds: int, worker_id: str):
        self._owned_update(
            task, worker_id,
            """
            UPDATE tasks SET status = 'pending', error_message = %s, not_before = NOW() + make_interval(secs => %s),
                locked_at = NULL, locked_by = NULL, updated_at = NOW()
            WHERE id = %s
            """,
            (message[:1000], delay_seconds, task["id"])
        )

    def fail(self, task: Dict[str, Any], message: str, worker_id: str, stop_reason: Optional[str] = None):
        def after(cur):
            if stop_reason:
                cur.execute("UPDATE briefs SET stop_reason = %s WHERE id = %s", (stop_reason, task["brief_id"]))
        self._owned_update(
            task, worker_id,
            """
            UPDATE tasks SET status = 'failed', error_message = %s, locked_at = NULL, locked_by = NULL,
                finished_at = NOW(), updated_at = NOW()
            WHERE id = %s
            """,
            (message[:1000], task["id"]), after
        )

    def release(self, task: Dict[str, Any], worker_id: str):
        """On shutdown: back to pending for another worker (lock_timeout so we never wait on ourselves)."""
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SET lock_timeout = '3s'")
                cur.execute(
                    "UPDATE tasks SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = NOW() WHERE id = %s AND locked_by = %s AND status = 'running'",
                    (task["id"], worker_id)
                )
                conn.commit()
        finally:
            conn.close()

    def set_step(self, brief_id: str, step: str):
        """Fine-grained progress shown in the UI (e.g. SEARCHING_GITHUB while discovery runs)."""
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("UPDATE briefs SET step = %s, updated_at = NOW() WHERE id = %s", (step, brief_id))
                conn.commit()
        finally:
            conn.close()

    def heartbeat(self, task: Dict[str, Any], worker_id: str):
        """Refreshes the lock during long stages; raises JobLostError if the task was invalidated meanwhile."""
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("UPDATE tasks SET locked_at = NOW() WHERE id = %s AND status = 'running' AND locked_by = %s", (task["id"], worker_id))
                owned = cur.rowcount > 0
                conn.commit()
        finally:
            conn.close()
        if not owned:
            raise JobLostError(f"Task {task['type']} of brief {task['brief_id']} was invalidated")
