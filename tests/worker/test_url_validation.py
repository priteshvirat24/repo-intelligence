import pytest
import re

def validate_github_url(url: str):
    if not url or not isinstance(url, str):
        return {"valid": False, "error": "empty"}
    trimmed = url.strip()
    if trimmed.startswith("http://"):
        return {"valid": False, "error": "insecure_http"}
    if trimmed.startswith("git@") or trimmed.startswith("ssh://"):
        return {"valid": False, "error": "ssh_not_allowed"}
    if "?" in trimmed or "#" in trimmed:
        return {"valid": False, "error": "query_or_fragment"}

    pattern = r'^https:\/\/github\.com\/([a-zA-Z0-9_\-\.]+)\/([a-zA-Z0-9_\-\.]+)(?:\/)?$'
    match = re.match(pattern, trimmed)
    if not match:
        return {"valid": False, "error": "invalid_format"}

    owner, repo = match.group(1), match.group(2)
    if owner in (".", "..") or repo in (".", ".."):
        return {"valid": False, "error": "invalid_path"}
    if repo.endswith(".git"):
        repo = repo[:-4]

    return {
        "valid": True,
        "owner": owner,
        "repo": repo,
        "canonical_url": f"https://github.com/{owner}/{repo}"
    }

def test_valid_github_urls():
    res = validate_github_url("https://github.com/unclecode/crawl4ai")
    assert res["valid"] is True
    assert res["owner"] == "unclecode"
    assert res["repo"] == "crawl4ai"
    assert res["canonical_url"] == "https://github.com/unclecode/crawl4ai"

def test_trailing_slash():
    res = validate_github_url("https://github.com/mem0ai/mem0/")
    assert res["valid"] is True
    assert res["owner"] == "mem0ai"
    assert res["repo"] == "mem0"

def test_git_suffix():
    res = validate_github_url("https://github.com/chroma-core/chroma.git")
    assert res["valid"] is True
    assert res["owner"] == "chroma-core"
    assert res["repo"] == "chroma"

def test_invalid_urls():
    assert validate_github_url("http://github.com/owner/repo")["valid"] is False
    assert validate_github_url("git@github.com:owner/repo.git")["valid"] is False
    assert validate_github_url("https://gitlab.com/owner/repo")["valid"] is False
    assert validate_github_url("https://github.com/owner/repo/tree/main")["valid"] is False
    assert validate_github_url("https://github.com/owner/repo?ref=main")["valid"] is False
    assert validate_github_url("https://github.com/owner/repo#readme")["valid"] is False
