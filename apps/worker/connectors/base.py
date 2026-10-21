"""
The connector contract (SYSTEM_DESIGN 5.1). Every external source implements it and is reached only
through the gateway, which caches, meters, checks URLs and marks what comes back as untrusted.

  search(query, filters) -> [Candidate]   what the source found, with provenance
  fetch(ref)             -> Document      one retrieved item, with its content hash and access basis

Connectors build requests and parse responses; they never open sockets themselves. A source that is not
configured (no API key) or not reachable says so through SourceUnavailable: callers record that and go on.
"""
import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

SOURCE_TYPES = ("code_host", "package_registry", "vuln_db", "qa_forum", "search", "docs_site", "papers")
ACCESS_BASES = ("official_api", "public_page", "rendered_public_page")


class SourceUnavailable(RuntimeError):
    """The source could not answer: not configured, rate limited, failing, or the URL was refused. Not fatal."""


class SourceBlocked(SourceUnavailable):
    """The URL failed the outbound safety check (SSRF guard) and was not requested."""


@dataclass
class Provenance:
    connector: str
    source_type: str
    access_basis: str
    url: str
    retrieved_at: str
    cached: bool = False

    def as_dict(self) -> Dict[str, Any]:
        return {"connector": self.connector, "sourceType": self.source_type, "accessBasis": self.access_basis,
                "url": self.url, "retrievedAt": self.retrieved_at, "cached": self.cached}


@dataclass
class Candidate:
    """One search result. resource_ref identifies it within the source (npm:bullmq, arxiv:2101.00001)."""
    resource_ref: str
    title: str
    url: str
    snippet: str
    provenance: Provenance
    signals: Dict[str, Any] = field(default_factory=dict)
    # Retrieved text is data, never instructions (PRODUCT_DEFINITION 7.3)
    untrusted: bool = True


@dataclass
class Document:
    url: str
    content: str
    content_hash: str
    retrieved_at: str
    access_basis: str
    provenance: Provenance
    title: str = ""
    content_type: Optional[str] = None
    licence_hint: Optional[str] = None
    untrusted: bool = True
    # Embedded instructions found in the content: ignored, and logged here (PRODUCT_DEFINITION 7.3)
    flagged_instructions: List[str] = field(default_factory=list)


def content_hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Connector:
    """Declared properties of a source. Subclasses set the class attributes and implement search/fetch.

    provider     ledger provider name; every request counts against the run's sourceRequests budget
    official_hosts  hosts of the source's fixed official API: requests elsewhere pass the SSRF check
    cache_ttl    seconds a cached response stays valid
    min_interval seconds between two live requests (the source's published rate limit)
    """
    id: str = ""
    provider: str = ""
    source_type: str = ""
    access_basis: str = "official_api"
    official_hosts: Tuple[str, ...] = ()
    cache_ttl: int = 24 * 3600
    min_interval: float = 0.0
    terms_note: str = ""

    def __init__(self, gateway):
        self.gateway = gateway

    @property
    def available(self) -> bool:
        """False when the source needs configuration (an API key) that is missing."""
        return True

    def provenance(self, url: str, retrieved_at: str, cached: bool) -> Provenance:
        return Provenance(self.id, self.source_type, self.access_basis, url, retrieved_at, cached)

    def search(self, query: str, **filters) -> List[Candidate]:
        raise NotImplementedError(f"{self.id} does not support search")

    def fetch(self, ref: str) -> Optional[Document]:
        raise NotImplementedError(f"{self.id} does not support fetch")
