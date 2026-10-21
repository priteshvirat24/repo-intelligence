"""
The connector registry: which sources exist and their declared properties. Adding, replacing or removing a
source is a change here, not a redesign (PRODUCT_DEFINITION 6.5).
"""
from typing import Any, Dict, List, Optional, Type

import httpx

from .arxiv import ArxivConnector
from .base import Connector
from .depsdev import DepsDevConnector
from .docs import DocsConnector
from .gateway import DatabaseCache, Gateway, MemoryCache
from .osv import OsvConnector
from .registries import CratesConnector, NpmConnector
from .stackexchange import StackExchangeConnector
from .tavily import TavilyConnector

CONNECTORS: Dict[str, Type[Connector]] = {
    c.id: c for c in (DepsDevConnector, OsvConnector, NpmConnector, CratesConnector, StackExchangeConnector,
                      TavilyConnector, ArxivConnector, DocsConnector)
}


def describe() -> List[Dict[str, Any]]:
    """Declared properties of every registered connector (for status views and the evaluation report)."""
    return [{"id": c.id, "provider": c.provider, "sourceType": c.source_type, "accessBasis": c.access_basis,
             "officialHosts": list(c.official_hosts), "cacheTtlSeconds": c.cache_ttl, "minIntervalSeconds": c.min_interval,
             "terms": c.terms_note} for c in CONNECTORS.values()]


class Connectors:
    """One gateway and an instance of every connector, sharing the gateway's cache, pacing and stats."""

    def __init__(self, gateway: Gateway):
        self.gateway = gateway
        self._instances: Dict[str, Connector] = {}

    def get(self, connector_id: str) -> Connector:
        if connector_id not in self._instances:
            self._instances[connector_id] = CONNECTORS[connector_id](self.gateway)
        return self._instances[connector_id]

    def __getattr__(self, name: str) -> Connector:
        if name in CONNECTORS:
            return self.get(name)
        raise AttributeError(name)

    def close(self):
        self.gateway.close()


def build_connectors(db=None, http: Optional[httpx.Client] = None, **gateway_options) -> Connectors:
    """Production: the cache lives in connector_cache when a database is given, else in memory."""
    cache = DatabaseCache(db) if db is not None else MemoryCache()
    return Connectors(Gateway(http=http, cache=cache, **gateway_options))
