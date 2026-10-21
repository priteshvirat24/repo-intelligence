"""
Claims: factual statements with an evidence grade (PRODUCT_DEFINITION 5.1, SYSTEM_DESIGN 3 and 6).

  E1 executed      a sandbox run showed it                       (Phase 6)
  E2 code          located in the source at file, lines, commit  (the repository evidence gate)
  E3 documented    stated by the platform or official docs       (GitHub API facts; docs in Phase 2)
  E4 claimed       a README, blog or forum says so                (README assessments)
  E5 inferred      Open Eye's own reasoning

A claim is identified by subject, kind, normalised statement and (for project-scoped claims) brief. Finding
the same fact again adds evidence to the existing claim and keeps the best grade; it never creates a copy.
"""
import hashlib
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from psycopg2.extras import Json

GRADES = ("E1", "E2", "E3", "E4", "E5")
# How long a finding stays current before it must be revalidated (PRODUCT_DEFINITION 8.2)
REVALIDATE_DAYS = {"capability": 90, "limitation": 90, "licence": 30, "maintenance": 7, "readme_summary": 30, "coverage": 30}


def statement_key(statement: str) -> str:
    normalised = re.sub(r"\s+", " ", statement.strip().lower())
    return hashlib.sha256(normalised.encode("utf-8")).hexdigest()[:32]


def github_subject(full_name: str) -> str:
    return f"github:{full_name.lower()}"


def upsert_claim(cur, subject: str, kind: str, statement: str, grade: str, evidence: Dict[str, Any],
                 subject_version: Optional[str] = None, brief_id: Optional[str] = None,
                 workspace_id: Optional[str] = None, confidence: Optional[float] = None) -> str:
    """Inserts or strengthens a claim; returns its id. Project-scoped when brief_id is given."""
    assert grade in GRADES, grade
    now = datetime.now(timezone.utc)
    # No timestamp inside the evidence: the claim's observed_at records when it was last seen, and identical
    # evidence must compare equal so that finding the same fact again merges instead of appending a copy
    evidence = {**evidence, "grade": grade}
    revalidate = now + timedelta(days=REVALIDATE_DAYS.get(kind, 30))
    cur.execute(
        """
        INSERT INTO claims (subject, subject_version, kind, statement, statement_key, grade, confidence, scope,
                            workspace_id, brief_id, evidence_json, revalidate_after)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ON CONFLICT (subject, kind, statement_key, (COALESCE(brief_id, '00000000-0000-0000-0000-000000000000'::uuid)))
        DO UPDATE SET
            grade = LEAST(claims.grade, EXCLUDED.grade),
            subject_version = COALESCE(EXCLUDED.subject_version, claims.subject_version),
            confidence = COALESCE(EXCLUDED.confidence, claims.confidence),
            status = 'current',
            evidence_json = CASE
                WHEN claims.evidence_json @> EXCLUDED.evidence_json THEN claims.evidence_json
                ELSE (claims.evidence_json || EXCLUDED.evidence_json)
            END,
            observed_at = NOW(), revalidate_after = EXCLUDED.revalidate_after, updated_at = NOW()
        RETURNING id
        """,
        (subject, subject_version, kind, statement[:2000], statement_key(statement), grade, confidence,
         "workspace" if brief_id else "global", workspace_id, brief_id, Json([_stable(evidence)]), revalidate)
    )
    return str(cur.fetchone()[0])


def _stable(evidence: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in evidence.items() if v is not None}


def claims_from_candidates(cur, brief_id: str, workspace_id: Optional[str], candidates: List[Dict[str, Any]]) -> int:
    """GitHub API facts about each candidate (E3) and README judgements (E4)."""
    written = 0
    for c in candidates:
        subject = github_subject(c["full_name"])
        api = {"method": "platform_api", "sourceUrl": f"https://api.github.com/repos/{c['full_name']}"}
        if c.get("license") and c["license"] != "NOASSERTION":
            upsert_claim(cur, subject, "licence", f"Licensed under {c['license']}", "E3", api)
            written += 1
        if c.get("pushed_at"):
            upsert_claim(cur, subject, "maintenance", f"Last push on {str(c['pushed_at'])[:10]}", "E3", api)
            written += 1
        assessment = c.get("assessment") or {}
        readme = {"method": "readme_assessment", "sourceUrl": c.get("source_url")}
        if assessment.get("summary"):
            upsert_claim(cur, subject, "readme_summary", assessment["summary"], "E4", readme)
            written += 1
        for requirement, value in (assessment.get("coverage") or {}).items():
            if value in ("yes", "partial"):
                statement = f"README indicates it {'covers' if value == 'yes' else 'partly covers'}: {requirement}"
                upsert_claim(cur, subject, "coverage", statement, "E4", readme, brief_id=brief_id, workspace_id=workspace_id)
                written += 1
    return written


def claims_from_repository(cur, repository_id: str) -> int:
    """Verified capabilities (E2, at file and lines) and located limitations of an indexed repository.
    Claims about an older commit of the same repository are marked for revalidation."""
    cur.execute("SELECT owner, name, url, latest_commit_hash, license FROM repositories WHERE id = %s AND status = 'READY'", (repository_id,))
    row = cur.fetchone()
    if not row:
        return 0
    owner, name, url, commit, licence = row
    subject = github_subject(f"{owner}/{name}")
    cur.execute(
        """
        SELECT ko.name, ko.description, ev.file_path, ev.start_line, ev.end_line, ev.symbol_name, ev.quote_snippet
        FROM knowledge_objects ko
        JOIN LATERAL (
            SELECT e.file_path, e.start_line, e.end_line, e.symbol_name, e.quote_snippet FROM evidence e
            WHERE e.knowledge_object_id = ko.id AND e.is_verified
            ORDER BY (e.evidence_strength = 'DIRECT_IMPLEMENTATION') DESC, e.start_line NULLS LAST LIMIT 1
        ) ev ON TRUE
        WHERE ko.repository_id = %s AND ko.object_type = 'capability'
        """,
        (repository_id,)
    )
    written = 0
    for cap_name, description, path, start, end, symbol, quote in cur.fetchall():
        lines = f"#L{start}-L{end}" if start and end and end != start else f"#L{start}" if start else ""
        evidence = {"method": "code_located", "sourceUrl": f"https://github.com/{owner}/{name}/blob/{commit or 'HEAD'}/{path}{lines}",
                    "locator": {"filePath": path, "startLine": start, "endLine": end, "symbol": symbol, "commit": commit},
                    "excerpt": (quote or "")[:400]}
        upsert_claim(cur, subject, "capability", f"{cap_name}: {description or ''}".strip(": "), "E2", evidence, subject_version=commit)
        written += 1
    cur.execute("SELECT category, description, file_path FROM repository_limitations WHERE repository_id = %s", (repository_id,))
    for category, description, path in cur.fetchall():
        grade = "E2" if path else "E5"
        evidence = {"method": "code_located" if path else "analysis_inferred", "sourceUrl": url, "locator": {"filePath": path, "commit": commit}}
        upsert_claim(cur, subject, "limitation", f"{category or 'Limitation'}: {description}", grade, evidence, subject_version=commit)
        written += 1
    if licence and licence != "NOASSERTION":
        upsert_claim(cur, subject, "licence", f"Licensed under {licence}", "E3", {"method": "platform_api", "sourceUrl": url})
        written += 1
    if commit:
        cur.execute(
            """
            UPDATE claims SET status = 'needs_revalidation', updated_at = NOW()
            WHERE subject = %s AND kind IN ('capability', 'limitation') AND subject_version IS DISTINCT FROM %s AND status = 'current'
            """,
            (subject, commit)
        )
    return written


def claim_ids_for(cur, subjects: List[str]) -> Dict[tuple, Dict[str, Any]]:
    """{(subject, kind, statement_key): {id, grade, status}} for the given subjects (current and stale)."""
    if not subjects:
        return {}
    cur.execute(
        "SELECT id, subject, kind, statement_key, grade, status FROM claims WHERE subject = ANY(%s) AND brief_id IS NULL",
        (subjects,)
    )
    return {(r[1], r[2], r[3]): {"id": str(r[0]), "grade": r[4], "status": r[5]} for r in cur.fetchall()}
