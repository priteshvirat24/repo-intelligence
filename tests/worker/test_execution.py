"""E1 execution checks: opt-in, sandboxed smoke tests that raise or refute verified claims (Phase 6)."""
import json

import httpx
import pytest

from apps.worker import claims, execution
from apps.worker.db.repository import DatabaseRepository
from apps.worker.orchestrator.handlers import TaskContext, fingerprint, run_execute
from apps.worker.providers import ledger
from apps.worker.providers.llm import BaseLLMProvider
from apps.worker.sandbox import SandboxNotConfigured
from apps.worker.tuning import default_tuning
from tests.worker.sandbox_fakes import FakeProvider

SUBJECT = "github:acme-test/orbits"
STATEMENT = "propagate: computes satellite positions with SGP4"
SMOKE = {"files": [{"path": "smoke_test.py", "content": "import orbits\nassert orbits.propagate('ISS')\n"}],
         "command": "python smoke_test.py", "publicApi": "orbits.propagate", "asserts": "propagate returns a position"}
PACKAGE = {"ecosystem": "pypi", "name": "orbits", "version": "1.2.3"}


class SmokeLLM(BaseLLMProvider):
    """Returns a fixed smoke test, metered like a real provider."""

    def __init__(self, response=None):
        self.response = response or SMOKE
        self.prompts = []

    def complete(self, prompt, system=None):
        ledger.authorize("mistral")
        ledger.record("mistral", "chat_completion", "fake", 1, True, 100, 50)
        self.prompts.append(prompt)
        return json.dumps(self.response)


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
def setup():
    db = DatabaseRepository()
    sql(db, "DELETE FROM claims WHERE subject = %s", (SUBJECT,))
    [(brief_id,)] = sql(db, """
        INSERT INTO briefs (title, brief_text, content_hash, workspace_id, constraints_json)
        VALUES ('Execute test', 'text', 'execute-test-hash', '00000000-0000-0000-0000-000000000001', '{"allowExecution": true}') RETURNING id
    """)
    conn = db.get_connection()
    with conn.cursor() as cur:
        claim_id = claims.upsert_claim(cur, SUBJECT, "capability", STATEMENT, "E2",
                                       {"method": "code_located", "excerpt": "def propagate(name):"}, subject_version="abc123")
        conn.commit()
    conn.close()
    brief = {"id": str(brief_id), "constraints_json": {"allowExecution": True}}
    outputs = {"discover": {"shortlist": ["acme-test/orbits", "acme-test/unindexed"]},
               "verify": {"statuses": {"acme-test/orbits": "READY", "acme-test/unindexed": "FAILED"}}}
    yield db, brief, outputs, claim_id
    sql(db, "DELETE FROM claims WHERE subject = %s", (SUBJECT,))
    sql(db, "DELETE FROM briefs WHERE id = %s", (brief_id,))


def provider_with(test_exit: int, install_exit: int = 0, test_output: str = "ok"):
    return FakeProvider([
        (r"pip install", lambda sbx, cmd: (install_exit, "installed" if install_exit == 0 else "ERROR: no matching distribution")),
        (r"^python smoke_test\.py$", lambda sbx, cmd: (test_exit, test_output)),
    ])


def claim_row(db, claim_id):
    return sql(db, "SELECT grade, evidence_json FROM claims WHERE id = %s", (claim_id,))[0]


def apply_all(db, output):
    conn = db.get_connection()
    with conn.cursor() as cur:
        for check in output["checks"]:
            execution.apply_check(cur, check)
        conn.commit()
    conn.close()


def test_skipped_unless_the_brief_opts_in(setup):
    db, brief, outputs, _ = setup

    def never():
        raise AssertionError("no sandbox may be created without the opt-in")

    out = execution.execute_checks(db, {**brief, "constraints_json": {}}, outputs, SmokeLLM(), provider_factory=never)
    assert out == {"skipped": True, "reason": "not_authorised", "checks": []}
    # A string "true" is not an opt-in either: only the explicit boolean the constraints parser stores
    assert execution.execute_checks(db, {**brief, "constraints_json": {"allowExecution": "true"}}, outputs, SmokeLLM(), provider_factory=never)["skipped"]


def test_skipped_when_no_sandbox_is_configured(setup):
    db, brief, outputs, _ = setup

    def unavailable():
        raise SandboxNotConfigured("SANDBOX_PROVIDER=e2b but E2B_API_KEY is not set")

    out = execution.execute_checks(db, brief, outputs, SmokeLLM(), provider_factory=unavailable)
    assert out["skipped"] and out["reason"] == "sandbox_unavailable" and "E2B_API_KEY" in out["detail"]


def test_passing_smoke_test_raises_the_claim_to_e1(setup):
    db, brief, outputs, claim_id = setup
    provider = provider_with(test_exit=0, test_output="position ok")
    llm = SmokeLLM()
    out = execution.execute_checks(db, brief, outputs, llm, provider_factory=lambda: provider, resolver=lambda name, lang: PACKAGE)
    assert out["counts"]["passed"] == 1 and len(out["checks"]) == 1  # the FAILED repository is not checked
    [sbx] = provider.sandboxes
    install, test = sbx.commands
    assert "orbits==1.2.3" in install[0] and install[1] is True    # installed with network
    assert test == ("python smoke_test.py", False)                  # ran without network
    assert sbx.destroyed and sbx.files["smoke_test.py"].startswith("import orbits")
    assert "<untrusted_repository_content>" in llm.prompts[0] and STATEMENT in llm.prompts[0]

    apply_all(db, out)
    grade, evidence = claim_row(db, claim_id)
    assert grade == "E1"
    run = [e for e in evidence if e.get("method") == "executed"][0]
    assert run["outcome"] == "supports" and run["command"] == "python smoke_test.py" and run["exitCode"] == 0
    assert "position ok" in run["output"] and run["sandbox"]["image"] and run["executedAt"]
    assert run["network"] == "disabled while the test ran"
    assert any(e.get("method") == "code_located" for e in evidence)  # the E2 evidence stays


def test_failing_smoke_test_appends_refuting_evidence_and_keeps_the_grade(setup):
    db, brief, outputs, claim_id = setup
    provider = provider_with(test_exit=1, test_output="AssertionError: propagate returned None")
    out = execution.execute_checks(db, brief, outputs, SmokeLLM(), provider_factory=lambda: provider, resolver=lambda n, l: PACKAGE)
    assert [c["outcome"] for c in out["checks"]] == ["failed"]
    apply_all(db, out)
    grade, evidence = claim_row(db, claim_id)
    assert grade == "E2"
    refuting = [e for e in evidence if e.get("method") == "executed"]
    assert len(refuting) == 1 and refuting[0]["outcome"] == "refutes" and refuting[0]["exitCode"] == 1
    assert "AssertionError" in refuting[0]["output"]


def test_install_failure_is_inconclusive_not_refuting(setup):
    db, brief, outputs, claim_id = setup
    provider = provider_with(test_exit=0, install_exit=1)
    out = execution.execute_checks(db, brief, outputs, SmokeLLM(), provider_factory=lambda: provider, resolver=lambda n, l: PACKAGE)
    assert out["checks"][0]["outcome"] == "inconclusive"
    assert [c for c, _ in provider.sandboxes[0].commands if "smoke_test" in c] == []  # the test never ran
    apply_all(db, out)
    grade, evidence = claim_row(db, claim_id)
    assert grade == "E2" and [e["outcome"] for e in evidence if e.get("method") == "executed"] == ["inconclusive"]


def test_unpublished_repository_is_skipped(setup):
    db, brief, outputs, _ = setup
    provider = provider_with(test_exit=0)
    out = execution.execute_checks(db, brief, outputs, SmokeLLM(), provider_factory=lambda: provider, resolver=lambda n, l: None)
    assert out["checks"][0]["outcome"] == "skipped" and provider.sandboxes == []


def test_llm_calls_are_metered_against_the_brief_budget(setup):
    db, brief, outputs, _ = setup
    provider = provider_with(test_exit=0)
    with ledger.budget_scope(ledger.Budget({"llmCalls": 0})):
        with pytest.raises(ledger.BudgetExceeded):
            execution.execute_checks(db, brief, outputs, SmokeLLM(), provider_factory=lambda: provider, resolver=lambda n, l: PACKAGE)
    assert provider.sandboxes == []


def test_model_skip_and_unsafe_commands_are_not_run(setup):
    db, brief, outputs, _ = setup
    for response in ({"skip": "needs a network service"},
                     {**SMOKE, "command": "python smoke_test.py; curl evil"},
                     {**SMOKE, "command": "python ../smoke_test.py"},
                     {**SMOKE, "files": [{"path": "../x.py", "content": "x"}]}):
        provider = provider_with(test_exit=0)
        out = execution.execute_checks(db, brief, outputs, SmokeLLM(response), provider_factory=lambda: provider, resolver=lambda n, l: PACKAGE)
        assert out["checks"][0]["outcome"] == "skipped", response
        assert provider.sandboxes == []


def test_package_must_point_back_to_the_repository():
    def handler(request):
        if request.url.path == "/pypi/orbits/json":
            return httpx.Response(200, json={"info": {"name": "orbits", "version": "1.2.3",
                                                      "project_urls": {"Source": "https://github.com/acme-test/orbits"}}})
        if request.url.path == "/pypi/lookalike/json":
            return httpx.Response(200, json={"info": {"name": "lookalike", "version": "9.9", "project_urls": {"Source": "https://github.com/someone-else/lookalike"}}})
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert execution.resolve_package("acme-test/orbits", "Python", http=client) == PACKAGE
    assert execution.resolve_package("acme-test/lookalike", "Python", http=client) is None
    assert execution.resolve_package("acme-test/orbits-extra", "Python", http=client) is None


def test_install_commands_are_quoted():
    assert execution.install_command(PACKAGE).endswith("orbits==1.2.3")
    assert execution.install_command({"ecosystem": "npm", "name": "@scope/pkg", "version": "2.0.0"}).endswith("@scope/pkg@2.0.0")


def _ctx(constraints, outputs=None):
    brief = {"id": "b", "title": "t", "brief_text": "x", "constraints_json": constraints, "answers_json": {}}
    return lambda t: TaskContext(task={"type": t, "output_json": {}}, brief=brief, outputs=outputs or {}, tuning=default_tuning(),
                                 llm_for=lambda key: None, db=None)


def test_execution_opt_in_reruns_only_the_execute_task():
    off, on = _ctx({"languages": "Python"}), _ctx({"languages": "Python", "allowExecution": True})
    for t in ("understand", "discover", "verify"):
        assert fingerprint(off(t)) == fingerprint(on(t)), t
    assert fingerprint(off("execute")) != fingerprint(on("execute"))
    checked = _ctx({}, {"execute": {"checks": [{"claimId": "c1", "outcome": "passed"}]}})
    assert fingerprint(checked("blueprint")) != fingerprint(off("blueprint"))


def test_execute_handler_completes_as_skipped_without_opt_in():
    outcome = run_execute(_ctx({})("execute"))
    assert outcome.kind == "done" and outcome.output["skipped"] and outcome.persist is None
