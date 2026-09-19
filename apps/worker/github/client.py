from typing import Optional, Dict, Any
import httpx
from ..config import config

class GitHubWorkerClient:
    """Client for GitHub API operations during background ingestion."""

    def __init__(self, token: Optional[str] = None):
        self.token = token or config.GITHUB_TOKEN
        self.headers = {
            "User-Agent": "Repo-Intelligence-Worker/1.0",
            "Accept": "application/vnd.github.v3+json"
        }
        if self.token:
            self.headers["Authorization"] = f"token {self.token}"

    def fetch_repo_info(self, owner: str, repo: str) -> Dict[str, Any]:
        url = f"https://api.github.com/repos/{owner}/{repo}"
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(url, headers=self.headers)
            if resp.status_code == 404:
                raise ValueError("REPOSITORY_NOT_FOUND: Repository does not exist or is private.")
            if resp.status_code == 403:
                raise RuntimeError("GITHUB_RATE_LIMITED: GitHub API rate limit reached or access forbidden.")
            resp.raise_for_status()
            data = resp.json()

            if data.get("private"):
                raise ValueError("PRIVATE_REPOSITORY: Only public GitHub repositories are supported.")

            size_kb = data.get("size", 0)
            if size_kb > config.MAX_REPOSITORY_SIZE_MB * 1024:
                raise ValueError(f"REPOSITORY_TOO_LARGE: Size {size_kb // 1024}MB exceeds limit of {config.MAX_REPOSITORY_SIZE_MB}MB.")

            return {
                "owner": data.get("owner", {}).get("login", owner),
                "name": data.get("name", repo),
                "description": data.get("description"),
                "default_branch": data.get("default_branch", "main"),
                "stars": data.get("stargazers_count", 0),
                "license": (data.get("license") or {}).get("spdx_id"),
                "primary_language": data.get("language"),
                "size_kb": size_kb
            }
