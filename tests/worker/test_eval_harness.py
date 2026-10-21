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
