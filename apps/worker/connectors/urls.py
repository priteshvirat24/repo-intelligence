import re
from typing import Optional
from urllib.parse import urlparse

# github.com/<owner>/<name> in the forms registries store: https, git+https, git://, ssh, "github:owner/name"
_GITHUB_REPO = re.compile(r"github\.com[/:]([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)", re.IGNORECASE)
_GITHUB_SHORTHAND = re.compile(r"^(?:github:)?([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)$")
_NOT_OWNERS = {"orgs", "topics", "sponsors", "marketplace", "features", "about", "apps", "settings"}


def github_full_name(url: Optional[str]) -> Optional[str]:
    """owner/name of the GitHub repository a registry's repository field points at, else None.
    Monorepo paths (github.com/a/b/tree/main/packages/x) resolve to the repository a/b."""
    text = (url or "").strip()
    if not text:
        return None
    match = _GITHUB_REPO.search(text)
    if not match and "://" not in text:
        match = _GITHUB_SHORTHAND.match(text)
    if not match:
        return None
    owner, name = match.group(1), re.sub(r"\.git$", "", match.group(2))
    if owner.lower() in _NOT_OWNERS or not name or name in (".", ".."):
        return None
    return f"{owner}/{name}"


def host_of(url: Optional[str]) -> str:
    try:
        host = (urlparse(url or "").hostname or "").lower()
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host
