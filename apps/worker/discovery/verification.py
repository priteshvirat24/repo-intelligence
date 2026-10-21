from typing import Any, Dict, List

from ..github.client import GitHubWorkerClient


def select_verification_targets(candidates: List[Dict[str, Any]], github: GitHubWorkerClient, limit: int) -> List[Dict[str, Any]]:
    """The first `limit` shortlisted candidates that can be indexed, in rank order.

    Each is checked with the same GitHub metadata call the indexer relies on (public, within the size
    limit, real default branch). Candidates that cannot be indexed are kept as 'skipped' with the reason,
    so the blueprint can say why their claims rest on the README alone.
    """
    targets: List[Dict[str, Any]] = []
    eligible = 0
    for c in candidates:
        if not c.get("shortlisted") or eligible >= limit:
            continue
        owner, _, name = c["full_name"].partition("/")
        target = {"fullName": c["full_name"], "url": f"https://github.com/{owner.lower()}/{name.lower()}"}
        try:
            target["meta"] = github.fetch_repo_info(owner, name)
            eligible += 1
        except Exception as e:
            # Not found, private, too large, or GitHub unavailable: verification is skipped, discovery is not failed
            target["state"] = "skipped"
            target["reason"] = str(e)[:300]
        targets.append(target)
    return targets
