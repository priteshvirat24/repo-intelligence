from typing import Optional, Dict, Any, List
import httpx
from ..config import config


class GitHubRateLimited(RuntimeError):
    """Search or REST quota exhausted. Transient: the discovery job is retried later."""


class GitHubSearchClient:
    """GitHub repository search and README reads for brief discovery."""

    def __init__(self, token: Optional[str] = None, http: Optional[httpx.Client] = None):
        self.token = token if token is not None else config.GITHUB_TOKEN
        self.headers = {
            "User-Agent": "Open-Eye-Discovery/1.0",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            self.headers["Authorization"] = f"Bearer {self.token}"
        self.http = http or httpx.Client(timeout=30.0)

    def close(self):
        self.http.close()

    @property
    def authenticated(self) -> bool:
        return bool(self.token)

    def search_repositories(self, query: str, per_page: int = 15, min_stars: Optional[int] = None) -> List[Dict[str, Any]]:
        """Best-match repository search. Archived repositories are excluded; forks are excluded by GitHub's default.
        READMEs are searched too: established libraries often describe what they do only there (python-sgp4's
        description never says "orbit propagation"), and best-match still ranks name/description hits first."""
        qualifiers = " in:name,description,topics,readme archived:false" + (f" stars:>={min_stars}" if min_stars else "")
        resp = self.http.get(
            "https://api.github.com/search/repositories",
            params={"q": query + qualifiers, "per_page": per_page},
            headers=self.headers,
        )
        self._raise_for_rate_limit(resp)
        if resp.status_code == 422:
            return []  # GitHub rejected the query text itself; other queries still run
        resp.raise_for_status()
        return [_repo_fields(item) for item in resp.json().get("items", []) if not item.get("fork")]

    def fetch_readme(self, full_name: str, max_chars: int = 3000) -> str:
        """Raw README text (first max_chars), or "" when the repository has none."""
        resp = self.http.get(
            f"https://api.github.com/repos/{full_name}/readme",
            headers={**self.headers, "Accept": "application/vnd.github.raw"},
        )
        self._raise_for_rate_limit(resp)
        if resp.status_code in (403, 404, 451):
            return ""
        resp.raise_for_status()
        return resp.text[:max_chars]

    @staticmethod
    def _raise_for_rate_limit(resp: httpx.Response):
        if resp.status_code == 429 or (resp.status_code == 403 and resp.headers.get("x-ratelimit-remaining") == "0"):
            raise GitHubRateLimited("GITHUB_RATE_LIMITED: GitHub API quota exhausted; discovery will retry.")


def _repo_fields(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "full_name": item.get("full_name") or "",
        "source_url": item.get("html_url") or f"https://github.com/{item.get('full_name')}",
        "description": item.get("description"),
        "primary_language": item.get("language"),
        "topics": list(item.get("topics") or []),
        "stars": int(item.get("stargazers_count") or 0),
        "forks": int(item.get("forks_count") or 0),
        "open_issues": int(item.get("open_issues_count") or 0),
        "license": (item.get("license") or {}).get("spdx_id"),
        "pushed_at": item.get("pushed_at"),
    }
