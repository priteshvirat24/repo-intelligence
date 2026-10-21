"""
Cost ledger: one entry for every metered provider call (SYSTEM_DESIGN 11, PRODUCT_DEFINITION 7.2, 9.2).

Providers call record() after each request that reached the provider, successful or not. What the call
was spent on comes from the current scope (ledger_scope), so providers need no knowledge of jobs or
briefs. Sinks receive the entries: the worker writes them to provider_usage, the evaluation harness
keeps them in memory for its report. A failing sink never fails the call that was metered.

Cost is computed only when LLM_PRICES_JSON gives a price for the model, as USD per million tokens:
{"ministral-8b-latest": {"input": 0.1, "output": 0.1}}. Without one, tokens are still recorded and the
cost is left unknown (NULL), never guessed.
"""
import json
import os
import sys
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Callable, Dict, List, Optional

_scope: ContextVar[Dict[str, Any]] = ContextVar("ledger_scope", default={})
_sinks: List[Callable[[Dict[str, Any]], None]] = []


class BudgetExceeded(RuntimeError):
    """A metered call would exceed the run's budget (PRODUCT_DEFINITION 7.2). The run stops; nothing falls back."""


LLM_PROVIDERS = {"mistral", "openai", "anthropic"}
# External sources reached through the connector gateway (apps/worker/connectors). Each request counts
# against the run's sourceRequests budget (PRODUCT_DEFINITION 7.2: search, API and crawl request counts).
SOURCE_PROVIDERS = {"depsdev", "osv", "npm", "crates", "stackexchange", "tavily", "arxiv", "docs"}


class Budget:
    """Limits for one run, with usage so far. Checked before each metered call and charged after it.

    limits: llmCalls, tokens, githubRequests, sourceRequests (absent or None means unlimited)."""

    def __init__(self, limits: Dict[str, Optional[int]], used: Optional[Dict[str, int]] = None):
        self.limits = {k: v for k, v in (limits or {}).items() if v is not None}
        self.used = {"llmCalls": 0, "tokens": 0, "githubRequests": 0, **(used or {})}

    def check(self, provider: str):
        keys = (["llmCalls", "tokens"] if provider in LLM_PROVIDERS else ["githubRequests"] if provider == "github"
                else ["sourceRequests"] if provider in SOURCE_PROVIDERS else [])
        for key in keys:
            limit = self.limits.get(key)
            if limit is not None and self.used.get(key, 0) >= limit:
                raise BudgetExceeded(f"BUDGET_EXCEEDED: {key} limit of {limit} reached")

    def charge(self, entry: Dict[str, Any]):
        if entry["provider"] in LLM_PROVIDERS and entry["operation"] != "embedding":
            self.used["llmCalls"] += 1
        if entry["provider"] in LLM_PROVIDERS:
            self.used["tokens"] += (entry.get("input_tokens") or 0) + (entry.get("output_tokens") or 0)
        if entry["provider"] == "github":
            self.used["githubRequests"] += 1
        if entry["provider"] in SOURCE_PROVIDERS:
            self.used["sourceRequests"] = self.used.get("sourceRequests", 0) + 1


_budget: ContextVar[Optional[Budget]] = ContextVar("ledger_budget", default=None)


@contextmanager
def budget_scope(budget: Optional[Budget]):
    token = _budget.set(budget)
    try:
        yield budget
    finally:
        _budget.reset(token)


def authorize(provider: str):
    """Called by providers before a metered request: raises BudgetExceeded when the run's budget is spent."""
    budget = _budget.get()
    if budget is not None:
        budget.check(provider)


@contextmanager
def ledger_scope(**fields: Any):
    """Attributes calls made inside the block: scope_type, scope_id, purpose, tuning_version."""
    token = _scope.set({**_scope.get(), **{k: v for k, v in fields.items() if v is not None}})
    try:
        yield
    finally:
        _scope.reset(token)


def add_sink(sink: Callable[[Dict[str, Any]], None]):
    _sinks.append(sink)


def remove_sink(sink: Callable[[Dict[str, Any]], None]):
    if sink in _sinks:
        _sinks.remove(sink)


def _prices() -> Dict[str, Dict[str, float]]:
    try:
        return json.loads(os.getenv("LLM_PRICES_JSON") or "{}")
    except json.JSONDecodeError:
        return {}


def cost_cents(model: Optional[str], input_tokens: Optional[int], output_tokens: Optional[int]) -> Optional[float]:
    price = _prices().get(model or "")
    if not price or input_tokens is None:
        return None
    usd = (input_tokens * price.get("input", 0) + (output_tokens or 0) * price.get("output", 0)) / 1_000_000
    return round(usd * 100, 4)


def record(
    provider: str,
    operation: str,
    model: Optional[str],
    duration_ms: int,
    success: bool,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
    error: Optional[str] = None,
):
    entry = {
        "provider": provider,
        "operation": operation,
        "model": model,
        "duration_ms": duration_ms,
        "success": success,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_cents": cost_cents(model, input_tokens, output_tokens),
        "error": (error or None) and str(error)[:500],
        **_scope.get(),
    }
    budget = _budget.get()
    if budget is not None:
        budget.charge(entry)
    for sink in list(_sinks):
        try:
            sink(entry)
        except Exception as e:
            print(f"[Ledger] Sink failed, entry not stored: {e}", file=sys.stderr)


def usage_tokens(data: Dict[str, Any]) -> tuple:
    usage = data.get("usage") or {}
    return usage.get("prompt_tokens"), usage.get("completion_tokens")


class DatabaseSink:
    """Writes entries to provider_usage."""

    def __init__(self, db):
        self.db = db

    def __call__(self, entry: Dict[str, Any]):
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO provider_usage (provider, operation, model, duration_ms, tokens_used, input_tokens,
                        output_tokens, cost_cents, success, error_message, scope_type, scope_id, purpose, tuning_version)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        entry["provider"], entry["operation"], entry["model"], entry["duration_ms"],
                        (entry["input_tokens"] or 0) + (entry["output_tokens"] or 0), entry["input_tokens"],
                        entry["output_tokens"], entry["cost_cents"], entry["success"], entry["error"],
                        entry.get("scope_type"), entry.get("scope_id"), entry.get("purpose"), entry.get("tuning_version"),
                    )
                )
                conn.commit()
        finally:
            conn.close()


class MemorySink:
    """Collects entries in memory (evaluation harness, tests)."""

    def __init__(self):
        self.entries: List[Dict[str, Any]] = []

    def __call__(self, entry: Dict[str, Any]):
        self.entries.append(entry)

    def totals(self) -> Dict[str, Any]:
        costs = [e["cost_cents"] for e in self.entries if e["cost_cents"] is not None]
        return {
            "calls": len(self.entries),
            "failedCalls": sum(1 for e in self.entries if not e["success"]),
            "inputTokens": sum(e["input_tokens"] or 0 for e in self.entries),
            "outputTokens": sum(e["output_tokens"] or 0 for e in self.entries),
            "costCents": round(sum(costs), 4) if len(costs) == len(self.entries) and self.entries else None,
            "durationMs": sum(e["duration_ms"] for e in self.entries),
        }
