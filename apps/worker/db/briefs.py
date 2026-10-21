from typing import Any, Dict, List, Optional
from psycopg2.extras import RealDictCursor, Json

from ..config import config
from .repository import DatabaseRepository, JobLostError, _text, _opt_text


class BriefRepository:
    """Queue and persistence for brief discovery. The briefs table is the queue: same claiming rules as
    ingestion_jobs (FOR UPDATE SKIP LOCKED, attempt limit, stale-lock recovery, ownership on every write)."""

    def __init__(self, db: DatabaseRepository):
        self.db = db

    def claim_next_brief(self, worker_id: str) -> Optional[Dict[str, Any]]:
        stale = f"locked_at IS NOT NULL AND locked_at < NOW() - INTERVAL '{config.JOB_LOCK_TIMEOUT_MINUTES} minutes'"
        conn = self.db.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    f"""
                    UPDATE briefs
                    SET status = 'FAILED', step = 'FAILED',
                        error_message = 'Discovery abandoned: worker stopped responding and retry limit was reached.',
                        locked_at = NULL, locked_by = NULL, updated_at = NOW()
                    WHERE attempts >= {config.MAX_JOB_ATTEMPTS}
                      AND (status = 'QUEUED' OR (status = 'RUNNING' AND {stale}))
                    """
                )
                cur.execute(
                    f"""
                    UPDATE briefs
                    SET status = 'RUNNING', step = 'PLANNING_QUERIES', locked_at = NOW(), locked_by = %s,
                        attempts = attempts + 1, updated_at = NOW()
                    WHERE id = (
                        SELECT id FROM briefs
                        WHERE (
                            (status = 'QUEUED' AND (locked_at IS NULL OR locked_at <= NOW()))
                            OR (status = 'RUNNING' AND {stale})
                        )
                        AND attempts < {config.MAX_JOB_ATTEMPTS}
                        ORDER BY created_at ASC
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id, title, requirements_json, attempts
                    """,
                    (worker_id,)
                )
                brief = cur.fetchone()
                conn.commit()
                return dict(brief) if brief else None
        finally:
            conn.close()

    def update_step(self, brief_id: str, step: str, worker_id: str):
        """Records progress and refreshes the lock. Raises JobLostError if the brief was deleted or re-queued."""
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE briefs SET step = %s, locked_at = NOW(), updated_at = NOW()
                    WHERE id = %s AND status = 'RUNNING' AND locked_by = %s
                    """,
                    (step, brief_id, worker_id)
                )
                owned = cur.rowcount > 0
                conn.commit()
        finally:
            conn.close()
        if not owned:
            raise JobLostError(f"Brief {brief_id} is no longer owned by {worker_id}")

    def persist_discovery(self, brief_id: str, candidates: List[Dict[str, Any]], metrics: Dict[str, Any], worker_id: str):
        """Replaces the brief's candidates and completes it, in one transaction, only if still owned."""
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM briefs WHERE id = %s AND status = 'RUNNING' AND locked_by = %s FOR UPDATE",
                    (brief_id, worker_id)
                )
                if cur.fetchone() is None:
                    conn.rollback()
                    raise JobLostError(f"Brief {brief_id} is no longer owned by {worker_id}")
                cur.execute("DELETE FROM brief_candidates WHERE brief_id = %s", (brief_id,))
                for c in candidates:
                    cur.execute(
                        """
                        INSERT INTO brief_candidates (
                            brief_id, full_name, source_url, description, primary_language, topics, stars, forks,
                            open_issues, license, pushed_at, candidate_kind, matched_queries, matched_requirements,
                            relevance_score, health_score, coverage_score, final_score, rank, shortlisted,
                            duplicate_of, assessment_json
                        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            brief_id,
                            _text(c["full_name"], 300),
                            _text(c["source_url"], 500),
                            _opt_text(c.get("description"), 2000),
                            _opt_text(c.get("primary_language"), 100),
                            [_text(t, 100) for t in (c.get("topics") or [])][:30],
                            c["stars"],
                            c["forks"],
                            c["open_issues"],
                            _opt_text(c.get("license"), 100),
                            c.get("pushed_at"),
                            c.get("candidate_kind") or "unknown",
                            [_text(q, 200) for q in c["matched_queries"]],
                            [_text(r, 300) for r in c["matched_requirements"]],
                            c["relevance_score"],
                            c["health_score"],
                            c.get("coverage_score"),
                            c["final_score"],
                            c["rank"],
                            bool(c.get("shortlisted")),
                            _opt_text(c.get("duplicate_of"), 300),
                            Json(c.get("assessment") or {}),
                        )
                    )
                cur.execute(
                    """
                    UPDATE briefs
                    SET status = 'COMPLETED', step = 'DONE', error_message = NULL, discovery_json = %s,
                        discovered_at = NOW(), locked_at = NULL, locked_by = NULL, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (Json(metrics), brief_id)
                )
                conn.commit()
        finally:
            conn.close()

    def requeue_for_retry(self, brief_id: str, error_message: str, worker_id: str, delay_seconds: int) -> bool:
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE briefs
                    SET status = 'QUEUED', step = 'QUEUED', error_message = %s,
                        locked_by = NULL, locked_at = NOW() + make_interval(secs => %s), updated_at = NOW()
                    WHERE id = %s AND status = 'RUNNING' AND locked_by = %s
                    """,
                    (error_message[:1000], delay_seconds, brief_id, worker_id)
                )
                requeued = cur.rowcount > 0
                conn.commit()
                return requeued
        finally:
            conn.close()

    def mark_failed(self, brief_id: str, error_message: str, worker_id: str):
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE briefs
                    SET status = 'FAILED', step = 'FAILED', error_message = %s,
                        locked_at = NULL, locked_by = NULL, updated_at = NOW()
                    WHERE id = %s AND status = 'RUNNING' AND locked_by = %s
                    """,
                    (error_message[:1000], brief_id, worker_id)
                )
                conn.commit()
        finally:
            conn.close()

    def release_on_shutdown(self, brief_id: str, worker_id: str):
        """Hands a running brief back to the queue on SIGINT/SIGTERM so another worker can pick it up."""
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                # Same as ingestion jobs: never wait on a row lock this process may itself be holding
                cur.execute("SET lock_timeout = '3s'")
                cur.execute(
                    """
                    UPDATE briefs
                    SET status = 'QUEUED', step = 'QUEUED', locked_at = NULL, locked_by = NULL, updated_at = NOW()
                    WHERE id = %s AND status = 'RUNNING' AND locked_by = %s
                    """,
                    (brief_id, worker_id)
                )
                conn.commit()
        finally:
            conn.close()
