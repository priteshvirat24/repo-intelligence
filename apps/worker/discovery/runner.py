import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from ..providers.llm import BaseLLMProvider
from .assess import assess_candidates, assessed_requirements
from .github_search import GitHubSearchClient
from .planner import capability_requirements, plan_queries, sorted_requirements
from ..tuning import Tuning, resolve
from . import ranking

SEARCH_RESULTS_PER_QUERY = 15
# Searches start with an adoption floor (removes most empty and abandoned repositories) and relax
# step by step while a query returns fewer than ENOUGH_RESULTS distinct repositories
MIN_STARS = 10
ENOUGH_RESULTS = 5
README_ASSESS_LIMIT = 12
MAX_STORED_CANDIDATES = 40
SHORTLIST_SIZE = 6


def search_attempts(query: str, min_stars: int = MIN_STARS) -> List[Tuple[str, Optional[int]]]:
    """The query with the stars floor, then its first two keywords, then those without the floor."""
    words = query.split()
    attempts = [(query, min_stars)]
    if len(words) > 2:
        attempts.append((" ".join(words[:2]), min_stars))
    attempts.append((attempts[-1][0], None))
    return attempts


class DiscoveryRunner:
    """Brief requirements -> GitHub searches -> merged, de-duplicated candidates -> README assessment -> ranking.

    on_step(step) is called before each stage; the caller uses it to record progress and to stop
    (by raising) when the brief was deleted or re-queued meanwhile.
    """

    def __init__(
        self,
        llm: BaseLLMProvider,
        github: GitHubSearchClient,
        on_step: Optional[Callable[[str], None]] = None,
        sleep: Callable[[float], None] = time.sleep,
        tuning: Optional[Tuning] = None,
    ):
        self.tuning = resolve(tuning)
        self.llm = llm
        self.github = github
        self.on_step = on_step or (lambda step: None)
        self.sleep = sleep
        # Search API quota: 30 requests/min with a token, 10/min without
        self.search_interval = 2.1 if github.authenticated else 6.5

    def run(self, requirements_json: Dict[str, Any]) -> Dict[str, Any]:
        t = self.tuning
        started = time.time()
        requirements = sorted_requirements(requirements_json)
        if not requirements:
            raise ValueError("BRIEF_HAS_NO_REQUIREMENTS: the brief was not decomposed into any requirements.")

        self.on_step("PLANNING_QUERIES")
        planned, planner_mode = plan_queries(self.llm, requirements_json, t)

        self.on_step("SEARCHING_GITHUB")
        results, searched_as, calls = [], {}, 0
        for query in planned:
            items, seen, attempts = [], set(), []
            for text, min_stars in search_attempts(query["query"], t.get("discovery.min_stars")):
                if calls:
                    self.sleep(self.search_interval)
                calls += 1
                attempts.append(f"{text} stars:>={min_stars}" if min_stars else text)
                for item in self.github.search_repositories(text, per_page=t.get("discovery.results_per_query"), min_stars=min_stars):
                    if item["full_name"].lower() not in seen:
                        seen.add(item["full_name"].lower())
                        items.append(item)
                if len(items) >= t.get("discovery.enough_results"):
                    break
            results.append((query, items))
            searched_as[query["query"]] = attempts

        merged = list(ranking.merge_search_results(results).values())
        duplicates = ranking.mark_mirrors(merged)
        now = ranking.utc_now()
        for c in merged:
            c["candidate_kind"] = "curated_list" if ranking.looks_like_curated_list(c) else "unknown"
            c["health_score"] = ranking.health_score(c, now, t)
            c["relevance_score"] = ranking.relevance_score(c, requirements_json, len(planned), t)
            c["coverage_score"] = None
            c["assessment"] = {}
        merged.sort(key=lambda c: ranking.pre_score(c, t), reverse=True)

        self.on_step("READING_READMES")
        to_assess = [c for c in merged if not c.get("duplicate_of") and c["candidate_kind"] != "curated_list"][:t.get("discovery.readme_assess_limit")]
        for c in to_assess:
            c["readme"] = self.github.fetch_readme(c["full_name"])
        capabilities = capability_requirements(requirements_json)
        assessments = assess_candidates(self.llm, requirements_json.get("problemSummary", ""), capabilities, to_assess, t) if to_assess else {}

        self.on_step("RANKING")
        assessed_reqs = assessed_requirements(capabilities, t)
        for c in merged:
            c.pop("readme", None)
            assessment = assessments.get(c["full_name"])
            if assessment:
                c["assessment"] = assessment
                c["candidate_kind"] = assessment["kind"] if assessment["kind"] != "unknown" else c["candidate_kind"]
                c["coverage_score"] = ranking.coverage_score(assessment["coverage"], assessed_reqs, t)
            c["final_score"] = ranking.final_score(c, t)
        merged.sort(key=lambda c: c["final_score"], reverse=True)
        stored = merged[:t.get("discovery.max_stored_candidates")]
        ranking.select_shortlist(stored, t.get("discovery.shortlist_size"), t.get("discovery.shortlist_max_stale_days"), now)
        for rank, c in enumerate(stored, start=1):
            c["rank"] = rank

        query_counts = {q["query"]: len(items) for q, items in results}
        metrics = {
            "queryPlanner": planner_mode,
            "tuningVersion": t.version,
            # The clock the health and staleness scores used, so a stored run can be re-ranked exactly
            "rankedAt": now.isoformat(),
            "queries": [
                {"query": q["query"], "requirement": q["requirement"], "results": query_counts[q["query"]], "searchedAs": searched_as[q["query"]]}
                for q in planned
            ],
            "candidatesFound": len(merged),
            "duplicatesRemoved": duplicates,
            "readmesAssessed": len(assessments),
            "githubAuthenticated": self.github.authenticated,
            "durationMs": int((time.time() - started) * 1000),
        }
        # pool: every candidate in final order, the kept ones first; the evaluation harness stores their ranking
        # inputs so a run can be re-ranked offline (apps/worker/evolution/offline.py)
        return {"candidates": stored, "metrics": metrics, "pool": merged}
