"""Run graph, budgets, claims and verification queueing against the database (Phase 1)."""
import json

import pytest
from psycopg2.extras import Json

from apps.worker import claims
from apps.worker.db.briefs import BriefStore
from apps.worker.db.repository import DatabaseRepository, JobLostError
from apps.worker.orchestrator import store as task_store
from apps.worker.orchestrator.graph import downstream
from apps.worker.orchestrator.handlers import Outcome, TaskContext, fingerprint, run_understand
from apps.worker.providers import ledger
from apps.worker.providers.llm import BaseLLMProvider
from apps.worker.tuning import default_tuning

REQUIREMENTS = {"problemSummary": "Queue test brief", "requirements": [{"name": "Orbit propagation", "description": "SGP4", "criticality": "MUST"}]}


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
def run():
    db = DatabaseRepository()
    store = task_store.TaskStore(db)
    # Other briefs' tasks must not be claimed by these tests
    sql(db, "UPDATE tasks SET status = 'done' WHERE status IN ('pending', 'stale', 'waiting', 'running')")
    [(brief_id,)] = sql(db, """
        INSERT INTO briefs (title, brief_text, content_hash, requirements_json, workspace_id)
        VALUES ('Run test', 'text', 'run-test-hash', %s, '00000000-0000-0000-0000-000000000001') RETURNING id
    """, (Json(REQUIREMENTS),))
    brief_id = str(brief_id)
    conn = db.get_connection()
    with conn.cursor() as cur:
        task_store.create_run(cur, brief_id)
        conn.commit()
    conn.close()
    yield db, store, brief_id
    sql(db, "DELETE FROM briefs WHERE id = %s", (brief_id,))


def statuses(db, brief_id):
    return dict(sql(db, "SELECT type, status FROM tasks WHERE brief_id = %s", (brief_id,)))


def brief_status(db, brief_id):
    return sql(db, "SELECT status, stop_reason FROM briefs WHERE id = %s", (brief_id,))[0]


def test_graph_runs_in_dependency_order(run):
    db, store, brief_id = run
    first = store.claim_next("w1")
    assert first["type"] == "understand"
    assert store.claim_next("w2") is None  # discover waits for understand
    store.complete(first, {"requirements": REQUIREMENTS}, "fp-u", "w1")
    assert store.claim_next("w2")["type"] == "discover"
    assert brief_status(db, brief_id)[0] == "RUNNING"


def test_unchanged_output_does_not_disturb_downstream(run):
    db, store, brief_id = run
    understand = store.claim_next("w1")
    store.complete(understand, {"requirements": REQUIREMENTS}, "fp-u", "w1")
    discover = store.claim_next("w1")
    store.complete(discover, {"shortlist": ["a/b"]}, "fp-d", "w1")
    assert statuses(db, brief_id)["discover"] == "done"

    # Re-running understand with the same result leaves discover done; a different result makes it stale
    task_store_conn = db.get_connection()
    with task_store_conn.cursor() as cur:
        cur.execute("UPDATE tasks SET status = 'stale' WHERE brief_id = %s AND type = 'understand'", (brief_id,))
        task_store_conn.commit()
    task_store_conn.close()
    again = store.claim_next("w1")
    assert again["type"] == "understand"
    store.complete(again, {"requirements": REQUIREMENTS}, "fp-u", "w1")
    assert statuses(db, brief_id)["discover"] == "done"

    sql(db, "UPDATE tasks SET status = 'stale' WHERE brief_id = %s AND type = 'understand'", (brief_id,))
    changed = store.claim_next("w1")
    store.complete(changed, {"requirements": {"problemSummary": "changed", "requirements": []}}, "fp-u2", "w1")
    s = statuses(db, brief_id)
    assert s["discover"] == "stale" and s["verify"] == "pending"


def test_invalidation_takes_ownership_from_a_running_task(run):
    db, store, brief_id = run
    understand = store.claim_next("w1")
    store.complete(understand, {"requirements": REQUIREMENTS}, "fp-u", "w1")
    discover = store.claim_next("w1")  # running
    conn = db.get_connection()
    with conn.cursor() as cur:
        task_store.invalidate(cur, brief_id, "understand", force=True)
        conn.commit()
    conn.close()
    with pytest.raises(JobLostError):
        store.complete(discover, {"shortlist": []}, "fp-d", "w1")
    s = statuses(db, brief_id)
    assert s["understand"] == "stale" and s["discover"] == "stale"
    assert sql(db, "SELECT inputs_fingerprint FROM tasks WHERE brief_id = %s AND type = 'understand'", (brief_id,))[0][0] is None


def test_waiting_task_is_not_claimed_before_its_time(run):
    db, store, brief_id = run
    understand = store.claim_next("w1")
    store.wait(understand, 300, "w1", {"phase": "waiting"}, "fp")
    assert store.claim_next("w2") is None
    sql(db, "UPDATE tasks SET not_before = NOW() - INTERVAL '1 second' WHERE brief_id = %s AND type = 'understand'", (brief_id,))
    assert store.claim_next("w2")["type"] == "understand"


def test_blocking_questions_hold_research(run):
    db, store, brief_id = run
    understand = store.claim_next("w1")
    store.await_input(understand, {"blockingQuestions": ["Which cloud?"]}, "fp", "w1")
    assert store.claim_next("w1") is None
    assert brief_status(db, brief_id)[0] == "AWAITING_INPUT"


def test_budget_stop_is_reported_on_the_brief(run):
    db, store, brief_id = run
    understand = store.claim_next("w1")
    store.fail(understand, "BUDGET_EXCEEDED: llmCalls limit of 1 reached", "w1", stop_reason="budget")
    assert brief_status(db, brief_id) == ("STOPPED", "budget")


def test_downstream_order():
    assert downstream("understand") == ["discover", "verify", "execute", "blueprint"]
    assert downstream("verify") == ["execute", "blueprint"]
    assert downstream("execute") == ["blueprint"]
    assert downstream("blueprint") == []
    from apps.worker.orchestrator.graph import ancestors
    assert ancestors("blueprint") == ["understand", "discover", "verify", "execute"]


# Understanding task

class QuestionLLM(BaseLLMProvider):
    def __init__(self, blocking):
        self.blocking = blocking

    def complete(self, prompt, system=None):
        return json.dumps({
            "problemSummary": "Track satellites",
            "requirements": [{"name": "Orbit propagation", "description": "SGP4", "type": "functional", "criticality": "MUST", "confidence": "explicit"}],
            "acceptanceCriteria": ["Shows ISS position within 1 km"],
            "clarifyingQuestions": [{"question": "Browser or desktop?", "why": "Changes the rendering stack", "blocking": self.blocking}],
            "assumptions": ["Public TLE data is enough"],
        })


def context(brief, llm):
    return TaskContext(task={"type": "understand", "output_json": {}}, brief=brief, outputs={}, tuning=default_tuning(),
                       llm_for=lambda key: llm, db=None)


BRIEF = {"id": "b", "title": "Satellite tracker", "brief_text": "Track satellites in the browser.", "constraints_json": {}, "answers_json": {}}


def test_non_blocking_questions_do_not_hold_research():
    outcome = run_understand(context(BRIEF, QuestionLLM(blocking=False)))
    assert outcome.kind == "done"
    assert outcome.output["requirements"]["requirements"][0]["name"] == "Orbit propagation"


def test_blocking_question_waits_until_answered():
    assert run_understand(context(BRIEF, QuestionLLM(blocking=True))).kind == "await_input"
    answered = {**BRIEF, "answers_json": {"Browser or desktop?": "Browser"}}
    assert run_understand(context(answered, QuestionLLM(blocking=True))).kind == "done"


def test_fingerprint_changes_with_constraints_and_answers():
    base = fingerprint(context(BRIEF, None))
    assert fingerprint(context({**BRIEF, "constraints_json": {"languages": "Python"}}, None)) != base
    assert fingerprint(context({**BRIEF, "answers_json": {"q": "a"}}, None)) != base
    assert fingerprint(context(dict(BRIEF), None)) == base


# Budgets

def test_budget_blocks_calls_once_spent():
    budget = ledger.Budget({"llmCalls": 2, "githubRequests": 1})
    with ledger.budget_scope(budget):
        ledger.authorize("mistral")
        ledger.record("mistral", "chat_completion", "m", 1, True, 10, 5)
        ledger.record("mistral", "chat_completion", "m", 1, True, 10, 5)
        with pytest.raises(ledger.BudgetExceeded, match="llmCalls"):
            ledger.authorize("mistral")
        ledger.authorize("github")
        ledger.record("github", "search", None, 1, True)
        with pytest.raises(ledger.BudgetExceeded, match="githubRequests"):
            ledger.authorize("github")
    assert budget.used == {"llmCalls": 2, "tokens": 30, "githubRequests": 1}
    ledger.authorize("mistral")  # outside the scope nothing is limited


def test_github_client_refuses_requests_over_budget():
    import httpx
    from apps.worker.discovery.github_search import GitHubSearchClient
    client = GitHubSearchClient(token="t", http=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"items": []}))))
    with ledger.budget_scope(ledger.Budget({"githubRequests": 1})):
        assert client.search_repositories("sgp4") == []
        with pytest.raises(ledger.BudgetExceeded):
            client.search_repositories("globe")


# Claims

def test_claims_merge_and_keep_the_best_grade(run):
    db, _, brief_id = run
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            subject = "github:test-owner/claims-test"
            cur.execute("DELETE FROM claims WHERE subject = %s", (subject,))
            a = claims.upsert_claim(cur, subject, "capability", "SGP4 propagation", "E4", {"method": "readme_assessment"})
            b = claims.upsert_claim(cur, subject, "capability", "  sgp4   PROPAGATION ", "E2", {"method": "code_located", "locator": {"filePath": "sgp4.js"}})
            c = claims.upsert_claim(cur, subject, "capability", "SGP4 propagation", "E4", {"method": "readme_assessment"})
            assert a == b == c
            cur.execute("SELECT grade, jsonb_array_length(evidence_json) FROM claims WHERE id = %s", (a,))
            assert cur.fetchone() == ("E2", 2)  # strongest grade kept; the repeated README evidence not duplicated
            scoped = claims.upsert_claim(cur, subject, "coverage", "covers orbit propagation", "E4", {"method": "readme_assessment"}, brief_id=brief_id)
            assert scoped != a
            cur.execute("DELETE FROM claims WHERE subject = %s", (subject,))
            conn.commit()
    finally:
        conn.close()


def test_claims_from_an_indexed_repository(run):
    db, _, _ = run
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM repositories WHERE owner = 'test-owner' AND name = 'claims-repo'")
            cur.execute("""INSERT INTO repositories (owner, name, url, status, latest_commit_hash, license)
                           VALUES ('test-owner', 'claims-repo', 'https://github.com/test-owner/claims-repo', 'READY', 'abc123', 'MIT') RETURNING id""")
            repo_id = str(cur.fetchone()[0])
            cur.execute("""INSERT INTO knowledge_objects (repository_id, object_type, name, description)
                           VALUES (%s, 'capability', 'SGP4 propagation', 'Propagates TLEs') RETURNING id""", (repo_id,))
            ko = cur.fetchone()[0]
            cur.execute("""INSERT INTO evidence (knowledge_object_id, file_path, start_line, end_line, quote_snippet, evidence_type, is_verified)
                           VALUES (%s, 'src/sgp4.js', 10, 40, 'export function sgp4(', 'code_ast', TRUE)""", (ko,))
            assert claims.claims_from_repository(cur, repo_id) == 2  # capability (E2) and licence (E3)
            cur.execute("SELECT kind, grade, subject_version, evidence_json->0->>'sourceUrl' FROM claims WHERE subject = 'github:test-owner/claims-repo' ORDER BY kind")
            rows = cur.fetchall()
            assert rows[0][:3] == ("capability", "E2", "abc123")
            assert rows[0][3] == "https://github.com/test-owner/claims-repo/blob/abc123/src/sgp4.js#L10-L40"
            assert rows[1][:2] == ("licence", "E3")
            cur.execute("DELETE FROM claims WHERE subject = 'github:test-owner/claims-repo'")
            cur.execute("DELETE FROM repositories WHERE id = %s", (repo_id,))
            conn.commit()
    finally:
        conn.close()


# Verification queueing (unchanged behaviour, now called by the verify task)

TARGET = {
    "fullName": "Test-Owner/BP-Verify",
    "url": "https://github.com/test-owner/bp-verify",
    "meta": {"owner": "Test-Owner", "name": "BP-Verify", "description": "d", "default_branch": "develop",
             "stars": 42, "license": "MIT", "primary_language": "Python", "size_kb": 100},
}


@pytest.fixture
def clean_target():
    db = DatabaseRepository()
    wipe = lambda: (sql(db, "DELETE FROM repositories WHERE lower(url) = %s", (TARGET["url"],)),
                    sql(db, "DELETE FROM resources WHERE lower(source_url) = %s", (TARGET["url"],)))
    wipe()
    yield db
    wipe()


def test_verification_queues_then_reuses_an_indexed_repository(clean_target):
    db = clean_target
    conn = db.get_connection()
    with conn.cursor() as cur:
        first = BriefStore.queue_verification(cur, TARGET)
        conn.commit()
    assert first["state"] == "queued"
    [(status, branch)] = sql(db, "SELECT status, default_branch FROM repositories WHERE id = %s", (first["repositoryId"],))
    assert (status, branch) == ("PENDING", "develop")
    sql(db, "UPDATE repositories SET status = 'READY' WHERE id = %s", (first["repositoryId"],))
    sql(db, "UPDATE ingestion_jobs SET status = 'COMPLETED' WHERE repository_id = %s", (first["repositoryId"],))
    with conn.cursor() as cur:
        second = BriefStore.queue_verification(cur, TARGET)
        conn.commit()
    conn.close()
    assert second["state"] == "reused" and second["repositoryId"] == first["repositoryId"]
    assert sql(db, "SELECT COUNT(*) FROM ingestion_jobs WHERE repository_id = %s", (first["repositoryId"],)) == [(1,)]
    skipped = BriefStore.queue_verification(None, {"fullName": "x/y", "url": "u", "state": "skipped", "reason": "REPOSITORY_TOO_LARGE"})
    assert skipped == {"fullName": "x/y", "state": "skipped", "reason": "REPOSITORY_TOO_LARGE"}
