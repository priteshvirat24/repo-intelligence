import json

import httpx
import pytest

from apps.worker.discovery import ranking
from apps.worker.discovery.runner import DiscoveryRunner
from apps.worker.providers import ledger
from apps.worker.providers.llm import MistralLLMProvider
from apps.worker.tuning import Tuning, default_tuning, load_tuning_file


# Tuning registry

def test_default_tuning_is_stable_and_reflects_the_code_defaults():
    a, b = default_tuning(), default_tuning()
    assert a.version == b.version and a.version.startswith("cfg-")
    assert a.get("discovery.min_stars") == 10
    assert a.get("ranking.final_weights") == {"coverage": 0.45, "relevance": 0.25, "health": 0.30}
    assert "GitHub repository searches" in a.get("prompts.discovery_planner")


def test_any_change_is_a_new_version_and_unknown_keys_fail():
    base = default_tuning()
    changed = base.with_overrides({"ranking.final_weights": {"coverage": 0.6}})
    assert changed.version != base.version
    # Nested overrides merge into the defaults
    assert changed.get("ranking.final_weights") == {"coverage": 0.6, "relevance": 0.25, "health": 0.30}
    assert base.with_overrides({"discovery.min_stars": 10}).version == base.version
    with pytest.raises(KeyError, match="discovery.min_star"):
        base.with_overrides({"discovery.min_star": 5})
    with pytest.raises(KeyError, match="covrage"):
        base.with_overrides({"ranking.final_weights": {"covrage": 0.6}})


def test_levels_follow_the_definition():
    assert Tuning.level("ranking.final_weights") == "L1"
    assert Tuning.level("prompts.blueprint") == "L2"
    assert Tuning.level("models.discovery") == "L2"


def test_tuning_file_overrides(tmp_path):
    path = tmp_path / "candidate.json"
    path.write_text(json.dumps({"discovery.min_stars": 25}))
    assert load_tuning_file(str(path)).get("discovery.min_stars") == 25


def test_scores_use_the_tuning_they_are_given():
    candidate = {"relevance_score": 0.5, "health_score": 0.5, "coverage_score": 1.0, "candidate_kind": "library"}
    base = ranking.final_score(candidate)
    coverage_heavy = ranking.final_score(candidate, default_tuning().with_overrides({"ranking.final_weights": {"coverage": 0.9}}))
    assert coverage_heavy > base


def test_runner_reports_its_tuning_version_and_uses_its_thresholds():
    class LLM:
        def complete(self, prompt, system=None):
            return json.dumps({"queries": [{"query": "sgp4", "requirement": "(overall)"}, {"query": "globe", "requirement": "(overall)"}]})

    class GitHub:
        authenticated = True
        def __init__(self):
            self.min_stars = []
        def search_repositories(self, query, per_page=15, min_stars=None):
            self.min_stars.append(min_stars)
            return []
        def fetch_readme(self, full_name, max_chars=3000):
            return ""

    tuned = default_tuning().with_overrides({"discovery.min_stars": 50})
    github = GitHub()
    result = DiscoveryRunner(LLM(), github, sleep=lambda s: None, tuning=tuned).run(
        {"requirements": [{"name": "Orbit propagation", "criticality": "MUST"}]}
    )
    assert result["metrics"]["tuningVersion"] == tuned.version
    assert github.min_stars[0] == 50


# Ledger

@pytest.fixture
def sink():
    s = ledger.MemorySink()
    ledger.add_sink(s)
    yield s
    ledger.remove_sink(s)


def mistral_with(handler):
    provider = MistralLLMProvider(api_key="test", model="ministral-8b-latest")
    transport = httpx.MockTransport(handler)
    original = httpx.Client

    class PatchedClient(original):
        def __init__(self, *args, **kwargs):
            kwargs["transport"] = transport
            super().__init__(*args, **kwargs)

    return provider, PatchedClient


def test_llm_calls_are_recorded_with_tokens_scope_and_cost(sink, monkeypatch):
    def handler(request):
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "{\"ok\": true}"}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1200, "completion_tokens": 300},
        })
    provider, client = mistral_with(handler)
    monkeypatch.setattr(httpx, "Client", client)
    monkeypatch.setenv("LLM_PRICES_JSON", json.dumps({"ministral-8b-latest": {"input": 0.1, "output": 0.1}}))

    with ledger.ledger_scope(scope_type="brief", scope_id="b1"):
        with ledger.ledger_scope(purpose="discovery_planner"):
            assert provider.complete("hi") == "{\"ok\": true}"

    [entry] = sink.entries
    assert entry["provider"] == "mistral" and entry["model"] == "ministral-8b-latest"
    assert (entry["input_tokens"], entry["output_tokens"]) == (1200, 300)
    assert (entry["scope_type"], entry["scope_id"], entry["purpose"]) == ("brief", "b1", "discovery_planner")
    # 1500 tokens at $0.10 per million = $0.00015
    assert entry["cost_cents"] == pytest.approx(0.015)
    assert entry["success"]


def test_unpriced_models_have_unknown_cost_and_failures_are_recorded(sink, monkeypatch):
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(429, json={})
        return httpx.Response(200, json={
            "choices": [{"message": {"content": "{\"cut\""}, "finish_reason": "length"}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5},
        })
    provider, client = mistral_with(handler)
    monkeypatch.setattr(httpx, "Client", client)
    monkeypatch.setattr("time.sleep", lambda s: None)
    monkeypatch.delenv("LLM_PRICES_JSON", raising=False)

    with pytest.raises(RuntimeError, match="LLM_UNAVAILABLE"):
        provider.complete("hi")
    assert [e["success"] for e in sink.entries] == [False, False, False]
    assert sink.entries[0]["error"] == "HTTP 429"
    assert sink.entries[1]["error"] == "output truncated at length limit"
    assert all(e["cost_cents"] is None for e in sink.entries)
    assert sink.totals()["costCents"] is None
    assert sink.totals()["inputTokens"] == 20


def test_a_failing_sink_never_breaks_the_call(sink):
    def broken(entry):
        raise RuntimeError("database down")
    ledger.add_sink(broken)
    try:
        ledger.record("mistral", "chat_completion", "m", 5, True, 1, 1)
    finally:
        ledger.remove_sink(broken)
    assert len(sink.entries) == 1


# Database registry and ledger sink

def test_promoted_tuning_is_loaded_and_unpromoted_is_not():
    from apps.worker.db.repository import DatabaseRepository
    from apps.worker.tuning import load_active, register
    db = DatabaseRepository()
    candidate = default_tuning().with_overrides({"discovery.min_stars": 33})
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("UPDATE config_versions SET status = 'retired' WHERE status = 'promoted'")
            conn.commit()
        assert register(db, candidate, notes="test") == candidate.version
        assert register(db, candidate) == candidate.version  # idempotent
        assert load_active(db).version == default_tuning().version
        with conn.cursor() as cur:
            cur.execute("SELECT level FROM config_versions WHERE id = %s", (candidate.version,))
            assert cur.fetchone()[0] == "L1"
            cur.execute("UPDATE config_versions SET status = 'promoted', promoted_at = NOW() WHERE id = %s", (candidate.version,))
            conn.commit()
        active = load_active(db)
        assert active.version == candidate.version and active.get("discovery.min_stars") == 33
    finally:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM config_versions WHERE id = %s", (candidate.version,))
            conn.commit()
        conn.close()


def test_database_sink_writes_provider_usage():
    from apps.worker.db.repository import DatabaseRepository
    db = DatabaseRepository()
    sink = ledger.DatabaseSink(db)
    ledger.add_sink(sink)
    try:
        with ledger.ledger_scope(scope_type="test", scope_id="ledger-sink", purpose="unit", tuning_version="cfg-test"):
            ledger.record("mistral", "chat_completion", "ministral-8b-latest", 42, True, 100, 20)
    finally:
        ledger.remove_sink(sink)
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT model, input_tokens, output_tokens, tokens_used, purpose, tuning_version FROM provider_usage WHERE scope_id = 'ledger-sink'")
            assert cur.fetchall() == [("ministral-8b-latest", 100, 20, 120, "unit", "cfg-test")]
            cur.execute("DELETE FROM provider_usage WHERE scope_id = 'ledger-sink'")
            conn.commit()
    finally:
        conn.close()
