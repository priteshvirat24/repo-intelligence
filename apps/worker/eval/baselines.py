"""
B0, the plain-search baseline (SYSTEM_DESIGN 10.2): what a person gets by typing the brief's title into
GitHub search and a web search engine. No query planning, no README reading, no ranking of our own.

- GitHub: repository search for the title's keywords, GitHub's default best-match order, top 10.
- Search provider: the title plus "github", top 10 results, keeping GitHub repository URLs.
- The two lists are interleaved (GitHub first) without duplicates; the top 6 stand in for a shortlist.

B0s is the same with the GitHub results sorted by stars: what a person tries next when best match returns
small projects. It is the stricter of the two baselines and the one improvement targets should beat.
"""
import re
from typing import Any, Dict, List, Optional

import httpx

from ..config import config
from ..discovery.planner import keywords

_REPO_URL = re.compile(r"^https?://github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)")
# github.com/<first segment>/... pages that are not repositories
_NOT_REPOS = {
    "topics", "orgs", "features", "marketplace", "collections", "sponsors", "settings", "search", "about", "apps",
    "advisories", "resources", "enterprise", "solutions", "pricing", "readme", "events", "customer-stories", "login", "trending",
}


def title_terms(title: str) -> str:
    return keywords(title, 4).lower()


def github_plain_search(http: httpx.Client, terms: str, token: Optional[str], sort: Optional[str] = None) -> List[str]:
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "Open-Eye-Eval/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    params = {"q": terms, "per_page": 10, **({"sort": sort, "order": "desc"} if sort else {})}
    resp = http.get("https://api.github.com/search/repositories", params=params, headers=headers)
    resp.raise_for_status()
    return [item["full_name"] for item in resp.json().get("items", [])]


def repo_from_url(url: str) -> Optional[str]:
    match = _REPO_URL.match(url or "")
    if not match or match.group(1).lower() in _NOT_REPOS:
        return None
    return f"{match.group(1)}/{re.sub(r'\.git$', '', match.group(2))}"


def web_search_repos(http: httpx.Client, title: str, api_key: str) -> List[str]:
    resp = http.post(
        "https://api.tavily.com/search",
        json={"api_key": api_key, "query": f"{title} github", "max_results": 10, "search_depth": "basic", "include_answer": False},
        timeout=30.0,
    )
    resp.raise_for_status()
    repos = []
    for result in resp.json().get("results", []):
        repo = repo_from_url(result.get("url", ""))
        if repo and repo.lower() not in {r.lower() for r in repos}:
            repos.append(repo)
    return repos


def interleave(*lists: List[str], limit: int = 10) -> List[str]:
    out, seen = [], set()
    for i in range(max((len(l) for l in lists), default=0)):
        for l in lists:
            if i < len(l) and l[i].lower() not in seen:
                seen.add(l[i].lower())
                out.append(l[i])
    return out[:limit]


def run_b0(brief: Dict[str, Any], http: httpx.Client, tavily_key: Optional[str], sort: Optional[str] = None) -> Dict[str, Any]:
    terms = title_terms(brief["title"])
    github = github_plain_search(http, terms, config.GITHUB_TOKEN or None, sort)
    web = web_search_repos(http, brief["title"], tavily_key) if tavily_key else []
    ranked = interleave(github, web)
    return {"ranked": ranked, "shortlisted": ranked[:6], "details": {"githubQuery": terms, "github": github, "web": web}}
