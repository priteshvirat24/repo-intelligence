from typing import Any, Dict, List, Optional
from psycopg2.extras import RealDictCursor, Json

from .repository import _text, _opt_text

IMPORTANCE_ORDER_SQL = "CASE ko.importance WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END"


class BriefStore:
    """Persistence for a brief's discovery, verification and blueprint. Scheduling is the run graph's job
    (apps/worker/orchestrator); these functions take a cursor inside the task's own transaction."""

    @staticmethod
    def save_candidates(cur, brief_id: str, candidates: List[Dict[str, Any]], metrics: Dict[str, Any]):
        """Replaces the brief's candidates and records how the search ran."""
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
            if c.get("memory") or (c.get("provenance") and c["provenance"] != ["search"]):
                # Phase 4: where the candidate came from (search, memory) and what memory knew about it
                cur.execute(
                    "UPDATE brief_candidates SET provenance = %s, memory_json = %s WHERE brief_id = %s AND full_name = %s",
                    (c.get("provenance") or ["search"], Json(c.get("memory") or {}), brief_id, _text(c["full_name"], 300))
                )

        cur.execute(
            "UPDATE briefs SET discovery_json = %s, discovered_at = NOW(), updated_at = NOW() WHERE id = %s",
            (Json(metrics), brief_id)
        )

    @staticmethod
    def queue_verification(cur, target: Dict[str, Any]) -> Dict[str, Any]:
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


    @staticmethod
    def save_blueprint_state(cur, brief_id: str, status: str, step: str, verification: List[Dict[str, Any]],
                             blueprint: Optional[Dict[str, Any]] = None, error: Optional[str] = None):
        """The brief's blueprint row, read by the web app: verification progress, then the written blueprint."""
        cur.execute(
            """
            INSERT INTO brief_blueprints (brief_id, status, step, verification_json, blueprint_json, error_message, completed_at)
            VALUES (%s, %s, %s, %s, %s, %s, CASE WHEN %s = 'COMPLETED' THEN NOW() END)
            ON CONFLICT (brief_id) DO UPDATE SET
                status = EXCLUDED.status, step = EXCLUDED.step, verification_json = EXCLUDED.verification_json,
                blueprint_json = COALESCE(EXCLUDED.blueprint_json, CASE WHEN EXCLUDED.status = 'COMPLETED' THEN brief_blueprints.blueprint_json ELSE '{}'::jsonb END),
                error_message = EXCLUDED.error_message, completed_at = EXCLUDED.completed_at, updated_at = NOW()
            """,
            (brief_id, status, step, Json(verification), Json(blueprint) if blueprint is not None else None, error, status)
        )

    @staticmethod
    def load_blueprint_inputs(conn, brief_id: str, verification: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Everything the blueprint is written from: the brief's requirements, its shortlisted candidates
        with their README assessments, and for each verification repository its indexing outcome and
        verified capabilities (one verified evidence location each), limitations and runtime dependencies."""
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            cur.execute("SELECT title, requirements_json FROM briefs WHERE id = %s", (brief_id,))
            brief = cur.fetchone()
            cur.execute(
                """
                SELECT full_name, source_url, description, primary_language, stars, license, pushed_at::text AS pushed_at,
                       candidate_kind, coverage_score::float AS coverage_score, rank, assessment_json
                FROM brief_candidates WHERE brief_id = %s AND shortlisted ORDER BY rank
                """,
                (brief_id,)
            )
            candidates = [dict(r) for r in cur.fetchall()]

            verified = []
            for entry in verification or []:
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
