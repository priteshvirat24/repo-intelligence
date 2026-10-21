"""
The gateway every connector request goes through (SYSTEM_DESIGN 5.1):

- cache: keyed by a hash of connector, method, URL, sorted parameters and body (credentials removed), with a
  TTL per connector, in connector_cache (or in memory for the evaluation harness and tests);
- budget: ledger.authorize(provider) before and ledger.record(...) after every request that leaves the
  process, so each one counts against the run's sourceRequests budget and appears in the cost ledger;
- outbound safety: a URL whose host is not one of the connector's fixed official API hosts passes the SSRF
  check (scraper/safety.py) before it is requested, and so does every redirect target;
- pacing: at most one live request per connector every min_interval seconds;
- trust: every response is marked untrusted, and instruction-like text in fetched pages is flagged and logged.

The HTTP client is injectable so the evaluation harness can record and replay sources (eval/recording.py).
"""
import hashlib
import json
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx

from ..providers import ledger
from ..scraper.safety import check_url
from .base import Connector, SourceBlocked, SourceUnavailable, content_hash, utc_now_iso

MAX_RESPONSE_BYTES = 8 * 1024 * 1024
MAX_REDIRECTS = 5
USER_AGENT = "OpenEye/1.0 (+https://github.com/priteshvirat/open-eye; research crawler, official APIs)"
# Query parameters and body fields that carry credentials: never part of a cache key or a stored URL
SECRET_FIELDS = {"key", "api_key", "apiKey", "token", "access_token"}

# Instruction-like text in retrieved content (PRODUCT_DEFINITION 7.3: ignored and logged)
_INSTRUCTION_PATTERNS = [
    re.compile(p, re.IGNORECASE) for p in (
        r"ignore (?:all |any )?(?:the )?(?:previous|prior|above) (?:instructions|prompts?)",
        r"disregard (?:all |any )?(?:the )?(?:previous|prior|above) (?:instructions|prompts?)",
        r"you are now (?:a|an|in) ",
        r"\bsystem prompt\b",
        r"\bact as (?:a|an) (?:different|new) (?:assistant|ai|model)\b",
        r"<\s*/?\s*(?:system|assistant)\s*>",
    )
]


def flag_instructions(text: str, limit: int = 5) -> List[str]:
    """Snippets of text that look like instructions to an AI model. They are only reported, never followed."""
    found = []
    for pattern in _INSTRUCTION_PATTERNS:
        for match in pattern.finditer(text or ""):
            start = max(0, match.start() - 40)
            found.append(re.sub(r"\s+", " ", text[start:match.end() + 40]).strip())
            if len(found) >= limit:
                return found
    return found


@dataclass
class GatewayResponse:
    status: int
    text: str
    url: str
    content_type: Optional[str]
    retrieved_at: str
    cached: bool
    content_hash: str
    untrusted: bool = True

    def json(self) -> Any:
        try:
            return json.loads(self.text)
        except ValueError as e:
            raise SourceUnavailable(f"Response from {self.url} is not JSON: {e}")


def _strip_secrets(params: Optional[Dict[str, Any]]) -> List[Tuple[str, str]]:
    return sorted((str(k), str(v)) for k, v in (params or {}).items() if k not in SECRET_FIELDS and v is not None)


def cache_key(connector_id: str, method: str, url: str, params: Optional[Dict[str, Any]], body: Any) -> str:
    if isinstance(body, dict):
        body = {k: v for k, v in body.items() if k not in SECRET_FIELDS}
    material = json.dumps([connector_id, method.upper(), url, _strip_secrets(params), body], sort_keys=True, default=str)
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


class MemoryCache:
    """Per-process cache (evaluation harness, tests)."""

    def __init__(self):
        self.rows: Dict[str, Dict[str, Any]] = {}

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        row = self.rows.get(key)
        if row and row["expires_at"] > datetime.now(timezone.utc):
            return row
        return None

    def put(self, key: str, row: Dict[str, Any]):
        self.rows[key] = row


class DatabaseCache:
    """connector_cache (migration 010). A failing cache never fails the request it would have served."""

    def __init__(self, db):
        self.db = db

    def get(self, key: str) -> Optional[Dict[str, Any]]:
        try:
            conn = self.db.get_connection()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT status_code, body, content_type, url, retrieved_at, content_hash, expires_at
                        FROM connector_cache WHERE cache_key = %s AND expires_at > NOW()
                        """,
                        (key,)
                    )
                    row = cur.fetchone()
            finally:
                conn.close()
        except Exception as e:
            print(f"[Gateway] Cache read failed: {e}", file=sys.stderr)
            return None
        if not row:
            return None
        status, body, ctype, url, retrieved_at, chash, expires_at = row
        return {"status": status, "body": body, "content_type": ctype, "url": url, "retrieved_at": retrieved_at.isoformat(),
                "content_hash": chash, "expires_at": expires_at}

    def put(self, key: str, row: Dict[str, Any]):
        try:
            conn = self.db.get_connection()
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO connector_cache (cache_key, connector, operation, url, status_code, content_type, body,
                                                     content_hash, retrieved_at, expires_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (cache_key) DO UPDATE SET status_code = EXCLUDED.status_code, body = EXCLUDED.body,
                            content_type = EXCLUDED.content_type, content_hash = EXCLUDED.content_hash,
                            retrieved_at = EXCLUDED.retrieved_at, expires_at = EXCLUDED.expires_at
                        """,
                        (key, row["connector"], row["operation"][:60], row["url"], row["status"], (row.get("content_type") or "")[:200],
                         row["body"].replace("\x00", ""), row["content_hash"], row["retrieved_at"], row["expires_at"])
                    )
                    conn.commit()
            finally:
                conn.close()
        except Exception as e:
            print(f"[Gateway] Cache write failed: {e}", file=sys.stderr)


class Gateway:
    def __init__(self, http: Optional[httpx.Client] = None, cache=None, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic, resolve_dns: bool = True):
        self._owns_http = http is None
        self.http = http or httpx.Client(timeout=30.0)
        self.cache = cache
        self.sleep = sleep
        self.clock = clock
        self.resolve_dns = resolve_dns
        self._last_request: Dict[str, float] = {}
        self.stats: Dict[str, Dict[str, int]] = {}

    def close(self):
        if self._owns_http:
            self.http.close()

    def _count(self, connector_id: str, key: str):
        bucket = self.stats.setdefault(connector_id, {"requests": 0, "cacheHits": 0, "failures": 0, "blocked": 0})
        bucket[key] += 1

    def _check(self, connector: Connector, url: str):
        host = (urlparse(url).hostname or "").lower()
        if host in connector.official_hosts and urlparse(url).scheme == "https":
            return
        reason = check_url(url, resolve=self.resolve_dns)
        if reason:
            self._count(connector.id, "blocked")
            raise SourceBlocked(f"SOURCE_BLOCKED: {reason}")

    def _pace(self, connector: Connector):
        if connector.min_interval <= 0:
            return
        last = self._last_request.get(connector.id)
        if last is not None:
            wait = connector.min_interval - (self.clock() - last)
            if wait > 0:
                self.sleep(wait)
        self._last_request[connector.id] = self.clock()

    def request(self, connector: Connector, operation: str, method: str, url: str, params: Optional[Dict[str, Any]] = None,
                json_body: Any = None, headers: Optional[Dict[str, str]] = None, accept_status: Iterable[int] = (404,),
                follow_redirects: bool = False, ttl: Optional[int] = None, trusted_endpoint: bool = False) -> GatewayResponse:
        """One request to a source. 2xx and accept_status responses are returned (and cached); rate limiting,
        server errors and other client errors raise SourceUnavailable. trusted_endpoint: the URL is a service the
        operator configured (the scraper service on a private network), exempt from the public-address check;
        the page it is asked for was checked by the caller and is checked again by the service."""
        key = cache_key(connector.id, method, url, params, json_body)
        if self.cache is not None:
            hit = self.cache.get(key)
            if hit:
                self._count(connector.id, "cacheHits")
                return GatewayResponse(hit["status"], hit["body"], hit["url"], hit.get("content_type"), hit["retrieved_at"], True, hit["content_hash"])

        current, hops = url, 0
        while True:
            if not trusted_endpoint:
                self._check(connector, current)
            response = self._send(connector, operation, method, current, params if hops == 0 else None, json_body, headers)
            location = response.headers.get("location")
            if follow_redirects and 300 <= response.status_code < 400 and location and hops < MAX_REDIRECTS:
                current, hops = urljoin(current, location), hops + 1
                continue
            break

        status = response.status_code
        accepted = 200 <= status < 300 or status in tuple(accept_status)
        if not accepted:
            self._count(connector.id, "failures")
            hint = " (rate limited)" if status == 429 else ""
            raise SourceUnavailable(f"SOURCE_UNAVAILABLE: {connector.id} returned HTTP {status}{hint}")
        text = response.text
        retrieved_at = utc_now_iso()
        result = GatewayResponse(status, text, str(response.url) if response.url else current, response.headers.get("content-type"),
                                 retrieved_at, False, content_hash(text))
        if self.cache is not None:
            expires = datetime.now(timezone.utc) + timedelta(seconds=ttl if ttl is not None else connector.cache_ttl)
            self.cache.put(key, {"connector": connector.id, "operation": operation, "url": _public_url(result.url),
                                 "status": status, "content_type": result.content_type, "body": text,
                                 "content_hash": result.content_hash, "retrieved_at": retrieved_at, "expires_at": expires})
        return result

    def _send(self, connector: Connector, operation: str, method: str, url: str, params, json_body, headers) -> httpx.Response:
        self._pace(connector)
        ledger.authorize(connector.provider)
        self._count(connector.id, "requests")
        started = time.time()
        try:
            request = self.http.build_request(method, url, params=params, json=json_body,
                                              headers={"User-Agent": USER_AGENT, **(headers or {})})
            response = self.http.send(request, stream=True)
            try:
                chunks, size = [], 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise SourceUnavailable(f"SOURCE_UNAVAILABLE: {connector.id} response exceeds {MAX_RESPONSE_BYTES // (1024 * 1024)}MB")
                    chunks.append(chunk)
            finally:
                response.close()
            body = b"".join(chunks)
            response = httpx.Response(response.status_code, headers=_plain_headers(response.headers), content=body, request=request)
        except SourceUnavailable as e:
            self._count(connector.id, "failures")
            ledger.record(connector.provider, operation, None, int((time.time() - started) * 1000), False, error=str(e))
            raise
        except httpx.HTTPError as e:
            self._count(connector.id, "failures")
            ledger.record(connector.provider, operation, None, int((time.time() - started) * 1000), False, error=str(e))
            raise SourceUnavailable(f"SOURCE_UNAVAILABLE: {connector.id} request failed: {e}")
        ledger.record(connector.provider, operation, None, int((time.time() - started) * 1000), response.status_code < 400,
                      error=None if response.status_code < 400 else f"HTTP {response.status_code}")
        return response


def _plain_headers(headers: httpx.Headers) -> Dict[str, str]:
    # The body is already decoded: drop the headers that would make httpx decode or size-check it again
    return {k: v for k, v in headers.items() if k.lower() not in ("content-encoding", "content-length", "transfer-encoding")}


def _public_url(url: str) -> str:
    """The URL without its query string, which may carry an API key."""
    parsed = urlparse(url)
    return parsed._replace(query="", fragment="").geturl()
