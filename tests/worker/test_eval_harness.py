import json

import httpx
import pytest

from apps.worker.eval.baselines import interleave, repo_from_url, title_terms
from apps.worker.eval.recording import RecordingTransport, ReplayMiss, request_key
from apps.worker.eval.report import build
from apps.worker.eval.suite import aggregate, load_suite, score_brief


def upstream(responses):
    def handler(request):
        responses["calls"] = responses.get("calls", 0) + 1
        if request.url.path == "/flaky":
            return httpx.Response(503, json={})
        return httpx.Response(200, json={"path": request.url.path, "q": request.url.params.get("q")}, headers={"x-ratelimit-remaining": "29"})
    return httpx.MockTransport(handler)


def test_record_then_replay_serves_identical_responses_without_network(tmp_path):
    seen = {}
    recorder = httpx.Client(transport=RecordingTransport(str(tmp_path), "record", inner=upstream(seen)))
    first = recorder.get("https://api.github.com/search/repositories", params={"q": "sgp4", "per_page": 15}).json()

    offline = {}
    replayer = httpx.Client(transport=RecordingTransport(str(tmp_path), "replay", inner=upstream(offline)))
    # Parameter order does not change the key
    second = replayer.get("https://api.github.com/search/repositories", params={"per_page": 15, "q": "sgp4"})
    assert second.json() == first
    assert second.headers["x-ratelimit-remaining"] == "29"
    assert offline == {}  # replay never touched the network

    with pytest.raises(ReplayMiss):
        replayer.get("https://api.github.com/search/repositories", params={"q": "never recorded"})


def test_snapshots_hold_no_credentials_and_skip_transient_failures(tmp_path):
    seen = {}
    client = httpx.Client(transport=RecordingTransport(str(tmp_path), "record", inner=upstream(seen)))
    client.get("https://api.github.com/repos/a/b", headers={"Authorization": "Bearer ghp_secret_token"})
    client.post("https://api.tavily.com/search", json={"api_key": "tvly-secret", "query": "x"})
    client.get("https://api.github.com/flaky")
    stored = "".join(p.read_text() for p in tmp_path.rglob("*.json"))
    assert "ghp_secret_token" not in stored and "tvly-secret" not in stored
    assert len(list(tmp_path.rglob("*.json"))) == 2  # the 503 was not recorded


def test_request_key_ignores_credentials_in_body():
    a = httpx.Request("POST", "https://api.tavily.com/search", json={"api_key": "one", "query": "x"})
    b = httpx.Request("POST", "https://api.tavily.com/search", json={"api_key": "two", "query": "x"})
    c = httpx.Request("POST", "https://api.tavily.com/search", json={"api_key": "one", "query": "y"})
    assert request_key(a) == request_key(b) != request_key(c)


BRIEF = {
    "id": "b", "domain": "d", "title": "t", "brief": "x",
    "labels": {
        "requirements": [
            {"name": "r1", "solutions": [{"repo": "Org/Essential-One", "rating": "essential"}, {"repo": "org/ok", "rating": "acceptable"}]},
            {"name": "r2", "solutions": [{"repo": "org/essential-two", "rating": "essential"}]},
        ],
        "products": [{"repo": "org/product", "rating": "essential"}],
        "traps": [{"repo": "org/trap", "reason": "archived"}],
    },
}


def test_scores_match_case_insensitively_and_count_traps():
    ranked = ["org/essential-one", "org/noise", "org/trap", "org/ok"] + [f"org/n{i}" for i in range(10)] + ["org/product"]
    s = score_brief(BRIEF, ranked, shortlisted=["org/essential-one", "org/trap", "org/unknown"])
    assert s["essentialTotal"] == 3
    assert s["recallAt10"] == pytest.approx(1 / 3, abs=1e-4)
    assert s["recallAll"] == pytest.approx(2 / 3, abs=1e-4)
    assert s["missedEssential"] == ["org/essential-two", "org/product"]
    assert s["shortlistPrecision"] == pytest.approx(1 / 3, abs=1e-4)
    assert s["shortlistUnlabelled"] == ["org/unknown"]
    assert s["trapRejection"] == 0.0 and s["trapsShortlisted"] == ["org/trap"]
    assert aggregate([s, {**s, "recallAt10": None}])["recallAt10"] == pytest.approx(1 / 3, abs=1e-4)


def test_b0_helpers():
    assert repo_from_url("https://github.com/CesiumGS/cesium/tree/main") == "CesiumGS/cesium"
    assert repo_from_url("https://github.com/topics/satellite") is None
    assert repo_from_url("https://example.com/a/b") is None
    assert repo_from_url("https://github.com/advisories/GHSA-f96f-54rq-c385") is None
    assert interleave(["a/1", "a/2"], ["b/1", "A/1"], limit=3) == ["a/1", "b/1", "a/2"]
    assert title_terms("Satellite tracker web app") == "satellite tracker web app"


def test_suite_v1_loads_and_meets_its_own_rules():
    suite = load_suite("eval/suite-v1")
    briefs = suite["briefs"]
    assert len(briefs) == 15 and len({b["domain"] for b in briefs}) == 5
    assert sum(b["outsideTeamExpertise"] for b in briefs) / len(briefs) >= 0.3
    for b in briefs:
        assert all(t.get("reason") for t in b["labels"]["traps"]), b["id"]
        assert any(r["solutions"] for r in b["labels"]["requirements"]), b["id"]


def test_report_shows_mean_and_range():
    def run(system, recall):
        return {"suite": "suite-v1", "labelsStatus": "draft", "system": system, "mode": "replay", "runId": f"{system}-{recall}",
                "commit": "abc", "model": "m", "tuningVersion": None, "snapshot": {"recorded": 0, "replayed": 5},
                "aggregate": {"recallAt10": recall, "recallAll": recall, "shortlistPrecision": 0.5, "trapRejection": 1.0,
                              "llmCalls": 1, "inputTokens": 10, "outputTokens": 5, "costCents": None, "meanDurationMs": 2000, "errors": 0},
                "briefs": [{"briefId": "x", "scores": {"recallAt10": recall, "missedEssential": ["org/a"]}}]}
    text = build([run("b1", 0.4), run("b1", 0.6), run("b0", 0.2)])
    assert "| Recall@10 | 0.200 | 0.500 (0.400–0.600) |" in text
    assert "not priced" in text


def test_fill_serves_recorded_and_records_missing(tmp_path):
    seen = {}
    recorder = httpx.Client(transport=RecordingTransport(str(tmp_path), "record", inner=upstream(seen)))
    recorder.get("https://api.github.com/search/repositories", params={"q": "sgp4"})
    calls_after_record = seen["calls"]

    fill = RecordingTransport(str(tmp_path), "fill", inner=upstream(seen))
    client = httpx.Client(transport=fill)
    client.get("https://api.github.com/search/repositories", params={"q": "sgp4"})
    client.get("https://api.github.com/search/repositories", params={"q": "new query"})
    assert seen["calls"] == calls_after_record + 1  # only the new query went to the network
    assert (fill.replayed, fill.fetched, fill.recorded) == (1, 1, 1)
    replay = httpx.Client(transport=RecordingTransport(str(tmp_path), "replay"))
    assert replay.get("https://api.github.com/search/repositories", params={"q": "new query"}).json()["q"] == "new query"



def test_trap_rejection_among_surfaced_traps():
    found_and_kept_out = score_brief(BRIEF, ["org/trap", "org/essential-one"], shortlisted=["org/essential-one"])
    never_found = score_brief(BRIEF, ["org/essential-one"], shortlisted=["org/essential-one"])
    assert found_and_kept_out["trapsSurfaced"] == 1 and found_and_kept_out["trapRejectionSurfaced"] == 1.0
    # Both reject every trap, but only one of them was ever tested by a trap
    assert never_found["trapRejection"] == 1.0 and never_found["trapRejectionSurfaced"] is None
    agg = aggregate([found_and_kept_out, never_found, score_brief(BRIEF, ["org/trap"], shortlisted=["org/trap"])])
    assert (agg["trapsSurfaced"], agg["trapsShortlisted"], agg["trapRejectionSurfaced"]) == (2, 1, 0.5)


# LLM record and replay

class CountingLLM:
    """A stand-in provider: numbered answers, so replay can be told apart from a fresh call."""

    def __init__(self):
        self.calls = 0

    def complete(self, prompt, system=None):
        self.calls += 1
        return f"answer {self.calls} to {prompt}"


def recording_llm(tmp_path, mode, inner):
    from apps.worker.eval.recording import LLMSnapshot, RecordingLLM
    snapshot = LLMSnapshot(str(tmp_path / "llm"), mode)
    return RecordingLLM(inner, snapshot, "mistral", "ministral-8b-latest"), snapshot


def test_llm_record_then_replay_needs_no_provider(tmp_path):
    real = CountingLLM()
    llm, snap = recording_llm(tmp_path, "record", real)
    first = llm.complete("plan queries", "system A")
    assert real.calls == 1 and snap.recorded == 1

    def no_provider():
        raise AssertionError("replay must not create the real provider")

    replay, rsnap = recording_llm(tmp_path, "replay", no_provider)
    assert replay.complete("plan queries", "system A") == first
    assert rsnap.replayed == 1 and rsnap.fetched == 0
    # extract_structured goes through complete, so it is replayed too
    assert replay.model == "ministral-8b-latest"


def test_llm_repeated_prompts_replay_each_recorded_answer_in_order(tmp_path):
    llm, _ = recording_llm(tmp_path, "record", CountingLLM())
    answers = [llm.complete("same"), llm.complete("same")]
    assert answers[0] != answers[1]
    replay, _ = recording_llm(tmp_path, "replay", CountingLLM())
    assert [replay.complete("same"), replay.complete("same")] == answers
    from apps.worker.eval.recording import ReplayMiss
    with pytest.raises(ReplayMiss, match="occurrence 3"):
        replay.complete("same")


def test_llm_replay_misses_a_changed_prompt_system_or_model(tmp_path):
    from apps.worker.eval.recording import LLMSnapshot, RecordingLLM, ReplayMiss
    llm, _ = recording_llm(tmp_path, "record", CountingLLM())
    llm.complete("prompt", "system")
    replay, _ = recording_llm(tmp_path, "replay", CountingLLM())
    for prompt, system in (("prompt!", "system"), ("prompt", "other system")):
        with pytest.raises(ReplayMiss):
            replay.complete(prompt, system)
    other_model = RecordingLLM(CountingLLM(), LLMSnapshot(str(tmp_path / "llm"), "replay"), "mistral", "mistral-large-latest")
    with pytest.raises(ReplayMiss):
        other_model.complete("prompt", "system")


def test_llm_fill_serves_recorded_and_fetches_only_missing(tmp_path):
    llm, _ = recording_llm(tmp_path, "record", CountingLLM())
    recorded = llm.complete("known")
    real = CountingLLM()
    fill, snap = recording_llm(tmp_path, "fill", real)
    assert fill.complete("known") == recorded
    fresh = fill.complete("new")
    assert real.calls == 1 and snap.replayed == 1 and snap.recorded == 1
    replay, _ = recording_llm(tmp_path, "replay", CountingLLM())
    assert replay.complete("new") == fresh


def test_llm_snapshots_store_no_prompt_text_and_skip_failures(tmp_path):
    from apps.worker.eval.recording import ReplayMiss

    class Failing:
        def complete(self, prompt, system=None):
            raise RuntimeError("LLM_UNAVAILABLE: provider down")

    llm, snap = recording_llm(tmp_path, "record", Failing())
    with pytest.raises(RuntimeError):
        llm.complete("secret-looking prompt text")
    assert snap.recorded == 0 and not list((tmp_path / "llm").rglob("*.json"))
    replay, _ = recording_llm(tmp_path, "replay", CountingLLM())
    with pytest.raises(ReplayMiss):
        replay.complete("secret-looking prompt text")
    ok, _ = recording_llm(tmp_path, "record", CountingLLM())
    ok.complete("secret-looking prompt text")
    [stored] = list((tmp_path / "llm").rglob("*.json"))
    text = stored.read_text()
    assert "secret-looking prompt text" not in text.split('"responses"')[0]  # only the answer is kept, not the prompt
