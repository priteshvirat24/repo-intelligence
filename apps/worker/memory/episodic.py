"""
Episodic memory: what happened in a specific run (PRODUCT_DEFINITION 8.1 "Project" and "Experience").

Store: episodes ('run' per finished, stopped or failed run of a brief; 'event' for later refutations,
       confirmations and feedback), experiences (build and test outcomes, Phase 6).
Write: record_run (from sync_brief_status when a run reaches COMPLETED, STOPPED or FAILED), record_event.
Read:  similar_episodes (the recall task), list_episodes (the /memory audit).

Episodes are history: they are never revalidated, only annotated (feedback_json) when something later
turns out right or wrong.
"""
import json
from typing import Any, Dict, List, Optional

from psycopg2.extras import Json, RealDictCursor

from ..discovery import ranking
from ..discovery.planner import capability_requirements
from ..orchestrator.graph import digest

OUTCOMES = {"COMPLETED": "completed", "STOPPED": "stopped", "FAILED": "failed"}
MAX_REJECTED = 15


def record_run(cur, brief_id: str, brief_status: str) -> Optional[str]:
    """Writes the run episode for a brief whose run just ended (idempotent per run state). Returns its id."""
    outcome = OUTCOMES.get(brief_status)
    if not outcome:
        return None
    with cur.connection.cursor(cursor_factory=RealDictCursor) as c:
        c.execute(
            """
            SELECT id::text, workspace_id::text, title, requirements_json, understanding_json, discovery_json, budget_json,
                   error_message, stop_reason, created_at
            FROM briefs WHERE id = %s
            """,
            (brief_id,)
        )
        brief = c.fetchone()
        if not brief:
            return None
        c.execute("SELECT type, status, output_json, output_hash, started_at, finished_at FROM tasks WHERE brief_id = %s", (brief_id,))
        tasks = {r["type"]: r for r in c.fetchall()}
        c.execute(
            """
            SELECT full_name, matched_queries, shortlisted, rank, candidate_kind, duplicate_of, coverage_score::float AS coverage_score,
                   assessment_json, pushed_at, provenance
            FROM brief_candidates WHERE brief_id = %s ORDER BY rank
            """,
            (brief_id,)
        )
        candidates = c.fetchall()
        c.execute("SELECT blueprint_json FROM brief_blueprints WHERE brief_id = %s", (brief_id,))
        bp = c.fetchone()
        reset_at = (brief["budget_json"] or {}).get("resetAt")
        c.execute(
            """
            SELECT COUNT(*) FILTER (WHERE provider <> 'github' AND operation <> 'embedding') AS "llmCalls",
                   COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) FILTER (WHERE provider <> 'github'), 0) AS tokens,
                   COUNT(*) FILTER (WHERE provider = 'github') AS "githubRequests"
            FROM provider_usage
            WHERE scope_type = 'brief' AND scope_id = %s AND (%s::timestamptz IS NULL OR created_at >= %s::timestamptz)
            """,
            (brief_id, reset_at, reset_at)
        )
        budget = {k: int(v) for k, v in c.fetchone().items()}

    run_key = digest({"outcome": outcome, "tasks": {t: (r["status"], r["output_hash"]) for t, r in sorted(tasks.items())},
                      "stop": brief["stop_reason"]})
    metrics = brief["discovery_json"] or {}
    shortlisted = [r["full_name"] for r in candidates if r["shortlisted"]]
    queries = _queries(metrics.get("queries") or [], candidates)
    rejected = [{"fullName": r["full_name"], "reason": _rejection_reason(r)} for r in candidates if not r["shortlisted"]][:MAX_REJECTED]
    blueprint = (bp or {}).get("blueprint_json") or {}
    decisions = [{"component": comp.get("name") or comp.get("requirement"), "decision": comp.get("decision"),
                  "repo": comp.get("repo") or comp.get("repository")}
                 for comp in blueprint.get("components") or [] if isinstance(comp, dict)]
    recall = (tasks.get("recall") or {}).get("output_json") or {}
    discover = (tasks.get("discover") or {}).get("output_json") or {}
    memory = {k: v for k, v in {
        "memoryCandidates": (discover.get("metrics") or {}).get("memoryCandidates"),
        "searchesAvoided": (discover.get("metrics") or {}).get("searchesAvoided"),
        "similarEpisodes": [e.get("episodeId") for e in recall.get("similarEpisodes") or []],
    }.items() if v}
    procedures = list(dict.fromkeys((discover.get("metrics") or {}).get("proceduresApplied") or []))
    requirements = brief["requirements_json"] or {}
    problem = requirements.get("problemSummary") or ""
    started = min((r["started_at"] for r in tasks.values() if r["started_at"]), default=brief["created_at"])
    summary = _summary(brief["title"], outcome, shortlisted, decisions, brief)

    cur.execute(
        """
        INSERT INTO episodes (workspace_id, brief_id, kind, run_key, outcome, title, problem_summary, summary, tuning_version,
            requirements_json, understanding_json, queries_json, shortlisted_json, rejected_json, decisions_json, budget_json,
            memory_json, procedures_used, search_text, provenance_json, started_at, finished_at)
        VALUES (%s, %s, 'run', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::uuid[], %s, %s, %s, NOW())
        ON CONFLICT (brief_id, run_key) WHERE kind = 'run' DO NOTHING
        RETURNING id::text
        """,
        (brief["workspace_id"], brief_id, run_key, outcome, brief["title"], problem[:2000], summary, metrics.get("tuningVersion"),
         Json(requirements), Json(brief["understanding_json"] or {}), Json(queries), Json(shortlisted), Json(rejected),
         Json(decisions), Json(budget), Json(memory), procedures, search_text(brief["title"], requirements),
         Json({"writer": "run_graph", "briefStatus": brief_status, "stopReason": brief["stop_reason"], "error": brief["error_message"]}),
         started)
    )
    row = cur.fetchone()
    if row is None:
        return None  # this run state was already recorded
    # A run that ends well supports the procedures it used; a failed run counts against them
    if procedures and outcome != "stopped":
        from . import procedural
        procedural.record_outcome(cur, procedures, success=outcome == "completed")
    return row[0]


def _queries(planned: List[Dict[str, Any]], candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Per query: results, the stored candidates it was first to find, and the shortlisted ones it found."""
    seen = set()
    out = []
    for q in planned:
        found = [c for c in candidates if q.get("query") in (c["matched_queries"] or [])]
        new = [c["full_name"] for c in found if c["full_name"] not in seen]
        seen.update(new)
        out.append({"query": q.get("query"), "requirement": q.get("requirement"), "results": q.get("results"),
                    "newCandidates": len(new), "shortlistedFound": [c["full_name"] for c in found if c["shortlisted"]]})
    return out


def _rejection_reason(c: Dict[str, Any]) -> str:
    if c.get("duplicate_of"):
        return f"copy of {c['duplicate_of']}"
    if c.get("candidate_kind") in ranking.NON_IMPLEMENTATION_KINDS:
        return f"a {c['candidate_kind'].replace('_', ' ')}, not an implementation"
    if c.get("coverage_score") is None:
        return "README not assessed (ranked below the assessment limit)"
    coverage = (c.get("assessment_json") or {}).get("coverage") or {}
    if "yes" not in coverage.values():
        return "README does not fully cover any requirement"
    if c.get("pushed_at") is not None:
        return "ranked below the shortlist or not recently maintained"
    return "ranked below the shortlist"


def _summary(title: str, outcome: str, shortlisted: List[str], decisions: List[Dict[str, Any]], brief: Dict[str, Any]) -> str:
    if outcome == "stopped":
        return f"Run of “{title}” stopped: {brief.get('error_message') or brief.get('stop_reason') or 'budget used up'}."
    if outcome == "failed":
        return f"Run of “{title}” failed: {(brief.get('error_message') or 'unknown error')[:200]}."
    reused = [d for d in decisions if d.get("decision") in ("reuse", "adapt", "REUSE", "ADAPT") and d.get("repo")]
    chose = ", ".join(sorted({d["repo"] for d in reused})[:3]) or ", ".join(shortlisted[:3]) or "no existing solution"
    return f"“{title}” chose {chose}."


def search_text(title: str, requirements: Dict[str, Any]) -> str:
    parts = [title or "", requirements.get("problemSummary") or ""]
    parts += [f"{r.get('name', '')} {r.get('description', '')}" for r in capability_requirements(requirements)]
    parts += [str(d) for d in requirements.get("domains") or []]
    return " ".join(parts)[:5000]


def record_event(cur, brief_id: str, outcome: str, detail: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Something happened after a run (refuted, confirmed, feedback): an event episode under the brief's
    latest run episode, and a feedback note on that run. Returns the run episode ({id, proceduresUsed})."""
    cur.execute(
        "SELECT id::text, procedures_used::text[] FROM episodes WHERE brief_id = %s AND kind = 'run' ORDER BY finished_at DESC LIMIT 1",
        (brief_id,)
    )
    run = cur.fetchone()
    cur.execute("SELECT workspace_id::text, title FROM briefs WHERE id = %s", (brief_id,))
    brief = cur.fetchone()
    if not brief:
        return None
    note = {"outcome": outcome, **{k: v for k, v in detail.items() if v is not None}}
    cur.execute(
        """
        INSERT INTO episodes (workspace_id, brief_id, parent_id, kind, outcome, title, summary, detail_json, provenance_json, finished_at)
        VALUES (%s, %s, %s, 'event', %s, %s, %s, %s, %s, NOW())
        """,
        (brief[0], brief_id, run[0] if run else None, outcome, brief[1],
         f"Claim {outcome} on {detail.get('subject') or 'a finding'}" + (f": {detail['reason']}" if detail.get("reason") else ""),
         Json(note), Json({"writer": "correction"}))
    )
    if run:
        cur.execute("UPDATE episodes SET feedback_json = feedback_json || %s WHERE id = %s", (Json([note]), run[0]))
        return {"id": run[0], "proceduresUsed": list(run[1] or [])}
    return None


def similar_episodes(cur, workspace_id: Optional[str], brief_id: Optional[str], title: str, requirements: Dict[str, Any],
                     limit: int = 3) -> List[Dict[str, Any]]:
    """Past runs of this workspace about a similar problem (full-text over problem and requirements), with
    what they chose and what feedback said since: "a similar brief on <date> chose X; feedback said Y"."""
    if not workspace_id:
        return []
    terms = sorted({t for t in ranking.tokens(search_text(title, requirements)) if t.isalnum()})
    if not terms:
        return []
    query = " | ".join(terms[:40])
    with cur.connection.cursor(cursor_factory=RealDictCursor) as c:
        c.execute(
            """
            SELECT DISTINCT ON (e.brief_id) e.id::text AS episode_id, e.brief_id::text AS brief_id, e.title, e.outcome, e.summary,
                   e.finished_at, e.shortlisted_json, e.decisions_json, e.feedback_json,
                   ts_rank(to_tsvector('english', e.search_text), to_tsquery('english', %s)) AS score
            FROM episodes e
            WHERE e.workspace_id = %s AND e.kind = 'run' AND e.brief_id IS DISTINCT FROM %s::uuid
              AND to_tsvector('english', e.search_text) @@ to_tsquery('english', %s)
            ORDER BY e.brief_id, e.finished_at DESC
            """,
            (query, workspace_id, brief_id, query)
        )
        rows = sorted(c.fetchall(), key=lambda r: -r["score"])
    out = []
    for r in rows:
        if r["score"] < 0.05:
            continue
        feedback = r["feedback_json"] or []
        said = "; ".join(f"{f.get('outcome')} {f.get('subject') or ''}{': ' + f['reason'] if f.get('reason') else ''}".strip() for f in feedback[-3:])
        date = r["finished_at"].date().isoformat() if r["finished_at"] else "an earlier date"
        chose = ", ".join(r["shortlisted_json"][:3]) if r["shortlisted_json"] else "nothing"
        out.append({
            "episodeId": r["episode_id"], "briefId": r["brief_id"], "title": r["title"], "outcome": r["outcome"],
            "finishedAt": r["finished_at"].isoformat() if r["finished_at"] else None,
            "shortlisted": r["shortlisted_json"][:6], "decisions": r["decisions_json"][:8], "feedback": feedback[-5:],
            "score": round(float(r["score"]), 4),
            "note": f"A similar brief on {date} ({r['title']}) {r['outcome']} and shortlisted {chose}"
                    + (f"; feedback said {said}." if said else "."),
        })
        if len(out) >= limit:
            break
    return out


def list_episodes(cur, workspace_id: str, limit: int = 50) -> List[Dict[str, Any]]:
    with cur.connection.cursor(cursor_factory=RealDictCursor) as c:
        c.execute(
            """
            SELECT id::text, brief_id::text, parent_id::text, kind, outcome, title, summary, tuning_version, queries_json,
                   shortlisted_json, rejected_json, decisions_json, budget_json, memory_json, feedback_json, detail_json, finished_at
            FROM episodes WHERE workspace_id = %s ORDER BY finished_at DESC LIMIT %s
            """,
            (workspace_id, limit)
        )
        return [dict(r) for r in c.fetchall()]


def record_experience(cur, workspace_id: str, kind: str, outcome: str, summary: str, resources: List[Dict[str, str]],
                      result: Optional[Dict[str, Any]] = None, test_runs: Optional[List[Dict[str, Any]]] = None,
                      brief_id: Optional[str] = None, confidence: Optional[float] = None, provenance: Optional[Dict[str, Any]] = None) -> str:
    """A build or test outcome tied to the resource versions involved ([{subject, version}]); flagged for
    revalidation when one of those versions changes (revalidation.flag_experiences)."""
    cur.execute(
        """
        INSERT INTO experiences (workspace_id, brief_id, kind, outcome, summary, context_json, subjects, result_json,
                                 test_runs_json, confidence, provenance_json)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id::text
        """,
        (workspace_id, brief_id, kind, outcome, summary, Json({"resources": resources}), [r["subject"] for r in resources],
         Json(result or {}), Json(test_runs or []), confidence, Json(provenance or {}))
    )
    return cur.fetchone()[0]


def dumps(value) -> str:
    return json.dumps(value, default=str)
