from typing import Optional, Dict, Any, List
import httpx
from ..config import config
from ..providers import ledger


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
        resp = self._get("search", "https://api.github.com/search/repositories",
                         params={"q": query + qualifiers, "per_page": per_page}, headers=self.headers)
        self._raise_for_rate_limit(resp)
        if resp.status_code == 422:
            return []  # GitHub rejected the query text itself; other queries still run
        resp.raise_for_status()
        return [_repo_fields(item) for item in resp.json().get("items", []) if not item.get("fork")]

    def fetch_readme(self, full_name: str, max_chars: int = 3000) -> str:
        """Raw README text (first max_chars), or "" when the repository has none."""
        resp = self._get("readme", f"https://api.github.com/repos/{full_name}/readme",
                         headers={**self.headers, "Accept": "application/vnd.github.raw"})
        self._raise_for_rate_limit(resp)
        if resp.status_code in (403, 404, 451):
            return ""
        resp.raise_for_status()
        return resp.text[:max_chars]

    def fetch_repository(self, full_name: str) -> Optional[Dict[str, Any]]:
        """Search-result fields for one repository (a candidate a package registry pointed at), under its
        current name (renamed repositories redirect). None when it is missing, private, archived or a fork."""
        resp = self._get("repository", f"https://api.github.com/repos/{full_name}", headers=self.headers, follow_redirects=True)
        self._raise_for_rate_limit(resp)
        if resp.status_code in (301, 403, 404, 451):
            return None
        resp.raise_for_status()
        item = resp.json()
        if item.get("private") or item.get("archived") or item.get("fork"):
            return None
        return _repo_fields(item)

    def _get(self, operation: str, url: str, **kwargs) -> httpx.Response:
        """A metered GitHub request: counted against the run's budget and recorded in the ledger."""
        import time
        ledger.authorize("github")
        started = time.time()
        try:
            resp = self.http.get(url, **kwargs)
        except Exception as e:
            ledger.record("github", operation, None, int((time.time() - started) * 1000), False, error=str(e))
            raise
        ledger.record("github", operation, None, int((time.time() - started) * 1000), resp.status_code < 400,
                      error=None if resp.status_code < 400 else f"HTTP {resp.status_code}")
        return resp

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
        "homepage": item.get("homepage") or None,
    }
