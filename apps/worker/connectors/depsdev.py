"""
deps.dev (Open Source Insights) API v3: projects by source repository, their packages across registries,
versions, licences, advisories and the OpenSSF Scorecard. https://docs.deps.dev/api/v3/
"""
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from .base import Connector

API = "https://api.deps.dev/v3"
# deps.dev system names -> OSV ecosystem names
OSV_ECOSYSTEM = {"NPM": "npm", "CARGO": "crates.io", "PYPI": "PyPI", "GO": "Go", "MAVEN": "Maven", "NUGET": "NuGet"}


class DepsDevConnector(Connector):
    id = "depsdev"
    provider = "depsdev"
    source_type = "package_registry"
    official_hosts = ("api.deps.dev",)
    cache_ttl = 24 * 3600
    terms_note = "Open data (CC-BY 4.0); no key required"

    def _get(self, operation: str, path: str) -> Optional[Dict[str, Any]]:
        response = self.gateway.request(self, operation, "GET", f"{API}{path}")
        return None if response.status == 404 else response.json()

    def project(self, full_name: str) -> Optional[Dict[str, Any]]:
        """The GitHub project: licence, description, homepage, scorecard. None when deps.dev does not know it."""
        data = self._get("project", f"/projects/{quote('github.com/' + full_name.lower(), safe='')}")
        if not data:
            return None
        scorecard = data.get("scorecard") or {}
        return {
            "projectKey": (data.get("projectKey") or {}).get("id"),
            "license": data.get("license") or None,
            "description": data.get("description") or None,
            "homepage": data.get("homepage") or None,
            "stars": data.get("starsCount"),
            "openIssues": data.get("openIssuesCount"),
            "scorecard": {
                "date": scorecard.get("date"),
                "overallScore": scorecard.get("overallScore"),
                "checks": [{"name": c.get("name"), "score": c.get("score"), "reason": c.get("reason")}
                           for c in scorecard.get("checks") or []],
            } if scorecard else None,
            "url": f"https://deps.dev/project/github/{quote(full_name.lower(), safe='')}",
        }

    def project_packages(self, full_name: str, limit: int = 3) -> List[Dict[str, str]]:
        """Distinct packages (system, name) that name the repository as their source: packages named like the
        repository first (republished copies such as "@someone/bullmq" also point at it), then by versions."""
        data = self._get("project_packages", f"/projects/{quote('github.com/' + full_name.lower(), safe='')}:packageversions")
        counts: Dict[tuple, int] = {}
        for v in (data or {}).get("versions") or []:
            key = v.get("versionKey") or {}
            if key.get("system") and key.get("name"):
                counts[(key["system"], key["name"])] = counts.get((key["system"], key["name"]), 0) + 1
        repo = full_name.split("/")[-1].lower()

        def named_like_repo(system: str, name: str) -> int:
            n = name.lower()
            if n == repo or n == full_name.lower() or n == f"github.com/{full_name.lower()}":
                return 2
            return 1 if n.rsplit("/", 1)[-1] == repo and not n.startswith("@") else 0

        ranked = sorted(counts.items(), key=lambda kv: (-named_like_repo(*kv[0]), -kv[1]))
        return [{"system": s, "name": n} for (s, n), _ in ranked[:limit]]

    def default_version(self, system: str, name: str) -> Optional[Dict[str, Any]]:
        """The version the registry marks as default (else the most recently published)."""
        data = self._get("package", f"/systems/{system.lower()}/packages/{quote(name, safe='')}")
        versions = (data or {}).get("versions") or []
        if not versions:
            return None
        chosen = next((v for v in versions if v.get("isDefault")), None) or max(versions, key=lambda v: v.get("publishedAt") or "")
        version = (chosen.get("versionKey") or {}).get("version")
        return {"system": system.upper(), "name": name, "version": version, "publishedAt": chosen.get("publishedAt"),
                "url": f"https://deps.dev/{system.lower()}/{quote(name, safe='')}/{quote(version or '', safe='')}"} if version else None

    def version(self, system: str, name: str, version: str) -> Optional[Dict[str, Any]]:
        data = self._get("version", f"/systems/{system.lower()}/packages/{quote(name, safe='')}/versions/{quote(version, safe='')}")
        if not data:
            return None
        return {"licenses": data.get("licenses") or [], "advisories": [a.get("id") for a in data.get("advisoryKeys") or [] if a.get("id")],
                "links": data.get("links") or [],
                "relatedProjects": [(p.get("projectKey") or {}).get("id") for p in data.get("relatedProjects") or []]}
