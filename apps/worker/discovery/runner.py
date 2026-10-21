import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from ..providers.llm import BaseLLMProvider
from .assess import assess_candidates, assessed_requirements
from .github_search import GitHubSearchClient
from .planner import OVERALL, capability_requirements, plan_queries, sorted_requirements
from ..tuning import Tuning, resolve
from . import ranking

SEARCH_RESULTS_PER_QUERY = 15
# Diminishing returns (PRODUCT_DEFINITION 6.4): after this many consecutive queries that found no new
# candidate of at least NOVELTY_MIN_HEALTH, further queries are skipped, except the first query for a
# requirement not searched yet. 0 disables the rule.
STOP_AFTER_UNPRODUCTIVE = 3
NOVELTY_MIN_HEALTH = 0.5
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
        skip_query: Optional[Callable[[Dict[str, str]], bool]] = None,
        procedures: Optional[List[Dict[str, Any]]] = None,
        registry_search=None,
    ):
        self.tuning = resolve(tuning)
        self.llm = llm
        self.github = github
        # Optional package-registry search (discovery/registry_search.py), run with every planned query
        self.registry_search = registry_search
        self.on_step = on_step or (lambda step: None)
        self.sleep = sleep
        # Phase 4 memory: queries memory already answers are not searched; learned procedures guide the planner
        self.skip_query = skip_query
        self.procedures = procedures or []
        # Search API quota: 30 requests/min with a token, 10/min without
        self.search_interval = 2.1 if github.authenticated else 6.5

    def run(self, requirements_json: Dict[str, Any]) -> Dict[str, Any]:
        t = self.tuning
        started = time.time()
        requirements = sorted_requirements(requirements_json)
        if not requirements:
            raise ValueError("BRIEF_HAS_NO_REQUIREMENTS: the brief was not decomposed into any requirements.")

        self.on_step("PLANNING_QUERIES")
        planned, planner_mode = plan_queries(self.llm, requirements_json, t, procedures=self.procedures)

        self.on_step("SEARCHING_GITHUB")
        results, registry_results, searched_as, calls = [], [], {}, 0
        known: Dict[str, Dict[str, Any]] = {}  # every repository found so far (lower full name)
        stop_after, min_health = t.get("discovery.stop_after_unproductive"), t.get("discovery.novelty_min_health")
        unproductive, searched_requirements, skipped, memory_skipped = 0, set(), [], []
        now = ranking.utc_now()
        for query in planned:
            # Phase 4 memory: a requirement the workspace researched recently is not searched again
            if self.skip_query and self.skip_query(query):
                results.append((query, []))
                searched_as[query["query"]] = []
                memory_skipped.append(query["query"])
                continue
            if stop_after and unproductive >= stop_after and (query["requirement"] == OVERALL or query["requirement"] in searched_requirements):
                skipped.append(query["query"])
                continue
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

            before = set(known)
            for item in items:
                known.setdefault(item["full_name"].lower(), item)
            found = list(items)
            if self.registry_search is not None:
                registry_items = self.registry_search.search(query["query"], known)
                registry_results.append((query, registry_items))
                for item in registry_items:
                    known.setdefault(item["full_name"].lower(), item)
                found += registry_items
            novel = [i for i in found if i["full_name"].lower() not in before and ranking.health_score(i, now, t) >= min_health]
            unproductive = 0 if novel else unproductive + 1
            searched_requirements.add(query["requirement"])

        merged = list(ranking.merge_search_results(results + registry_results).values())
        github_found = {i["full_name"].lower() for _, items in results for i in items}
        if self.registry_search is not None:
            self.registry_search.annotate(merged, github_found)
        else:
            for c in merged:
                c["sources"], c["packages"] = ["github"], []
        duplicates = ranking.mark_mirrors(merged)
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
            "queries": [
                {"query": q["query"], "requirement": q["requirement"], "results": query_counts[q["query"]], "searchedAs": searched_as[q["query"]]}
                if q["query"] in query_counts else
                {"query": q["query"], "requirement": q["requirement"], "results": 0, "searchedAs": [], "skipped": True}
                for q in planned
            ],
            # Queries not run because the previous ones stopped finding new candidates
            "diminishingReturns": {"skippedQueries": skipped, "afterUnproductive": stop_after} if skipped else None,
            "registries": self.registry_search.metrics() if self.registry_search is not None else None,
            "candidatesFound": len(merged),
            "duplicatesRemoved": duplicates,
            "readmesAssessed": len(assessments),
            "githubAuthenticated": self.github.authenticated,
            "durationMs": int((time.time() - started) * 1000),
        }
        if self.skip_query:
            metrics["queriesSkipped"] = memory_skipped
        return {"candidates": stored, "metrics": metrics}
