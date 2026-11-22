"""
Record/replay of external HTTP responses for reproducible evaluation (SYSTEM_DESIGN 10.3).

The first live run of a suite records every response from GitHub and the search provider into a
content-addressed snapshot; replay runs serve those responses, so two configurations are compared
against the same external world. LLM completions are recorded too when the run asks for it (LLMSnapshot,
eval --llm snapshot); otherwise they run live in every mode.

Snapshots never contain secrets: request headers (where tokens live) are not stored, and the request
key is a hash of method, URL and a body with credential fields removed.
"""
import base64
import hashlib
import json
from pathlib import Path
from typing import Optional

import httpx

from ..providers.llm import BaseLLMProvider

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
        # GitHub signals primary and secondary rate limits with 403 (remaining 0, or a retry-after header)
        rate_limited = response.status_code == 403 and (
            response.headers.get("x-ratelimit-remaining") == "0" or "retry-after" in response.headers)
        if self.mode in ("record", "fill") and response.status_code < 500 and response.status_code != 429 and not rate_limited:
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


class LLMSnapshot:
    """Record/replay of LLM completions, beside the HTTP snapshot (eval --llm snapshot).

    Each completion is stored under a hash of the provider, model, system prompt and user prompt. The prompt
    text itself is not stored, and neither are API keys (they never reach this layer). A prompt asked several
    times in one run keeps one answer per occurrence, so the n-th identical request replays the n-th recorded
    answer and retries reproduce what the recording saw.

    Modes match RecordingTransport: live, record, replay (a missing answer raises ReplayMiss) and fill. Replay
    needs no API key: the real provider is only created when an answer has to be fetched.
    """

    def __init__(self, snapshot_dir: str, mode: str):
        if mode not in ("live", "record", "replay", "fill"):
            raise ValueError(f"Unknown mode {mode!r}")
        self.dir = Path(snapshot_dir)
        self.mode = mode
        self.recorded = 0
        self.replayed = 0
        self.fetched = 0
        self._occurrences: dict = {}
        if mode in ("record", "fill"):
            self.dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def key(provider: str, model: Optional[str], system: Optional[str], prompt: str) -> str:
        material = json.dumps({"provider": provider, "model": model, "system": system, "prompt": prompt}, sort_keys=True)
        return hashlib.sha256(material.encode("utf-8")).hexdigest()

    def _path(self, key: str) -> Path:
        return self.dir / key[:2] / f"{key}.json"

    def complete(self, provider: str, model: Optional[str], prompt: str, system: Optional[str], fetch) -> str:
        key = self.key(provider, model, system, prompt)
        n = self._occurrences.get(key, 0)
        self._occurrences[key] = n + 1
        if self.mode == "live":
            self.fetched += 1
            return fetch()
        path = self._path(key)
        stored = json.loads(path.read_text()) if path.exists() else {"provider": provider, "model": model, "responses": []}
        responses = stored["responses"]
        # A slot is empty (None) when that occurrence failed live during the recording: it counts as missing
        if self.mode in ("replay", "fill") and n < len(responses) and responses[n] is not None:
            self.replayed += 1
            return responses[n]
        if self.mode == "replay":
            raise ReplayMiss(f"No recorded LLM answer for {provider}/{model} (key {key[:12]}, occurrence {n + 1})")
        text = fetch()  # an error propagates and nothing is stored: failures are not part of the recorded world
        self.fetched += 1
        if n < len(responses):
            responses[n] = text  # record mode re-records over an older recording
        else:
            responses.extend([None] * (n - len(responses)))
            responses.append(text)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(stored))
        self.recorded += 1
        return text


class RecordingLLM(BaseLLMProvider):
    """An LLM provider whose completions go through an LLMSnapshot. inner is the real provider, or a factory
    for it, so replay never needs one."""

    def __init__(self, inner, snapshot: LLMSnapshot, provider: str, model: Optional[str]):
        self._inner = inner
        self.snapshot = snapshot
        self.provider = provider
        self.model = model

    def _real(self) -> BaseLLMProvider:
        if callable(self._inner) and not isinstance(self._inner, BaseLLMProvider):
            self._inner = self._inner()
        return self._inner

    def complete(self, prompt: str, system: Optional[str] = None) -> str:
        return self.snapshot.complete(self.provider, self.model, prompt, system, lambda: self._real().complete(prompt, system))
