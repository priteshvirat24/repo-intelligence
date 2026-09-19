import os
import psycopg2
from psycopg2.extras import RealDictCursor, Json
from typing import Optional, Dict, Any, List
from ..config import config

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
        """
        conn = self.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                query = f"""
                    UPDATE ingestion_jobs
                    SET status = 'RUNNING',
                        step = 'INITIALIZING',
                        locked_at = NOW(),
                        locked_by = %s,
                        attempts = attempts + 1,
                        updated_at = NOW()
                    WHERE id = (
                        SELECT id FROM ingestion_jobs
                        WHERE (
                            status = 'QUEUED'
                            OR (status = 'RUNNING' AND locked_at < NOW() - INTERVAL '{config.JOB_LOCK_TIMEOUT_MINUTES} minutes')
                        )
                        AND attempts < {config.MAX_JOB_ATTEMPTS}
                        ORDER BY created_at ASC
                        LIMIT 1
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id, repository_id, attempts, status, step;
                """
                cur.execute(query, (worker_id,))
                job = cur.fetchone()
                conn.commit()
                return dict(job) if job else None
        finally:
            conn.close()

    def update_job_step(self, job_id: str, repo_id: str, step: str, repo_status: str):
        """Updates job step and repository status."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE ingestion_jobs SET step = %s, updated_at = NOW() WHERE id = %s",
                    (step, job_id)
                )
                cur.execute(
                    "UPDATE repositories SET status = %s, updated_at = NOW() WHERE id = %s",
                    (repo_status, repo_id)
                )
                conn.commit()
        finally:
            conn.close()

    def release_job_on_shutdown(self, job_id: str, repo_id: str):
        """Releases lock on SIGINT/SIGTERM so job can be safely retried."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE ingestion_jobs SET status = 'QUEUED', step = 'RELEASED', locked_at = NULL, locked_by = NULL, updated_at = NOW() WHERE id = %s",
                    (job_id,)
                )
                cur.execute(
                    "UPDATE repositories SET status = 'PENDING', updated_at = NOW() WHERE id = %s",
                    (repo_id,)
                )
                conn.commit()
        finally:
            conn.close()

    def mark_job_failed(self, job_id: str, repo_id: str, error_message: str):
        """Marks repository and job as FAILED."""
        conn = self.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE ingestion_jobs SET status = 'FAILED', step = 'ERROR', error_message = %s, updated_at = NOW() WHERE id = %s",
                    (error_message, job_id)
                )
                cur.execute(
                    "UPDATE repositories SET status = 'FAILED', error_message = %s, updated_at = NOW() WHERE id = %s",
                    (error_message, repo_id)
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
        knowledge_relationships: Optional[List[Dict[str, Any]]] = None
    ):
        """
        Atomically persists all ingestion artifacts within a single database transaction.
        Guarantees that repository metadata, documents, chunks, capabilities, evidence,
        dependencies, limitations, open-world knowledge objects, and relationships become visible together.
        """
        conn = self.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                # 1. Update Repository commit, domain tags, open knowledge JSON, and status
                cur.execute(
                    """
                    UPDATE repositories
                    SET latest_commit_hash = %s,
                        domain_tags = %s,
                        open_knowledge_json = %s,
                        status = 'READY',
                        error_message = NULL,
                        updated_at = NOW()
                    WHERE id = %s
                    """,
                    (commit_hash, domain_tags or [], Json(open_knowledge_json or {}), repo_id)
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
                        INSERT INTO documents (repository_id, file_path, doc_type, language, token_count, content_hash)
                        VALUES (%s, %s, %s, %s, %s, %s)
                        RETURNING id;
                        """,
                        (repo_id, doc["file_path"], doc["doc_type"], doc.get("language"), doc["token_count"], doc.get("content_hash"))
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
                        INSERT INTO chunks (document_id, repository_id, chunk_index, content, chunk_hash, embedding, metadata_json)
                        VALUES (%s, %s, %s, %s, %s, %s, %s);
                        """,
                        (doc_id, repo_id, chunk["chunk_index"], chunk["content"], chunk.get("chunk_hash"), emb, Json(chunk.get("metadata", {})))
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
                        (cap["slug"], cap["name"], cap["category"], cap.get("notes", cap["name"]))
                    )
                    cap_id = cur.fetchone()["id"]

                    cur.execute(
                        """
                        INSERT INTO repository_capabilities (repository_id, capability_id, confidence, implementation_notes)
                        VALUES (%s, %s, %s, %s)
                        RETURNING id;
                        """,
                        (repo_id, cap_id, cap["confidence"], cap.get("notes"))
                    )
                    repo_cap_id = cur.fetchone()["id"]

                    for ev in cap.get("evidence", []):
                        cur.execute(
                            """
                            INSERT INTO evidence (repository_capability_id, file_path, start_line, end_line, symbol_name, quote_snippet, evidence_type, is_verified)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s);
                            """,
                            (
                                repo_cap_id,
                                ev.get("file_path", "README.md"),
                                ev.get("start_line"),
                                ev.get("end_line"),
                                ev.get("symbol_name"),
                                ev.get("quote_snippet", ""),
                                ev.get("evidence_type", "doc"),
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
                            INSERT INTO knowledge_objects (repository_id, object_type, name, description, category, importance, confidence, metadata_json, embedding)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                            RETURNING id;
                            """,
                            (
                                repo_id,
                                ko["object_type"],
                                ko["name"],
                                ko["description"],
                                ko.get("category"),
                                ko.get("importance", "medium"),
                                ko.get("confidence", 0.90),
                                Json(ko.get("metadata_json", {})),
                                ko_emb
                            )
                        )
                        ko_id = cur.fetchone()["id"]
                        ko_id_map[ko["name"].lower()] = ko_id

                        # Connect verified evidence to knowledge object if present
                        for ev in ko.get("evidence", []):
                            cur.execute(
                                """
                                INSERT INTO evidence (repository_capability_id, knowledge_object_id, file_path, start_line, end_line, symbol_name, quote_snippet, evidence_type, is_verified)
                                VALUES (NULL, %s, %s, %s, %s, %s, %s, %s, %s);
                                """,
                                (
                                    ko_id,
                                    ev.get("file_path", "README.md"),
                                    ev.get("start_line"),
                                    ev.get("end_line"),
                                    ev.get("symbol_name"),
                                    ev.get("quote_snippet", ""),
                                    ev.get("evidence_type", "code_ast"),
                                    ev.get("verified", True)
                                )
                            )

                # 6. Insert Knowledge Relationships
                if knowledge_relationships:
                    for rel in knowledge_relationships:
                        source_id = ko_id_map.get(rel.get("sourceName", "").lower())
                        target_id = ko_id_map.get(rel.get("targetName", "").lower())
                        if source_id:
                            cur.execute(
                                """
                                INSERT INTO knowledge_relationships (source_id, target_id, source_repo_id, relationship_type, confidence, evidence_snippet, metadata_json)
                                VALUES (%s, %s, %s, %s, %s, %s, %s);
                                """,
                                (
                                    source_id,
                                    target_id,
                                    repo_id,
                                    rel.get("relationshipType", "relates-to"),
                                    rel.get("confidence", 0.85),
                                    rel.get("evidenceSnippet", ""),
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
                        (repo_id, dep["package_name"], dep["ecosystem"], dep.get("version_spec"), dep["is_runtime"], dep["is_heavyweight"])
                    )

                # 8. Insert Limitations
                for lim in limitations:
                    cur.execute(
                        """
                        INSERT INTO repository_limitations (repository_id, category, description, file_path)
                        VALUES (%s, %s, %s, %s);
                        """,
                        (repo_id, lim.get("category", "scalability"), lim.get("description", ""), lim.get("file_path"))
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
