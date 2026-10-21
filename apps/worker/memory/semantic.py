"""
Semantic memory: facts about the world (PRODUCT_DEFINITION 8.1 "Technical knowledge" and "Source reliability").

Store: claims (graded E1-E5, at a subject version, with revalidate_after), source_stats, revalidation_checks.
Write: claims.upsert_claim (findings), corroborate_coverage, refute_claim / confirm_claim (user corrections).
Read:  recall_candidates (the recall task), search_claims (the /memory audit), reliability.

A claim is current only while status = 'current' and revalidate_after has not passed; anything else is
reported with its last verification date and never as current.
"""
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from psycopg2.extras import Json, RealDictCursor

from ..claims import github_subject
from ..discovery import ranking
from ..discovery.planner import capability_requirements

# Source reliability: weighted counts halve every HALF_LIFE_DAYS, so recent evidence weighs more
HALF_LIFE_DAYS = 90
# Recall: findings about these kinds can tie a repository to a requirement
RECALL_KINDS = ("capability", "readme_summary", "limitation")
MAX_REMEMBERED = 12
MAX_CLAIMS_PER_CANDIDATE = 8
# An earlier brief's README assessment is reused while it is this fresh (the coverage freshness rule)
ASSESSMENT_FRESH_DAYS = 30
# A requirement researched by an earlier brief of the workspace this recently, with at least this many
# remembered candidates, is not searched again (memory effectiveness, PRODUCT_DEFINITION 10.1)
SKIP_SEARCH_FRESH_DAYS = 7
SKIP_SEARCH_MIN_CANDIDATES = 3

# Evidence method -> source type for source_stats
SOURCE_TYPES = {"readme_assessment": "readme", "code_located": "code", "platform_api": "platform_api",
                "analysis_inferred": "inferred", "docs": "docs"}
USER_METHODS = ("user_refutation", "user_confirmation", "corroboration")


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def normalise_requirement(name: str) -> str:
    return re.sub(r"\s+", " ", (name or "").strip().lower())


def _tsquery(terms) -> Optional[str]:
    words = sorted({re.sub(r"[^a-z0-9]", "", t) for t in terms} - {""})
    words = [w for w in words if len(w) > 2]
    return " | ".join(words) if words else None


def is_current(claim: Dict[str, Any], now: Optional[datetime] = None) -> bool:
    after = claim.get("revalidate_after")
    return claim.get("status") == "current" and (after is None or after > (now or utc_now()))


# Source reliability

def source_of(subject: str, evidence: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    """(source, source_type) an evidence item came from; None for user corrections."""
    method = evidence.get("method") or "unknown"
    if method in USER_METHODS:
        return None
    source_type = SOURCE_TYPES.get(method, method)
    if source_type == "platform_api":
        url = evidence.get("sourceUrl") or ""
        host = re.sub(r"^https?://([^/]+).*$", r"\1", url) if url.startswith("http") else "api.github.com"
        return host.lower(), source_type
    return subject, source_type


def record_source_event(cur, source: str, source_type: str, event: str):
    """event: verified | refuted | stale. Updates the source's row and the source type's aggregate ('*')."""
    assert event in ("verified", "refuted", "stale"), event
    for key in {source, "*"}:
        cur.execute(
            """
            INSERT INTO source_stats (source, source_type, claims_verified, claims_refuted, claims_stale,
                                      verified_weight, refuted_weight, last_event_at, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NOW(), NOW())
            ON CONFLICT (source, source_type) DO UPDATE SET
                claims_verified = source_stats.claims_verified + EXCLUDED.claims_verified,
                claims_refuted = source_stats.claims_refuted + EXCLUDED.claims_refuted,
                claims_stale = source_stats.claims_stale + EXCLUDED.claims_stale,
                verified_weight = source_stats.verified_weight * power(0.5, GREATEST(0, EXTRACT(EPOCH FROM NOW() - COALESCE(source_stats.last_event_at, NOW()))) / 86400.0 / %s) + EXCLUDED.verified_weight,
                refuted_weight = source_stats.refuted_weight * power(0.5, GREATEST(0, EXTRACT(EPOCH FROM NOW() - COALESCE(source_stats.last_event_at, NOW()))) / 86400.0 / %s) + EXCLUDED.refuted_weight,
                last_event_at = CASE WHEN EXCLUDED.claims_stale > 0 THEN source_stats.last_event_at ELSE NOW() END,
                updated_at = NOW()
            """,
            (key[:300], source_type, int(event == "verified"), int(event == "refuted"), int(event == "stale"),
             float(event == "verified"), float(event == "refuted"), HALF_LIFE_DAYS, HALF_LIFE_DAYS)
        )


def record_claim_event(cur, subject: str, evidence: List[Dict[str, Any]], event: str):
    """A claim was corroborated, refuted or went stale: every distinct source behind it is credited."""
    seen = set()
    for item in evidence or []:
        src = source_of(subject, item)
        if src and src not in seen:
            seen.add(src)
            record_source_event(cur, src[0], src[1], event)


def reliability(cur, source: str, source_type: str) -> Dict[str, Any]:
    """Smoothed share of a source's checked claims that held up, recent evidence weighing more. Sources
    with no history take their type's rate; a type with no history scores 0.5. For ranking (not wired in)."""
    cur.execute(
        "SELECT source, verified_weight, refuted_weight, claims_verified, claims_refuted, claims_stale FROM source_stats WHERE source_type = %s AND source IN (%s, '*')",
        (source_type, source)
    )
    rows = {r[0]: r for r in cur.fetchall()}
    agg = rows.get("*")
    prior = (agg[1] + 1) / (agg[1] + agg[2] + 2) if agg else 0.5
    own = rows.get(source) if source != "*" else agg
    verified_w, refuted_w = (own[1], own[2]) if own else (0.0, 0.0)
    score = (verified_w + 2 * prior) / (verified_w + refuted_w + 2)
    return {"source": source, "sourceType": source_type, "score": round(score, 4), "prior": round(prior, 4),
            "verified": own[3] if own else 0, "refuted": own[4] if own else 0, "stale": own[5] if own else 0}


def corroborate_coverage(cur, subject: str) -> int:
    """README coverage claims (E4) about subject backed by a current code claim (E2) for the same
    requirement are corroborated: the evidence records which claim backs it, and the README source gains
    reliability. Matching is by shared terms between the requirement and the capability. Idempotent."""
    cur.execute(
        "SELECT id, statement, evidence_json FROM claims WHERE subject = %s AND kind = 'coverage' AND status = 'current'",
        (subject,)
    )
    coverage = cur.fetchall()
    if not coverage:
        return 0
    cur.execute(
        "SELECT id::text, statement FROM claims WHERE subject = %s AND kind = 'capability' AND grade IN ('E1', 'E2') AND status = 'current'",
        (subject,)
    )
    code = [(cid, ranking.tokens(statement)) for cid, statement in cur.fetchall()]
    corroborated = 0
    for claim_id, statement, evidence in coverage:
        requirement = statement.split(":", 1)[-1]
        wanted = ranking.tokens(requirement)
        if not wanted:
            continue
        if any(e.get("method") == "corroboration" for e in evidence or []):
            continue
        need = min(2, len(wanted))
        backing = next((cid for cid, terms in code if len(wanted & terms) >= need), None)
        if not backing:
            continue
        item = {"method": "corroboration", "claimId": backing, "grade": "E2", "matchedBy": "shared terms"}
        cur.execute("UPDATE claims SET evidence_json = evidence_json || %s, updated_at = NOW() WHERE id = %s", (Json([item]), claim_id))
        record_claim_event(cur, subject, evidence, "verified")
        corroborated += 1
    return corroborated


# Corrections (PRODUCT_DEFINITION 8.2 "Auditable and correctable"); the web API mirrors these

def _claim_for_update(cur, claim_id: str, workspace_id: Optional[str]):
    cur.execute(
        """
        SELECT c.id::text, c.subject, c.grade, c.status, c.brief_id::text, c.evidence_json, b.workspace_id::text
        FROM claims c LEFT JOIN briefs b ON b.id = c.brief_id WHERE c.id = %s FOR UPDATE OF c
        """,
        (claim_id,)
    )
    row = cur.fetchone()
    if not row:
        return None
    # Project-scoped claims belong to their brief's workspace; global claims are facts about public code
    if row[4] and workspace_id and row[6] != workspace_id:
        return None
    return {"id": row[0], "subject": row[1], "grade": row[2], "status": row[3], "briefId": row[4], "evidence": row[5] or []}


def refute_claim(cur, claim_id: str, reason: str, workspace_id: str, user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """The user says a claim is wrong: it is downgraded (refuted, E5, with the refuting evidence appended),
    its sources lose reliability, and the blueprint of every brief in the workspace that cites it is
    re-written. Returns None when the claim is not visible to the workspace."""
    from . import episodic, procedural
    from ..orchestrator.store import invalidate
    claim = _claim_for_update(cur, claim_id, workspace_id)
    if claim is None:
        return None
    item = {"method": "user_refutation", "grade": "E5", "reason": (reason or "")[:1000], "previousGrade": claim["grade"],
            "by": user_id, "at": utc_now().isoformat()}
    cur.execute(
        "UPDATE claims SET status = 'refuted', grade = 'E5', evidence_json = evidence_json || %s, updated_at = NOW() WHERE id = %s",
        (Json([_stable(item)]), claim_id)
    )
    if claim["status"] != "refuted":
        record_claim_event(cur, claim["subject"], claim["evidence"], "refuted")
    briefs = citing_briefs(cur, claim_id, workspace_id)
    for brief_id in briefs:
        invalidate(cur, brief_id, "blueprint", force=True)
    for brief_id in sorted(set(briefs) | ({claim["briefId"]} if claim["briefId"] else set())):
        run = episodic.record_event(cur, brief_id, "refuted", {"claimId": claim_id, "subject": claim["subject"], "reason": item["reason"], "by": user_id})
        if run and run.get("proceduresUsed"):
            procedural.record_outcome(cur, run["proceduresUsed"], success=False)
    return {"claimId": claim_id, "status": "refuted", "invalidatedBriefs": briefs}


def confirm_claim(cur, claim_id: str, workspace_id: str, note: str = "", user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """The user confirms a claim: the confirmation is recorded as evidence (it does not raise the grade:
    a person's word is not code evidence) and its sources gain reliability."""
    from . import episodic
    claim = _claim_for_update(cur, claim_id, workspace_id)
    if claim is None:
        return None
    item = {"method": "user_confirmation", "note": (note or "")[:1000] or None, "by": user_id, "at": utc_now().isoformat()}
    cur.execute("UPDATE claims SET evidence_json = evidence_json || %s, updated_at = NOW() WHERE id = %s", (Json([_stable(item)]), claim_id))
    record_claim_event(cur, claim["subject"], claim["evidence"], "verified")
    if claim["briefId"]:
        episodic.record_event(cur, claim["briefId"], "confirmed", {"claimId": claim_id, "subject": claim["subject"], "by": user_id})
    return {"claimId": claim_id, "status": claim["status"]}


def citing_briefs(cur, claim_id: str, workspace_id: str) -> List[str]:
    """Briefs of the workspace whose blueprint cites the claim (blueprint sources carry claimId)."""
    cur.execute(
        """
        SELECT bb.brief_id::text FROM brief_blueprints bb JOIN briefs b ON b.id = bb.brief_id
        WHERE b.workspace_id = %s AND bb.blueprint_json -> 'sources' @> %s::jsonb
        ORDER BY bb.brief_id
        """,
        (workspace_id, json.dumps([{"claimId": claim_id}]))
    )
    return [r[0] for r in cur.fetchall()]


def _stable(item: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in item.items() if v is not None}


# Read path: the audit view

def search_claims(cur, workspace_id: str, text: str = "", kind: Optional[str] = None, grade: Optional[str] = None,
                  status: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    """Global claims and the workspace's project claims, newest first, with whether each is current."""
    where, params = ["(c.brief_id IS NULL OR b.workspace_id = %s)"], [workspace_id]
    if text.strip():
        where.append("(to_tsvector('english', c.statement) @@ plainto_tsquery('english', %s) OR c.subject ILIKE %s)")
        params += [text, f"%{text.strip()}%"]
    for column, value in (("c.kind", kind), ("c.grade", grade), ("c.status", status)):
        if value:
            where.append(f"{column} = %s")
            params.append(value)
    with cur.connection.cursor(cursor_factory=RealDictCursor) as dict_cur:
        dict_cur.execute(
            f"""
            SELECT c.id::text, c.subject, c.subject_version, c.kind, c.statement, c.grade, c.status, c.scope,
                   c.brief_id::text, c.evidence_json, c.observed_at, c.revalidate_after, c.revalidated_at
            FROM claims c LEFT JOIN briefs b ON b.id = c.brief_id
            WHERE {' AND '.join(where)} ORDER BY c.updated_at DESC LIMIT %s
            """,
            params + [limit]
        )
        rows = [dict(r) for r in dict_cur.fetchall()]
    now = utc_now()
    for r in rows:
        r["current"] = is_current(r, now)
    return rows


# Read path: cross-project reuse (the recall task)

def recall_candidates(cur, workspace_id: Optional[str], brief_id: Optional[str], requirements_json: Dict[str, Any]) -> Dict[str, Any]:
    """Repositories memory already knows something current about that matches the brief's requirements:
    global claims and indexed resources matching the requirement text, and candidates earlier briefs of
    the same workspace found for a requirement of the same name. Returns {candidates, skipRequirements}."""
    now = utc_now()
    reqs = capability_requirements(requirements_json or {})
    by_subject: Dict[str, Dict[str, Any]] = {}

    def entry(subject: str) -> Dict[str, Any]:
        return by_subject.setdefault(subject, {"subject": subject, "fullName": subject.split(":", 1)[1], "matchedRequirements": [],
                                               "via": [], "claims": {}, "assessment": None})

    for r in reqs:
        wanted = ranking.tokens(f"{r['name']} {r.get('description', '')}")
        query = _tsquery(wanted)
        if not query:
            continue
        need = min(2, len(wanted))
        cur.execute(
            f"""
            SELECT id::text, subject, kind, statement, grade, status, observed_at, revalidate_after, revalidated_at, subject_version
            FROM claims
            WHERE brief_id IS NULL AND subject LIKE 'github:%%' AND status <> 'refuted' AND kind IN %s
              AND to_tsvector('english', statement) @@ to_tsquery('english', %s)
            ORDER BY ts_rank(to_tsvector('english', statement), to_tsquery('english', %s)) DESC LIMIT 200
            """,
            (RECALL_KINDS, query, query)
        )
        for row in cur.fetchall():
            claim = _claim_row(row)
            if len(wanted & ranking.tokens(claim["statement"])) < need:
                continue
            e = entry(claim["subject"])
            e["claims"][claim["id"]] = claim
            _add(e["matchedRequirements"], r["name"])
            _add(e["via"], "claims")
        cur.execute(
            """
            SELECT title FROM resources
            WHERE resource_type = 'github_repository' AND tsv_content @@ to_tsquery('english', %s)
            ORDER BY ts_rank(tsv_content, to_tsquery('english', %s)) DESC LIMIT 50
            """,
            (query, query)
        )
        for (title,) in cur.fetchall():
            if title and "/" in title:
                e = entry(github_subject(title))
                _add(e["matchedRequirements"], r["name"])
                _add(e["via"], "resources")

    # Earlier briefs of this workspace that researched a requirement of the same name
    researched: Dict[str, Dict[str, Any]] = {}
    if workspace_id and reqs:
        names = {normalise_requirement(r["name"]): r["name"] for r in reqs}
        with cur.connection.cursor(cursor_factory=RealDictCursor) as dict_cur:
            dict_cur.execute(
                """
                SELECT c.brief_id::text AS brief_id, b.discovered_at, c.full_name, c.matched_requirements, c.assessment_json,
                       c.candidate_kind
                FROM brief_candidates c JOIN briefs b ON b.id = c.brief_id
                WHERE b.workspace_id = %s AND b.id IS DISTINCT FROM %s::uuid AND b.discovered_at > NOW() - make_interval(days => %s)
                  AND EXISTS (SELECT 1 FROM unnest(c.matched_requirements) m WHERE lower(m) = ANY(%s))
                ORDER BY b.discovered_at DESC
                """,
                (workspace_id, brief_id, ASSESSMENT_FRESH_DAYS, list(names))
            )
            rows = dict_cur.fetchall()
        for row in rows:
            subject = github_subject(row["full_name"])
            matched = [names[normalise_requirement(m)] for m in row["matched_requirements"] if normalise_requirement(m) in names]
            e = entry(subject)
            for name in matched:
                _add(e["matchedRequirements"], name)
                info = researched.setdefault(name, {"briefs": set(), "candidates": set(), "lastResearchedAt": row["discovered_at"]})
                info["briefs"].add(row["brief_id"])
                info["candidates"].add(subject)
            _add(e["via"], "workspace_briefs")
            assessment = row["assessment_json"] or {}
            coverage = {names[normalise_requirement(k)]: v for k, v in (assessment.get("coverage") or {}).items() if normalise_requirement(k) in names}
            if coverage and e["assessment"] is None:
                e["assessment"] = {"summary": assessment.get("summary"), "kind": assessment.get("kind") or row["candidate_kind"],
                                   "coverage": coverage, "reason": assessment.get("reason"),
                                   "fromBrief": row["brief_id"], "assessedAt": row["discovered_at"]}

    if not by_subject:
        return {"candidates": [], "skipRequirements": []}

    # Every claim about the remembered subjects (global, and this workspace's coverage claims)
    subjects = list(by_subject)
    cur.execute(
        """
        SELECT c.id::text, c.subject, c.kind, c.statement, c.grade, c.status, c.observed_at, c.revalidate_after, c.revalidated_at, c.subject_version
        FROM claims c LEFT JOIN briefs b ON b.id = c.brief_id
        WHERE c.subject = ANY(%s) AND c.status <> 'refuted' AND (c.brief_id IS NULL OR (b.workspace_id = %s AND c.brief_id IS DISTINCT FROM %s::uuid))
        """,
        (subjects, workspace_id, brief_id)
    )
    for row in cur.fetchall():
        claim = _claim_row(row)
        e = by_subject[claim["subject"]]
        if claim["kind"] in ("licence", "maintenance", "coverage") or claim["id"] in e["claims"]:
            e["claims"].setdefault(claim["id"], claim)

    candidates = []
    for e in by_subject.values():
        claims = sorted(e["claims"].values(), key=lambda c: (not c["current"], c["grade"], c["kind"]))
        current = [c for c in claims if c["current"]]
        relevant = [c for c in current if c["kind"] in RECALL_KINDS or c["kind"] == "coverage"]
        if not relevant and not e["assessment"]:
            continue  # nothing current ties it to this brief: never offered as remembered knowledge
        verified = [c.get("revalidatedAt") or c["observedAt"] for c in current if c.get("observedAt")]
        candidates.append({
            "fullName": e["fullName"],
            "subject": e["subject"],
            "provenance": "memory",
            "matchedRequirements": e["matchedRequirements"],
            "via": e["via"],
            "claims": claims[:MAX_CLAIMS_PER_CANDIDATE],
            "currentClaims": len(current),
            "staleClaims": len(claims) - len(current),
            "lastVerifiedAt": max(verified) if verified else None,
            "assessment": e["assessment"],
        })
    candidates.sort(key=lambda c: (-len(c["matchedRequirements"]), -c["currentClaims"], c["fullName"]))
    candidates = candidates[:MAX_REMEMBERED]
    _attach_metadata(cur, workspace_id, candidates)

    kept = {c["subject"] for c in candidates}
    skip = []
    for name, info in researched.items():
        remembered = info["candidates"] & kept
        if len(remembered) >= SKIP_SEARCH_MIN_CANDIDATES and info["lastResearchedAt"] > now - timedelta(days=SKIP_SEARCH_FRESH_DAYS):
            skip.append({"requirement": name, "briefs": sorted(info["briefs"]), "candidates": len(remembered),
                         "lastResearchedAt": info["lastResearchedAt"]})
    return {"candidates": _jsonable(candidates), "skipRequirements": _jsonable(sorted(skip, key=lambda s: s["requirement"]))}


def _claim_row(row) -> Dict[str, Any]:
    claim = {"id": row[0], "subject": row[1], "kind": row[2], "statement": row[3], "grade": row[4], "status": row[5],
             "observedAt": row[6], "revalidateAfter": row[7], "revalidatedAt": row[8], "subjectVersion": row[9]}
    claim["current"] = is_current({"status": claim["status"], "revalidate_after": claim["revalidateAfter"]})
    return claim


def _add(values: List[str], value: str):
    if value not in values:
        values.append(value)


def _attach_metadata(cur, workspace_id: Optional[str], candidates: List[Dict[str, Any]]):
    """Public repository facts for remembered candidates: the workspace's latest candidate row, else the
    shared library (repositories). pushed_at falls back to the latest push claim."""
    names = [c["fullName"] for c in candidates]
    with cur.connection.cursor(cursor_factory=RealDictCursor) as dict_cur:
        dict_cur.execute(
            """
            SELECT DISTINCT ON (lower(c.full_name)) lower(c.full_name) AS key, c.full_name, c.source_url, c.description,
                   c.primary_language, c.topics, c.stars, c.forks, c.open_issues, c.license, c.pushed_at
            FROM brief_candidates c JOIN briefs b ON b.id = c.brief_id
            WHERE b.workspace_id = %s AND lower(c.full_name) = ANY(%s)
            ORDER BY lower(c.full_name), c.created_at DESC
            """,
            (workspace_id, [n.lower() for n in names])
        )
        rows = {r["key"]: dict(r) for r in dict_cur.fetchall()}
        dict_cur.execute(
            """
            SELECT lower(owner || '/' || name) AS key, owner || '/' || name AS full_name, url AS source_url, description,
                   primary_language, stars, license
            FROM repositories WHERE lower(owner || '/' || name) = ANY(%s)
            """,
            ([n.lower() for n in names],)
        )
        library = {r["key"]: dict(r) for r in dict_cur.fetchall()}
    for c in candidates:
        key = c["fullName"].lower()
        meta = rows.get(key) or library.get(key) or {}
        pushed = meta.get("pushed_at")
        if not pushed:
            pushes = [cl["statement"][len("Last push on "):] for cl in c["claims"] if cl["kind"] == "maintenance" and cl["current"]]
            pushed = max(pushes) if pushes else None
        licence = meta.get("license") or next((cl["statement"][len("Licensed under "):] for cl in c["claims"]
                                               if cl["kind"] == "licence" and cl["current"]), None)
        c["fullName"] = meta.get("full_name") or c["fullName"]
        c["meta"] = {
            "source_url": meta.get("source_url") or f"https://github.com/{c['fullName']}",
            "description": meta.get("description"),
            "primary_language": meta.get("primary_language"),
            "topics": list(meta.get("topics") or []),
            "stars": int(meta.get("stars") or 0),
            "forks": int(meta.get("forks") or 0),
            "open_issues": int(meta.get("open_issues") or 0),
            "license": licence,
            "pushed_at": pushed.isoformat() if hasattr(pushed, "isoformat") else pushed,
        }


def _jsonable(value):
    return json.loads(json.dumps(value, default=lambda v: v.isoformat() if hasattr(v, "isoformat") else str(v)))


# Merging remembered candidates into a discovery result (run_discover)

def merge_remembered(candidates: List[Dict[str, Any]], remembered: List[Dict[str, Any]], requirements_json: Dict[str, Any],
                     query_count: int, tuning) -> Dict[str, int]:
    """Adds remembered repositories the searches did not return, scored by the same ranking functions,
    and marks searched ones memory also knew. Candidates keep their provenance ('search', 'memory').
    Re-selects the shortlist and re-ranks. Returns counts for the discovery metrics."""
    from ..discovery.assess import assessed_requirements
    t = tuning
    now = ranking.utc_now()
    by_name = {c["full_name"].lower(): c for c in candidates}
    for c in candidates:
        c.setdefault("provenance", ["search"])
    added = known = reused = 0
    assessed_reqs = assessed_requirements(capability_requirements(requirements_json), t)

    def apply_assessment(c: Dict[str, Any], assessment: Optional[Dict[str, Any]]) -> bool:
        if not (assessment and assessment.get("coverage")):
            return False
        c["assessment"] = {k: assessment[k] for k in ("summary", "kind", "coverage", "reason") if assessment.get(k)}
        if assessment.get("kind") and assessment["kind"] != "unknown":
            c["candidate_kind"] = assessment["kind"]
        c["coverage_score"] = ranking.coverage_score(assessment["coverage"], assessed_reqs, t)
        return True

    for m in remembered:
        memory_info = {"claims": [{k: cl[k] for k in ("id", "kind", "grade", "statement", "status", "current", "observedAt", "revalidatedAt")}
                                  for cl in m["claims"]],
                       "lastVerifiedAt": m.get("lastVerifiedAt"), "via": m.get("via"),
                       "assessedFromBrief": (m.get("assessment") or {}).get("fromBrief")}
        existing = by_name.get(m["fullName"].lower())
        if existing:
            known += 1
            if "memory" not in existing["provenance"]:
                existing["provenance"].append("memory")
            existing["memory"] = memory_info
            # Searched but not assessed this time (outside the README limit): memory's assessment stands in
            if existing.get("coverage_score") is None and apply_assessment(existing, m.get("assessment")):
                existing["final_score"] = ranking.final_score(existing, t)
                reused += 1
            continue
        meta = m.get("meta") or {}
        c = {"full_name": m["fullName"], **meta, "matched_queries": [], "matched_requirements": list(m["matchedRequirements"]),
             "best_position": 15, "candidate_kind": "unknown", "assessment": {}, "coverage_score": None,
             "provenance": ["memory"], "memory": memory_info}
        c["health_score"] = ranking.health_score(c, now, t)
        c["relevance_score"] = ranking.relevance_score(c, requirements_json, max(1, query_count), t)
        apply_assessment(c, m.get("assessment"))
        c["final_score"] = ranking.final_score(c, t)
        candidates.append(c)
        by_name[c["full_name"].lower()] = c
        added += 1
    if added or reused:
        candidates.sort(key=lambda c: c["final_score"], reverse=True)
        del candidates[t.get("discovery.max_stored_candidates"):]
        ranking.select_shortlist(candidates, t.get("discovery.shortlist_size"), t.get("discovery.shortlist_max_stale_days"), now)
        for rank, c in enumerate(candidates, start=1):
            c["rank"] = rank
    return {"added": added, "alsoFound": known, "assessmentsReused": reused}
