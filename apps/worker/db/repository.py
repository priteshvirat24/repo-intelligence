import os
import psycopg2
from psycopg2.extras import RealDictCursor, Json
from typing import Optional, Dict, Any, List
from ..config import config


class JobLostError(Exception):
    """Raised when this worker no longer owns a job (cancelled, superseded, or reclaimed after a stall)."""


# Resolves the resources row(s) belonging to a job/repository. Repositories created via the universal
# GitHub adapter have their own resource UUID (repositories.resource_id); legacy rows share the id or URL.
RESOURCE_MATCH_SQL = """(
    id IN (SELECT resource_id FROM repositories WHERE id = %(repo_id)s AND resource_id IS NOT NULL)
    OR id IN (SELECT resource_id FROM ingestion_jobs WHERE id = %(job_id)s AND resource_id IS NOT NULL)
    OR source_url IN (SELECT url FROM repositories WHERE id = %(repo_id)s)
    OR id::text = %(repo_id)s::text
)"""

# Worker repository statuses -> resource statuses the web app understands (ResourceStatus)
RESOURCE_STATUS_FOR_REPO_STATUS = {
    "PENDING": "PENDING",
    "CLONING": "FETCHING",
    "ANALYZING": "ANALYZING",
    "INDEXING": "INDEXING",
    "READY": "READY",
    "FAILED": "FAILED",
}


def _text(value: Any, max_len: Optional[int] = None) -> str:
    """Coerces LLM/manifest values to a NUL-free string that fits the target column."""
    s = "" if value is None else str(value)
    s = s.replace("\x00", "")
    return s[:max_len] if max_len else s


def _opt_text(value: Any, max_len: Optional[int] = None) -> Optional[str]:
    return None if value is None else _text(value, max_len)


class DatabaseRepository:
    """Handles PostgreSQL connection pooling, job queue, and atomic transactional persistence."""

    def __init__(self, connection_url: Optional[str] = None):
        self.url = connection_url or config.DATABASE_URL

    def get_connection(self):
        sslmode = "require" if "neon.tech" in self.url else "prefer"
        return psycopg2.connect(self.url, sslmode=sslmode)

    def claim_next_job(self, worker_id: str = "worker-1") -> Optional[Dict[str, Any]]:
        """
        Atomically claims a queued job or recovers a stalled job using FOR UPDATE SKIP LOCKED.
        Handles MAX_JOB_ATTEMPTS and JOB_LOCK_TIMEOUT_MINUTES.

        Only repository jobs are claimed: universal (web/YouTube/PDF) jobs have no repository_id and
        are processed in-process by the web app, which holds them as RUNNING without a lock.
        """
        stale = f"locked_at IS NOT NULL AND locked_at < NOW() - INTERVAL '{config.JOB_LOCK_TIMEOUT_MINUTES} minutes'"
        conn = self.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # Jobs that exhausted their attempts (worker crashed on the final attempt, or released on
                # shutdown too many times) would otherwise stay RUNNING/QUEUED forever.
                exhausted_msg = "Ingestion abandoned: worker stopped responding and retry limit was reached."
                cur.execute(
                    f"""
                    WITH exhausted AS (
                        UPDATE ingestion_jobs
                        SET status = 'FAILED', step = 'FAILED', error_message = %(msg)s,
                            locked_at = NULL, locked_by = NULL, updated_at = NOW()
                        WHERE repository_id IS NOT NULL
                          AND attempts >= {config.MAX_JOB_ATTEMPTS}
                          AND (status = 'QUEUED' OR (status = 'RUNNING' AND {stale}))
                        RETURNING repository_id, resource_id
                    ), failed_repos AS (
                        UPDATE repositories r
                        SET status = 'FAILED', error_message = %(msg)s, updated_at = NOW()
                        FROM exhausted e
                        WHERE r.id = e.repository_id
                        RETURNING r.resource_id
                    )
                    UPDATE resources
                    SET status = 'FAILED', error_message = %(msg)s, updated_at = NOW()
                    WHERE status <> 'CANCELLED'
                      AND id IN (
                        SELECT resource_id FROM exhausted WHERE resource_id IS NOT NULL
                        UNION
                        SELECT resource_id FROM failed_repos WHERE resource_id IS NOT NULL
                      )
                    """,
                    {"msg": exhausted_msg}
                )

                cur.execute(
                    f"""
                    UPDATE ingestion_jobs
                    SET status = 'RUNNING',
                        step = 'INITIALIZING',
                        locked_at = NOW(),
                        locked_by = %s,
                        attempts = attempts + 1,
                        updated_at = NOW()
                    WHERE id = (
                        SELECT id FROM ingestion_jobs
                        WHERE repository_id IS NOT NULL
                        AND (
                            status = 'QUEUED'
                            OR (status = 'RUNNING' AND {stale})
                        )
                        AND attempts < {config.MAX_JOB_ATTEMPTS}
                        ORDER BY created_at ASC
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id, repository_id, resource_id, attempts, status, step;
                    """,
                    (worker_id,)
                )
                job = cur.fetchone()
                conn.commit()
                return dict(job) if job else None
        finally:
            conn.close()

    def update_job_step(self, job_id: str, repo_id: str, step: str, repo_status: str, worker_id: str):
        """
        Updates job step, repository status, and resource status. Also refreshes the job lock so
        long-running jobs are not reclaimed as stalled. Raises JobLostError if this worker no longer
        owns the job (e.g. the user cancelled it or a newer ingestion superseded it).
        """
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE ingestion_jobs SET step = %s, locked_at = NOW(), updated_at = NOW()
                    WHERE id = %s AND status = 'RUNNING' AND locked_by = %s
                    """,
                    (step, job_id, worker_id)
                )
                if cur.rowcount == 0:
                    conn.rollback()
                    raise JobLostError(f"Job {job_id} is no longer owned by {worker_id}")
                cur.execute(
                    "UPDATE repositories SET status = %s, updated_at = NOW() WHERE id = %s",
                    (repo_status, repo_id)
                )
                cur.execute(
                    f"""
                    UPDATE resources
                    SET status = %(status)s, updated_at = NOW()
                    WHERE status <> 'CANCELLED' AND {RESOURCE_MATCH_SQL}
                    """,
                    {
                        "status": RESOURCE_STATUS_FOR_REPO_STATUS.get(repo_status, "ANALYZING"),
                        "job_id": job_id,
                        "repo_id": repo_id,
                    }
                )
                conn.commit()
        finally:
            conn.close()

    def release_job_on_shutdown(self, job_id: str, repo_id: str, worker_id: str):
        """Releases lock on SIGINT/SIGTERM so job can be safely retried."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                # Only release a job we still hold: it may have just completed or been cancelled
                cur.execute(
                    """
                    UPDATE ingestion_jobs
                    SET status = 'QUEUED', step = 'RELEASED', locked_at = NULL, locked_by = NULL, updated_at = NOW()
                    WHERE id = %s AND status = 'RUNNING' AND locked_by = %s
                    """,
                    (job_id, worker_id)
                )
                if cur.rowcount == 0:
                    conn.rollback()
                    return
                cur.execute(
                    "UPDATE repositories SET status = 'PENDING', updated_at = NOW() WHERE id = %s",
                    (repo_id,)
                )
                cur.execute(
                    f"""
                    UPDATE resources SET status = 'PENDING', updated_at = NOW()
                    WHERE status <> 'CANCELLED' AND {RESOURCE_MATCH_SQL}
                    """,
                    {"job_id": job_id, "repo_id": repo_id}
                )
                conn.commit()
        finally:
            conn.close()

    def mark_job_failed(self, job_id: str, repo_id: str, error_message: str, worker_id: str):
        """Marks an ingestion job and associated repository/resource as failed (only if still owned)."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE ingestion_jobs
                    SET status = 'FAILED', error_message = %s, step = 'FAILED', updated_at = NOW()
                    WHERE id = %s AND status = 'RUNNING' AND locked_by = %s
                    """,
                    (error_message, job_id, worker_id)
                )
                if cur.rowcount == 0:
                    # Cancelled, superseded, or reclaimed: leave the newer state alone
                    conn.rollback()
                    return
                cur.execute(
                    """
                    UPDATE repositories
                    SET status = 'FAILED', error_message = %s, updated_at = NOW()
                    WHERE id = %s
                    """,
                    (error_message, repo_id)
                )
                cur.execute(
                    f"""
                    UPDATE resources
                    SET status = 'FAILED', error_message = %(msg)s, updated_at = NOW()
                    WHERE status <> 'CANCELLED' AND {RESOURCE_MATCH_SQL}
                    """,
                    {"msg": error_message, "job_id": job_id, "repo_id": repo_id}
                )
                conn.commit()
        finally:
            conn.close()

    def record_heartbeat(self, worker_id: str, current_job_id: Optional[str] = None, status: str = "ALIVE", metadata: Optional[Dict[str, Any]] = None):
        """Records or updates heartbeat in worker_heartbeats table."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO worker_heartbeats (worker_id, status, current_job_id, last_seen_at, metadata)
                    VALUES (%s, %s, %s, NOW(), %s)
                    ON CONFLICT (worker_id) DO UPDATE
                    SET status = EXCLUDED.status,
                        current_job_id = EXCLUDED.current_job_id,
                        last_seen_at = NOW(),
                        metadata = EXCLUDED.metadata;
                    """,
                    (worker_id, status, current_job_id, Json(metadata or {}))
                )
                conn.commit()
        finally:
            conn.close()

    def persist_ingestion_atomic(
        self,
        job_id: str,
        repo_id: str,
        commit_hash: str,
        documents: List[Dict[str, Any]],
        chunks: List[Dict[str, Any]],
        embeddings: List[List[float]],
        capabilities: List[Dict[str, Any]],
        dependencies: List[Dict[str, Any]],
        limitations: List[Dict[str, Any]],
        stage_metrics: Dict[str, Any],
        domain_tags: Optional[List[str]] = None,
        open_knowledge_json: Optional[Dict[str, Any]] = None,
        knowledge_objects: Optional[List[Dict[str, Any]]] = None,
        knowledge_relationships: Optional[List[Dict[str, Any]]] = None,
        analysis_completeness: Optional[Dict[str, Any]] = None,
        worker_id: Optional[str] = None
    ):
        """
        Atomically persists all ingestion artifacts within a single database transaction.
        Guarantees that repository metadata, documents, chunks, capabilities, evidence,
        dependencies, limitations, open-world knowledge objects, and relationships become visible together.
        """
        conn = self.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # 0. Verify we still own the job and hold its row lock for the rest of the transaction,
                # so a concurrent cancel/supersede cannot be overwritten with READY. (Seed scripts that
                # persist directly pass no worker_id.)
                if worker_id is not None:
                    cur.execute(
                        """
                        SELECT id FROM ingestion_jobs
                        WHERE id = %s AND status = 'RUNNING' AND locked_by = %s
                        FOR UPDATE
                        """,
                        (job_id, worker_id)
                    )
                    if not cur.fetchone():
                        raise JobLostError(f"Job {job_id} is no longer owned by {worker_id}")

                cur.execute(
                    f"SELECT id, status FROM resources WHERE {RESOURCE_MATCH_SQL} FOR UPDATE",
                    {"job_id": job_id, "repo_id": repo_id}
                )
                resource_rows = cur.fetchall()
                if any(r["status"] == "CANCELLED" for r in resource_rows):
                    raise JobLostError(f"Resource for job {job_id} was cancelled")

                cur.execute(
                    """
                    SELECT COALESCE(
                        (SELECT resource_id FROM repositories WHERE id = %s),
                        (SELECT resource_id FROM ingestion_jobs WHERE id = %s)
                    ) AS resource_id
                    """,
                    (repo_id, job_id)
                )
                resource_id = cur.fetchone()["resource_id"]

                # 1. Update Repository commit, domain tags, open knowledge JSON, completeness, and status
                cur.execute(
                    """
                    UPDATE repositories
                    SET latest_commit_hash = %s,
                        domain_tags = %s,
                        open_knowledge_json = %s,
                        analysis_completeness = %s,
                        status = 'READY',
                        error_message = NULL,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (commit_hash, domain_tags or [], Json(open_knowledge_json or {}), Json(analysis_completeness or {}), repo_id)
                )

                # Also update corresponding resource in resources table
                cur.execute(
                    """
                    UPDATE resources
                    SET status = 'READY',
                        domain_tags = %s,
                        error_message = NULL,
                        indexed_at = NOW(),
                        updated_at = NOW()
                    WHERE id = ANY(%s::uuid[])
                    """,
                    (domain_tags or [], [str(r["id"]) for r in resource_rows])
                )

                # Clean previous data if re-indexing
                cur.execute("DELETE FROM documents WHERE repository_id = %s", (repo_id,))
                cur.execute("DELETE FROM repository_capabilities WHERE repository_id = %s", (repo_id,))
                cur.execute("DELETE FROM repository_dependencies WHERE repository_id = %s", (repo_id,))
                cur.execute("DELETE FROM repository_limitations WHERE repository_id = %s", (repo_id,))
                cur.execute("DELETE FROM knowledge_objects WHERE repository_id = %s", (repo_id,))

                # 2. Insert Documents
                doc_id_map = {}
                for doc in documents:
                    cur.execute(
                        """
                        INSERT INTO documents (repository_id, resource_id, file_path, doc_type, language, token_count, content_hash)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        RETURNING id;
                        """,
                        (repo_id, resource_id, doc["file_path"], doc["doc_type"], _opt_text(doc.get("language"), 50), doc["token_count"], doc.get("content_hash"))
                    )
                    doc_id_map[doc["file_path"]] = cur.fetchone()["id"]

                # 3. Insert Chunks with embeddings
                for i, chunk in enumerate(chunks):
                    doc_id = doc_id_map.get(chunk["file_path"])
                    if not doc_id:
                        continue
                    emb = embeddings[i] if i < len(embeddings) else None
                    cur.execute(
                        """
                        INSERT INTO chunks (document_id, repository_id, resource_id, chunk_index, content, chunk_hash, embedding, metadata_json)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
                        """,
                        (doc_id, repo_id, resource_id, chunk["chunk_index"], _text(chunk["content"]), chunk.get("chunk_hash"), emb, Json(chunk.get("metadata", {})))
                    )

                # 4. Insert Capabilities and Evidence (Relational backwards-compat & vocabulary)
                for cap in capabilities:
                    cur.execute(
                        """
                        INSERT INTO capabilities (slug, name, category, description)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (slug) DO UPDATE
                        SET name = EXCLUDED.name, category = EXCLUDED.category
                        RETURNING id;
                        """,
                        (_text(cap["slug"], 100), _text(cap["name"], 150), _text(cap["category"], 50) or "domain-specific", _text(cap.get("notes") or cap["name"]))
                    )
                    cap_id = cur.fetchone()["id"]

                    cur.execute(
                        """
                        INSERT INTO repository_capabilities (repository_id, capability_id, confidence, implementation_notes)
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT ON CONSTRAINT unique_repo_capability DO UPDATE
                        SET confidence = GREATEST(repository_capabilities.confidence, EXCLUDED.confidence)
                        RETURNING id;
                        """,
                        (repo_id, cap_id, cap["confidence"], cap.get("notes"))
                    )
                    repo_cap_id = cur.fetchone()["id"]

                    for ev in cap.get("evidence", []):
                        cur.execute(
                            """
                            INSERT INTO evidence (repository_capability_id, resource_id, file_path, start_line, end_line, symbol_name, quote_snippet, evidence_type, evidence_strength, is_verified)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                            """,
                            (
                                repo_cap_id,
                                resource_id,
                                _text(ev.get("file_path") or "README.md"),
                                ev.get("start_line"),
                                ev.get("end_line"),
                                _opt_text(ev.get("symbol_name"), 150),
                                _text(ev.get("quote_snippet")),
                                ev.get("evidence_type", "doc"),
                                ev.get("evidence_strength", "DIRECT_IMPLEMENTATION"),
                                ev.get("verified", True)
                            )
                        )

                # 5. Insert Open-World Knowledge Objects (Multi-level semantic objects with embeddings)
                ko_id_map: Dict[str, str] = {}
                if knowledge_objects:
                    for ko in knowledge_objects:
                        ko_emb = ko.get("embedding")
                        cur.execute(
                            """
                            INSERT INTO knowledge_objects (repository_id, resource_id, object_type, name, description, category, importance, confidence, metadata_json, embedding)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                            RETURNING id;
                            """,
                            (
                                repo_id,
                                resource_id,
                                ko["object_type"],
                                _text(ko["name"], 255),
                                _text(ko["description"]),
                                _opt_text(ko.get("category"), 100),
                                ko.get("importance", "medium"),
                                ko.get("confidence", 0.90),
                                Json(ko.get("metadata_json", {})),
                                ko_emb
                            )
                        )
                        ko_id = cur.fetchone()["id"]
                        ko_id_map[_text(ko["name"], 255).lower()] = ko_id

                        # Connect verified evidence to knowledge object if present
                        for ev in ko.get("evidence", []):
                            cur.execute(
                                """
                                INSERT INTO evidence (repository_capability_id, knowledge_object_id, resource_id, file_path, start_line, end_line, symbol_name, quote_snippet, evidence_type, evidence_strength, is_verified)
                                VALUES (NULL, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s);
                                """,
                                (
                                    ko_id,
                                    resource_id,
                                    _text(ev.get("file_path") or "README.md"),
                                    ev.get("start_line"),
                                    ev.get("end_line"),
                                    _opt_text(ev.get("symbol_name"), 150),
                                    _text(ev.get("quote_snippet")),
                                    ev.get("evidence_type", "code_ast"),
                                    ev.get("evidence_strength", "DIRECT_IMPLEMENTATION"),
                                    ev.get("verified", True)
                                )
                            )

                # 6. Insert Knowledge Relationships
                if knowledge_relationships:
                    for rel in knowledge_relationships:
                        source_id = ko_id_map.get(_text(rel.get("sourceName"), 255).lower())
                        target_id = ko_id_map.get(_text(rel.get("targetName"), 255).lower())
                        if source_id:
                            cur.execute(
                                """
                                INSERT INTO knowledge_relationships (source_id, target_id, source_repo_id, source_resource_id, relationship_type, confidence, evidence_snippet, metadata_json)
                                VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
                                """,
                                (
                                    source_id,
                                    target_id,
                                    repo_id,
                                    resource_id,
                                    _text(rel.get("relationshipType") or "relates-to", 50),
                                    rel.get("confidence", 0.85),
                                    _text(rel.get("evidenceSnippet")),
                                    Json(rel.get("metadata", {}))
                                )
                            )

                # 7. Insert Dependencies
                for dep in dependencies:
                    cur.execute(
                        """
                        INSERT INTO repository_dependencies (repository_id, package_name, ecosystem, version_spec, is_runtime, is_heavyweight)
                        VALUES (%s, %s, %s, %s, %s, %s);
                        """,
                        (repo_id, _text(dep["package_name"], 150), _text(dep["ecosystem"], 50), _opt_text(dep.get("version_spec"), 50), dep["is_runtime"], dep["is_heavyweight"])
                    )

                # 8. Insert Limitations
                for lim in limitations:
                    cur.execute(
                        """
                        INSERT INTO repository_limitations (repository_id, category, description, file_path)
                        VALUES (%s, %s, %s, %s);
                        """,
                        (repo_id, _text(lim.get("category") or "scalability", 50), _text(lim.get("description")), lim.get("file_path"))
                    )

                # 9. Complete Job with Stage Metrics
                cur.execute(
                    """
                    UPDATE ingestion_jobs
                    SET status = 'COMPLETED',
                        step = 'DONE',
                        stage_metrics = %s,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (Json(stage_metrics), job_id)
                )

                conn.commit()

        except Exception as e:
            conn.rollback()
            raise e
        finally:
            conn.close()
