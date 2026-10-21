"""arXiv API (Atom feed): research papers, for briefs that need algorithms. https://info.arxiv.org/help/api/"""
import re
import xml.etree.ElementTree as ET
from typing import List

from .base import Candidate, Connector, SourceUnavailable

_ATOM = "{http://www.w3.org/2005/Atom}"
_ARXIV = "{http://arxiv.org/schemas/atom}"


def _text(el) -> str:
    return re.sub(r"\s+", " ", (el.text or "") if el is not None else "").strip()


class ArxivConnector(Connector):
    id = "arxiv"
    provider = "arxiv"
    source_type = "papers"
    official_hosts = ("export.arxiv.org",)
    cache_ttl = 7 * 24 * 3600
    # arXiv API terms: no more than one request every three seconds
    min_interval = 3.0
    terms_note = "arXiv API terms of use: 1 request per 3 seconds; metadata CC0"

    def search(self, query: str, size: int = 10, **filters) -> List[Candidate]:
        terms = " AND ".join(f"all:{w}" for w in re.findall(r"[\w.+-]+", query)[:6])
        if not terms:
            return []
        response = self.gateway.request(self, "search", "GET", "https://export.arxiv.org/api/query",
                                        params={"search_query": terms, "start": 0, "max_results": size}, accept_status=())
        try:
            # The feed is untrusted XML: ElementTree does not resolve external entities
            root = ET.fromstring(response.text)
        except ET.ParseError as e:
            raise SourceUnavailable(f"SOURCE_UNAVAILABLE: arxiv returned unreadable XML: {e}")
        out = []
        for entry in root.findall(f"{_ATOM}entry"):
            url = _text(entry.find(f"{_ATOM}id"))
            if not url or "/abs/" not in url:
                continue
            arxiv_id = url.rsplit("/abs/", 1)[-1]
            out.append(Candidate(
                resource_ref=f"arxiv:{arxiv_id}",
                title=_text(entry.find(f"{_ATOM}title")),
                url=url.replace("http://", "https://", 1),
                snippet=_text(entry.find(f"{_ATOM}summary"))[:800],
                provenance=self.provenance(response.url, response.retrieved_at, response.cached),
                signals={
                    "authors": [_text(a.find(f"{_ATOM}name")) for a in entry.findall(f"{_ATOM}author")][:10],
                    "published": _text(entry.find(f"{_ATOM}published")) or None,
                    "updated": _text(entry.find(f"{_ATOM}updated")) or None,
                    "category": (entry.find(f"{_ARXIV}primary_category").get("term")
                                 if entry.find(f"{_ARXIV}primary_category") is not None else None),
                },
            ))
        return out
