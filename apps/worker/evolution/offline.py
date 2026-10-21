"""
Offline re-ranking of stored evaluation runs (SYSTEM_DESIGN 9, 10.3).

Every B1 result file keeps, per brief, the ranking inputs of every candidate the searches found
(`features`): what the searches matched (queries, requirements, best position), the repository facts the
health and relevance scores read (stars, last push, licence, name, description, topics), the README
assessment (kind and per-requirement coverage), the requirements, and the clock the scores used. From these,
scores, ranking, the kept list and the shortlist are recomputed under any Tuning with
apps/worker/discovery/ranking.py, without a network or LLM call.

The recomputation is exact for the run's own tuning (the stored ranking is reproduced, which every use
checks) and for any change to OFFLINE_EXACT_KEYS. Other keys change what is searched, which READMEs are read
or what an LLM is asked; their effect cannot be known from stored features and needs a replay run.
"""
from datetime import datetime
from typing import Any, Dict, List, Optional

from ..discovery import ranking
from ..discovery.assess import assessed_requirements
from ..discovery.planner import capability_requirements
from ..eval.suite import aggregate, score_brief
from ..tuning import L2_PREFIXES, Tuning, default_tuning

FEATURES_VERSION = 1

# L1 keys whose effect is entirely downstream of the README assessment. Which READMEs are read depends on
# the pre-score (relevance and health weights) and on the initial kind and mirror marks, none of which
# these keys enter; no prompt depends on them. With every candidate stored, re-ranking under them is exact,
# and cost and latency are unchanged by construction.
OFFLINE_EXACT_KEYS = (
    "ranking.final_weights",
    "ranking.coverage_value",
    "ranking.unassessed_factor",
    "ranking.non_implementation_factor",
    "ranking.duplicate_factor",
    "discovery.max_stored_candidates",
    "discovery.shortlist_size",
    "discovery.shortlist_max_stale_days",
)

_INPUT_FIELDS = ("full_name", "description", "topics", "stars", "forks", "license", "pushed_at",
                 "matched_queries", "matched_requirements", "best_position", "candidate_kind", "duplicate_of")
_SCORE_FIELDS = ("relevance_score", "health_score", "coverage_score", "final_score", "rank", "shortlisted")


def l1_values(tuning: Tuning) -> Dict[str, Any]:
    """The tuning's L1 keys (numbers and weights); stored with a run so it can be re-ranked as it was run."""
    return {k: v for k, v in tuning.values().items() if not k.startswith(L2_PREFIXES)}


def candidate_features(c: Dict[str, Any], order: int) -> Dict[str, Any]:
    out = {k: c.get(k) for k in _INPUT_FIELDS + _SCORE_FIELDS}
    out["order"] = order
    assessment = c.get("assessment") or {}
    out["assessment"] = {"kind": assessment.get("kind"), "coverage": assessment.get("coverage") or {}} if assessment else None
    # Absent means empty: keeps a result file of ~100 candidates per brief readable
    return {k: v for k, v in out.items() if v not in (None, [], "") and not (k == "shortlisted" and v is False)}


def capture(requirements_json: Dict[str, Any], result: Dict[str, Any]) -> Dict[str, Any]:
    """The ranking inputs of one brief's discovery result (DiscoveryRunner.run), for the result file."""
    metrics = result["metrics"]
    pool = result.get("pool")
    return {
        "version": FEATURES_VERSION,
        "rankedAt": metrics.get("rankedAt"),
        "queryCount": len(metrics.get("queries") or []),
        # False when only the kept candidates were available: re-ranking may then miss a candidate that a
        # different tuning would have kept, so the tuner does not use the brief
        "complete": pool is not None,
        "requirements": {
            "requirements": [
                {k: r.get(k) for k in ("name", "description", "criticality", "type") if r.get(k) is not None}
                for r in requirements_json.get("requirements", [])
            ],
            "queryExpansions": list(requirements_json.get("queryExpansions") or []),
        },
        "candidates": [candidate_features(c, i) for i, c in enumerate(pool if pool is not None else result["candidates"])],
    }


def run_tuning(run: Dict[str, Any]) -> Optional[Tuning]:
    """The tuning a stored run used, rebuilt from its L1 values (None for runs recorded without them)."""
    values = run.get("tuningValues")
    if not values:
        return None
    known = default_tuning().values()
    return default_tuning().with_overrides({k: v for k, v in values.items() if k in known})


def changed_keys(base: Tuning, other: Tuning) -> List[str]:
    if base.version == other.version:
        return []
    keys = set(_keys(base)) | set(_keys(other))
    return sorted(k for k in keys if _get(base, k) != _get(other, k))


_KEYS: Dict[str, List[str]] = {}


def _keys(t: Tuning) -> List[str]:
    if t.version not in _KEYS:
        _KEYS[t.version] = list(t.values())
    return _KEYS[t.version]


def _get(t: Tuning, key: str) -> Any:
    try:
        return t.get(key)
    except KeyError:
        return None


def has_features(entry: Dict[str, Any]) -> bool:
    f = entry.get("features")
    return bool(f) and f.get("version") == FEATURES_VERSION and bool(f.get("rankedAt"))


def _parse_now(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _inputs(f: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **{k: f.get(k) for k in _INPUT_FIELDS},
        "topics": f.get("topics") or [],
        "matched_queries": f.get("matched_queries") or [],
        "matched_requirements": f.get("matched_requirements") or [],
        "assessment": f.get("assessment") or {},
    }


def _order(features: Dict[str, Any]) -> List[int]:
    return [f.get("order", i) for i, f in enumerate(features["candidates"])]


def rerank(features: Dict[str, Any], tuning: Tuning) -> Dict[str, Any]:
    """Recomputes one brief's ranking under `tuning`: the runner's ranking stage (DiscoveryRunner.run, from
    the scores on) applied to the stored candidates. Returns the kept names in rank order, the shortlist and
    the re-scored kept candidates."""
    t = tuning
    now = _parse_now(features["rankedAt"])
    requirements_json = features["requirements"]
    assessed_reqs = assessed_requirements(capability_requirements(requirements_json), t)
    candidates = []
    for f in features["candidates"]:
        c = _inputs(f)
        c["health_score"] = ranking.health_score(c, now, t)
        c["relevance_score"] = ranking.relevance_score(c, requirements_json, features["queryCount"], t)
        c["coverage_score"] = ranking.coverage_score(c["assessment"]["coverage"], assessed_reqs, t) if f.get("assessment") else None
        candidates.append(c)
    return rank_prepared(candidates, t, now, _order(features))


def rank_prepared(candidates: List[Dict[str, Any]], t: Tuning, now: datetime, stored_order: List[int]) -> Dict[str, Any]:
    """Final scores, order, kept list and shortlist for candidates whose health, relevance and coverage are
    computed. The runner sorts by pre-score and then, stably, by final score; the same two sorts are applied
    here starting from the stored order, which reproduces the runner's order including ties."""
    pool = [dict(candidates[i]) for i in sorted(range(len(candidates)), key=lambda i: stored_order[i])]
    pool.sort(key=lambda c: ranking.pre_score(c, t), reverse=True)
    return _finish(pool, t, now)


def _finish(pool: List[Dict[str, Any]], t: Tuning, now: datetime) -> Dict[str, Any]:
    """The runner's last steps on candidates already in pre-score order (copies, modified in place)."""
    for c in pool:
        c["final_score"] = ranking.final_score(c, t)
    pool.sort(key=lambda c: c["final_score"], reverse=True)
    kept = pool[:t.get("discovery.max_stored_candidates")]
    ranking.select_shortlist(kept, t.get("discovery.shortlist_size"), t.get("discovery.shortlist_max_stale_days"), now)
    for rank, c in enumerate(kept, start=1):
        c["rank"] = rank
    return {
        "ranked": [c["full_name"] for c in kept],
        "shortlisted": [c["full_name"] for c in kept if c.get("shortlisted")],
        "candidates": kept,
    }


def reproduces(entry: Dict[str, Any], tuning: Tuning) -> bool:
    """True when re-ranking the stored features under the run's own tuning gives back the stored ranking
    and shortlist: the check that the features are complete and the ranking code unchanged."""
    out = rerank(entry["features"], tuning)
    return out["ranked"] == entry["ranked"] and out["shortlisted"] == entry["shortlisted"]


class PreparedRun:
    """A stored run with the scores that OFFLINE_EXACT_KEYS do not affect (health, relevance) computed once,
    so many candidate tunings can be scored quickly. Coverage depends on ranking.coverage_value and is
    recomputed per tuning."""

    def __init__(self, run: Dict[str, Any], briefs: Dict[str, Dict[str, Any]], base: Tuning):
        self.run_id = run["runId"]
        self.base = base
        self.briefs = []
        for entry in run["briefs"]:
            if entry["briefId"] not in briefs or not has_features(entry):
                continue
            f = entry["features"]
            now = _parse_now(f["rankedAt"])
            prepared = []
            for c in f["candidates"]:
                d = _inputs(c)
                d["health_score"] = ranking.health_score(d, now, base)
                d["relevance_score"] = ranking.relevance_score(d, f["requirements"], f["queryCount"], base)
                prepared.append(d)
            # The pre-score order does not depend on OFFLINE_EXACT_KEYS: sort once
            order = _order(f)
            prepared = [prepared[i] for i in sorted(range(len(prepared)), key=lambda i: order[i])]
            prepared.sort(key=lambda c: ranking.pre_score(c, base), reverse=True)
            self.briefs.append({
                "briefId": entry["briefId"],
                "brief": briefs[entry["briefId"]],
                "now": now,
                "assessedReqs": assessed_requirements(capability_requirements(f["requirements"]), base),
                "candidates": prepared,
            })

    def score(self, tuning: Tuning) -> Dict[str, Any]:
        """Per-brief scores and the run aggregate under `tuning`, which may differ from the base only in
        OFFLINE_EXACT_KEYS."""
        outside = [k for k in changed_keys(self.base, tuning) if k not in OFFLINE_EXACT_KEYS]
        if outside:
            raise ValueError(f"Not computable from stored features (needs a replay run): {', '.join(outside)}")
        per_brief = []
        coverage_key = repr(sorted(tuning.get("ranking.coverage_value").items()))
        for b in self.briefs:
            # Coverage depends only on ranking.coverage_value among these keys
            cache = b.setdefault("coverage", {})
            if coverage_key not in cache:
                cache[coverage_key] = [
                    ranking.coverage_score(c["assessment"]["coverage"], b["assessedReqs"], tuning) if c["assessment"] else None
                    for c in b["candidates"]
                ]
            candidates = [{**c, "coverage_score": cov} for c, cov in zip(b["candidates"], cache[coverage_key])]
            out = _finish(candidates, tuning, b["now"])
            per_brief.append({"briefId": b["briefId"], **score_brief(b["brief"], out["ranked"], out["shortlisted"])})
        return {"runId": self.run_id, "aggregate": aggregate(per_brief), "briefs": per_brief}


def score_run(run: Dict[str, Any], briefs: Dict[str, Dict[str, Any]], tuning: Tuning) -> Dict[str, Any]:
    """Re-ranks every brief of a stored run that has features under any tuning and scores it against the
    suite labels (eval/suite.score_brief)."""
    per_brief = []
    for entry in run["briefs"]:
        if entry["briefId"] in briefs and has_features(entry):
            out = rerank(entry["features"], tuning)
            per_brief.append({"briefId": entry["briefId"], **score_brief(briefs[entry["briefId"]], out["ranked"], out["shortlisted"])})
    return {"runId": run["runId"], "aggregate": aggregate(per_brief), "briefs": per_brief}
