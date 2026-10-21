"""
Package-registry candidates for brief discovery (SYSTEM_DESIGN 5.2): the planner's queries are also run
against npm and crates.io, each package is resolved to the GitHub repository it names as its source, and
those repositories join the GitHub candidates (merged by full name, with every source that found them).

Registries are chosen by ecosystem: a query or brief that names Rust searches crates.io, one that names
JavaScript searches npm, and one that names neither searches both. Python has no registry search API
(PyPI), so Python briefs rely on GitHub search.
"""
import re
from typing import Any, Dict, List, Optional, Set

from ..connectors.base import SourceUnavailable
from ..tuning import Tuning, resolve

# Defaults for the tuning registry (apps/worker/tuning.py)
RESULTS_PER_QUERY = 10
# Repositories found only through a registry cost one GitHub request each for their metadata
MAX_NEW_REPOS = 12

ECOSYSTEM_WORDS = {
    "npm": {"node", "nodejs", "node.js", "javascript", "js", "typescript", "ts", "npm", "react", "nextjs", "next.js", "vue",
            "svelte", "angular", "deno", "bun", "express", "browser", "webgl", "three.js", "electron"},
    "crates": {"rust", "cargo", "crate", "crates", "tokio", "wasm"},
}
# Ecosystems whose registry has no search API: a brief that names only these searches no registry
NO_SEARCH_ECOSYSTEMS = {"python", "django", "flask", "fastapi", "pypi", "golang", "java", "kotlin", "maven",
                        "ruby", "rails", "php", "laravel", "dotnet", ".net", "c#", "elixir"}


def _words(text: str) -> Set[str]:
    return {w.lower() for w in re.findall(r"[A-Za-z0-9#.+-]+", text or "")}


def brief_ecosystems(requirements_json: Dict[str, Any]) -> Set[str]:
    """Words naming an ecosystem anywhere in the brief's requirements and constraints."""
    text = " ".join([requirements_json.get("problemSummary") or ""] + [
        f"{r.get('name', '')} {r.get('description', '')}" for r in requirements_json.get("requirements") or []
    ])
    return _words(text)


def registries_for(query: str, brief_words: Set[str]) -> List[str]:
    """Which registries a query is worth sending to."""
    query_words = _words(query)
    for words in (query_words, brief_words):
        named = [r for r, eco in ECOSYSTEM_WORDS.items() if words & eco]
        if named:
            return named
        if words & NO_SEARCH_ECOSYSTEMS:
            return []
    return list(ECOSYSTEM_WORDS)


def registry_query(query: str) -> str:
    """The query without ecosystem words: "job queue node" -> "job queue" (the registry is the ecosystem)."""
    all_words = set().union(*ECOSYSTEM_WORDS.values())
    kept = [w for w in query.split() if w.lower() not in all_words]
    return " ".join(kept) or query


class RegistrySearch:
    """Runs a planned query against the registries and returns GitHub-shaped items for the repositories found."""

    def __init__(self, connectors, github, requirements_json: Dict[str, Any], tuning: Optional[Tuning] = None):
        t = resolve(tuning)
        self.connectors = connectors
        self.github = github
        self.brief_words = brief_ecosystems(requirements_json)
        self.per_query = t.get("discovery.registry_results_per_query")
        self.max_new = t.get("discovery.registry_max_new_repos")
        self.new_repos = 0
        self.sources: Dict[str, Set[str]] = {}         # full name (lower) -> registries that found it
        self.packages: Dict[str, List[Dict[str, Any]]] = {}
        self.homepages: Dict[str, str] = {}
        self.unavailable: List[str] = []
        self.searched: List[Dict[str, Any]] = []
        self._metadata: Dict[str, Optional[Dict[str, Any]]] = {}

    def search(self, query: str, known: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
        """known: GitHub items already found (lower full name -> item); they are reused, not fetched again."""
        items: List[Dict[str, Any]] = []
        seen: Set[str] = set()
        text = registry_query(query)
        for registry in registries_for(query, self.brief_words):
            try:
                results = self.connectors.get(registry).search(text, size=self.per_query)
            except SourceUnavailable as e:
                self.unavailable.append(f"{registry}: {e}"[:300])
                continue
            resolved = 0
            for candidate in results:
                repo = candidate.signals.get("repository")
                if not repo:
                    continue
                item = self._item(repo, known)
                if item is None:
                    continue
                key = item["full_name"].lower()
                resolved += 1
                self.sources.setdefault(key, set()).add(registry)
                package = {"system": candidate.signals["system"], "name": candidate.signals["name"],
                           "version": candidate.signals.get("version"), "url": candidate.url}
                if package not in self.packages.setdefault(key, []):
                    self.packages[key].append(package)
                if candidate.signals.get("homepage") and key not in self.homepages:
                    self.homepages[key] = candidate.signals["homepage"]
                if key not in seen:
                    seen.add(key)
                    items.append(item)
            self.searched.append({"registry": registry, "query": text, "results": len(results), "resolved": resolved})
        return items

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
        """Sets sources, packages and (when GitHub has none) homepage on the merged candidates."""
        for c in candidates:
            key = c["full_name"].lower()
            sources = (["github"] if key in github_found else []) + sorted(self.sources.get(key, set()))
            c["sources"] = sources or ["github"]
            c["packages"] = self.packages.get(key, [])
            if not c.get("homepage") and self.homepages.get(key):
                c["homepage"] = self.homepages[key]

    def metrics(self) -> Dict[str, Any]:
        counts: Dict[str, int] = {}
        for regs in self.sources.values():
            for r in regs:
                counts[r] = counts.get(r, 0) + 1
        return {"searches": self.searched, "repositoriesFound": counts, "newRepositoriesFetched": self.new_repos,
                "unavailable": self.unavailable}
