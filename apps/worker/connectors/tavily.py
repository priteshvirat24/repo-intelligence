"""Tavily search API: official docs pages and articles, optionally restricted to given domains (TAVILY_API_KEY)."""
import os
from typing import List, Optional, Sequence

from .base import Candidate, Connector, SourceUnavailable


class TavilyConnector(Connector):
    id = "tavily"
    provider = "tavily"
    source_type = "search"
    official_hosts = ("api.tavily.com",)
    cache_ttl = 3 * 24 * 3600
    terms_note = "Paid API; metered per search"

    def __init__(self, gateway, api_key: Optional[str] = None):
        super().__init__(gateway)
        self.api_key = api_key if api_key is not None else os.getenv("TAVILY_API_KEY", "")

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    def search(self, query: str, size: int = 5, include_domains: Optional[Sequence[str]] = None, **filters) -> List[Candidate]:
        if not self.api_key:
            raise SourceUnavailable("SOURCE_UNAVAILABLE: tavily is not configured (TAVILY_API_KEY)")
        body = {"query": query, "max_results": size, "search_depth": "basic", "include_answer": False}
        if include_domains:
            body["include_domains"] = list(include_domains)
        # The key travels in the Authorization header: never in the cache key or a recorded body
        response = self.gateway.request(self, "search", "POST", "https://api.tavily.com/search", json_body=body,
                                        headers={"Authorization": f"Bearer {self.api_key}"}, accept_status=())
        out = []
        for r in response.json().get("results") or []:
            if not r.get("url"):
                continue
            out.append(Candidate(
                resource_ref=f"web:{r['url']}",
                title=(r.get("title") or "")[:300],
                url=r["url"],
                snippet=(r.get("content") or "")[:800],
                provenance=self.provenance(response.url, response.retrieved_at, response.cached),
                signals={"score": r.get("score")},
            ))
        return out
