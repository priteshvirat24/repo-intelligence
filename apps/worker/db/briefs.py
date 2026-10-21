from typing import Any, Dict, List, Optional
from psycopg2.extras import RealDictCursor, Json

from ..config import config
from .repository import DatabaseRepository, JobLostError, _text, _opt_text

# Queue tables owned by this module and the status a retried/released row goes back to
_WAITING_STATUS = {"briefs": "QUEUED", "brief_blueprints": "WAITING"}

IMPORTANCE_ORDER_SQL = "CASE ko.importance WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END"


class BriefRepository:
    """Queues and persistence for brief discovery and blueprints. Both tables are their own queue, with the
    same claiming rules as ingestion_jobs (FOR UPDATE SKIP LOCKED, attempt limit, stale-lock recovery,
    ownership checked on every write)."""

    def __init__(self, db: DatabaseRepository):
        self.db = db

    # Discovery

    def claim_next_brief(self, worker_id: str) -> Optional[Dict[str, Any]]:
        stale = self._stale_sql()
        conn = self.db.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                self._fail_exhausted(cur, "briefs", "QUEUED", "Discovery abandoned: worker stopped responding and retry limit was reached.")
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
        self._update_step("briefs", brief_id, step, worker_id)

    def persist_discovery(
        self,
        brief_id: str,
        candidates: List[Dict[str, Any]],
        metrics: Dict[str, Any],
        worker_id: str,
        verification_targets: Optional[List[Dict[str, Any]]] = None,
    ):
        """Replaces the brief's candidates, queues its verification repositories into the indexer and
        creates a fresh blueprint waiting for them, all in one transaction, only if the brief is still owned."""
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
                verification = [self._queue_verification(cur, t) for t in (verification_targets or [])]
                cur.execute("DELETE FROM brief_blueprints WHERE brief_id = %s", (brief_id,))
                cur.execute(
                    "INSERT INTO brief_blueprints (brief_id, verification_json) VALUES (%s, %s)",
                    (brief_id, Json(verification))
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

    @staticmethod
    def _queue_verification(cur, target: Dict[str, Any]) -> Dict[str, Any]:
        """Puts one repository through the normal indexer, like adding it in the web app: the resources and
        repositories rows are found case-insensitively or created, and a job is queued with the repository
        row locked. A repository that is already indexed or being indexed is reused, not re-indexed."""
        entry: Dict[str, Any] = {"fullName": target["fullName"]}
        if target.get("state") == "skipped":
            return {**entry, "state": "skipped", "reason": target.get("reason")}

        meta, url = target["meta"], target["url"]
        cur.execute(
            """
            SELECT id, status, resource_id FROM repositories
            WHERE lower(url) = lower(%s) OR (lower(owner) = lower(%s) AND lower(name) = lower(%s))
            ORDER BY updated_at DESC LIMIT 1
            """,
            (url, meta["owner"], meta["name"])
        )
        existing = cur.fetchone()
        if existing:
            repo_id, repo_status, resource_id = str(existing[0]), existing[1], existing[2]
            cur.execute("SELECT id FROM repositories WHERE id = %s FOR UPDATE", (repo_id,))
            cur.execute("SELECT 1 FROM ingestion_jobs WHERE repository_id = %s AND status IN ('QUEUED', 'RUNNING')", (repo_id,))
            if repo_status == "READY" or cur.fetchone():
                return {**entry, "state": "reused", "repositoryId": repo_id, "resourceId": str(resource_id) if resource_id else None}

        metadata = {
            "owner": meta["owner"], "name": meta["name"], "description": meta.get("description"),
            "defaultBranch": meta.get("default_branch"), "stars": meta.get("stars", 0), "license": meta.get("license"),
            "primaryLanguage": meta.get("primary_language"), "sizeKb": meta.get("size_kb"),
        }
        cur.execute(
            """
            SELECT id FROM resources
            WHERE resource_type = 'github_repository' AND (lower(source_url) = lower(%s) OR lower(canonical_url) = lower(%s))
            ORDER BY updated_at DESC LIMIT 1
            """,
            (url, url)
        )
        resource = cur.fetchone()
        if resource:
            cur.execute(
                """
                UPDATE resources SET title = %s, description = COALESCE(%s, description), metadata_json = %s,
                    status = 'PENDING', updated_at = NOW()
                WHERE id = %s RETURNING id
                """,
                (f"{meta['owner']}/{meta['name']}", meta.get("description"), Json(metadata), resource[0])
            )
        else:
            cur.execute(
                """
                INSERT INTO resources (resource_type, resource_role, source_url, canonical_url, title, description,
                    author, publisher, source_domain, status, metadata_json, updated_at)
                VALUES ('github_repository', 'software_component', %s, %s, %s, %s, %s, 'GitHub', 'github.com', 'PENDING', %s, NOW())
                ON CONFLICT (source_url) DO UPDATE SET status = 'PENDING', metadata_json = EXCLUDED.metadata_json, updated_at = NOW()
                RETURNING id
                """,
                (url, url, f"{meta['owner']}/{meta['name']}", meta.get("description"), meta["owner"], Json(metadata))
            )
        resource_id = str(cur.fetchone()[0])

        repo_values = (resource_id, meta.get("description"), meta.get("default_branch") or "main", meta.get("stars", 0),
                       _opt_text(meta.get("license"), 50), _opt_text(meta.get("primary_language"), 50))
        if existing:
            cur.execute(
                """
                UPDATE repositories SET resource_id = %s, description = COALESCE(%s, description), default_branch = %s,
                    stars = %s, license = COALESCE(%s, license), primary_language = COALESCE(%s, primary_language),
                    status = 'PENDING', error_message = NULL, updated_at = NOW()
                WHERE id = %s RETURNING id
                """,
                repo_values + (existing[0],)
            )
        else:
            cur.execute(
                """
                INSERT INTO repositories (resource_id, description, default_branch, stars, license, primary_language,
                    owner, name, url, status, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'PENDING', NOW())
                ON CONFLICT (owner, name) DO UPDATE SET resource_id = EXCLUDED.resource_id, status = 'PENDING',
                    error_message = NULL, updated_at = NOW()
                RETURNING id
                """,
                repo_values + (_text(meta["owner"], 100), _text(meta["name"], 100), url)
            )
        repo_id = str(cur.fetchone()[0])
        cur.execute("SELECT id FROM repositories WHERE id = %s FOR UPDATE", (repo_id,))
        cur.execute(
            "INSERT INTO ingestion_jobs (repository_id, resource_id, status, step) VALUES (%s, %s, 'QUEUED', 'QUEUED')",
            (repo_id, resource_id)
        )
        return {**entry, "state": "queued", "repositoryId": repo_id, "resourceId": resource_id}

    # Blueprints

    def claim_next_blueprint(self, worker_id: str) -> Optional[Dict[str, Any]]:
        """Claims a waiting blueprint once none of its repositories is still being indexed (READY or FAILED,
        or removed from the library), or once it has waited BLUEPRINT_MAX_WAIT_MINUTES."""
        stale = self._stale_sql()
        conn = self.db.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                self._fail_exhausted(cur, "brief_blueprints", "WAITING", "Blueprint abandoned: worker stopped responding and retry limit was reached.")
                cur.execute(
                    f"""
                    UPDATE brief_blueprints
                    SET status = 'RUNNING', step = 'COLLECTING_EVIDENCE', locked_at = NOW(), locked_by = %s,
                        attempts = attempts + 1, updated_at = NOW()
                    WHERE id = (
                        SELECT b.id FROM brief_blueprints b
                        WHERE (
                            (b.status = 'WAITING' AND (b.locked_at IS NULL OR b.locked_at <= NOW()) AND (
                                b.created_at < NOW() - make_interval(mins => %s)
                                OR NOT EXISTS (
                                    SELECT 1 FROM jsonb_array_elements(b.verification_json) v
                                    JOIN repositories r ON r.id = (v->>'repositoryId')::uuid
                                    WHERE r.status NOT IN ('READY', 'FAILED')
                                )
                            ))
                            OR (b.status = 'RUNNING' AND {stale.replace('locked_at', 'b.locked_at')})
                        )
                        AND b.attempts < {config.MAX_JOB_ATTEMPTS}
                        ORDER BY b.created_at ASC
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id, brief_id, verification_json, attempts
                    """,
                    (worker_id, config.BLUEPRINT_MAX_WAIT_MINUTES)
                )
                blueprint = cur.fetchone()
                conn.commit()
                return dict(blueprint) if blueprint else None
        finally:
            conn.close()

    def update_blueprint_step(self, blueprint_id: str, step: str, worker_id: str):
        self._update_step("brief_blueprints", blueprint_id, step, worker_id)

    def load_blueprint_inputs(self, blueprint: Dict[str, Any]) -> Dict[str, Any]:
        """Everything the blueprint is written from: the brief's requirements, its shortlisted candidates
        with their README assessments, and for each verification repository its indexing outcome and
        verified capabilities (one verified evidence location each), limitations and runtime dependencies."""
        conn = self.db.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute("SELECT title, requirements_json FROM briefs WHERE id = %s", (blueprint["brief_id"],))
                brief = cur.fetchone()
                if brief is None:
                    raise JobLostError(f"Brief {blueprint['brief_id']} was deleted")
                cur.execute(
                    """
                    SELECT full_name, source_url, description, primary_language, stars, license, pushed_at::text AS pushed_at,
                           candidate_kind, coverage_score::float AS coverage_score, rank, assessment_json
                    FROM brief_candidates WHERE brief_id = %s AND shortlisted ORDER BY rank
                    """,
                    (blueprint["brief_id"],)
                )
                candidates = [dict(r) for r in cur.fetchall()]

                verified = []
                for entry in blueprint["verification_json"] or []:
                    repo_id = entry.get("repositoryId")
                    result = {**entry, "repository": None, "capabilities": [], "limitations": [], "dependencies": []}
                    if repo_id:
                        cur.execute(
                            """
                            SELECT owner, name, url, status, error_message, latest_commit_hash, license, stars,
                                   open_knowledge_json->>'purpose' AS purpose,
                                   open_knowledge_json->'architecture' AS architecture,
                                   open_knowledge_json->'interfaces' AS interfaces,
                                   analysis_completeness
                            FROM repositories WHERE id = %s
                            """,
                            (repo_id,)
                        )
                        repo = cur.fetchone()
                        result["repository"] = dict(repo) if repo else None
                        if repo and repo["status"] == "READY":
                            cur.execute(
                                f"""
                                SELECT ko.name, ko.description, ko.importance, ev.file_path, ev.start_line, ev.end_line,
                                       ev.symbol_name, ev.quote_snippet
                                FROM knowledge_objects ko
                                JOIN LATERAL (
                                    SELECT e.file_path, e.start_line, e.end_line, e.symbol_name, e.quote_snippet
                                    FROM evidence e
                                    WHERE e.knowledge_object_id = ko.id AND e.is_verified
                                    ORDER BY (e.evidence_strength = 'DIRECT_IMPLEMENTATION') DESC, e.start_line NULLS LAST
                                    LIMIT 1
                                ) ev ON TRUE
                                WHERE ko.repository_id = %s AND ko.object_type = 'capability'
                                ORDER BY {IMPORTANCE_ORDER_SQL}, ko.confidence DESC
                                LIMIT 15
                                """,
                                (repo_id,)
                            )
                            result["capabilities"] = [dict(r) for r in cur.fetchall()]
                            cur.execute(
                                "SELECT category, description, file_path FROM repository_limitations WHERE repository_id = %s LIMIT 8",
                                (repo_id,)
                            )
                            result["limitations"] = [dict(r) for r in cur.fetchall()]
                            cur.execute(
                                """
                                SELECT package_name, ecosystem FROM repository_dependencies
                                WHERE repository_id = %s AND is_runtime ORDER BY package_name LIMIT 20
                                """,
                                (repo_id,)
                            )
                            result["dependencies"] = [dict(r) for r in cur.fetchall()]
                    verified.append(result)
                return {"title": brief["title"], "requirements": brief["requirements_json"] or {}, "candidates": candidates, "verification": verified}
        finally:
            conn.close()

    def persist_blueprint(self, blueprint_id: str, blueprint_json: Dict[str, Any], worker_id: str):
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE brief_blueprints
                    SET status = 'COMPLETED', step = 'DONE', blueprint_json = %s, error_message = NULL,
                        completed_at = NOW(), locked_at = NULL, locked_by = NULL, updated_at = NOW()
                    WHERE id = %s AND status = 'RUNNING' AND locked_by = %s
                    """,
                    (Json(blueprint_json), blueprint_id, worker_id)
                )
                owned = cur.rowcount > 0
                conn.commit()
        finally:
            conn.close()
        if not owned:
            raise JobLostError(f"Blueprint {blueprint_id} is no longer owned by {worker_id}")

    # Shared queue operations (table is always one of _WAITING_STATUS, never user input)

    def requeue_for_retry(self, brief_id: str, error_message: str, worker_id: str, delay_seconds: int, table: str = "briefs") -> bool:
        assert table in _WAITING_STATUS
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE {table}
                    SET status = %s, step = %s, error_message = %s,
                        locked_by = NULL, locked_at = NOW() + make_interval(secs => %s), updated_at = NOW()
                    WHERE id = %s AND status = 'RUNNING' AND locked_by = %s
                    """,
                    (_WAITING_STATUS[table], "QUEUED" if table == "briefs" else "VERIFYING", error_message[:1000],
                     delay_seconds, brief_id, worker_id)
                )
                requeued = cur.rowcount > 0
                conn.commit()
                return requeued
        finally:
            conn.close()

    def mark_failed(self, brief_id: str, error_message: str, worker_id: str, table: str = "briefs"):
        assert table in _WAITING_STATUS
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE {table}
                    SET status = 'FAILED', step = 'FAILED', error_message = %s,
                        locked_at = NULL, locked_by = NULL, updated_at = NOW()
                    WHERE id = %s AND status = 'RUNNING' AND locked_by = %s
                    """,
                    (error_message[:1000], brief_id, worker_id)
                )
                conn.commit()
        finally:
            conn.close()

    def release_on_shutdown(self, brief_id: str, worker_id: str, table: str = "briefs"):
        """Hands a running row back to its queue on SIGINT/SIGTERM so another worker can pick it up."""
        assert table in _WAITING_STATUS
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                # Same as ingestion jobs: never wait on a row lock this process may itself be holding
                cur.execute("SET lock_timeout = '3s'")
                cur.execute(
                    f"""
                    UPDATE {table}
                    SET status = %s, locked_at = NULL, locked_by = NULL, updated_at = NOW()
                    WHERE id = %s AND status = 'RUNNING' AND locked_by = %s
                    """,
                    (_WAITING_STATUS[table], brief_id, worker_id)
                )
                conn.commit()
        finally:
            conn.close()

    def _update_step(self, table: str, row_id: str, step: str, worker_id: str):
        assert table in _WAITING_STATUS
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    f"""
                    UPDATE {table} SET step = %s, locked_at = NOW(), updated_at = NOW()
                    WHERE id = %s AND status = 'RUNNING' AND locked_by = %s
                    """,
                    (step, row_id, worker_id)
                )
                owned = cur.rowcount > 0
                conn.commit()
        finally:
            conn.close()
        if not owned:
            raise JobLostError(f"{table} row {row_id} is no longer owned by {worker_id}")

    @staticmethod
    def _stale_sql() -> str:
        return f"locked_at IS NOT NULL AND locked_at < NOW() - INTERVAL '{config.JOB_LOCK_TIMEOUT_MINUTES} minutes'"

    def _fail_exhausted(self, cur, table: str, waiting: str, message: str):
        cur.execute(
            f"""
            UPDATE {table}
            SET status = 'FAILED', step = 'FAILED', error_message = %s,
                locked_at = NULL, locked_by = NULL, updated_at = NOW()
            WHERE attempts >= {config.MAX_JOB_ATTEMPTS}
              AND (status = %s OR (status = 'RUNNING' AND {self._stale_sql()}))
            """,
            (message, waiting)
        )
