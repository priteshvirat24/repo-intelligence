from typing import Any, Dict, List, Optional

from ..config import config
from ..github.client import GitHubWorkerClient
from .planner import capability_requirements
from .ranking import tokens


def focus_terms(requirements_json: Dict[str, Any], limit: int = 20) -> List[str]:
    """Words of the capability requirements, used to pick the directories of a large repository to analyse."""
    words: List[str] = []
    for r in capability_requirements(requirements_json or {}):
        for t in sorted(tokens(f"{r.get('name', '')} {r.get('description', '')}")):
            if t not in words:
                words.append(t)
    return words[:limit]


def select_verification_targets(candidates: List[Dict[str, Any]], github: GitHubWorkerClient, limit: int,
                                focus_terms: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """The first `limit` shortlisted candidates that can be indexed, in rank order.

    Each is checked with the same GitHub metadata call the indexer relies on (public, real default branch).
    A repository over the size limit is not skipped: it gets a partial analysis of its most relevant
    directories (scope "partial", SYSTEM_DESIGN 6), so the major frameworks are not missing from the inventory.
    Candidates that cannot be indexed at all are kept as 'skipped' with the reason, so the blueprint can say
    why their claims rest on the README alone.
    """
    targets: List[Dict[str, Any]] = []
    eligible = 0
    for c in candidates:
        if not c.get("shortlisted") or eligible >= limit:
            continue
        owner, _, name = c["full_name"].partition("/")
        target = {"fullName": c["full_name"], "url": f"https://github.com/{owner.lower()}/{name.lower()}"}
        try:
            target["meta"] = github.fetch_repo_info(owner, name, allow_large=True)
            if target["meta"].get("too_large"):
                size_mb = int(target["meta"].get("size_kb") or 0) // 1024
                target["scope"] = {
                    "mode": "partial",
                    "reason": f"Repository is {size_mb}MB, over the {config.MAX_REPOSITORY_SIZE_MB}MB limit: only its most relevant directories are analysed",
                    "focusTerms": list(focus_terms or []),
                }
            eligible += 1
        except Exception as e:
            # Not found, private, or GitHub unavailable: verification is skipped, discovery is not failed
            target["state"] = "skipped"
            target["reason"] = str(e)[:300]
        targets.append(target)
    return targets
