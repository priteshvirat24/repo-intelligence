"""OSV.dev: known vulnerabilities affecting one package version. https://google.github.io/osv.dev/api/"""
from typing import Any, Dict, List

from .base import Connector

API = "https://api.osv.dev/v1"


class OsvConnector(Connector):
    id = "osv"
    provider = "osv"
    source_type = "vuln_db"
    official_hosts = ("api.osv.dev",)
    # Advisories are published continuously: a short TTL keeps "no known vulnerabilities" honest
    cache_ttl = 6 * 3600
    terms_note = "Open data (CC-BY 4.0); no key required"

    def query(self, ecosystem: str, name: str, version: str) -> List[Dict[str, Any]]:
        """Vulnerabilities affecting name@version: [{id, aliases, summary, severity, published, modified, url}]."""
        response = self.gateway.request(self, "query", "POST", f"{API}/query",
                                        json_body={"package": {"name": name, "ecosystem": ecosystem}, "version": version}, accept_status=())
        vulns = []
        for v in response.json().get("vulns") or []:
            if not v.get("id"):
                continue
            severity = ((v.get("database_specific") or {}).get("severity")
                        or next((s.get("score") for s in v.get("severity") or [] if s.get("score")), None))
            vulns.append({
                "id": v["id"],
                "aliases": [a for a in v.get("aliases") or [] if isinstance(a, str)],
                "summary": (v.get("summary") or (v.get("details") or "")[:200]).strip(),
                "severity": severity,
                "published": v.get("published"),
                "modified": v.get("modified"),
                "withdrawn": v.get("withdrawn"),
                "url": f"https://osv.dev/vulnerability/{v['id']}",
            })
        return [v for v in vulns if not v["withdrawn"]]
