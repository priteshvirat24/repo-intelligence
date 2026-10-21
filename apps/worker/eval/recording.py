"""
Record/replay of external HTTP responses for reproducible evaluation (SYSTEM_DESIGN 10.3).

The first live run of a suite records every response from GitHub and the search provider into a
content-addressed snapshot; replay runs serve those responses, so two configurations are compared
against the same external world. LLM calls are never recorded: they run live in every mode.

Snapshots never contain secrets: request headers (where tokens live) are not stored, and the request
key is a hash of method, URL and a body with credential fields removed.
"""
import base64
import hashlib
import json
from pathlib import Path
from typing import Optional

import httpx

# Body fields that carry credentials (Tavily sends api_key in the JSON body)
_SECRET_BODY_FIELDS = {"api_key", "apiKey", "token", "access_token"}
_KEPT_RESPONSE_HEADERS = {"content-type", "x-ratelimit-remaining", "x-ratelimit-reset", "link"}


class ReplayMiss(RuntimeError):
    """Replay asked for a request the snapshot does not contain. The run is not comparable: fail loudly."""


def request_key(request: httpx.Request) -> str:
    body = request.content or b""
    if body:
        try:
            data = json.loads(body)
            if isinstance(data, dict):
                body = json.dumps({k: v for k, v in data.items() if k not in _SECRET_BODY_FIELDS}, sort_keys=True).encode()
        except (ValueError, UnicodeDecodeError):
            pass
    url = request.url.copy_with(params=sorted(request.url.params.multi_items()))
    material = b"\n".join([request.method.encode(), str(url).encode(), hashlib.sha256(body).hexdigest().encode()])
    return hashlib.sha256(material).hexdigest()


class RecordingTransport(httpx.BaseTransport):
    """mode: "live" (pass through), "record" (pass through and store), "replay" (serve from the snapshot only),
    "fill" (serve from the snapshot, fetch and store what is missing: for runs whose queries differ from the
    recording, e.g. a changed planner prompt; shared requests still see the recorded world)."""

    def __init__(self, snapshot_dir: str, mode: str, inner: Optional[httpx.BaseTransport] = None):
        if mode not in ("live", "record", "replay", "fill"):
            raise ValueError(f"Unknown mode {mode!r}")
        self.dir = Path(snapshot_dir)
        self.mode = mode
        self.inner = inner or httpx.HTTPTransport(retries=1)
        self.recorded = 0
        self.replayed = 0
        self.fetched = 0
        if mode in ("record", "fill"):
            self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        return self.dir / key[:2] / f"{key}.json"

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        key = request_key(request)
        path = self._path(key)
        if self.mode in ("replay", "fill") and path.exists():
            stored = json.loads(path.read_text())
            self.replayed += 1
            return httpx.Response(stored["status"], headers=stored["headers"], content=base64.b64decode(stored["body"]), request=request)
        if self.mode == "replay":
            raise ReplayMiss(f"No recorded response for {request.method} {request.url.copy_with(query=None)} (key {key[:12]})")

        response = self.inner.handle_request(request)
        response.read()
        self.fetched += 1
        if self.mode in ("record", "fill") and response.status_code < 500 and response.status_code != 429:
            # Transient failures are not recorded: replay must reproduce the world, not a bad minute
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps({
                "method": request.method,
                "url": str(request.url.copy_with(query=None)),
                "status": response.status_code,
                "headers": {k: v for k, v in response.headers.items() if k.lower() in _KEPT_RESPONSE_HEADERS},
                "body": base64.b64encode(response.content).decode(),
            }))
            self.recorded += 1
        # content is already decoded: drop the headers that would make httpx decode or size-check it again
        headers = {k: v for k, v in response.headers.items() if k.lower() not in ("content-encoding", "content-length", "transfer-encoding")}
        return httpx.Response(response.status_code, headers=headers, content=response.content, request=request)
