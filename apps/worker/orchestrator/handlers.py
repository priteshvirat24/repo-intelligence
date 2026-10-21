"""
Task handlers for the brief run graph. Each returns an Outcome; the runner applies it through TaskStore.

  understand  brief + constraints + answers           -> requirements, acceptance criteria, questions
  recall      requirements + memory                   -> remembered candidates, similar past runs, procedures
  discover    requirements + constraints + recall     -> ranked candidates and shortlist
  verify      shortlist                               -> shortlisted repositories indexed (waits for the indexer)
  blueprint   verification outcome + candidates       -> the engineering blueprint
"""
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Optional

from .. import claims as claim_writer
from .. import memory
from ..config import config
from ..db.briefs import BriefStore
from ..discovery.blueprint import generate_blueprint
from ..discovery.github_search import GitHubSearchClient
from ..discovery.runner import DiscoveryRunner
from ..discovery.verification import select_verification_targets
from ..github.client import GitHubWorkerClient
from ..tuning import Tuning
from ..understanding import understand
from .graph import digest

VERIFY_POLL_SECONDS = 30
TERMINAL_REPO_STATUSES = ("READY", "FAILED")


@dataclass
class Outcome:
    kind: str                       # done | wait | await_input
    output: Dict[str, Any]
    wait_seconds: int = 0
    persist: Optional[Callable] = None  # persist(cur), applied in the completion transaction


@dataclass
class TaskContext:
    task: Dict[str, Any]
    brief: Dict[str, Any]
    outputs: Dict[str, Dict[str, Any]]
    tuning: Tuning
    llm_for: Callable[[str], Any]   # tuning key -> LLM provider
    db: Any
    set_step: Callable[[str], None] = field(default=lambda step: None)
    heartbeat: Callable[[], None] = field(default=lambda: None)


def fingerprint(ctx: TaskContext) -> str:
    """What a task's result depends on. Equal fingerprints mean the previous result still holds."""
    b, o, t = ctx.brief, ctx.outputs, ctx.task["type"]
    if t == "understand":
        parts = {"title": b["title"], "brief": b["brief_text"], "constraints": b["constraints_json"], "answers": b["answers_json"],
                 "prompt": "understanding-v1"}
    elif t == "recall":
        parts = {"requirements": o.get("understand", {}).get("requirements"), "memory": "recall-v1"}
    elif t == "discover":
        parts = {"requirements": o.get("understand", {}).get("requirements"), "constraints": b["constraints_json"], "tuning": ctx.tuning.version}
        if o.get("recall"):
            parts["memory"] = _memory_inputs(o["recall"])
    elif t == "verify":
        parts = {"shortlist": o.get("discover", {}).get("shortlist"), "count": config.BRIEF_VERIFY_COUNT}
    else:
        parts = {"verification": o.get("verify", {}).get("verification"), "candidates": o.get("discover", {}).get("shortlist"),
                 "tuning": ctx.tuning.version}
    return digest(parts)


def run_understand(ctx: TaskContext) -> Outcome:
    b = ctx.brief
    result, mode = understand(ctx.llm_for("models.discovery"), b["title"], b["brief_text"], b["constraints_json"], b["answers_json"])
    requirements = {k: v for k, v in result.items() if k not in ("acceptanceCriteria", "clarifyingQuestions", "assumptions")}
    understanding = {
        "acceptanceCriteria": result["acceptanceCriteria"],
        "clarifyingQuestions": result["clarifyingQuestions"],
        "assumptions": result["assumptions"],
        "mode": mode,
    }
    answered = {q.strip().lower() for q in (b["answers_json"] or {})}
    blocking = [q for q in result["clarifyingQuestions"] if q["blocking"] and q["question"].strip().lower() not in answered]

    def persist(cur):
        from psycopg2.extras import Json
        cur.execute(
            "UPDATE briefs SET requirements_json = %s, understanding_json = %s, decomposition_mode = %s WHERE id = %s",
            (Json(requirements), Json(understanding), mode, b["id"])
        )

    output = {"requirements": requirements, "mode": mode, "blockingQuestions": [q["question"] for q in blocking]}
    # Research does not wait for non-blocking questions (PRODUCT_DEFINITION 4.1): it proceeds on assumptions
    return Outcome("await_input" if blocking else "done", output, persist=persist)


def run_recall(ctx: TaskContext) -> Outcome:
    """Reads memory before any research: repositories with current claims matching the requirements,
    similar past runs of the workspace, and the active procedures that fit (apps/worker/memory)."""
    requirements = ctx.outputs.get("understand", {}).get("requirements") or ctx.brief["requirements_json"] or {}
    conn = ctx.db.get_connection()
    try:
        with conn.cursor() as cur:
            result = memory.recall(cur, ctx.brief, requirements)
    finally:
        conn.close()
    return Outcome("done", result)


def _memory_inputs(recall: Dict[str, Any]) -> Dict[str, Any]:
    return {"candidates": sorted((c["fullName"], tuple(sorted(cl["id"] for cl in c["claims"]))) for c in recall.get("candidates") or []),
            "skip": sorted(s["requirement"] for s in recall.get("skipRequirements") or []),
            "procedures": sorted(p["id"] for p in recall.get("procedures") or [])}


def run_discover(ctx: TaskContext) -> Outcome:
    requirements = ctx.outputs.get("understand", {}).get("requirements") or ctx.brief["requirements_json"]
    # Phase 4 memory (recall task): requirements researched recently by the workspace are not searched again,
    # and active procedures guide the planner
    recall = ctx.outputs.get("recall") or {}
    skip = {s["requirement"] for s in recall.get("skipRequirements") or []}
    procedures = recall.get("procedures") or []
    github = GitHubSearchClient()
    try:
        runner = DiscoveryRunner(ctx.llm_for("models.discovery"), github, on_step=_step(ctx), tuning=ctx.tuning,
                                 skip_query=(lambda q: q["requirement"] in skip) if skip else None, procedures=procedures)
        result = runner.run(requirements)
    finally:
        github.close()
    candidates, metrics = result["candidates"], result["metrics"]
    # Phase 4 memory: remembered candidates join the result with provenance "memory"
    if recall:
        merged = memory.merge_remembered(candidates, recall.get("candidates") or [], requirements,
                                         len(metrics.get("queries") or []), ctx.tuning)
        metrics["memoryCandidates"] = merged["added"]
        metrics["memoryAlsoFound"] = merged["alsoFound"]
        metrics["searchesAvoided"] = len(metrics.get("queriesSkipped") or [])
        if procedures and metrics.get("queryPlanner") == "llm":
            metrics["proceduresApplied"] = [p["id"] for p in procedures]

    def persist(cur):
        BriefStore.save_candidates(cur, ctx.brief["id"], candidates, metrics)
        claim_writer.claims_from_candidates(cur, str(ctx.brief["id"]), _ws(ctx), candidates)

    output = {
        "shortlist": [c["full_name"] for c in candidates if c.get("shortlisted")],
        "ranked": [c["full_name"] for c in candidates],
        "metrics": metrics,
    }
    return Outcome("done", output, persist=persist)


def run_verify(ctx: TaskContext) -> Outcome:
    """First run: queue the strongest shortlisted repositories into the indexer. Later runs (after waiting):
    check them. Done once none is still indexing, or after BLUEPRINT_MAX_WAIT_MINUTES."""
    previous = ctx.task.get("output_json") or {}
    if previous.get("phase") == "waiting" and previous.get("fingerprint") == fingerprint(ctx):
        verification = previous["verification"]
        waited = previous.get("waitedSeconds", 0) + VERIFY_POLL_SECONDS
    else:
        shortlist = ctx.outputs.get("discover", {}).get("shortlist") or []
        targets = select_verification_targets([{"full_name": n, "shortlisted": True} for n in shortlist], GitHubWorkerClient(), config.BRIEF_VERIFY_COUNT)
        conn = ctx.db.get_connection()
        try:
            with conn.cursor() as cur:
                verification = [BriefStore.queue_verification(cur, t) for t in targets]
                BriefStore.save_blueprint_state(cur, ctx.brief["id"], "WAITING", "VERIFYING", verification)
                conn.commit()
        finally:
            conn.close()
        waited = 0

    statuses = _repo_statuses(ctx.db, [v.get("repositoryId") for v in verification if v.get("repositoryId")])
    pending = [v for v in verification if v.get("repositoryId") and statuses.get(v["repositoryId"]) not in TERMINAL_REPO_STATUSES]
    if pending and waited < config.BLUEPRINT_MAX_WAIT_MINUTES * 60:
        return Outcome("wait", {"phase": "waiting", "fingerprint": fingerprint(ctx), "verification": verification, "waitedSeconds": waited},
                       wait_seconds=VERIFY_POLL_SECONDS)

    final = [{**v, "repositoryStatus": statuses.get(v.get("repositoryId"))} for v in verification]

    def persist(cur):
        for v in final:
            if v.get("repositoryStatus") == "READY":
                claim_writer.claims_from_repository(cur, v["repositoryId"])
                memory.corroborate_coverage(cur, claim_writer.github_subject(v["fullName"]))  # Phase 4: source reliability
        BriefStore.save_blueprint_state(cur, ctx.brief["id"], "WAITING", "COLLECTING_EVIDENCE", verification)

    return Outcome("done", {"verification": verification, "statuses": {v["fullName"]: v.get("repositoryStatus") for v in final}}, persist=persist)


def run_blueprint(ctx: TaskContext) -> Outcome:
    verification = ctx.outputs.get("verify", {}).get("verification") or []
    conn = ctx.db.get_connection()
    try:
        inputs = BriefStore.load_blueprint_inputs(conn, ctx.brief["id"], verification)
        with conn.cursor() as cur:
            subjects = [claim_writer.github_subject(c["full_name"]) for c in inputs["candidates"]]
            inputs["claimIds"] = claim_writer.claim_ids_for(cur, subjects)
            BriefStore.save_blueprint_state(cur, ctx.brief["id"], "RUNNING", "DESIGNING", verification)
            conn.commit()
    finally:
        conn.close()
    ctx.set_step("DESIGNING")
    blueprint = generate_blueprint(ctx.llm_for("models.blueprint"), inputs, tuning=ctx.tuning)

    def persist(cur):
        BriefStore.save_blueprint_state(cur, ctx.brief["id"], "COMPLETED", "DONE", verification, blueprint=blueprint)

    decisions = [c["decision"] for c in blueprint["components"]]
    return Outcome("done", {"decisions": {d: decisions.count(d) for d in set(decisions)}, "sources": len(blueprint["sources"])}, persist=persist)


HANDLERS = {"understand": run_understand, "recall": run_recall, "discover": run_discover, "verify": run_verify, "blueprint": run_blueprint}


def _ws(ctx: TaskContext) -> Optional[str]:
    return str(ctx.brief["workspace_id"]) if ctx.brief.get("workspace_id") else None


def _step(ctx: TaskContext):
    def on_step(step: str):
        ctx.heartbeat()
        ctx.set_step(step)
    return on_step


def _repo_statuses(db, repo_ids) -> Dict[str, str]:
    if not repo_ids:
        return {}
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id::text, status FROM repositories WHERE id::text = ANY(%s)", (list(repo_ids),))
            return dict(cur.fetchall())
    finally:
        conn.close()
