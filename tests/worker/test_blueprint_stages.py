"""Phase 3: the staged blueprint (SYSTEM_DESIGN 7). Each stage's validator against hand-written model output,
then the whole generator against a scripted fake LLM."""
import copy
import json
from typing import Optional

import pytest

from apps.worker.discovery import blueprint_report as report
from apps.worker.discovery import blueprint_stages as stages
from apps.worker.discovery.blueprint import build_sources, generate_blueprint
from apps.worker.discovery.blueprint_evidence import BlueprintContext, licence_check
from apps.worker.discovery.planner import _user_prompt, heuristic_queries, plan_queries
from apps.worker.orchestrator.handlers import TaskContext, fingerprint
from apps.worker.providers.llm import BaseLLMProvider
from apps.worker.tuning import default_tuning
from tests.worker.test_blueprint import NOW, candidate, verified

SAT, GLOBE, OLD, GPL = "shashwatak/satellite-js", "vasturiano/globe.gl", "old/unlicensed", "gnu/orbit-tools"

REQUIREMENTS = {
    "problemSummary": "Live satellite tracker on a 3D globe",
    "requirements": [
        {"name": "Orbit propagation", "description": "SGP4 from TLEs", "criticality": "MUST", "type": "functional"},
        {"name": "Globe rendering", "description": "WebGL globe", "criticality": "MUST", "type": "functional"},
        {"name": "Ground tracks", "description": "Track lines", "criticality": "SHOULD", "type": "functional"},
        {"name": "Pass prediction", "description": "When a satellite is overhead", "criticality": "SHOULD", "type": "functional"},
        {"name": "Backend in Python", "description": "Python service", "criticality": "MUST", "type": "deployment"},
    ],
}


def data(policy=None, challenges=None, previous=None):
    """satellite-js is verified with code about propagation and ground tracks; globe.gl is README-only; an
    unlicensed and a GPL repository complete the shortlist."""
    gpl = candidate(GPL, license="GPL-3.0", coverage={"Pass prediction": "yes"})
    sat_verified = verified(SAT, [
        {"name": "SGP4 propagation", "description": "Propagates TLEs", "file_path": "src/propagation/sgp4.js",
         "start_line": 10, "end_line": 40, "symbol_name": "sgp4", "quote_snippet": "export function sgp4(satrec, tsince) { // v4.1.4"},
        {"name": "Ground track computation", "description": "Geodetic track points", "file_path": "src/transforms.js",
         "start_line": 5, "end_line": 30, "symbol_name": "eciToGeodetic", "quote_snippet": "export function eciToGeodetic(eci, gmst) {"},
    ], limitations=[{"category": "precision", "description": "No SDP4 deep-space corrections", "file_path": None}])
    gpl_verified = verified(GPL, [
        {"name": "Pass prediction engine", "description": "Finds passes over an observer", "file_path": "passes.py",
         "start_line": 1, "end_line": 50, "symbol_name": "find_passes", "quote_snippet": "def find_passes(observer, tle):"},
    ])
    gpl_verified["repositoryId"] = "00000000-0000-0000-0000-000000000002"
    return {
        "title": "Satellite tracker",
        "requirements": REQUIREMENTS,
        "candidates": [
            candidate(SAT, coverage={"Orbit propagation": "yes", "Globe rendering": "no"}),
            candidate(GLOBE, coverage={"Globe rendering": "yes"}),
            candidate(OLD, license=None, pushed_at="2019-01-01 00:00:00+00", coverage={"Ground tracks": "partial"}),
            gpl,
        ],
        "verification": [
            sat_verified,
            {"fullName": GLOBE, "state": "skipped", "reason": "REPOSITORY_TOO_LARGE: 300MB", "repository": None, "capabilities": [], "limitations": [], "dependencies": []},
            gpl_verified,
        ],
        "constraints": {"licencePolicy": policy} if policy else {},
        "challenges": challenges or [],
        "discoveryQueries": [{"query": "pass prediction python", "requirement": "Pass prediction", "results": 3},
                             {"query": "satellite tracker", "requirement": "(overall)", "results": 9}],
        "acceptanceCriteria": ["The ISS position is within 1 km of the reference"],
        "previous": previous or {},
    }


def context(d=None):
    d = d or data()
    return BlueprintContext.build(d, build_sources(d), NOW)


def ids(ctx, repo, kind):
    return [s["id"] for s in ctx.sources if s["repo"] == repo and s["kind"] == kind]


# Sources: C1 SGP4 propagation, C2 Ground track computation (satellite-js), L1 (satellite-js), C3 Pass prediction
# engine (orbit-tools), then R1..R4 README assessments in candidate order.

def test_source_numbering_for_the_fixture():
    ctx = context()
    assert [s["id"] for s in ctx.sources] == ["C1", "C2", "L1", "C3", "R1", "R2", "R3", "R4"]
    assert ctx.known["C3"]["repo"] == GPL and ctx.known["R2"]["repo"] == GLOBE


# 1. Classify

def classify(ctx, *items):
    return stages.validate_classification(list(items), ctx)


def test_classes_one_to_three_need_relevant_strong_evidence_from_the_named_repository():
    ctx = context()
    out = classify(
        ctx,
        {"requirement": "Orbit propagation", "class": 1, "repo": SAT, "sources": ["C1"], "reason": "sgp4()"},
        # README only: unresolved, with what would resolve it
        {"requirement": "Globe rendering", "class": 2, "repo": GLOBE, "sources": ["R2"], "setup": "Mount the globe"},
        # Code from the right repository, but about propagation, not ground tracks
        {"requirement": "Ground tracks", "class": 3, "repo": SAT, "sources": ["C1"], "change": "Draw lines"},
        # Cites another repository's code: nothing from the named one, so build
        {"requirement": "Pass prediction", "class": 1, "repo": SAT, "sources": ["C3"]},
    )
    assert (out["Orbit propagation"]["class"], out["Orbit propagation"]["decision"], out["Orbit propagation"]["evidence"]) == (1, "reuse", "verified")
    assert out["Orbit propagation"]["evidenceGrades"] == ["E2"]
    globe = out["Globe rendering"]
    assert (globe["class"], globe["decision"], globe["evidence"]) == (6, "investigate", "unconfirmed")
    assert globe["reason"].startswith(f"Not confirmed in {GLOBE}'s code") and GLOBE in globe["resolveBy"]
    assert (out["Ground tracks"]["class"], out["Ground tracks"]["decision"]) == (6, "investigate")
    passes = out["Pass prediction"]
    # ...and since another candidate's README claims coverage, it is unresolved rather than "must be built"
    assert passes["class"] == 6 and passes["repo"] == GPL and "README of gnu/orbit-tools claims" in passes["reason"]


def test_documentation_only_support_is_class_two_and_setup_free_code_support_class_one():
    ctx = context()
    ctx.known["C1"]["grade"] = "E3"
    out = classify(ctx, {"requirement": "Orbit propagation", "class": 1, "repo": SAT, "sources": ["C1"]},
                   {"requirement": "Ground tracks", "class": 2, "repo": SAT, "sources": ["C2"]})
    assert out["Orbit propagation"]["class"] == 2
    assert out["Ground tracks"]["class"] == 1  # E2 code, and no configuration named


def test_modification_and_partial_coverage_must_name_the_change_and_the_gap():
    ctx = context()
    out = classify(ctx, {"requirement": "Ground tracks", "class": 3, "repo": SAT, "sources": ["C2"], "change": "Add antimeridian splitting"},
                   {"requirement": "Orbit propagation", "class": 3, "repo": SAT, "sources": ["C1"]},
                   {"requirement": "Globe rendering", "class": 4, "repo": GLOBE, "sources": ["R2"], "uncovered": "Night-side shading"},
                   {"requirement": "Pass prediction", "class": 4, "repo": GPL, "sources": ["C3"]})
    assert (out["Ground tracks"]["class"], out["Ground tracks"]["decision"], out["Ground tracks"]["change"]) == (3, "adapt", "Add antimeridian splitting")
    assert out["Orbit propagation"]["class"] == 6 and "modification was not identified" in out["Orbit propagation"]["reason"]
    # Class 4 may rest on README evidence, but then it is investigated, not adapted
    assert (out["Globe rendering"]["class"], out["Globe rendering"]["decision"]) == (4, "investigate")
    assert out["Pass prediction"]["class"] == 6 and "uncovered" not in out["Pass prediction"]


def test_unclassified_requirements_fall_back_to_the_evidence_and_build_records_the_search():
    ctx = context()
    out = classify(ctx, {"requirement": "Pass prediction", "class": 5, "reason": "x"})
    # Related code exists, but nobody judged it: unresolved, never reuse
    assert (out["Ground tracks"]["class"], out["Ground tracks"]["repo"], out["Ground tracks"]["generated"]) == (6, SAT, True)
    assert out["Backend in Python"]["class"] == 5 and out["Backend in Python"]["searched"] == []
    # Class 5 while a README claims coverage is unresolved
    assert out["Pass prediction"]["class"] == 6
    d = data()
    d["candidates"][3]["assessment_json"]["coverage"] = {}
    out = classify(context(d), {"requirement": "Pass prediction", "class": 5})
    assert out["Pass prediction"]["class"] == 5 and out["Pass prediction"]["searched"] == ["pass prediction python"]


def test_single_call_decisions_map_onto_classes():
    out = classify(context(), {"requirement": "Ground tracks", "decision": "adapt", "repo": SAT, "sources": ["C2"], "how": "Split at the antimeridian"},
                   {"requirement": "Orbit propagation", "decision": "reuse", "repo": SAT, "sources": ["C1"]})
    assert (out["Ground tracks"]["class"], out["Ground tracks"]["decision"]) == (3, "adapt")
    assert (out["Orbit propagation"]["class"], out["Orbit propagation"]["decision"]) == (1, "reuse")


# 2. Inventory and licence policy

@pytest.mark.parametrize("licence,policy,status", [
    ("MIT", "permissive-only", "compatible"),
    ("GPL-3.0", "permissive-only", "conflict"),
    ("GPL-3.0", "copyleft-flagged", "flagged"),
    ("LGPL-2.1", "any", "compatible"),
    (None, "any", "missing"),
    ("NOASSERTION", "copyleft-flagged", "missing"),
    ("Custom-1.0", "any", "unknown"),
])
def test_licence_against_policy(licence, policy, status):
    assert licence_check(licence, policy)["status"] == status


def _classified(ctx):
    return classify(ctx, {"requirement": "Orbit propagation", "class": 1, "repo": SAT, "sources": ["C1"]},
                    {"requirement": "Pass prediction", "class": 1, "repo": GPL, "sources": ["C3"]},
                    {"requirement": "Globe rendering", "class": 6, "repo": GLOBE, "sources": ["R2"]})


def test_inventory_lists_every_candidate_with_cited_capabilities_and_modules():
    ctx = context()
    comps = _classified(ctx)
    raw = [
        # C3 belongs to another repository: dropped from satellite-js's capabilities
        {"repo": SAT, "capabilities": ["C1", "C3", "C99"], "action": "reject", "reason": "x"},
        {"repo": GLOBE, "capabilities": ["R2"], "action": "reuse", "reason": "Popular"},
    ]
    inv = {e["repo"]: e for e in stages.validate_inventory(raw, ctx, comps)}
    assert set(inv) == {SAT, GLOBE, OLD, GPL}
    sat = inv[SAT]
    assert sat["capabilities"][0] == "C1" and "C3" not in sat["capabilities"]
    assert sat["modules"][0]["filePath"] == "src/propagation/sgp4.js" and sat["modules"][0]["source"] == "C1"
    # The classification relies on it with code evidence: the model's "reject" is overruled
    assert sat["action"] == "reuse" and sat["reason"].startswith("Set from the build-versus-reuse analysis")
    assert sat["version"]["commit"] == "abc123" and sat["limitations"] == ["L1"]
    assert sat["missing"] == ["Globe rendering"]
    # README-only: reuse is not allowed without code or documentation evidence
    assert inv[GLOBE]["action"] == "investigate" and inv[GLOBE]["verification"] == "skipped"
    assert inv[GLOBE]["version"]["commit"] is None
    # Unlicensed and unused: still listed, rejected or investigated with a reason
    assert inv[OLD]["action"] in ("investigate", "reject") and inv[OLD]["reason"]
    assert inv[OLD]["licence"]["status"] == "missing" and inv[OLD]["maintenance"]["risk"] == "high"


def test_permissive_only_policy_rejects_copyleft_and_unresolves_what_relied_on_it():
    ctx = context(data(policy="permissive-only"))
    comps = _classified(ctx)
    inventory = stages.validate_inventory([{"repo": GPL, "capabilities": ["C3"], "action": "reuse", "reason": "Does passes"}], ctx, comps)
    stages.apply_licence_policy(comps, inventory)
    gpl = next(e for e in inventory if e["repo"] == GPL)
    assert gpl["action"] == "reject" and gpl["reason"].startswith("Licence conflict")
    assert (comps["Pass prediction"]["class"], comps["Pass prediction"]["decision"]) == (6, "investigate")
    assert "licence" in comps["Pass prediction"]["resolveBy"].lower()
    assert comps["Orbit propagation"]["class"] == 1


def test_copyleft_flagged_policy_keeps_the_action_and_asks_a_person():
    ctx = context()
    comps = _classified(ctx)
    inventory = stages.validate_inventory([], ctx, comps)
    stages.apply_licence_policy(comps, inventory)
    gpl = next(e for e in inventory if e["repo"] == GPL)
    assert gpl["licence"]["status"] == "flagged" and gpl["action"] == "reuse" and gpl["generated"]
    arch = stages.validate_architecture({}, ctx, comps, inventory)
    unc = report.uncertainty_report(ctx, comps, inventory, arch, [], [], {})
    assert any(d["title"] == f"Licence of {GPL}" for d in unc["humanDecisions"])


# 3. Architecture

def test_architecture_maps_reuse_to_inventory_and_every_requirement_to_a_component():
    ctx = context()
    comps = _classified(ctx)
    inventory = stages.validate_inventory([{"repo": OLD, "action": "reject", "reason": "Unlicensed and stale"}], ctx, comps)
    raw = {
        "components": [
            {"name": "Propagator", "origin": "reused", "repo": SAT, "requirements": ["Orbit propagation"], "sources": ["C1", "C3"]},
            # globe.gl is "investigate" in the inventory: it cannot be a reused component
            {"name": "Globe", "origin": "reused", "repo": GLOBE, "requirements": ["Globe rendering"]},
        ],
        "dataFlows": [{"from": "Propagator", "to": "Globe", "data": "positions"}, {"from": "Propagator", "to": "Nowhere", "data": "x"}],
        "auth": "None needed for public TLE data.",
        "tradeoffs": [{"decision": "Client-side propagation", "reason": "No server cost", "alternatives": ["Server-side"]}],
    }
    arch = stages.validate_architecture(raw, ctx, comps, inventory)
    by_name = {a["name"]: a for a in arch["components"]}
    assert by_name["Propagator"]["origin"] == "reused" and by_name["Propagator"]["sources"] == ["C1"]
    assert by_name["Globe"]["origin"] == "new" and by_name["Globe"]["repo"] is None
    assert by_name["Globe"]["responsibility"].startswith(f"Built new: {GLOBE} is marked investigate")
    mapped = {n for a in arch["components"] for n in a["requirements"]}
    assert mapped == {r["name"] for r in REQUIREMENTS["requirements"]}
    assert [f["to"] for f in arch["dataFlows"]] == ["Globe"]
    assert arch["auth"] and arch["basis"] == "design recommendation"
    # Rejected candidates stay visible as rejected alternatives, with the reason
    assert arch["rejectedAlternatives"] == [{"option": OLD, "reason": "Unlicensed and stale", "generated": True}]


# 4. Integration guide

def test_guide_keeps_env_names_only_versions_only_when_cited_and_marks_every_step_unexecuted():
    ctx = context()
    comps = _classified(ctx)
    inventory = stages.validate_inventory([], ctx, comps)
    raw = [
        {"phase": "configuration", "title": "Set the TLE source", "detail": "Set CELESTRAK_URL=https://celestrak.org/x and API_TOKEN=abc123",
         "envVars": ["CELESTRAK_URL", "api_token=abc", "API_TOKEN"], "sources": []},
        {"phase": "install", "title": "Install satellite.js", "detail": "npm install", "version": "4.1.4", "sources": ["C1", "Z9"],
         "code": "const SECRET_KEY = 'hunter2';\nsgp4(satrec, 0)"},
        {"phase": "install", "title": "Install globe", "version": "2.27.0", "sources": ["R2"]},
    ]
    steps = stages.validate_guide(raw, ctx, inventory)
    assert [s["phase"] for s in steps] == ["install", "install", "configuration"]
    sat, globe, config = steps
    assert sat["version"] == "4.1.4" and sat["sources"] == ["C1"]  # the version is in C1's quoted code
    assert "version" not in globe  # no cited source states it
    assert "hunter2" not in sat["code"] and "SECRET_KEY=<set in the environment>" in sat["code"]
    assert config["envVars"] == ["CELESTRAK_URL", "API_TOKEN"]
    assert config["envVarsProposed"] == ["CELESTRAK_URL", "API_TOKEN"]  # no cited source names them
    assert "abc123" not in config["detail"] and "celestrak.org" not in config["detail"]
    assert all(s["executed"] is False for s in steps)
    assert (config["basis"], sat["basis"]) == ("inferred", "cited")


def test_guide_falls_back_to_installing_reused_repositories_at_the_examined_commit():
    ctx = context()
    comps = _classified(ctx)
    steps = stages.validate_guide("not a list", ctx, stages.validate_inventory([], ctx, comps))
    titles = [s["title"] for s in steps]
    assert f"Add {SAT}" in titles and all(s.get("generated") for s in steps)
    assert "abc123" in steps[titles.index(f"Add {SAT}")]["detail"]


# 5. Roadmap

def test_roadmap_covers_every_non_reused_requirement_and_orders_by_dependency():
    ctx = context()
    comps = classify(ctx, {"requirement": "Orbit propagation", "class": 1, "repo": SAT, "sources": ["C1"]},
                     {"requirement": "Ground tracks", "class": 3, "repo": SAT, "sources": ["C2"], "change": "Split lines"})
    raw = [
        {"title": "Track renderer", "requirements": ["Ground tracks"], "dependsOn": ["TLE service"], "complexity": "M", "uncertainty": "low",
         "acceptanceCriteria": ["Lines wrap at the antimeridian"], "tests": ["Snapshot test of a polar orbit"]},
        {"title": "TLE service", "requirements": ["Backend in Python"], "dependsOn": ["Track renderer"], "complexity": "huge"},
    ]
    tasks = stages.validate_roadmap(raw, ctx, comps)
    by_title = {t["title"]: t for t in tasks}
    covered = {n for t in tasks for n in t["requirements"]}
    non_reused = {c["requirement"] for c in comps.values() if c["decision"] != "reuse"}
    assert non_reused <= covered and "Orbit propagation" not in covered
    # A cycle is cut: one of the two depends on the other, not both
    a, b = by_title["Track renderer"], by_title["TLE service"]
    assert not (a["dependsOn"] and b["dependsOn"])
    assert [t["order"] for t in tasks] == list(range(1, len(tasks) + 1))
    for t in tasks:
        assert t["estimate"] is True and t["complexity"] in ("S", "M", "L") and t["acceptanceCriteria"]
    assert b["complexity"] == "M" and b["estimateBasis"].startswith("default")
    assert b["acceptanceGenerated"] and b["testsGenerated"]
    generated = [t for t in tasks if t.get("generated")]
    assert {"Globe rendering", "Pass prediction"} <= {n for t in generated for n in t["requirements"]}


# 6. Uncertainty, challenges, changes, executive

def test_uncertainty_report_is_generated_from_the_data():
    d = data()
    ctx = context(d)
    ctx.known["C2"]["claimStatus"] = "needs_revalidation"
    comps = classify(ctx, {"requirement": "Orbit propagation", "class": 1, "repo": SAT, "sources": ["C1"]},
                     {"requirement": "Globe rendering", "class": 6, "repo": GLOBE, "sources": ["R2"], "resolveBy": "Index globe.gl"})
    inventory = stages.validate_inventory([], ctx, comps)
    arch = stages.validate_architecture({}, ctx, comps, inventory)
    guide = stages.validate_guide([{"title": "Glue", "sources": []}], ctx, inventory)
    unc = report.uncertainty_report(ctx, comps, inventory, arch, guide, [], {"inventory": "fallback"})
    # satellite-js's README claims Orbit propagation and its code shows it: no conflict there
    assert not any(c["requirement"] == "Orbit propagation" and c["title"].startswith("README") for c in unc["conflicts"])
    assert [s["sources"] for s in unc["stale"]] == [["C2"]]
    assert any(w["requirement"] == "Globe rendering" and w["grades"] == ["E4"] for w in unc["weakDependencies"])
    assert any(w["requirement"] is None and "Glue" in w["detail"] for w in unc["weakDependencies"])
    assert any(m["repo"] == GLOBE and "Could not be indexed" in m["detail"] for m in unc["missingVerification"])
    assert any(m["repo"] is None and "Nothing was executed" in m["detail"] for m in unc["missingVerification"])
    assert any(i["title"] == f"Not indexable: {GLOBE}" for i in unc["incompleteResearch"])
    assert any(i["title"].startswith("Inventory built from data only") for i in unc["incompleteResearch"])
    titles = [h["title"] for h in unc["humanDecisions"]]
    assert "Resolve Globe rendering" in titles and [h["id"] for h in unc["humanDecisions"]][0] == "H1"
    assert unc["traceability"][0]["recommendation"] == f"Reuse {SAT} for Orbit propagation"


def test_readme_claim_contradicted_by_the_code_is_a_conflict():
    d = data()
    d["candidates"][0]["assessment_json"]["coverage"]["Pass prediction"] = "yes"
    ctx = context(d)
    comps = classify(ctx)
    inventory = stages.validate_inventory([], ctx, comps)
    unc = report.uncertainty_report(ctx, comps, inventory, stages.validate_architecture({}, ctx, comps, inventory), [], [], {})
    assert any(c["title"] == f"README versus code: {SAT}" and c["requirement"] == "Pass prediction" for c in unc["conflicts"])


def test_challenge_answers_say_from_the_data_whether_the_decision_changed():
    previous = {"components": [{"requirement": "Ground tracks", "class": 5, "decision": "build", "repo": None},
                               {"requirement": "Globe rendering", "class": 6, "decision": "investigate", "repo": GLOBE}]}
    challenges = [{"id": "a", "requirement": "ground tracks", "repo": SAT, "note": "satellite.js has eciToGeodetic"},
                  {"id": "b", "requirement": "Globe rendering", "repo": "cesium/cesium", "note": "Why not Cesium?"}]
    ctx = context(data(challenges=challenges, previous=previous))
    assert "[CH1] Ground tracks (currently class 5)" in stages.classify_prompt(ctx)
    comps = classify(ctx, {"requirement": "Ground tracks", "class": 3, "repo": SAT, "sources": ["C2"], "change": "Split at the antimeridian"},
                     {"requirement": "Globe rendering", "class": 6, "repo": GLOBE, "sources": ["R2"]})
    answers = stages.validate_challenge_responses([{"id": "CH1", "response": "eciToGeodetic gives track points [C2]."}], ctx, comps)
    tracks, globe = answers
    assert (tracks["outcome"], tracks["previousClass"], tracks["newClass"], tracks["id"]) == ("changed", 5, 3, "a")
    assert tracks["response"].startswith("eciToGeodetic") and tracks["repoEvidence"] == "verified" and tracks["sources"] == ["C2"]
    assert (globe["outcome"], globe["repoEvidence"]) == ("upheld", "not-a-candidate")
    assert globe["response"] == comps["Globe rendering"]["reason"]
    changes = report.changes_since(ctx, comps, answers)
    tracks_change = next(c for c in changes if c["requirement"] == "Ground tracks")
    assert tracks_change["from"]["class"] == 5 and tracks_change["to"] == {"class": 3, "decision": "adapt", "repo": SAT}
    assert tracks_change["reason"].startswith("Challenged: satellite.js has eciToGeodetic")
    assert not any(c["requirement"] == "Globe rendering" for c in changes)


def test_executive_may_only_summarise_the_artifacts():
    ctx = context()
    comps = _classified(ctx)
    inventory = stages.validate_inventory([], ctx, comps)
    roadmap = stages.validate_roadmap([], ctx, comps)
    risks = report.risk_list([{"title": "a", "detail": ""}, {"title": "b", "detail": ""}, {"title": "c", "detail": ""}, {"title": "d", "detail": ""}])
    unc = report.uncertainty_report(ctx, comps, inventory, stages.validate_architecture({}, ctx, comps, inventory), [], [], {})
    raw = {"strategy": "Build on satellite.js.", "buildingBlocks": [SAT, GLOBE, "made/up"], "topRisks": ["K4", "K1", "K9", "K2", "K3"],
           "humanDecisions": ["H1", "H99"], "remainingWork": "About three weeks"}
    ex = report.validate_executive(raw, ctx, comps, inventory, roadmap, risks, unc)
    # globe.gl is "investigate" in the inventory and made/up is not a candidate
    assert ex["buildingBlocks"] == [SAT]
    assert [r["id"] for r in ex["topRisks"]] == ["K4", "K1", "K2"]
    assert [d["id"] for d in ex["humanDecisions"]] == ["H1"]
    assert ex["remainingWork"]["label"] == "estimate" and sum(ex["remainingWork"]["taskCounts"].values()) == len(roadmap)
    fallback = report.validate_executive({}, ctx, comps, inventory, roadmap, risks, unc)
    assert fallback["mode"] == "fallback" and SAT in fallback["strategy"]


# End to end with a scripted model

class StagedLLM(BaseLLMProvider):
    """Answers each stage by recognising its prompt; `broken` stages return unparseable text."""

    def __init__(self, broken=()):
        self.broken = set(broken)
        self.calls = []

    RESPONSES = {
        "classify": {
            "classifications": [
                {"requirement": "Orbit propagation", "class": 1, "repo": SAT, "sources": ["C1"], "reason": "sgp4() propagates TLEs."},
                {"requirement": "Globe rendering", "class": 1, "repo": GLOBE, "sources": ["R2"], "reason": "README says so."},
                {"requirement": "Ground tracks", "class": 3, "repo": SAT, "sources": ["C2"], "reason": "Track points exist.", "change": "Split at the antimeridian"},
                {"requirement": "Pass prediction", "class": 1, "repo": GPL, "sources": ["C3"], "reason": "find_passes()."},
                {"requirement": "Backend in Python", "class": 5, "reason": "A small service."},
            ],
            "challengeResponses": [{"id": "CH1", "response": "C2 shows eciToGeodetic."}],
        },
        "inventory": {"inventory": [{"repo": SAT, "capabilities": ["C1", "C2"], "action": "reuse", "reason": "Core propagation."},
                                    {"repo": GPL, "capabilities": ["C3"], "action": "adapt", "reason": "Pass finder."}]},
        "architecture": {"components": [{"name": "Propagation worker", "origin": "reused", "repo": SAT, "requirements": ["Orbit propagation", "Ground tracks"], "sources": ["C1"]},
                                        {"name": "TLE service", "origin": "new", "requirements": ["Backend in Python"]}],
                         "dataFlows": [{"from": "TLE service", "to": "Propagation worker", "data": "TLE sets", "contract": "JSON over HTTP"}],
                         "deployment": "Static site plus one container.",
                         "risks": [{"title": "Precision", "detail": "No deep-space corrections", "sources": ["L1"]}]},
        "guide": {"steps": [{"phase": "install", "title": "Install satellite.js", "sources": ["C1"], "version": "4.1.4"},
                            {"phase": "configuration", "title": "Point at CelesTrak", "envVars": ["TLE_SOURCE_URL"]}]},
        "roadmap": {"tasks": [{"title": "TLE service", "requirements": ["Backend in Python"], "complexity": "M", "uncertainty": "low",
                               "acceptanceCriteria": ["Serves fresh TLEs"], "tests": ["API test"]}]},
        "executive": {"strategy": "Reuse satellite.js for propagation; build the TLE service.", "buildingBlocks": [SAT], "topRisks": ["K1"], "humanDecisions": ["H1"]},
    }

    @staticmethod
    def stage(prompt: str) -> str:
        for marker, stage in (("Classify every requirement", "classify"), ("existing-solutions inventory", "inventory"),
                              ("Design the system", "architecture"), ("integration guide", "guide"),
                              ("implementation roadmap", "roadmap"), ("executive recommendation", "executive")):
            if marker in prompt:
                return stage
        raise AssertionError("unknown stage prompt")

    def complete(self, prompt: str, system: Optional[str] = None) -> str:
        stage = self.stage(prompt)
        self.calls.append(stage)
        assert system and "Never invent" in system
        return "I cannot answer that." if stage in self.broken else json.dumps(self.RESPONSES[stage])


def test_staged_generator_runs_every_stage_in_order_and_assembles_the_blueprint():
    llm = StagedLLM()
    challenges = [{"id": "ch-1", "requirement": "Ground tracks", "repo": SAT, "note": "It has eciToGeodetic"}]
    previous = {"revision": 1, "components": [{"requirement": "Ground tracks", "decision": "build", "repo": None}]}
    bp = generate_blueprint(llm, data(challenges=challenges, previous=previous), NOW)
    assert llm.calls == ["classify", "inventory", "architecture", "guide", "roadmap", "executive"]
    assert bp["stages"] == {s: "llm" for s in llm.calls}
    by_req = {c["requirement"]: c for c in bp["components"]}
    assert [by_req[r]["class"] for r in ("Orbit propagation", "Globe rendering", "Ground tracks", "Backend in Python")] == [1, 6, 3, 5]
    assert by_req["Pass prediction"]["class"] == 1  # GPL under the default copyleft-flagged policy: allowed, flagged
    assert bp["classCounts"]["1"] == 2
    assert bp["summary"] == bp["executive"]["strategy"] and bp["executive"]["buildingBlocks"] == [SAT]
    assert {e["repo"] for e in bp["inventory"]} == {SAT, GLOBE, OLD, GPL}
    assert bp["architecture"]["dataFlows"][0]["contract"] == "JSON over HTTP"
    assert bp["integrationSteps"][0]["version"] == "4.1.4" and all(not s["executed"] for s in bp["integrationSteps"])
    covered = {n for t in bp["roadmap"] for n in t["requirements"]}
    assert {c["requirement"] for c in bp["components"] if c["decision"] != "reuse"} <= covered
    assert bp["toBuild"] and all(set(t["requirements"]) & {"Backend in Python"} for t in bp["toBuild"])
    assert any(r["title"] == "Precision" and r["sources"] == ["L1"] for r in bp["risks"])
    assert bp["challenges"][0]["outcome"] == "changed" and bp["challenges"][0]["response"] == "C2 shows eciToGeodetic."
    assert any(c["requirement"] == "Ground tracks" for c in bp["changes"]) and bp["revision"] == 2
    assert bp["schemaVersion"] == 2 and bp["tuningVersion"] == default_tuning().version
    json.dumps(bp)  # stored as JSONB


def test_unusable_stage_output_falls_back_without_stopping_the_blueprint():
    llm = StagedLLM(broken={"classify", "architecture", "executive"})
    bp = generate_blueprint(llm, data(), NOW)
    assert bp["stages"]["classify"] == "fallback" and bp["stages"]["architecture"] == "fallback" and bp["stages"]["inventory"] == "llm"
    assert all(c["class"] in (5, 6) for c in bp["components"])  # nothing above 6 without a judgement
    assert bp["executive"]["mode"] == "fallback" and bp["summary"]
    assert {n for a in bp["architecture"]["components"] for n in a["requirements"]} == {r["name"] for r in REQUIREMENTS["requirements"]}
    assert any("built from data only" in i["title"] for i in bp["uncertainty"]["incompleteResearch"])


def test_budget_exhaustion_is_not_swallowed_by_a_stage_fallback():
    from apps.worker.providers.ledger import BudgetExceeded

    class Spent(StagedLLM):
        def complete(self, prompt, system=None):
            if self.stage(prompt) == "inventory":
                raise BudgetExceeded("BUDGET_EXCEEDED: llmCalls limit of 1 reached")
            return super().complete(prompt, system)

    with pytest.raises(BudgetExceeded):
        generate_blueprint(Spent(), data(), NOW)


# Investigate deeper: the planner

class QueryLLM(BaseLLMProvider):
    def __init__(self):
        self.prompts = []

    def complete(self, prompt, system=None):
        self.prompts.append(prompt)
        return json.dumps({"queries": [{"query": f"q{i} words", "requirement": "Pass prediction"} for i in range(20)]})


def test_focus_requirements_get_a_delimited_prompt_block_and_extra_queries():
    focused = {**REQUIREMENTS, "focusRequirements": ["pass prediction", "Not a requirement"]}
    prompt = _user_prompt(focused, 10)
    assert "Investigate deeper" in prompt and "- Pass prediction" in prompt and "Not a requirement" not in prompt
    assert "Investigate deeper" not in _user_prompt(REQUIREMENTS, 10)
    llm = QueryLLM()
    planned, mode = plan_queries(llm, focused)
    base, _ = plan_queries(QueryLLM(), REQUIREMENTS)
    assert mode == "llm" and len(planned) == len(base) + 2
    heuristic = heuristic_queries({**REQUIREMENTS, "focusRequirements": ["Pass prediction"]}, 10)
    assert [q["requirement"] for q in heuristic[:2]] == ["Pass prediction", "Pass prediction"]


def test_fingerprints_follow_focus_challenges_and_licence_policy():
    def fp(task_type, **brief):
        base = {"id": "b", "title": "t", "brief_text": "x", "constraints_json": {}, "answers_json": {}}
        ctx = TaskContext(task={"type": task_type}, brief={**base, **brief}, outputs={}, tuning=default_tuning(), llm_for=lambda k: None, db=None)
        return fingerprint(ctx)
    assert fp("discover") == fp("discover", challenges_json=[{"requirement": "x"}])
    assert fp("discover") != fp("discover", focus_json=[{"requirement": "x"}])
    assert fp("blueprint") == fp("blueprint", focus_json=[{"requirement": "x"}])
    assert fp("blueprint") != fp("blueprint", challenges_json=[{"requirement": "x"}])
    assert fp("blueprint") != fp("blueprint", constraints_json={"licencePolicy": "permissive-only"})
    # Briefs without Phase 3 data keep their fingerprints (no needless re-runs after the upgrade)
    assert fp("blueprint") == fp("blueprint", challenges_json=[], focus_json=[])


def test_deep_copy_of_inputs_is_not_mutated_by_generation():
    d = data()
    before = copy.deepcopy(d)
    generate_blueprint(StagedLLM(), d, NOW)
    assert d == before


def test_text_drops_markdown_emphasis_but_keeps_globs():
    from apps.worker.discovery.blueprint_evidence import text
    assert text("Reuse **taskforcesh/bullmq** with __node-resque__", 200) == "Reuse taskforcesh/bullmq with node-resque"
    assert text("Lint src/**/*.ts and lib/**/x", 200) == "Lint src/**/*.ts and lib/**/x"
