import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from ..tuning import Tuning, resolve
from .planner import OVERALL, capability_requirements

# Defaults for the tuning registry (apps/worker/tuning.py); code reads the active Tuning, not these
CRITICALITY_WEIGHT = {"MUST": 1.0, "SHOULD": 0.6, "NICE_TO_HAVE": 0.3}
COVERAGE_VALUE = {"yes": 1.0, "partial": 0.5, "no": 0.0, "unknown": 0.0}
HEALTH_WEIGHTS = {"stars": 0.60, "recency": 0.25, "license": 0.15}
RELEVANCE_WEIGHTS = {"requirements": 0.40, "queries": 0.20, "position": 0.20, "overlap": 0.20}
PRE_WEIGHTS = {"relevance": 0.75, "health": 0.25}
FINAL_WEIGHTS = {"coverage": 0.45, "relevance": 0.25, "health": 0.30}
UNASSESSED_FACTOR = 0.6
NON_IMPLEMENTATION_FACTOR = 0.5
DUPLICATE_FACTOR = 0.3
# Shortlist only repositories pushed to within this many days; None disables the rule
SHORTLIST_MAX_STALE_DAYS = 730
# Kinds that are not themselves a starting point to build on
NON_IMPLEMENTATION_KINDS = {"curated_list", "tutorial"}

_TOKEN_RE = re.compile(r"[a-z0-9][a-z0-9+#]*")
_GENERIC_TOKENS = {
    "the", "and", "for", "with", "from", "into", "using", "use", "based", "data", "system", "systems",
    "support", "tool", "tools", "app", "application", "api", "library", "framework", "open", "source",
}


def tokens(text: str) -> set:
    return {t for t in _TOKEN_RE.findall((text or "").lower()) if len(t) > 2 and t not in _GENERIC_TOKENS}


def merge_search_results(results: List[Tuple[Dict[str, str], List[Dict[str, Any]]]]) -> Dict[str, Dict[str, Any]]:
    """One candidate per repository, remembering every query and requirement that found it and its best position."""
    merged: Dict[str, Dict[str, Any]] = {}
    for planned, items in results:
        for position, item in enumerate(items):
            key = item["full_name"].lower()
            if not key or is_profile_repository(key):
                continue
            candidate = merged.get(key)
            if candidate is None:
                candidate = {**item, "matched_queries": [], "matched_requirements": [], "best_position": position}
                merged[key] = candidate
            candidate["best_position"] = min(candidate["best_position"], position)
            if planned["query"] not in candidate["matched_queries"]:
                candidate["matched_queries"].append(planned["query"])
            if planned["requirement"] != OVERALL and planned["requirement"] not in candidate["matched_requirements"]:
                candidate["matched_requirements"].append(planned["requirement"])
    return merged


def is_profile_repository(full_name: str) -> bool:
    """owner/owner repositories are GitHub profile READMEs, not software."""
    owner, _, name = full_name.lower().partition("/")
    return owner == name or name.endswith(".github.io")


def looks_like_curated_list(candidate: Dict[str, Any]) -> bool:
    name = candidate["full_name"].split("/")[-1].lower()
    description = (candidate.get("description") or "").lower()
    return name.startswith("awesome") or "curated list" in description or "awesome list" in description


def mark_mirrors(candidates: List[Dict[str, Any]]) -> int:
    """Repositories with the same name and the same description under different owners are copies of one
    project (mirrors, re-uploads); the most-starred one is kept and the others point at it."""
    groups: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for c in candidates:
        description = re.sub(r"\s+", " ", (c.get("description") or "").strip().lower())
        if len(description) < 20:
            continue  # too short to tell copies from unrelated projects that share a name
        groups.setdefault((c["full_name"].split("/")[-1].lower(), description), []).append(c)
    marked = 0
    for group in groups.values():
        if len(group) < 2:
            continue
        original = max(group, key=lambda c: (c["stars"], c["forks"]))
        for c in group:
            if c is not original:
                c["duplicate_of"] = original["full_name"]
                marked += 1
    return marked


def _parse_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def health_score(candidate: Dict[str, Any], now: datetime, tuning: Optional[Tuning] = None) -> float:
    """Adoption, maintenance and reusability: stars (log scale, 10k ~ 1.0), last push, and a licence.
    Adoption weighs most: a fresh push alone is what most abandoned-on-arrival projects also have."""
    w = resolve(tuning).get("ranking.health_weights")
    stars = min(1.0, math.log10(candidate["stars"] + 1) / 4.0)
    pushed = _parse_time(candidate.get("pushed_at"))
    if pushed is None:
        recency = 0.1
    else:
        days = (now - pushed).days
        recency = 1.0 if days <= 180 else 0.8 if days <= 365 else 0.5 if days <= 730 else 0.25 if days <= 1460 else 0.1
    license_ok = 1.0 if candidate.get("license") and candidate["license"] != "NOASSERTION" else 0.4
    return round(w["stars"] * stars + w["recency"] * recency + w["license"] * license_ok, 4)


def relevance_score(candidate: Dict[str, Any], requirements_json: Dict[str, Any], query_count: int, tuning: Optional[Tuning] = None) -> float:
    """How strongly the search itself ties the repository to the brief, before any README is read."""
    t = resolve(tuning)
    weight, w = t.get("ranking.criticality_weight"), t.get("ranking.relevance_weights")
    reqs = capability_requirements(requirements_json)
    total_weight = sum(weight.get(r.get("criticality"), 0.6) for r in reqs) or 1.0
    matched = set(candidate["matched_requirements"])
    requirement_share = sum(weight.get(r.get("criticality"), 0.6) for r in reqs if r["name"] in matched) / total_weight
    query_share = len(candidate["matched_queries"]) / max(1, query_count)
    position = 1.0 / (1.0 + candidate["best_position"] / 5.0)

    brief_terms = tokens(" ".join(
        [r["name"] + " " + r.get("description", "") for r in reqs] + list(requirements_json.get("queryExpansions") or [])
    ))
    repo_terms = tokens(" ".join([
        candidate["full_name"].replace("/", " ").replace("-", " ").replace("_", " "),
        candidate.get("description") or "",
        " ".join(candidate.get("topics") or []).replace("-", " "),
    ]))
    overlap = len(brief_terms & repo_terms) / max(1, min(len(repo_terms), 12))

    return round(min(1.0, w["requirements"] * requirement_share + w["queries"] * min(1.0, query_share * 2)
                     + w["position"] * position + w["overlap"] * min(1.0, overlap)), 4)


def coverage_score(coverage: Dict[str, str], assessed_requirements: List[Dict[str, Any]], tuning: Optional[Tuning] = None) -> float:
    """Criticality-weighted share of the assessed requirements the README shows the repository meets."""
    t = resolve(tuning)
    weight, value = t.get("ranking.criticality_weight"), t.get("ranking.coverage_value")
    total = sum(weight.get(r.get("criticality"), 0.6) for r in assessed_requirements) or 1.0
    got = sum(
        weight.get(r.get("criticality"), 0.6) * value.get(coverage.get(r["name"], "unknown"), 0.0)
        for r in assessed_requirements
    )
    return round(got / total, 4)


def pre_score(candidate: Dict[str, Any], tuning: Optional[Tuning] = None) -> float:
    w = resolve(tuning).get("ranking.pre_weights")
    return round(w["relevance"] * candidate["relevance_score"] + w["health"] * candidate["health_score"], 4)


def final_score(candidate: Dict[str, Any], tuning: Optional[Tuning] = None) -> float:
    """Assessed candidates are ranked mainly on README coverage; unassessed ones are discounted so they
    never outrank a repository whose README was actually read."""
    t = resolve(tuning)
    if candidate.get("coverage_score") is None:
        score = t.get("ranking.unassessed_factor") * pre_score(candidate, t)
    else:
        w = t.get("ranking.final_weights")
        score = w["coverage"] * candidate["coverage_score"] + w["relevance"] * candidate["relevance_score"] + w["health"] * candidate["health_score"]
    if candidate.get("candidate_kind") in NON_IMPLEMENTATION_KINDS:
        score *= t.get("ranking.non_implementation_factor")
    if candidate.get("duplicate_of"):
        score *= t.get("ranking.duplicate_factor")
    return round(score, 4)


def is_stale(candidate: Dict[str, Any], max_days: Optional[int], now: Optional[datetime] = None) -> bool:
    if not max_days:
        return False
    pushed = _parse_time(candidate.get("pushed_at"))
    return pushed is None or ((now or utc_now()) - pushed).days > max_days


def select_shortlist(candidates: List[Dict[str, Any]], size: int = 6, max_stale_days: Optional[int] = None,
                     now: Optional[datetime] = None) -> None:
    """Marks the best assessed implementations: README read, fully covering at least one capability,
    not a list or a copy, and (when max_stale_days is set) pushed to within that many days. A stale
    repository stays in the candidate list; it is just not recommended as a starting point."""
    picked = 0
    for c in candidates:
        coverage = (c.get("assessment") or {}).get("coverage") or {}
        eligible = (
            c.get("coverage_score") is not None
            and c["coverage_score"] > 0
            and "yes" in coverage.values()
            and c.get("candidate_kind") not in NON_IMPLEMENTATION_KINDS
            and not c.get("duplicate_of")
            and not is_stale(c, max_stale_days, now)
        )
        c["shortlisted"] = eligible and picked < size
        if c["shortlisted"]:
            picked += 1


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
