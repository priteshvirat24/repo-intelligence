import json
from datetime import datetime, timezone
from typing import Optional

import pytest

from apps.worker.discovery.blueprint import build_sources, generate_blueprint, validate_blueprint
from apps.worker.discovery.verification import select_verification_targets
from apps.worker.providers.llm import BaseLLMProvider

NOW = datetime(2026, 10, 21, tzinfo=timezone.utc)

REQUIREMENTS = {
    "problemSummary": "Live satellite tracker on a 3D globe",
    "requirements": [
        {"name": "Orbit propagation", "description": "SGP4 from TLEs", "criticality": "MUST", "type": "functional"},
        {"name": "Globe rendering", "description": "WebGL globe", "criticality": "MUST", "type": "functional"},
        {"name": "Ground tracks", "description": "Track lines", "criticality": "SHOULD", "type": "functional"},
        {"name": "Backend in Python", "description": "Python service", "criticality": "MUST", "type": "deployment"},
    ],
}


def candidate(full_name, license="MIT", pushed_at="2026-09-01 00:00:00+00", coverage=None):
    return {
        "full_name": full_name, "source_url": f"https://github.com/{full_name}", "description": f"{full_name} description",
        "primary_language": "TypeScript", "stars": 1000, "license": license, "pushed_at": pushed_at,
        "candidate_kind": "library", "coverage_score": 0.5, "rank": 1,
        "assessment_json": {"summary": f"{full_name} summary", "coverage": coverage or {}},
    }


def verified(full_name, capabilities, limitations=None, status="READY"):
    owner, name = full_name.split("/")
    return {
        "fullName": full_name, "state": "queued", "repositoryId": "00000000-0000-0000-0000-000000000001",
        "repository": {"owner": owner, "name": name, "url": f"https://github.com/{full_name}", "status": status,
                       "latest_commit_hash": "abc123", "purpose": "Does things", "analysis_completeness": {"level": "full"},
                       "error_message": None if status == "READY" else "REPOSITORY_TOO_LARGE"},
        "capabilities": capabilities, "limitations": limitations or [], "dependencies": [{"package_name": "three", "ecosystem": "npm"}],
    }


def inputs():
    return {
        "title": "Satellite tracker",
        "requirements": REQUIREMENTS,
        "candidates": [
            candidate("shashwatak/satellite-js", coverage={"Orbit propagation": "yes"}),
            candidate("vasturiano/globe.gl", coverage={"Globe rendering": "yes"}),
            candidate("old/unlicensed", license=None, pushed_at="2019-01-01 00:00:00+00", coverage={"Ground tracks": "partial"}),
        ],
        "verification": [
            verified("shashwatak/satellite-js", [
                {"name": "SGP4 propagation", "description": "Propagates TLEs", "file_path": "src/propagation/sgp4.js",
                 "start_line": 10, "end_line": 40, "symbol_name": "sgp4", "quote_snippet": "export function sgp4(satrec, tsince) {"},
            ], limitations=[{"category": "precision", "description": "No SDP4 deep-space corrections", "file_path": None}]),
            {"fullName": "vasturiano/globe.gl", "state": "skipped", "reason": "REPOSITORY_TOO_LARGE: 300MB",
             "repository": None, "capabilities": [], "limitations": [], "dependencies": []},
        ],
    }


class ScriptedLLM(BaseLLMProvider):
    def __init__(self, response):
        self.response = response
        self.prompts = []

    def complete(self, prompt: str, system: Optional[str] = None) -> str:
        self.prompts.append(prompt)
        return json.dumps(self.response)


def test_sources_number_code_limitations_then_readmes_with_line_links():
    sources = build_sources(inputs())
    assert [s["id"] for s in sources] == ["C1", "L1", "R1", "R2", "R3"]
    code = sources[0]
    assert code["kind"] == "code" and code["repo"] == "shashwatak/satellite-js"
    assert code["url"] == "https://github.com/shashwatak/satellite-js/blob/abc123/src/propagation/sgp4.js#L10-L40"
    assert "Orbit propagation (yes)" in sources[2]["text"]


def test_unverified_repositories_contribute_no_code_sources():
    data = inputs()
    data["verification"][0]["repository"]["status"] = "FAILED"
    assert all(s["kind"] != "code" for s in build_sources(data))


def test_validation_keeps_supported_decisions_and_downgrades_unsupported_ones():
    data = inputs()
    sources = build_sources(data)
    raw = {
        "summary": "Use satellite.js for propagation and globe.gl for rendering.",
        "components": [
            {"requirement": "orbit propagation", "decision": "reuse", "repo": "shashwatak/satellite-js", "how": "Call sgp4()", "sources": ["C1", "C99"]},
            {"requirement": "Globe rendering", "decision": "reuse", "repo": "vasturiano/globe.gl", "how": "Use Globe()", "sources": ["R2"]},
            # Cites a source of a different repository: not evidence for this one
            {"requirement": "Ground tracks", "decision": "adapt", "repo": "old/unlicensed", "how": "Extend it", "sources": ["C1"]},
            {"requirement": "Invented requirement", "decision": "reuse", "repo": "x/y", "sources": ["C1"]},
        ],
        "integrationSteps": [{"title": "Propagate in a web worker", "detail": "Run sgp4 per tick", "sources": ["C1", "bogus"]}],
        "toBuild": [{"title": "TLE refresh service", "detail": "Fetch CelesTrak daily", "requirements": ["Backend in Python"]}],
        "risks": [{"title": "Precision", "detail": "No deep-space corrections", "sources": ["L1"]}],
    }
    bp = validate_blueprint(raw, data, sources, NOW)
    by_req = {c["requirement"]: c for c in bp["components"]}

    assert by_req["Orbit propagation"]["decision"] == "reuse"
    assert by_req["Orbit propagation"]["evidence"] == "verified"
    assert by_req["Orbit propagation"]["sources"] == ["C1"]
    # README-only support is not enough for reuse (PRODUCT_DEFINITION 5.4): investigate further
    assert by_req["Globe rendering"]["decision"] == "investigate"
    assert by_req["Globe rendering"]["evidence"] == "unconfirmed"
    assert by_req["Globe rendering"]["how"].startswith("Not confirmed in vasturiano/globe.gl's code")
    assert by_req["Ground tracks"]["decision"] == "build" and by_req["Ground tracks"]["repo"] is None
    assert by_req["Ground tracks"]["how"].startswith("No cited evidence that old/unlicensed")
    # Every requirement gets exactly one decision, in requirement order (MUST first)
    assert [c["requirement"] for c in bp["components"]] == ["Orbit propagation", "Globe rendering", "Backend in Python", "Ground tracks"]
    assert by_req["Backend in Python"]["decision"] == "build" and by_req["Backend in Python"]["isConstraint"]

    assert bp["integrationSteps"][0]["sources"] == ["C1"]
    # Uncovered capabilities are added to the build list; constraints are not
    built = {name for item in bp["toBuild"] for name in item["requirements"]}
    assert "Ground tracks" in built
    assert bp["toBuild"][0]["requirements"] == ["Backend in Python"]


def test_data_risks_flag_licence_staleness_and_missing_verification():
    data = inputs()
    sources = build_sources(data)
    raw = {"components": [
        {"requirement": "Globe rendering", "decision": "reuse", "repo": "vasturiano/globe.gl", "sources": ["R2"]},
        {"requirement": "Ground tracks", "decision": "adapt", "repo": "old/unlicensed", "sources": ["R3"]},
    ]}
    titles = [r["title"] for r in validate_blueprint(raw, data, sources, NOW)["risks"]]
    assert "Not code-verified: vasturiano/globe.gl" in titles
    assert "No licence: old/unlicensed" in titles
    assert "Unmaintained: old/unlicensed" in titles
    # satellite-js is not relied on in this blueprint, so it gets no risk entries
    assert not any("satellite-js" in t for t in titles)


def test_verification_summary_reports_each_repository():
    bp = validate_blueprint({}, inputs(), build_sources(inputs()), NOW)
    assert bp["verification"] == [
        {"fullName": "shashwatak/satellite-js", "status": "verified", "capabilities": 1, "reason": None,
         "repositoryId": "00000000-0000-0000-0000-000000000001"},
        {"fullName": "vasturiano/globe.gl", "status": "skipped", "capabilities": 0, "reason": "REPOSITORY_TOO_LARGE: 300MB", "repositoryId": None},
    ]


def test_generate_wraps_sources_as_untrusted_and_lists_constraints():
    llm = ScriptedLLM({"summary": "s", "components": []})
    generate_blueprint(llm, inputs(), NOW)
    prompt = llm.prompts[0]
    assert prompt.index("<untrusted_repository_content>") < prompt.index("[C1]") < prompt.index("</untrusted_repository_content>")
    assert "[MUST constraint] Backend in Python" in prompt
    assert "vasturiano/globe.gl (TypeScript, 1000 stars, licence MIT, not verified (could not be indexed))" in prompt


class FakeWorkerGitHub:
    def __init__(self, failing=()):
        self.failing = set(failing)
        self.calls = []

    def fetch_repo_info(self, owner, repo):
        self.calls.append(f"{owner}/{repo}")
        if f"{owner}/{repo}" in self.failing:
            raise ValueError("REPOSITORY_TOO_LARGE: Size 400MB exceeds limit of 100MB.")
        return {"owner": owner, "name": repo, "default_branch": "main", "stars": 10, "license": "MIT", "primary_language": "Go", "size_kb": 10}


def test_verification_targets_skip_unindexable_and_fill_up_to_the_limit():
    candidates = [
        {"full_name": "A/Big", "shortlisted": True},
        {"full_name": "b/one", "shortlisted": True},
        {"full_name": "c/not-shortlisted", "shortlisted": False},
        {"full_name": "d/two", "shortlisted": True},
        {"full_name": "e/three", "shortlisted": True},
    ]
    github = FakeWorkerGitHub(failing={"A/Big"})
    targets = select_verification_targets(candidates, github, limit=2)
    assert github.calls == ["A/Big", "b/one", "d/two"]
    assert targets[0]["state"] == "skipped" and "REPOSITORY_TOO_LARGE" in targets[0]["reason"]
    assert targets[0]["url"] == "https://github.com/a/big"
    assert [t["fullName"] for t in targets if "meta" in t] == ["b/one", "d/two"]


def test_code_evidence_about_another_capability_does_not_verify_a_requirement():
    data = inputs()
    sources = build_sources(data)
    # C1 is "SGP4 propagation": real code from satellite-js, but not about ground tracks
    raw = {"components": [{"requirement": "Ground tracks", "decision": "reuse", "repo": "shashwatak/satellite-js", "sources": ["C1"]}]}
    component = next(c for c in validate_blueprint(raw, data, sources, NOW)["components"] if c["requirement"] == "Ground tracks")
    assert (component["decision"], component["evidence"]) == ("investigate", "unconfirmed")


def test_relevance_ignores_function_words_and_matches_word_stems():
    from apps.worker.discovery.blueprint import is_about
    assert not is_about({"title": "Customizable Satellite Catalogs and Groups"}, {"name": "User Interaction and Selection"})
    assert is_about({"title": "Geodetic Coordinate Transformations"}, {"name": "Coordinate Transformation from ECI to Geodetic"})
    assert is_about({"title": "High-Speed SGP4/SDP4 Propagation"}, {"name": "Real-Time Satellite Position Propagation"})
    assert not is_about({"title": "Real-Time Satellite Visualization on 3D Globe"}, {"name": "Ground Track Visualization"})
