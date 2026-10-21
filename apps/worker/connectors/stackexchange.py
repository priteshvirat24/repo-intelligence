"""
Stack Exchange API 2.3: questions about a package, as evidence of integration problems and gotchas (E4).
Works without a key at a lower daily quota (300 requests per IP); STACKEXCHANGE_KEY raises it.
"""
import html
import os
from datetime import datetime, timezone
from typing import List, Optional

from .base import Candidate, Connector, SourceUnavailable


class StackExchangeConnector(Connector):
    id = "stackexchange"
    provider = "stackexchange"
    source_type = "qa_forum"
    official_hosts = ("api.stackexchange.com",)
    cache_ttl = 3 * 24 * 3600
    terms_note = "Content CC BY-SA; attribute question links; honour the backoff field"

    def __init__(self, gateway, key: Optional[str] = None, site: str = "stackoverflow"):
        super().__init__(gateway)
        self.key = key if key is not None else os.getenv("STACKEXCHANGE_KEY", "")
        self.site = site

    def search(self, query: str, size: int = 10, tagged: Optional[str] = None, **filters) -> List[Candidate]:
        params = {"order": "desc", "sort": "relevance", "q": query, "site": self.site, "pagesize": size}
        if tagged:
            params["tagged"] = tagged
        if self.key:
            params["key"] = self.key
        response = self.gateway.request(self, "search", "GET", "https://api.stackexchange.com/2.3/search/advanced",
                                        params=params, accept_status=(400,))
        data = response.json()
        if response.status == 400 or data.get("error_id"):
            # 400 with error_id: a bad parameter or an exhausted quota (error 502 throttle_violation)
            raise SourceUnavailable(f"SOURCE_UNAVAILABLE: stackexchange error {data.get('error_id')}: {data.get('error_message') or data.get('error_name')}")
        out = []
        for item in data.get("items") or []:
            if not item.get("link") or not item.get("title"):
                continue
            created = item.get("creation_date")
            out.append(Candidate(
                resource_ref=f"stackexchange:{self.site}:{item.get('question_id')}",
                title=html.unescape(item["title"]),
                url=item["link"],
                snippet="",
                provenance=self.provenance(response.url, response.retrieved_at, response.cached),
                signals={
                    "score": item.get("score", 0),
                    "answers": item.get("answer_count", 0),
                    "answered": bool(item.get("is_answered")),
                    "accepted": bool(item.get("accepted_answer_id")),
                    "tags": list(item.get("tags") or []),
                    "created": datetime.fromtimestamp(created, timezone.utc).date().isoformat() if created else None,
                    "views": item.get("view_count"),
                },
            ))
        return out
