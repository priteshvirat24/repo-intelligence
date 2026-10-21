"""Build mode: scope from the blueprint, the bounded coding loop, the report, and the runner (Phase 6)."""
import json

import pytest
from psycopg2.extras import Json

from apps.worker.builder import loop, scope
from apps.worker.builder.runner import BuildStore, process_build
from apps.worker.db.repository import DatabaseRepository
from apps.worker.providers import ledger
from apps.worker.providers.llm import BaseLLMProvider
from apps.worker.sandbox import SandboxNotConfigured
from tests.worker.sandbox_fakes import FakeProvider

REQUIREMENTS = {"requirements": [{"name": "Orbit propagation", "description": "SGP4 from TLEs", "criticality": "MUST"},
                                 {"name": "Globe view", "description": "3D globe", "criticality": "SHOULD"}]}
BLUEPRINT = {
    "summary": "Use sgp4 for propagation.",
    "components": [{"requirement": "Orbit propagation", "decision": "reuse", "repo": "brandon-rhodes/python-sgp4", "how": "Call Satrec.twoline2rv"}],
    "integrationSteps": [{"title": "Install sgp4", "detail": "pip install sgp4", "sources": ["C1"]}],
    "toBuild": [{"title": "TLE ingestion service", "detail": "Fetch and cache TLEs", "requirements": ["Orbit propagation"]}],
}
ROADMAP_BLUEPRINT = {**BLUEPRINT, "roadmap": {"tasks": [
    {"id": "T1", "title": "Propagation module", "description": "Wrap sgp4", "acceptanceCriteria": ["Returns a position for the ISS TLE"],
     "testRequirements": ["Unit test with a fixed TLE"], "requirements": ["Orbit propagation"]},
    {"title": "Globe", "requirements": ["Globe view"]},
]}, "integrationGuide": {"steps": [{"title": "Configure", "detail": "Set the API key", "envVars": ["SPACETRACK_USER", "bad name"]}]}}


def test_roadmap_items_read_defensively():
    assert [i["id"] for i in scope.roadmap_items(ROADMAP_BLUEPRINT)] == ["T1", "roadmap-2"]
    assert [i["id"] for i in scope.roadmap_items({**BLUEPRINT, "roadmap": ROADMAP_BLUEPRINT["roadmap"]["tasks"]})] == ["T1", "roadmap-2"]
    fallback = scope.roadmap_items(BLUEPRINT)
    assert fallback[0]["id"] == "build-1" and fallback[0]["source"] == "toBuild"
    assert scope.roadmap_items({}) == [] and scope.roadmap_items({"roadmap": "garbage"}) == []
    assert scope.env_var_names(ROADMAP_BLUEPRINT) == ["SPACETRACK_USER"]


def test_build_spec_from_scope():
    brief = {"title": "Tracker", "requirements_json": REQUIREMENTS, "constraints_json": {"languages": "Python"}}
    spec = scope.build_spec(brief, ROADMAP_BLUEPRINT, {"roadmapTaskIds": ["T1"]})
    assert [r["name"] for r in spec["requirements"]] == ["Orbit propagation"]
    assert spec["acceptanceCriteria"] == ["Returns a position for the ISS TLE"]
    assert spec["testRequirements"] == ["Unit test with a fixed TLE"]
    assert spec["components"][0]["repo"] == "brandon-rhodes/python-sgp4" and spec["languages"] == "Python"
    assert spec["integrationSteps"][0]["title"] == "Configure"
    with pytest.raises(ValueError):
        scope.build_spec(brief, ROADMAP_BLUEPRINT, {"roadmapTaskIds": ["nope"], "requirements": ["Unknown"]})


# The loop, with a fake model and a fake sandbox

GOOD = {"runtime": "python", "dependencies": ["sgp4==2.23"],
        "files": [{"path": "tracker/propagate.py", "content": "def position():\n    return (1, 2, 3)\n"},
                  {"path": "tests/test_propagate.py", "content": "from tracker.propagate import position\n\ndef test_iss_position():\n    assert position()\n"},
                  {"path": "requirements.txt", "content": "evil-package\n"}],
        "coverage": [{"criterion": "Returns a position for the ISS TLE", "tests": ["test_iss_position"]}],
        "needsHuman": ["Check against a live TLE feed"], "notes": "first try"}
FIX = {"files": [{"path": "tracker/propagate.py", "content": "def position():\n    return (6771.0, 0, 0)\n"}], "notes": "fixed"}


class ScriptedLLM(BaseLLMProvider):
    def __init__(self, responses):
        self.responses = list(responses)
        self.prompts = []

    def complete(self, prompt, system=None):
        ledger.authorize("mistral")
        ledger.record("mistral", "chat_completion", "fake", 1, True, 100, 50)
        self.prompts.append(prompt)
        r = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        return r if isinstance(r, str) else json.dumps(r)


def junit(cases):
    body = "".join(
        f'<testcase classname="tests.test_propagate" name="{name}">' + ('<failure message="assert None">AssertionError</failure>' if not ok else "") + "</testcase>"
        for name, ok in cases)
    return f'<?xml version="1.0"?><testsuites><testsuite name="pytest">{body}</testsuite></testsuites>'


def sandbox_where(passes_from_iteration: int):
    """Tests fail until the given sandbox (1-based) runs them."""
    calls = {"n": 0}

    def run_tests(sbx, cmd):
        calls["n"] += 1
        ok = calls["n"] >= passes_from_iteration
        sbx.files[".openeye/report.xml"] = junit([("test_iss_position", ok)])
        return (0 if ok else 1, "1 passed" if ok else "1 failed: AssertionError assert None")

    return FakeProvider([(r"pip install", lambda sbx, cmd: (0, "")), (r"pytest", run_tests)])


SPEC = scope.build_spec({"title": "Tracker", "requirements_json": REQUIREMENTS}, ROADMAP_BLUEPRINT, {"roadmapTaskIds": ["T1"]})


def test_loop_is_bounded_by_max_iterations():
    provider = sandbox_where(passes_from_iteration=99)
    llm = ScriptedLLM([GOOD, FIX])
    result = loop.run_build_loop(llm, provider, SPEC, loop.BuildLimits(max_iterations=3))
    assert result["stopReason"] == "max_iterations"
    assert len(llm.prompts) == 3 and len(provider.sandboxes) == 3
    assert all(s.destroyed for s in provider.sandboxes)
    for sbx in provider.sandboxes:
        (install, net_install), (test, net_test) = sbx.commands
        assert "pip install" in install and net_install is True
        assert "pytest" in test and net_test is False
        # The model's own requirements.txt is replaced by the validated dependency list
        assert sbx.files["requirements.txt"] == "sgp4==2.23\npytest\n"
    report = loop.build_report(SPEC, result)
    assert report["outcome"] == "failed" and report["iterations"] == 3
    assert any("Not every test passes" in n for n in report["needsHuman"])


def test_failures_are_fed_back_and_the_loop_stops_when_tests_pass():
    provider = sandbox_where(passes_from_iteration=2)
    llm = ScriptedLLM([GOOD, FIX])
    result = loop.run_build_loop(llm, provider, SPEC, loop.BuildLimits(max_iterations=4))
    assert result["stopReason"] == "all_passed" and len(llm.prompts) == 2
    second = llm.prompts[1]
    assert "tests.test_propagate::test_iss_position" in second and "assert None" in second
    assert "tracker/propagate.py" in second and "<sandbox_output>" in second
    assert result["state"]["files"]["tracker/propagate.py"].startswith("def position():\n    return (6771.0")

    report = loop.build_report(SPEC, result)
    assert report["outcome"] == "passed" and report["totals"] == {"passed": 1, "failed": 0, "error": 0, "skipped": 0}
    assert report["passed"] == ["Returns a position for the ISS TLE"]
    assert report["untested"] == ["Unit test with a fixed TLE"]  # no test was mapped to it
    assert report["failed"] == []
    assert any("without network" in n for n in report["needsHuman"]) and "Check against a live TLE feed" in report["needsHuman"]
    assert any("SPACETRACK_USER" in n for n in report["needsHuman"])
    for key in ("stopReason", "runtime", "image", "testCommand", "criteria", "tests", "history", "network"):
        assert key in report


def test_invalid_model_output_is_reported_back():
    provider = sandbox_where(passes_from_iteration=1)
    llm = ScriptedLLM(["not json at all", {**GOOD, "files": [{"path": "../escape.py", "content": "x"}]}, GOOD])
    result = loop.run_build_loop(llm, provider, SPEC, loop.BuildLimits(max_iterations=3))
    assert result["stopReason"] == "all_passed" and len(provider.sandboxes) == 1
    assert "could not be used" in llm.prompts[2]
    assert [h["phase"] for h in result["history"]] == ["generate", "generate", "test"]


def test_disallowed_dependencies_are_refused():
    with pytest.raises(ValueError):
        loop.parse_change({**GOOD, "dependencies": ["sgp4; rm -rf /"]}, None)
    with pytest.raises(ValueError):
        loop.parse_change({**GOOD, "runtime": "ruby"}, None)


def test_budget_stops_the_loop():
    provider = sandbox_where(passes_from_iteration=99)
    with ledger.budget_scope(ledger.Budget({"llmCalls": 1})):
        result = loop.run_build_loop(ScriptedLLM([GOOD, FIX]), provider, SPEC, loop.BuildLimits(max_iterations=4))
    assert result["stopReason"] == "budget" and len(provider.sandboxes) == 1


def test_diff_adds_every_file_under_the_prefix():
    diff = loop.make_diff({"a.py": "x = 1\n", "pkg/b.py": "y = 2"}, "open-eye/build-1234")
    assert "diff --git a/open-eye/build-1234/a.py b/open-eye/build-1234/a.py\nnew file mode 100644\n--- /dev/null\n+++ b/open-eye/build-1234/a.py\n@@ -0,0 +1 @@\n+x = 1\n" in diff
    assert "+y = 2\n" in diff


def test_node_manifest_from_dependencies():
    pkg = json.loads(loop.manifests("node", ["satellite.js@5.0.0", "@scope/lib@^1.2.0", "plain"])["package.json"])
    assert pkg["dependencies"] == {"satellite.js": "5.0.0", "@scope/lib": "^1.2.0", "plain": "*"} and pkg["type"] == "module"


def test_junit_parsing_refuses_entities():
    assert loop.parse_junit('<!DOCTYPE x [<!ENTITY a "b">]><testsuite/>') == []
    assert loop.parse_junit(junit([("t1", True), ("t2", False)]))[1]["status"] == "failed"


# The runner against the database

def sql(db, query, params=()):
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall() if cur.description else None
            conn.commit()
            return rows
    finally:
        conn.close()


@pytest.fixture
def queued_build():
    db = DatabaseRepository()
    sql(db, "UPDATE builds SET status = 'failed' WHERE status IN ('queued', 'running')")
    [(brief_id,)] = sql(db, """
        INSERT INTO briefs (title, brief_text, content_hash, requirements_json, workspace_id)
        VALUES ('Build test', 'text', 'build-test-hash', %s, '00000000-0000-0000-0000-000000000001') RETURNING id
    """, (Json(REQUIREMENTS),))
    sql(db, "INSERT INTO brief_blueprints (brief_id, status, blueprint_json) VALUES (%s, 'COMPLETED', %s)", (brief_id, Json(ROADMAP_BLUEPRINT)))

    def make(scope_json):
        [(build_id,)] = sql(db, "INSERT INTO builds (brief_id, workspace_id, scope_json, max_iterations) VALUES (%s, '00000000-0000-0000-0000-000000000001', %s, 3) RETURNING id",
                            (brief_id, Json(scope_json)))
        return str(build_id)

    yield db, make
    sql(db, "DELETE FROM briefs WHERE id = %s", (brief_id,))


def build_row(db, build_id):
    return sql(db, "SELECT status, iterations, test_report_json, diff_text, files_json, error_message FROM builds WHERE id = %s", (build_id,))[0]


def test_runner_stores_the_change_set_and_report(queued_build):
    db, make = queued_build
    build_id = make({"roadmapTaskIds": ["T1"]})
    claimed = BuildStore(db).claim_next("w1")
    assert str(claimed["id"]) == build_id and BuildStore(db).claim_next("w2") is None
    status = process_build(db, claimed, lambda key: ScriptedLLM([GOOD, FIX]), "w1", provider_factory=lambda: sandbox_where(2))
    assert status == "succeeded"
    st, iterations, report, diff, files, error = build_row(db, build_id)
    assert st == "succeeded" and iterations == 2 and error is None
    assert report["outcome"] == "passed" and report["pathPrefix"] == f"open-eye/build-{build_id[:8]}"
    assert f"+++ b/open-eye/build-{build_id[:8]}/tracker/propagate.py" in diff
    assert set(files) == {"tracker/propagate.py", "tests/test_propagate.py", "requirements.txt"}


def test_runner_failing_tests_await_a_person(queued_build):
    db, make = queued_build
    make({"roadmapTaskIds": ["T1"]})
    claimed = BuildStore(db).claim_next("w1")
    assert process_build(db, claimed, lambda key: ScriptedLLM([GOOD]), "w1", provider_factory=lambda: sandbox_where(99)) == "awaiting_approval"


def test_runner_fails_clearly_without_sandbox_or_scope(queued_build):
    db, make = queued_build
    a = make({"roadmapTaskIds": ["T1"]})

    def unavailable():
        raise SandboxNotConfigured("SANDBOX_PROVIDER=e2b but E2B_API_KEY is not set")

    process_build(db, BuildStore(db).claim_next("w1"), lambda key: ScriptedLLM([GOOD]), "w1", provider_factory=unavailable)
    st, _, _, diff, _, error = build_row(db, a)
    assert st == "failed" and "E2B_API_KEY" in error and diff is None

    b = make({"roadmapTaskIds": ["does-not-exist"]})
    process_build(db, BuildStore(db).claim_next("w1"), lambda key: ScriptedLLM([GOOD]), "w1", provider_factory=lambda: sandbox_where(1))
    assert build_row(db, b)[0] == "failed"
