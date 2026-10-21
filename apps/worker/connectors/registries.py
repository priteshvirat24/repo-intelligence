"""
Package registry search: npm (registry search API) and crates.io (crates API). Both are official APIs;
neither registry website is scraped. PyPI has no search API, so Python packages are found through GitHub
and resolved through deps.dev (SYSTEM_DESIGN 5.2).
"""
from typing import List

from .base import Candidate, Connector, utc_now_iso
from .urls import github_full_name


class NpmConnector(Connector):
    id = "npm"
    provider = "npm"
    source_type = "package_registry"
    official_hosts = ("registry.npmjs.org",)
    cache_ttl = 24 * 3600
    terms_note = "npm public registry API; no key required"

    def search(self, query: str, size: int = 10, **filters) -> List[Candidate]:
        response = self.gateway.request(self, "search", "GET", "https://registry.npmjs.org/-/v1/search",
                                        params={"text": query, "size": size}, accept_status=())
        out = []
        for obj in response.json().get("objects") or []:
            pkg = obj.get("package") or {}
            name = pkg.get("name")
            if not name:
                continue
            links = pkg.get("links") or {}
            score = obj.get("score") or {}
            out.append(Candidate(
                resource_ref=f"npm:{name}",
                title=name,
                url=links.get("npm") or f"https://www.npmjs.com/package/{name}",
                snippet=(pkg.get("description") or "")[:500],
                provenance=self.provenance(response.url, response.retrieved_at or utc_now_iso(), response.cached),
                signals={
                    "system": "NPM",
                    "name": name,
                    "version": pkg.get("version"),
                    "repository": github_full_name(links.get("repository")),
                    "homepage": links.get("homepage"),
                    "keywords": list(pkg.get("keywords") or [])[:15],
                    "published": pkg.get("date"),
                    "score": (score.get("final") if isinstance(score, dict) else None),
                    "downloads": (obj.get("downloads") or {}).get("monthly") if isinstance(obj.get("downloads"), dict) else None,
                },
            ))
        return out


class CratesConnector(Connector):
    id = "crates"
    provider = "crates"
    source_type = "package_registry"
    official_hosts = ("crates.io",)
    cache_ttl = 24 * 3600
    # crates.io data-access policy: at most one request per second, with an identifying User-Agent
    min_interval = 1.0
    terms_note = "crates.io crawler policy: 1 request/second, identifying User-Agent"

    def search(self, query: str, size: int = 10, **filters) -> List[Candidate]:
        response = self.gateway.request(self, "search", "GET", "https://crates.io/api/v1/crates",
                                        params={"q": query, "per_page": size}, accept_status=())
        out = []
        for crate in response.json().get("crates") or []:
            name = crate.get("name") or crate.get("id")
            if not name:
                continue
            out.append(Candidate(
                resource_ref=f"crates:{name}",
                title=name,
                url=f"https://crates.io/crates/{name}",
                snippet=(crate.get("description") or "")[:500],
                provenance=self.provenance(response.url, response.retrieved_at, response.cached),
                signals={
                    "system": "CARGO",
                    "name": name,
                    "version": crate.get("max_stable_version") or crate.get("newest_version") or crate.get("max_version"),
                    "repository": github_full_name(crate.get("repository")),
                    "homepage": crate.get("homepage"),
                    "documentation": crate.get("documentation"),
                    "downloads": crate.get("recent_downloads"),
                    "published": crate.get("updated_at"),
                },
            ))
        return out
