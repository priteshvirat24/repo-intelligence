"""
Procedural memory: how to do things, learned from episodes and evaluations (PRODUCT_DEFINITION 8.1
"Strategy", 9.1 L2).

Store: procedures (candidate -> active -> retired), fed by episodes and strategy_records.
Write: distill (proposes candidates from recurring successful episodes and from strategy records),
       record_outcome (success and failure counts from later runs and refutations), activate / retire.
Read:  active_for (the procedures the recall task hands the discovery planner).

A procedure is never learned from one episode: it is proposed only when at least MIN_SUPPORT distinct
briefs succeeded with it and none contradicts it, and it becomes active only by a maintainer's decision
once it has that measured support (a planner prompt change is an L2 change).
"""
import hashlib
from typing import Any, Dict, List, Optional

from psycopg2.extras import Json, RealDictCursor

from ..discovery import ranking
from ..discovery.planner import OVERALL, capability_requirements

MIN_SUPPORT = 3              # distinct successful briefs before a pattern is proposed
MIN_ACTIVATION_SUCCESSES = 3  # successes needed before a candidate may be activated
RETIRE_MIN_USES = 4           # an active procedure failing half its uses (at least this many) is retired
MAX_FOR_PLANNER = 5
STRATEGY_MIN_RUNS = 3         # evaluation runs of one tuning on one brief class before it is proposed


class ProcedureError(Exception):
    """An activation or retirement that is not allowed (role or insufficient support)."""


def _key(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:32]


def requirement_terms(name: str) -> List[str]:
    return sorted(ranking.tokens(name))


def distill(cur, workspace_id: Optional[str] = None) -> Dict[str, int]:
    """Proposes query-pattern procedures from run episodes and research strategies from strategy records.
    Existing procedures are updated with the evidence (never re-proposed once retired)."""
    proposed = _distill_query_patterns(cur, workspace_id)
    proposed += _distill_strategies(cur)
    return {"proposed": proposed}


def _distill_query_patterns(cur, workspace_id: Optional[str]) -> int:
    """A query that, for a requirement of the same kind (same requirement terms), found a shortlisted
    repository in completed, unrefuted runs of at least MIN_SUPPORT distinct briefs, and never ran for
    such a requirement without finding one in a completed run."""
    with cur.connection.cursor(cursor_factory=RealDictCursor) as c:
        c.execute(
            """
            SELECT id::text, workspace_id::text, brief_id::text, outcome, queries_json, feedback_json
            FROM episodes WHERE kind = 'run' AND outcome = 'completed' AND (%s::uuid IS NULL OR workspace_id = %s::uuid)
            ORDER BY finished_at
            """,
            (workspace_id, workspace_id)
        )
        episodes = c.fetchall()
    patterns: Dict[tuple, Dict[str, Any]] = {}
    for e in episodes:
        refuted = any(f.get("outcome") == "refuted" for f in e["feedback_json"] or [])
        for q in e["queries_json"] or []:
            if not q.get("query") or not q.get("requirement") or q["requirement"] == OVERALL:
                continue
            terms = requirement_terms(q["requirement"])
            if not terms:
                continue
            key = (e["workspace_id"], " ".join(terms), " ".join(q["query"].lower().split()))
            p = patterns.setdefault(key, {"support": {}, "contradicting": {}, "requirement": q["requirement"], "query": q["query"]})
            if q.get("shortlistedFound") and not refuted:
                p["support"].setdefault(e["brief_id"], e["id"])
            else:
                p["contradicting"].setdefault(e["brief_id"], e["id"])
    proposed = 0
    for (ws, terms, query), p in patterns.items():
        supporting = {b: ep for b, ep in p["support"].items() if b not in p["contradicting"]}
        if len(supporting) < MIN_SUPPORT or p["contradicting"]:
            continue
        trigger = {"requirementTerms": terms.split()}
        steps = {"query": p["query"], "requirementExample": p["requirement"]}
        evidence = {"episodes": sorted(supporting.values()), "briefs": len(supporting)}
        if _upsert(cur, ws, "query_pattern", _key("query_pattern", terms, query), f"Search “{p['query']}” for {p['requirement']}",
                   trigger, steps, evidence, len(supporting), "workspace"):
            proposed += 1
    return proposed


def _distill_strategies(cur) -> int:
    """For a brief class, the tuning version with the best mean recall@10 over at least STRATEGY_MIN_RUNS
    evaluation runs (global: strategy records hold no project content)."""
    cur.execute(
        """
        SELECT brief_class, tuning_version, COUNT(*), AVG((metrics_json->>'recallAt10')::float), array_agg(run_id ORDER BY run_id)
        FROM strategy_records
        WHERE status = 'current' AND tuning_version IS NOT NULL AND metrics_json ? 'recallAt10'
        GROUP BY brief_class, tuning_version HAVING COUNT(*) >= %s
        """,
        (STRATEGY_MIN_RUNS,)
    )
    best: Dict[str, tuple] = {}
    for brief_class, version, runs, recall, run_ids in cur.fetchall():
        if brief_class not in best or recall > best[brief_class][2]:
            best[brief_class] = (version, runs, recall, run_ids)
    proposed = 0
    for brief_class, (version, runs, recall, run_ids) in best.items():
        trigger = {"domain": brief_class}
        steps = {"tuningVersion": version, "meanRecallAt10": round(recall, 4), "runs": runs}
        if _upsert(cur, None, "research_strategy", _key("research_strategy", brief_class), f"Use tuning {version} for {brief_class} briefs",
                   trigger, steps, {"evalRuns": run_ids}, runs, "global"):
            proposed += 1
    return proposed


def _upsert(cur, workspace_id, kind, trigger_key, name, trigger, steps, evidence, support, scope) -> bool:
    """Inserts a candidate, or refreshes an existing procedure's evidence. True when newly proposed."""
    cur.execute(
        """
        INSERT INTO procedures (workspace_id, kind, name, trigger_key, trigger_json, steps_json, evidence_json,
                                success_count, confidence, status, scope, provenance_json)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'candidate', %s, %s)
        ON CONFLICT (kind, trigger_key, (COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid)))
        DO UPDATE SET steps_json = EXCLUDED.steps_json, evidence_json = EXCLUDED.evidence_json,
            success_count = GREATEST(procedures.success_count, EXCLUDED.success_count), updated_at = NOW()
        RETURNING (xmax = 0)
        """,
        (workspace_id, kind, name[:500], trigger_key, Json(trigger), Json(steps), Json(evidence), support,
         round(min(0.95, support / (support + 2)), 2), scope, Json({"method": "distilled", "from": "episodes" if kind == "query_pattern" else "strategy_records"}))
    )
    return bool(cur.fetchone()[0])


def record_outcome(cur, procedure_ids: List[str], success: Optional[bool]):
    """A run that used these procedures ended (success True/False), or one used them at all (None).
    An active procedure that fails half its uses (at least RETIRE_MIN_USES) is retired automatically."""
    if not procedure_ids:
        return
    cur.execute(
        """
        UPDATE procedures SET uses_count = uses_count + 1,
            success_count = success_count + %s, failure_count = failure_count + %s,
            confidence = ROUND(((success_count + %s)::numeric / NULLIF(success_count + %s + failure_count + %s + 2, 0)), 2),
            updated_at = NOW()
        WHERE id = ANY(%s::uuid[])
        """,
        (int(success is True), int(success is False), int(success is True), int(success is True), int(success is False), list(procedure_ids))
    )
    cur.execute(
        """
        UPDATE procedures SET status = 'retired', retired_at = NOW(),
            provenance_json = provenance_json || '{"retiredBecause": "failed half of its uses"}'::jsonb
        WHERE id = ANY(%s::uuid[]) AND status = 'active' AND uses_count >= %s AND failure_count * 2 >= uses_count
        """,
        (list(procedure_ids), RETIRE_MIN_USES)
    )


def activate(cur, procedure_id: str, role: str, user_id: Optional[str] = None, workspace_id: Optional[str] = None) -> Dict[str, Any]:
    """Maintainers only, and only with measured support. The web API mirrors these rules."""
    if role != "maintainer":
        raise ProcedureError("Only a maintainer can activate a procedure")
    p = _load(cur, procedure_id, workspace_id)
    if p["status"] == "active":
        return p
    if p["status"] == "retired":
        raise ProcedureError("A retired procedure is not re-activated; it is proposed again if it recurs")
    if p["success_count"] < MIN_ACTIVATION_SUCCESSES:
        raise ProcedureError(f"Needs at least {MIN_ACTIVATION_SUCCESSES} successful uses; has {p['success_count']}")
    cur.execute("UPDATE procedures SET status = 'active', activated_at = NOW(), activated_by = %s, updated_at = NOW() WHERE id = %s",
                (user_id, procedure_id))
    return {**p, "status": "active"}


def retire(cur, procedure_id: str, role: str, user_id: Optional[str] = None, workspace_id: Optional[str] = None) -> Dict[str, Any]:
    if role != "maintainer":
        raise ProcedureError("Only a maintainer can retire a procedure")
    p = _load(cur, procedure_id, workspace_id)
    cur.execute("UPDATE procedures SET status = 'retired', retired_at = NOW(), retired_by = %s, updated_at = NOW() WHERE id = %s",
                (user_id, procedure_id))
    return {**p, "status": "retired"}


def _load(cur, procedure_id: str, workspace_id: Optional[str]) -> Dict[str, Any]:
    cur.execute(
        "SELECT id::text, workspace_id::text, status, success_count FROM procedures WHERE id = %s FOR UPDATE",
        (procedure_id,)
    )
    row = cur.fetchone()
    if not row or (row[1] and workspace_id and row[1] != workspace_id):
        raise ProcedureError("Procedure not found")
    return {"id": row[0], "workspaceId": row[1], "status": row[2], "success_count": row[3]}


def active_for(cur, workspace_id: Optional[str], requirements_json: Dict[str, Any], limit: int = MAX_FOR_PLANNER) -> List[Dict[str, Any]]:
    """Active query procedures of the workspace (or global) whose trigger matches one of the brief's
    requirements: every trigger term appears in the requirement's name (and the domain, if set, matches)."""
    reqs = capability_requirements(requirements_json or {})
    domains = {str(d).lower() for d in requirements_json.get("domains") or []} if requirements_json else set()
    with cur.connection.cursor(cursor_factory=RealDictCursor) as c:
        c.execute(
            """
            SELECT id::text, kind, name, trigger_json, steps_json, success_count, failure_count, confidence::float AS confidence
            FROM procedures
            WHERE status = 'active' AND kind = 'query_pattern' AND (workspace_id IS NULL OR workspace_id = %s::uuid)
            ORDER BY confidence DESC NULLS LAST, success_count DESC
            """,
            (workspace_id,)
        )
        rows = c.fetchall()
    matched = []
    for p in rows:
        trigger = p["trigger_json"] or {}
        terms = set(trigger.get("requirementTerms") or [])
        if trigger.get("domain") and trigger["domain"].lower() not in domains:
            continue
        requirement = next((r["name"] for r in reqs if terms and terms <= ranking.tokens(f"{r['name']} {r.get('description', '')}")), None)
        if requirement:
            matched.append({"id": p["id"], "name": p["name"], "requirement": requirement, "steps": p["steps_json"],
                            "successCount": p["success_count"], "failureCount": p["failure_count"], "confidence": p["confidence"]})
        if len(matched) >= limit:
            break
    return matched


def list_procedures(cur, workspace_id: str, limit: int = 100) -> List[Dict[str, Any]]:
    with cur.connection.cursor(cursor_factory=RealDictCursor) as c:
        c.execute(
            """
            SELECT id::text, workspace_id::text, kind, name, trigger_json, steps_json, evidence_json, success_count, failure_count,
                   uses_count, confidence::float AS confidence, status, scope, provenance_json, revalidation_rule, activated_at,
                   retired_at, created_at, updated_at
            FROM procedures WHERE workspace_id IS NULL OR workspace_id = %s
            ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'candidate' THEN 1 ELSE 2 END, updated_at DESC LIMIT %s
            """,
            (workspace_id, limit)
        )
        return [dict(r) for r in c.fetchall()]
