"""
Open-web and paper candidates for brief discovery (RESEARCH_STRATEGY 5: strategy S4 and the papers route).

S4, web search for comparisons and alternatives: once for the product as a whole, and once for every MUST
requirement the GitHub and registry searches left with no candidate, Tavily is asked for open-source tools
of that kind. Papers: when a requirement (or the brief) asks for an algorithm or a benchmark, arXiv is asked
for papers about it. In both cases the pages only nominate candidates: the GitHub repositories they link to
are resolved through the GitHub API and join the other candidates with source "web" or "arxiv". A page is
E4 at best and never grades a capability; the nominating pages are kept in the run's metrics.

Off by default (tuning key discovery.web_search): a new search strategy is an L2 change and is switched on
only after it passes the evaluation gate (RESEARCH_STRATEGY 9, at least five runs per side).
"""
import re
from typing import Any, Dict, List, Optional, Set, Tuple

from ..connectors.base import SourceUnavailable
from ..tuning import Tuning, resolve
from .planner import OVERALL

# Defaults for the tuning registry (apps/worker/tuning.py)
WEB_SEARCH = False
RESULTS_PER_QUERY = 5
MAX_QUERIES = 4
# Repositories found only through a page cost one GitHub request each for their metadata
MAX_NEW_REPOS = 10

# Words that mean a requirement needs an algorithm or a benchmark: the papers route (RESEARCH_STRATEGY 4, arXiv row)
PAPER_WORDS = {"algorithm", "algorithms", "algorithmic", "benchmark", "benchmarks", "sota", "state-of-the-art",
               "paper", "papers", "arxiv", "research", "academic", "published", "heuristic", "heuristics"}

# github.com/<owner>/<repo> in a page URL or its text. GitHub site sections are not owners.
_GITHUB_REPO = re.compile(r"github\.com/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))/([A-Za-z0-9._-]{1,100})", re.IGNORECASE)
_NOT_OWNERS = {"topics", "orgs", "sponsors", "marketplace", "collections", "features", "settings", "explore", "trending",
               "apps", "notifications", "organizations", "search", "codespaces", "login", "new", "about", "site", "pricing",
               "enterprise", "events", "readme", "security", "customer-stories"}


def _words(text: str) -> Set[str]:
    return {w.lower() for w in re.findall(r"[A-Za-z0-9+-]+", text or "")}


def repositories_in(text: str) -> List[str]:
    """owner/name of every GitHub repository a URL or page text links to, in order, once each."""
    out: List[str] = []
    for owner, name in _GITHUB_REPO.findall(text or ""):
        if owner.lower() in _NOT_OWNERS:
            continue
        name = re.sub(r"\.git$", "", name.rstrip("."))
        if not name or name in (".", ".."):
            continue
        full = f"{owner}/{name}"
        if full.lower() not in {o.lower() for o in out}:
            out.append(full)
    return out


def needs_papers(text: str) -> bool:
    return bool(_words(text) & PAPER_WORDS)


def _keywords(text: str, limit: int = 6) -> str:
    """The first few content words of a requirement or summary, for a search query."""
    stop = {"a", "an", "the", "and", "or", "of", "for", "to", "in", "on", "with", "that", "this", "it", "is", "be",
            "must", "should", "can", "app", "application", "system", "tool", "users", "user"}
    words = [w for w in re.findall(r"[A-Za-z0-9.+#-]+", text or "") if w.lower() not in stop]
    return " ".join(words[:limit])


class WebSearch:
    """Runs S4 and the papers route after the planned searches, and returns their candidates as (query, items)."""

    def __init__(self, connectors, github, requirements_json: Dict[str, Any], tuning: Optional[Tuning] = None):
        t = resolve(tuning)
        self.enabled = bool(t.get("discovery.web_search"))
        self.connectors = connectors
        self.github = github
        self.requirements_json = requirements_json
        self.per_query = t.get("discovery.web_results_per_query")
        self.max_queries = t.get("discovery.web_max_queries")
        self.max_new = t.get("discovery.web_max_new_repos")
        self.new_repos = 0
        self.sources: Dict[str, Set[str]] = {}            # full name (lower) -> "web" / "arxiv"
        self.nominations: Dict[str, List[Dict[str, str]]] = {}
        self.searched: List[Dict[str, Any]] = []
        self.unavailable: List[str] = []
        self._metadata: Dict[str, Optional[Dict[str, Any]]] = {}

    def plan(self, planned: List[Dict[str, str]], covered: Set[str]) -> List[Tuple[str, Dict[str, str]]]:
        """(source, query) pairs: S4 for the product and for uncovered MUST requirements, then papers."""
        if not self.enabled:
            return []
        rj = self.requirements_json
        summary = _keywords(rj.get("problemSummary") or "") or next((q["query"] for q in planned if q["requirement"] == OVERALL), "")
        queries: List[Tuple[str, Dict[str, str]]] = []
        if summary:
            queries.append(("web", {"query": f"open source {summary} alternatives", "requirement": OVERALL}))
        requirements = [r for r in rj.get("requirements") or [] if r.get("name")]
        for r in requirements:
            if (r.get("criticality") or "").upper() == "MUST" and r["name"] not in covered:
                queries.append(("web", {"query": f"open source {_keywords(r['name'])} library", "requirement": r["name"]}))
        for r in requirements:
            if needs_papers(f"{r.get('name', '')} {r.get('description', '')}"):
                # arXiv ANDs every word: a short query (the requirement's name) finds papers, a long one finds none
                queries.append(("arxiv", {"query": _keywords(r["name"], 4), "requirement": r["name"]}))
        if not any(source == "arxiv" for source, _ in queries) and needs_papers(rj.get("problemSummary") or ""):
            queries.append(("arxiv", {"query": _keywords(rj.get("problemSummary") or "", 4), "requirement": OVERALL}))
        # Keep the product-wide S4 query and at least one paper query when the brief asks for papers
        papers = [q for q in queries if q[0] == "arxiv"][:1]
        rest = [q for q in queries if q not in papers]
        return (rest[: max(0, self.max_queries - len(papers))] + papers)[: self.max_queries]

    def search(self, planned: List[Dict[str, str]], covered: Set[str], known: Dict[str, Dict[str, Any]]):
        """covered: requirements that already have a candidate. known: items found so far (lower full name)."""
        results: List[Tuple[Dict[str, str], List[Dict[str, Any]]]] = []
        for source, query in self.plan(planned, covered):
            try:
                if source == "web":
                    pages = self.connectors.get("tavily").search(query["query"], size=self.per_query)
                else:
                    pages = self.connectors.get("arxiv").search(query["query"], size=self.per_query)
            except SourceUnavailable as e:
                self.unavailable.append(f"{source}: {e}"[:300])
                continue
            items: List[Dict[str, Any]] = []
            for page in pages:
                for repo in repositories_in(f"{page.url} {page.snippet}"):
                    item = self._item(repo, known)
                    if item is None:
                        continue
                    key = item["full_name"].lower()
                    self.sources.setdefault(key, set()).add(source)
                    nomination = {"source": source, "url": page.url, "title": page.title[:200]}
                    if nomination not in self.nominations.setdefault(key, []):
                        self.nominations[key].append(nomination)
                    if all(i["full_name"].lower() != key for i in items):
                        items.append(item)
                    known.setdefault(key, item)
            # The query text says where it came from, so a candidate's matched queries show it was nominated by a page
            results.append(({"query": f"{source}: {query['query']}", "requirement": query["requirement"]}, items))
            self.searched.append({"source": source, "query": query["query"], "requirement": query["requirement"],
                                  "pages": len(pages), "repositories": len(items)})
        return results

    def _item(self, repo: str, known: Dict[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        key = repo.lower()
        if key in known:
            return known[key]
        if key in self._metadata:
            return self._metadata[key]
        if self.new_repos >= self.max_new:
            return None
        self.new_repos += 1
        item = self.github.fetch_repository(repo)
        self._metadata[key] = item
        if item and item["full_name"].lower() != key:
            self._metadata[item["full_name"].lower()] = item  # renamed: the canonical name is what merges
        return item

    def annotate(self, candidates: List[Dict[str, Any]], github_found: Set[str]):
        """Adds "web" / "arxiv" to the sources of the candidates a page nominated. "github" is a fallback label
        elsewhere (a candidate always has a source); it is dropped for a repository GitHub search never found."""
        for c in candidates:
            key = c["full_name"].lower()
            extra = sorted(self.sources.get(key, set()))
            if not extra:
                continue
            kept = [s for s in (c.get("sources") or []) if s != "github" or key in github_found]
            c["sources"] = kept + [s for s in extra if s not in kept]

    def metrics(self) -> Optional[Dict[str, Any]]:
        if not self.enabled:
            return None
        return {
            "searched": self.searched,
            "newRepositories": self.new_repos,
            # Pages are nominations (E4), never evidence: kept so the brief can say why a candidate was considered
            "nominations": {k: v[:3] for k, v in sorted(self.nominations.items())},
            "unavailable": self.unavailable,
        }
