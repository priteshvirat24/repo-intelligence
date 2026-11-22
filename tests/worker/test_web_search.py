"""Open-web (S4) and papers search: pages and papers nominate GitHub repositories (discovery/web_search.py)."""
import httpx

from apps.worker.discovery.planner import OVERALL
from apps.worker.discovery.runner import DiscoveryRunner
from apps.worker.discovery.web_search import WebSearch, needs_papers, repositories_in
from apps.worker.tuning import default_tuning

from tests.worker.test_discovery import ScriptedLLM
from tests.worker.test_discovery_breadth import RegistryGitHub, connectors_for, fresh

ON = default_tuning().with_overrides({"discovery.web_search": True})

ORBIT_BRIEF = {
    "problemSummary": "Satellite tracker web app showing live positions",
    "requirements": [
        {"name": "Orbit propagation", "description": "SGP4 algorithm from TLE data", "criticality": "MUST"},
        {"name": "Globe rendering", "description": "3D globe in the browser", "criticality": "MUST"},
        {"name": "Pass alerts", "description": "Notify before a pass", "criticality": "SHOULD"},
    ],
}

ARXIV_FEED = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/2101.00001v1</id>
    <title>Fast SGP4 orbit propagation</title>
    <summary>We present a faster propagator. Code is available at https://github.com/orbits/fast-sgp4.</summary>
    <author><name>A. Author</name></author>
  </entry>
</feed>"""


def test_repositories_are_read_from_page_urls_and_text():
    text = ("See https://github.com/CesiumGS/cesium and github.com/cesiumgs/cesium/tree/main, "
            "https://github.com/topics/webgl, https://github.com/shashwatak/satellite-js.git and https://github.com/sponsors/x")
    assert repositories_in(text) == ["CesiumGS/cesium", "shashwatak/satellite-js"]
    assert needs_papers("SGP4 algorithm") and not needs_papers("Globe rendering in the browser")


def test_web_search_is_off_by_default():
    web = WebSearch(None, None, ORBIT_BRIEF)  # the default tuning: no connector is ever called
    assert web.plan([], set()) == [] and web.search([], set(), {}) == [] and web.metrics() is None


def test_plan_covers_the_product_uncovered_musts_and_papers():
    web = WebSearch(None, None, ORBIT_BRIEF, ON)
    plan = web.plan([], covered={"Globe rendering"})
    assert ("web", {"query": "open source Satellite tracker web showing live positions alternatives", "requirement": OVERALL}) in plan
    assert ("web", {"query": "open source Orbit propagation library", "requirement": "Orbit propagation"}) in plan
    assert all(q["requirement"] != "Globe rendering" for _, q in plan)  # covered: no web search for it
    assert all(q["requirement"] != "Pass alerts" or s == "arxiv" for s, q in plan)  # SHOULD: no S4 query
    assert ("arxiv", {"query": "Orbit propagation", "requirement": "Orbit propagation"}) in plan
    capped = WebSearch(None, None, ORBIT_BRIEF, ON.with_overrides({"discovery.web_max_queries": 2})).plan([], set())
    assert len(capped) == 2 and capped[-1][0] == "arxiv"  # the papers route keeps its place under the cap


def test_pages_and_papers_nominate_candidates_that_merge_with_github(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    cesium = fresh("CesiumGS/cesium", stars=13000, description="3D globes and maps in the browser")
    satjs = fresh("shashwatak/satellite-js", stars=900, description="SGP4/SDP4 propagation in JavaScript")
    fast = fresh("orbits/fast-sgp4", stars=120, description="Fast SGP4 propagator")
    tavily_pages = {"results": [
        {"url": "https://example.com/best-satellite-libraries", "title": "Best satellite libraries",
         "content": "Use https://github.com/shashwatak/satellite-js for SGP4 and https://github.com/CesiumGS/cesium for the globe."},
    ]}
    connectors, recorder = connectors_for({
        "POST api.tavily.com/search": (200, tavily_pages),
        "GET export.arxiv.org/api/query": (200, ARXIV_FEED),
    })
    # The fake planner searches the requirement names
    github = RegistryGitHub({"Globe rendering": [cesium]}, {"shashwatak/satellite-js": satjs, "orbits/fast-sgp4": fast})
    llm = ScriptedLLM()
    web = WebSearch(connectors, github, ORBIT_BRIEF, ON)
    result = DiscoveryRunner(llm, github, sleep=lambda s: None, tuning=ON, web_search=web).run(ORBIT_BRIEF)

    by_name = {c["full_name"]: c for c in result["candidates"]}
    assert by_name["CesiumGS/cesium"]["sources"] == ["github", "web"]  # found by both, merged once
    assert by_name["shashwatak/satellite-js"]["sources"] == ["web"]  # never found by GitHub search: not labelled github
    assert by_name["orbits/fast-sgp4"]["sources"] == ["arxiv"]
    assert "Orbit propagation" in by_name["orbits/fast-sgp4"]["matched_requirements"]
    assert sorted(github.fetched) == ["orbits/fast-sgp4", "shashwatak/satellite-js"]  # cesium was known: no request
    metrics = result["metrics"]["web"]
    assert metrics["nominations"]["orbits/fast-sgp4"][0]["url"] == "https://arxiv.org/abs/2101.00001v1"
    assert {s["source"] for s in metrics["searched"]} == {"web", "arxiv"}
    assert recorder.requests[0].headers["authorization"] == "Bearer tvly-test"


def test_missing_tavily_key_is_recorded_and_papers_still_run(monkeypatch):
    monkeypatch.delenv("TAVILY_API_KEY", raising=False)
    fast = fresh("orbits/fast-sgp4", stars=120)
    connectors, _ = connectors_for({"GET export.arxiv.org/api/query": (200, ARXIV_FEED)})
    github = RegistryGitHub({}, {"orbits/fast-sgp4": fast})
    web = WebSearch(connectors, github, ORBIT_BRIEF, ON)
    results = web.search([], set(), {})
    assert any("TAVILY_API_KEY" in u for u in web.unavailable)
    assert [i["full_name"] for _, items in results for i in items] == ["orbits/fast-sgp4"]


def test_new_repositories_from_pages_are_capped(monkeypatch):
    monkeypatch.setenv("TAVILY_API_KEY", "tvly-test")
    links = " ".join(f"https://github.com/o/r{i}" for i in range(10))
    connectors, _ = connectors_for({"POST api.tavily.com/search": (200, {"results": [{"url": "https://x.dev", "title": "t", "content": links}]}),
                                    "GET export.arxiv.org/api/query": (200, "<feed xmlns='http://www.w3.org/2005/Atom'/>")})
    github = RegistryGitHub({}, {f"o/r{i}": fresh(f"o/r{i}") for i in range(10)})
    web = WebSearch(connectors, github, ORBIT_BRIEF, ON.with_overrides({"discovery.web_max_new_repos": 3}))
    web.search([], set(), {})
    assert len(github.fetched) == 3


def test_switching_web_search_on_is_an_l2_change():
    from apps.worker.tuning import Tuning
    assert Tuning.level("discovery.web_search") == "L2"
    assert Tuning.level("discovery.web_max_queries") == "L1"
    assert default_tuning().get("discovery.web_search") is False
