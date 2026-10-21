"""Phase 4 memory: semantic (recall, revalidation, source reliability, corrections), episodic (run episodes,
similar past runs) and procedural (distillation, activation, planner hints), plus strategy ingestion."""
import json
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from psycopg2.extras import Json

from apps.worker import claims, memory
from apps.worker.db.repository import DatabaseRepository
from apps.worker.discovery.planner import plan_queries
from apps.worker.discovery.runner import DiscoveryRunner
from apps.worker.memory import episodic, procedural, revalidation, semantic, strategy
from apps.worker.orchestrator import handlers, store as task_store
from apps.worker.providers import ledger
from apps.worker.providers.llm import BaseLLMProvider
from apps.worker.tuning import default_tuning

ORBIT = {"name": "Orbit propagation", "description": "Propagate satellite orbits from TLE with SGP4", "criticality": "MUST"}
REQUIREMENTS = {"problemSummary": "Track satellites in the browser", "domains": ["space"], "requirements": [ORBIT]}


@pytest.fixture
def db():
    return DatabaseRepository()


@pytest.fixture
def conn(db):
    c = db.get_connection()
    yield c
    c.rollback()
    with c.cursor() as cur:
        cur.execute("DELETE FROM claims WHERE subject LIKE 'github:p4test-%%'")
        cur.execute("DELETE FROM source_stats WHERE source LIKE 'github:p4test-%%'")
        cur.execute("DELETE FROM revalidation_checks WHERE subject LIKE 'github:p4test-%%'")
        cur.execute("DELETE FROM repositories WHERE owner LIKE 'p4test-%%'")
        cur.execute("DELETE FROM strategy_records WHERE run_id LIKE 'p4test-%%'")
        cur.execute("DELETE FROM procedures WHERE kind = 'research_strategy' AND trigger_json->>'domain' LIKE 'p4test-%%'")
        cur.execute("DELETE FROM workspaces WHERE name LIKE 'p4test %%'")
    c.commit()
    c.close()


def workspace(cur) -> str:
    cur.execute("INSERT INTO workspaces (name) VALUES (%s) RETURNING id::text", (f"p4test {uuid.uuid4().hex[:8]}",))
    return cur.fetchone()[0]


def brief(cur, ws, title="Satellite tracker", requirements=REQUIREMENTS, discovered=True) -> str:
    cur.execute(
        """
        INSERT INTO briefs (title, brief_text, content_hash, requirements_json, workspace_id, discovered_at, discovery_json)
        VALUES (%s, %s, %s, %s, %s, CASE WHEN %s THEN NOW() END, %s) RETURNING id::text
        """,
        (title, title, uuid.uuid4().hex, Json(requirements), ws, discovered,
         Json({"tuningVersion": "cfg-test", "queries": [{"query": "sgp4 propagation", "requirement": "Orbit propagation", "results": 9}]}))
    )
    brief_id = cur.fetchone()[0]
    task_store.create_run(cur, brief_id)
    return brief_id


def candidate(cur, brief_id, full_name, shortlisted=False, coverage="yes", matched=("Orbit propagation",), queries=("sgp4 propagation",)):
    cur.execute(
        """
        INSERT INTO brief_candidates (brief_id, full_name, source_url, description, stars, forks, open_issues, license, pushed_at,
            matched_queries, matched_requirements, relevance_score, health_score, coverage_score, final_score, rank, shortlisted, assessment_json)
        VALUES (%s, %s, %s, 'An SGP4 orbit library', 500, 10, 1, 'MIT', NOW(), %s, %s, 0.5, 0.5, 0.8, 0.6,
                (SELECT COUNT(*) + 1 FROM brief_candidates WHERE brief_id = %s), %s, %s)
        """,
        (brief_id, full_name, f"https://github.com/{full_name}", list(queries), list(matched), brief_id, shortlisted,
         Json({"summary": "SGP4 propagation library", "kind": "library", "coverage": {"Orbit propagation": coverage}}))
    )


def finish_run(cur, brief_id, stop_reason=None):
    if stop_reason:
        cur.execute("UPDATE tasks SET status = 'failed' WHERE brief_id = %s AND type = 'understand'", (brief_id,))
        cur.execute("UPDATE briefs SET stop_reason = %s WHERE id = %s", (stop_reason, brief_id))
    else:
        cur.execute("UPDATE tasks SET status = 'done', output_hash = md5(random()::text) WHERE brief_id = %s", (brief_id,))
    task_store.sync_brief_status(cur, brief_id)


# Semantic memory: recall

def test_recall_offers_repositories_with_current_claims_only(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        b = brief(cur, ws)
        good = claims.upsert_claim(cur, "github:p4test-a/orbit-lib", "capability", "SGP4 orbit propagation: propagates satellite orbits from TLE", "E2",
                                   {"method": "code_located"}, subject_version="abc")
        stale = claims.upsert_claim(cur, "github:p4test-b/old-orbit", "capability", "Orbit propagation with SGP4 for satellites", "E2",
                                    {"method": "code_located"}, subject_version="old")
        cur.execute("UPDATE claims SET status = 'needs_revalidation' WHERE id = %s", (stale,))
        expired = claims.upsert_claim(cur, "github:p4test-c/expired", "capability", "Satellite orbit propagation SGP4", "E2", {"method": "code_located"})
        cur.execute("UPDATE claims SET revalidate_after = NOW() - INTERVAL '1 day' WHERE id = %s", (expired,))

        result = memory.recall(cur, {"id": b, "workspace_id": ws, "title": "Satellite tracker"}, REQUIREMENTS)
        names = {c["fullName"]: c for c in result["candidates"]}
        assert "p4test-a/orbit-lib" in names
        # A claim needing revalidation or past its date is never offered as current knowledge
        assert "p4test-b/old-orbit" not in names and "p4test-c/expired" not in names
        remembered = names["p4test-a/orbit-lib"]
        assert remembered["provenance"] == "memory" and remembered["matchedRequirements"] == ["Orbit propagation"]
        assert remembered["claims"][0]["id"] == good and remembered["claims"][0]["current"] is True
        assert remembered["lastVerifiedAt"] and remembered["meta"]["source_url"] == "https://github.com/p4test-a/orbit-lib"


def test_recall_reuses_a_recent_brief_and_skips_its_searches(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        earlier = brief(cur, ws, "Earlier satellite brief")
        for i in range(3):
            candidate(cur, earlier, f"p4test-r/orbit-{i}", shortlisted=True)
        current = brief(cur, ws, "Satellite tracker again", discovered=False)
        result = memory.recall(cur, {"id": current, "workspace_id": ws, "title": "Satellite tracker again"}, REQUIREMENTS)
        assert {c["fullName"] for c in result["candidates"]} >= {f"p4test-r/orbit-{i}" for i in range(3)}
        assert [s["requirement"] for s in result["skipRequirements"]] == ["Orbit propagation"]
        remembered = next(c for c in result["candidates"] if c["fullName"] == "p4test-r/orbit-0")
        assert remembered["assessment"]["coverage"] == {"Orbit propagation": "yes"} and remembered["assessment"]["fromBrief"] == earlier

        # Another workspace never sees these briefs
        other = workspace(cur)
        assert memory.recall(cur, {"id": None, "workspace_id": other, "title": "x"}, REQUIREMENTS)["skipRequirements"] == []


def test_merge_adds_remembered_candidates_with_provenance():
    searched = [{"full_name": "found/by-search", "source_url": "https://github.com/found/by-search", "stars": 50, "forks": 1, "open_issues": 0,
                 "license": "MIT", "pushed_at": datetime.now(timezone.utc).isoformat(), "matched_queries": ["sgp4"],
                 "matched_requirements": ["Orbit propagation"], "best_position": 0, "candidate_kind": "library",
                 "relevance_score": 0.5, "health_score": 0.5, "coverage_score": 0.2, "final_score": 0.3, "rank": 1, "shortlisted": False,
                 "assessment": {"coverage": {"Orbit propagation": "partial"}}}]
    remembered = [
        {"fullName": "mem/orbit", "matchedRequirements": ["Orbit propagation"], "via": ["workspace_briefs"], "lastVerifiedAt": "2026-10-01",
         "claims": [{"id": "c1", "kind": "coverage", "grade": "E4", "statement": "covers", "status": "current", "current": True,
                     "observedAt": "2026-10-01", "revalidatedAt": None}],
         "assessment": {"summary": "SGP4", "kind": "library", "coverage": {"Orbit propagation": "yes"}, "fromBrief": "b0"},
         "meta": {"source_url": "https://github.com/mem/orbit", "stars": 900, "forks": 9, "open_issues": 0, "license": "MIT",
                  "pushed_at": datetime.now(timezone.utc).isoformat(), "topics": [], "description": "sgp4 orbit"}},
        {"fullName": "found/by-search", "matchedRequirements": ["Orbit propagation"], "claims": [], "via": ["claims"]},
    ]
    counts = memory.merge_remembered(searched, remembered, REQUIREMENTS, 2, default_tuning())
    assert counts == {"added": 1, "alsoFound": 1, "assessmentsReused": 0}
    by_name = {c["full_name"]: c for c in searched}
    assert by_name["mem/orbit"]["provenance"] == ["memory"] and by_name["mem/orbit"]["shortlisted"]
    assert by_name["found/by-search"]["provenance"] == ["search", "memory"]
    assert [c["rank"] for c in searched] == [1, 2] and searched[0]["full_name"] == "mem/orbit"


def test_merge_reuses_memory_assessment_for_unassessed_search_hits():
    # Found by search but outside this run's README limit: the assessment memory holds ranks it instead of no coverage
    unassessed = {"full_name": "found/unassessed", "source_url": "https://github.com/found/unassessed", "stars": 5000, "forks": 1,
                  "open_issues": 0, "license": "MIT", "pushed_at": datetime.now(timezone.utc).isoformat(), "matched_queries": ["sgp4"],
                  "matched_requirements": ["Orbit propagation"], "best_position": 3, "candidate_kind": "unknown",
                  "relevance_score": 0.4, "health_score": 0.8, "coverage_score": None, "final_score": 0.2, "rank": 2,
                  "shortlisted": False, "assessment": {}}
    assessed = {**unassessed, "full_name": "found/assessed", "coverage_score": 0.2, "candidate_kind": "library", "final_score": 0.3,
                "rank": 1, "assessment": {"coverage": {"Orbit propagation": "partial"}}}
    searched = [assessed, unassessed]
    remembered = [{"fullName": "found/unassessed", "matchedRequirements": ["Orbit propagation"], "claims": [], "via": ["workspace_briefs"],
                   "assessment": {"summary": "SGP4", "kind": "library", "coverage": {"Orbit propagation": "yes"}, "fromBrief": "b0"}},
                  {"fullName": "found/assessed", "matchedRequirements": ["Orbit propagation"], "claims": [], "via": ["workspace_briefs"],
                   "assessment": {"kind": "library", "coverage": {"Orbit propagation": "no"}, "fromBrief": "b0"}}]
    counts = memory.merge_remembered(searched, remembered, REQUIREMENTS, 2, default_tuning())
    assert counts == {"added": 0, "alsoFound": 2, "assessmentsReused": 1}
    by_name = {c["full_name"]: c for c in searched}
    # This run's own assessment is never replaced; the unassessed hit now carries memory's and ranks first
    assert by_name["found/assessed"]["assessment"]["coverage"] == {"Orbit propagation": "partial"}
    assert by_name["found/unassessed"]["candidate_kind"] == "library" and by_name["found/unassessed"]["coverage_score"] is not None
    assert searched[0]["full_name"] == "found/unassessed" and searched[0]["rank"] == 1


class SilentLLM(BaseLLMProvider):
    def complete(self, prompt, system=None):
        raise RuntimeError("no LLM in this test")


class CountingGitHub:
    authenticated = True

    def __init__(self):
        self.queries = []

    def search_repositories(self, query, per_page=15, min_stars=None):
        self.queries.append(query)
        return []

    def fetch_readme(self, full_name):
        return ""


def test_runner_skips_queries_memory_answers():
    two = {**REQUIREMENTS, "requirements": [ORBIT, {"name": "Globe rendering", "description": "3D globe", "criticality": "MUST"}]}
    github = CountingGitHub()
    result = DiscoveryRunner(SilentLLM(), github, sleep=lambda s: None, skip_query=lambda q: q["requirement"] == "Orbit propagation").run(two)
    assert result["metrics"]["queriesSkipped"] == ["Orbit propagation"]
    assert not any("orbit" in q.lower() for q in github.queries) and any("globe" in q.lower() for q in github.queries)
    without = DiscoveryRunner(SilentLLM(), CountingGitHub(), sleep=lambda s: None).run(two)
    assert "queriesSkipped" not in without["metrics"]


def test_run_discover_merges_memory_and_records_metrics(monkeypatch):
    seen = {}

    class FakeRunner:
        def __init__(self, llm, github, on_step=None, tuning=None, skip_query=None, procedures=None, registry_search=None):
            seen["skip"] = skip_query
            seen["procedures"] = procedures

        def run(self, requirements):
            return {"candidates": [], "metrics": {"queries": [{"query": "sgp4 propagation"}], "queryPlanner": "llm",
                                                  "queriesSkipped": ["sgp4 propagation"]}}

    monkeypatch.setattr(handlers, "DiscoveryRunner", FakeRunner)
    monkeypatch.setattr(handlers, "GitHubSearchClient", lambda: type("G", (), {"close": lambda self: None})())
    recall = {"candidates": [{"fullName": "mem/orbit", "matchedRequirements": ["Orbit propagation"], "claims": [], "via": ["claims"],
                              "meta": {"source_url": "https://github.com/mem/orbit", "stars": 5}}],
              "skipRequirements": [{"requirement": "Orbit propagation"}],
              "procedures": [{"id": "p1", "requirement": "Orbit propagation", "steps": {"query": "sgp4"}}]}
    ctx = handlers.TaskContext(task={"type": "discover"}, brief={"id": "b", "workspace_id": None, "requirements_json": REQUIREMENTS, "constraints_json": {}},
                               outputs={"understand": {"requirements": REQUIREMENTS}, "recall": recall}, tuning=default_tuning(),
                               llm_for=lambda key: None, db=None)
    outcome = handlers.run_discover(ctx)
    assert seen["skip"]({"requirement": "Orbit propagation"}) and not seen["skip"]({"requirement": "Other"})
    assert seen["procedures"][0]["id"] == "p1"
    metrics = outcome.output["metrics"]
    assert metrics["memoryCandidates"] == 1 and metrics["searchesAvoided"] == 1 and metrics["proceduresApplied"] == ["p1"]
    assert outcome.output["ranked"] == ["mem/orbit"]
    # Recall output changes what discover depends on
    assert handlers.fingerprint(ctx) != handlers.fingerprint(handlers.TaskContext(**{**ctx.__dict__, "outputs": {"understand": {"requirements": REQUIREMENTS}}}))


# Semantic memory: revalidation

def github_transport(pushed_at, head, calls):
    def handle(request):
        calls.append(str(request.url))
        if request.url.path.endswith("/commits/main"):
            return httpx.Response(200, text=head)
        return httpx.Response(200, json={"full_name": "p4test-v/lib", "pushed_at": pushed_at, "default_branch": "main",
                                         "license": {"spdx_id": "MIT"}, "private": False})
    return httpx.MockTransport(handle)


def indexed_subject(cur, commit="aaa"):
    cur.execute(
        "INSERT INTO repositories (owner, name, url, latest_commit_hash, status) VALUES ('p4test-v', 'lib', 'https://github.com/p4test-v/lib', %s, 'READY') RETURNING id::text",
        (commit,)
    )
    repo_id = cur.fetchone()[0]
    subject = "github:p4test-v/lib"
    cap = claims.upsert_claim(cur, subject, "capability", "Propagation: SGP4", "E2", {"method": "code_located"}, subject_version=commit)
    claims.upsert_claim(cur, subject, "maintenance", "Last push on 2026-01-01", "E3",
                        {"method": "platform_api", "sourceUrl": "https://api.github.com/repos/p4test-v/lib"})
    cur.execute("UPDATE claims SET revalidate_after = NOW() - INTERVAL '1 day' WHERE subject = %s", (subject,))
    return repo_id, subject, cap


def test_revalidation_keeps_an_unchanged_source_current(conn):
    sink = ledger.MemorySink()
    ledger.add_sink(sink)
    try:
        with conn.cursor() as cur:
            repo_id, subject, cap = indexed_subject(cur)
            calls = []
            client = revalidation.GitHubStateClient(token="t", http=httpx.Client(transport=github_transport("2026-01-01T10:00:00Z", "aaa", calls)))
            result = revalidation.check_subject(cur, client, subject)
            assert result["outcome"] == "unchanged"
            assert len(calls) == 1  # nothing pushed since the claims were seen: no commit lookup
            cur.execute("SELECT status, revalidate_after > NOW(), revalidated_at IS NOT NULL FROM claims WHERE id = %s", (cap,))
            assert cur.fetchone() == ("current", True, True)
            cur.execute("SELECT COUNT(*) FROM ingestion_jobs WHERE repository_id = %s", (repo_id,))
            assert cur.fetchone()[0] == 0
    finally:
        ledger.remove_sink(sink)
    assert [e["provider"] for e in sink.entries] == ["github"]  # metered through the ledger


def test_revalidation_of_a_changed_source_marks_claims_and_queues_a_reindex(conn):
    with conn.cursor() as cur:
        repo_id, subject, cap = indexed_subject(cur)
        calls = []
        pushed = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
        client = revalidation.GitHubStateClient(token="t", http=httpx.Client(transport=github_transport(pushed, "bbb", calls)))
        result = revalidation.check_subject(cur, client, subject)
        assert result["outcome"] == "changed" and result["currentVersion"] == "bbb" and result["reindex"] == "queued"
        assert len(calls) == 2
        cur.execute("SELECT status FROM claims WHERE id = %s", (cap,))
        assert cur.fetchone()[0] == "needs_revalidation"  # never shown as current again until re-read
        cur.execute("SELECT status, statement FROM claims WHERE subject = %s AND kind = 'maintenance' ORDER BY statement", (subject,))
        facts = cur.fetchall()
        assert ("superseded", "Last push on 2026-01-01") in facts and ("current", f"Last push on {pushed[:10]}") in facts
        cur.execute("SELECT status FROM ingestion_jobs WHERE repository_id = %s", (repo_id,))
        assert [r[0] for r in cur.fetchall()] == ["QUEUED"]
        cur.execute("SELECT claims_stale FROM source_stats WHERE source = %s AND source_type = 'code'", (subject,))
        assert cur.fetchone()[0] == 1
        # A second change while the job is queued does not queue another
        assert revalidation.queue_reindex(cur, repo_id, None) == "queued"
        cur.execute("SELECT COUNT(*) FROM ingestion_jobs WHERE repository_id = %s", (repo_id,))
        assert cur.fetchone()[0] == 1
        # Once the index is READY at the new commit the check is applied
        cur.execute("UPDATE repositories SET status = 'READY', latest_commit_hash = 'bbb' WHERE id = %s", (repo_id,))
        assert revalidation.apply_reindexed(cur) == 1
        cur.execute("SELECT reindex_status FROM revalidation_checks WHERE id = %s", (result["id"],))
        assert cur.fetchone()[0] == "applied"


def test_due_subjects_are_those_of_recent_briefs(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        b = brief(cur, ws)
        _, subject, _ = indexed_subject(cur)
        assert subject not in revalidation.due_subjects(cur, 1000)
        candidate(cur, b, "p4test-v/lib", shortlisted=True)
        assert subject in revalidation.due_subjects(cur, 1000)


# Semantic memory: source reliability and corrections

def test_code_evidence_corroborates_a_readme_claim(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        b = brief(cur, ws)
        subject = "github:p4test-s/orbit"
        claims.upsert_claim(cur, subject, "coverage", "README indicates it covers: Orbit propagation", "E4",
                            {"method": "readme_assessment", "sourceUrl": "https://github.com/p4test-s/orbit"}, brief_id=b, workspace_id=ws)
        assert semantic.corroborate_coverage(cur, subject) == 0  # nothing backs it yet
        claims.upsert_claim(cur, subject, "capability", "Orbit propagation: SGP4 propagator", "E2", {"method": "code_located"}, subject_version="c1")
        assert semantic.corroborate_coverage(cur, subject) == 1
        assert semantic.corroborate_coverage(cur, subject) == 0  # idempotent
        score = memory.reliability(cur, subject, "readme")
        assert score["verified"] == 1 and score["score"] > 0.5


def test_refutation_downgrades_the_claim_and_rewrites_citing_blueprints(conn):
    with conn.cursor() as cur:
        ws, other_ws = workspace(cur), workspace(cur)
        subject = "github:p4test-f/lib"
        claim_id = claims.upsert_claim(cur, subject, "capability", "Propagation: SGP4", "E2", {"method": "code_located"}, subject_version="x")
        citing, unrelated, elsewhere = brief(cur, ws), brief(cur, ws), brief(cur, other_ws)
        for b, cited in ((citing, claim_id), (unrelated, str(uuid.uuid4())), (elsewhere, claim_id)):
            finish_run(cur, b)
            cur.execute("INSERT INTO brief_blueprints (brief_id, status, step, blueprint_json) VALUES (%s, 'COMPLETED', 'DONE', %s)",
                        (b, Json({"sources": [{"id": "C1", "claimId": cited}], "components": []})))
        result = memory.refute_claim(cur, claim_id, "It only supports SDP4", ws)
        assert result["invalidatedBriefs"] == [citing]
        cur.execute("SELECT status, grade, evidence_json->-1->>'method', evidence_json->-1->>'previousGrade' FROM claims WHERE id = %s", (claim_id,))
        assert cur.fetchone() == ("refuted", "E5", "user_refutation", "E2")
        cur.execute("SELECT brief_id::text, status, inputs_fingerprint FROM tasks WHERE type = 'blueprint' AND brief_id = ANY(%s::uuid[])",
                    ([citing, unrelated, elsewhere],))
        tasks = {r[0]: (r[1], r[2]) for r in cur.fetchall()}
        assert tasks[citing] == ("stale", None)
        assert tasks[unrelated][0] == "done" and tasks[elsewhere][0] == "done"
        cur.execute("SELECT claims_refuted FROM source_stats WHERE source = %s AND source_type = 'code'", (subject,))
        assert cur.fetchone()[0] == 1
        cur.execute("SELECT outcome, detail_json->>'reason' FROM episodes WHERE brief_id = %s AND kind = 'event'", (citing,))
        assert cur.fetchone() == ("refuted", "It only supports SDP4")
        cur.execute("SELECT feedback_json->0->>'outcome' FROM episodes WHERE brief_id = %s AND kind = 'run'", (citing,))
        assert cur.fetchone()[0] == "refuted"
        # Confirming records evidence without raising the grade
        memory.confirm_claim(cur, claim_id, ws, "checked by hand")
        cur.execute("SELECT grade, evidence_json->-1->>'method' FROM claims WHERE id = %s", (claim_id,))
        assert cur.fetchone() == ("E5", "user_confirmation")


def test_project_claims_of_another_workspace_cannot_be_corrected(conn):
    with conn.cursor() as cur:
        ws, other = workspace(cur), workspace(cur)
        b = brief(cur, ws)
        scoped = claims.upsert_claim(cur, "github:p4test-w/x", "coverage", "README indicates it covers: Orbit propagation", "E4",
                                     {"method": "readme_assessment"}, brief_id=b, workspace_id=ws)
        assert memory.refute_claim(cur, scoped, "no", other) is None
        assert memory.refute_claim(cur, scoped, "no", ws)["status"] == "refuted"


# Episodic memory

def test_a_completed_run_is_remembered_as_an_episode(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        b = brief(cur, ws)
        candidate(cur, b, "p4test-e/orbit", shortlisted=True)
        candidate(cur, b, "p4test-e/awesome", coverage="no")
        finish_run(cur, b)
        cur.execute("SELECT outcome, shortlisted_json, queries_json, rejected_json, tuning_version, summary FROM episodes WHERE brief_id = %s AND kind = 'run'", (b,))
        outcome, shortlisted, queries, rejected, tuning, summary = cur.fetchone()
        assert outcome == "completed" and shortlisted == ["p4test-e/orbit"] and tuning == "cfg-test"
        assert queries[0]["query"] == "sgp4 propagation" and queries[0]["newCandidates"] == 2 and queries[0]["shortlistedFound"] == ["p4test-e/orbit"]
        assert rejected == [{"fullName": "p4test-e/awesome", "reason": "README does not fully cover any requirement"}]
        assert "p4test-e/orbit" in summary
        task_store.sync_brief_status(cur, b)  # the same state again writes nothing new
        cur.execute("SELECT COUNT(*) FROM episodes WHERE brief_id = %s", (b,))
        assert cur.fetchone()[0] == 1


def test_a_budget_stop_is_remembered(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        b = brief(cur, ws)
        finish_run(cur, b, stop_reason="budget")
        cur.execute("SELECT outcome, provenance_json->>'stopReason' FROM episodes WHERE brief_id = %s", (b,))
        assert cur.fetchone() == ("stopped", "budget")


def test_recall_surfaces_a_similar_past_run(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        past = brief(cur, ws, "Satellite tracker for a ground station")
        candidate(cur, past, "p4test-e/orbit", shortlisted=True)
        finish_run(cur, past)
        unrelated = brief(cur, ws, "Invoice OCR", {"problemSummary": "Read invoices", "requirements": [{"name": "Invoice OCR", "description": "scan pdf invoices"}]})
        finish_run(cur, unrelated)
        now = brief(cur, ws, "Satellite tracker", discovered=False)
        similar = memory.recall(cur, {"id": now, "workspace_id": ws, "title": "Satellite tracker"}, REQUIREMENTS)["similarEpisodes"]
        assert [e["briefId"] for e in similar] == [past]
        assert "shortlisted p4test-e/orbit" in similar[0]["note"]


# Procedural memory

def episode(cur, ws, query="sgp4 propagation", found=("x/orbit",), feedback=()):
    b = brief(cur, ws)
    cur.execute(
        """
        INSERT INTO episodes (workspace_id, brief_id, kind, run_key, outcome, title, queries_json, feedback_json)
        VALUES (%s, %s, 'run', md5(random()::text), 'completed', 't', %s, %s) RETURNING id::text
        """,
        (ws, b, Json([{"query": query, "requirement": "Orbit propagation", "shortlistedFound": list(found)}]), Json(list(feedback)))
    )
    return cur.fetchone()[0]


def procedures_of(cur, ws):
    cur.execute("SELECT kind, status, success_count, steps_json->>'query' FROM procedures WHERE workspace_id = %s", (ws,))
    return cur.fetchall()


def test_distillation_needs_recurring_success(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        episode(cur, ws)
        episode(cur, ws)
        procedural.distill(cur, ws)
        assert procedures_of(cur, ws) == []  # two briefs are not a pattern
        episode(cur, ws)
        procedural.distill(cur, ws)
        assert procedures_of(cur, ws) == [("query_pattern", "candidate", 3, "sgp4 propagation")]


def test_distillation_ignores_contradicted_patterns(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        for _ in range(3):
            episode(cur, ws)
        episode(cur, ws, found=())  # the same query found nothing for the same kind of requirement
        procedural.distill(cur, ws)
        assert procedures_of(cur, ws) == []
        ws2 = workspace(cur)
        for _ in range(2):
            episode(cur, ws2)
        episode(cur, ws2, feedback=[{"outcome": "refuted"}])  # a refuted run is not a success
        procedural.distill(cur, ws2)
        assert procedures_of(cur, ws2) == []


def insert_procedure(cur, ws, status, terms, query, successes=3):
    cur.execute(
        """
        INSERT INTO procedures (workspace_id, kind, name, trigger_key, trigger_json, steps_json, success_count, status)
        VALUES (%s, 'query_pattern', %s, md5(random()::text), %s, %s, %s, %s) RETURNING id::text
        """,
        (ws, f"Search {query}", Json({"requirementTerms": terms}), Json({"query": query}), successes, status)
    )
    return cur.fetchone()[0]


class RecordingLLM(BaseLLMProvider):
    def __init__(self):
        self.prompts = []

    def complete(self, prompt, system=None):
        self.prompts.append(prompt)
        return json.dumps({"queries": [{"query": "sgp4 library", "requirement": "Orbit propagation"}, {"query": "satellite tracker", "requirement": "(overall)"}]})


def test_planner_receives_only_active_matching_procedures(conn):
    with conn.cursor() as cur:
        ws, other = workspace(cur), workspace(cur)
        active = insert_procedure(cur, ws, "active", ["orbit", "propagation"], "sgp4 propagation")
        insert_procedure(cur, ws, "candidate", ["orbit", "propagation"], "orbit candidate")
        insert_procedure(cur, ws, "active", ["invoice", "ocr"], "invoice ocr")
        insert_procedure(cur, ws, "retired", ["orbit"], "orbit retired")
        insert_procedure(cur, other, "active", ["orbit"], "other workspace")
        matched = procedural.active_for(cur, ws, REQUIREMENTS)
        assert [p["id"] for p in matched] == [active] and matched[0]["requirement"] == "Orbit propagation"

    llm = RecordingLLM()
    plan_queries(llm, REQUIREMENTS, procedures=matched)
    assert '"sgp4 propagation" found the solution in 3 earlier briefs' in llm.prompts[0]
    assert "orbit candidate" not in llm.prompts[0] and "invoice" not in llm.prompts[0]
    plan_queries(llm, REQUIREMENTS)
    assert "Queries that worked" not in llm.prompts[1]  # no procedures, unchanged prompt


def test_activation_needs_a_maintainer_and_measured_support(conn):
    with conn.cursor() as cur:
        ws, other = workspace(cur), workspace(cur)
        weak = insert_procedure(cur, ws, "candidate", ["orbit"], "weak", successes=2)
        strong = insert_procedure(cur, ws, "candidate", ["orbit"], "strong", successes=3)
        with pytest.raises(procedural.ProcedureError, match="maintainer"):
            procedural.activate(cur, strong, "member", workspace_id=ws)
        with pytest.raises(procedural.ProcedureError, match="at least 3"):
            procedural.activate(cur, weak, "maintainer", workspace_id=ws)
        with pytest.raises(procedural.ProcedureError, match="not found"):
            procedural.activate(cur, strong, "maintainer", workspace_id=other)
        assert procedural.activate(cur, strong, "maintainer", workspace_id=ws)["status"] == "active"
        procedural.retire(cur, strong, "maintainer", workspace_id=ws)
        with pytest.raises(procedural.ProcedureError, match="retired"):
            procedural.activate(cur, strong, "maintainer", workspace_id=ws)


def test_failing_procedures_retire_themselves(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        p = insert_procedure(cur, ws, "active", ["orbit"], "flaky", successes=0)
        for success in (True, False, False, True):
            procedural.record_outcome(cur, [p], success=success)
        cur.execute("SELECT status, uses_count, success_count, failure_count FROM procedures WHERE id = %s", (p,))
        assert cur.fetchone() == ("retired", 4, 2, 2)


def test_episode_outcome_updates_the_procedures_it_used(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        p = insert_procedure(cur, ws, "active", ["orbit"], "sgp4", successes=3)
        b = brief(cur, ws)
        cur.execute("UPDATE tasks SET output_json = %s WHERE brief_id = %s AND type = 'discover'",
                    (Json({"metrics": {"proceduresApplied": [p], "memoryCandidates": 2}}), b))
        finish_run(cur, b)
        cur.execute("SELECT success_count, uses_count FROM procedures WHERE id = %s", (p,))
        assert cur.fetchone() == (4, 1)
        cur.execute("SELECT procedures_used::text[], memory_json FROM episodes WHERE brief_id = %s", (b,))
        used, mem = cur.fetchone()
        assert used == [p] and mem == {"memoryCandidates": 2}


# Strategy records

def test_strategy_records_are_ingested_per_brief_class(conn, tmp_path):
    def result(run_id, recall):
        return {"runId": run_id, "suite": "suite-v1", "system": "b1", "mode": "fill", "tuningVersion": "cfg-p4test", "model": "m",
                "labelsStatus": "draft", "finishedAt": "2026-10-21T00:00:00+00:00",
                "aggregate": {"briefs": 2, "recallAt10": recall},
                "briefs": [{"briefId": "a", "domain": "p4test-geo", "scores": {"recallAt10": recall, "shortlistPrecision": 0.5}, "durationMs": 10,
                            "ledger": {"llmCalls": 3}},
                           {"briefId": "b", "domain": "p4test-geo", "scores": {"recallAt10": recall / 2}, "durationMs": 30, "ledger": {"llmCalls": 1}}]}
    for i in range(3):
        (tmp_path / f"run{i}.json").write_text(json.dumps(result(f"p4test-run{i}", 0.6)))
    (tmp_path / "notes.json").write_text("[]")
    with conn.cursor() as cur:
        assert strategy.ingest(cur, [str(tmp_path)]) == {"files": 4, "records": 6}
        assert strategy.ingest(cur, [str(tmp_path)])["records"] == 6  # re-ingesting updates, never duplicates
        cur.execute("SELECT brief_class, briefs, metrics_json FROM strategy_records WHERE run_id = 'p4test-run0' ORDER BY brief_class")
        rows = cur.fetchall()
        assert [r[0] for r in rows] == ["all", "p4test-geo"]
        assert rows[1][1] == 2 and rows[1][2]["recallAt10"] == 0.45 and rows[1][2]["llmCalls"] == 4 and rows[1][2]["meanDurationMs"] == 20
        procedural.distill(cur)
        cur.execute("SELECT status, steps_json->>'tuningVersion', evidence_json->'evalRuns' FROM procedures WHERE kind = 'research_strategy' AND trigger_json->>'domain' = 'p4test-geo'")
        assert cur.fetchone() == ("candidate", "cfg-p4test", ["p4test-run0", "p4test-run1", "p4test-run2"])


def test_memory_maintenance_is_rate_limited(db):
    ticks = iter([0, 10, 400])
    passes = []

    class Client:
        def close(self):
            pass

    maintenance = revalidation.MemoryMaintenance(db, interval_seconds=300, clock=lambda: next(ticks), client_factory=Client)
    original = revalidation.run_pass
    revalidation.run_pass = lambda db, client: passes.append(1) or {"applied": 0, "checked": []}
    try:
        maintenance.maybe_run()
        maintenance.maybe_run()
        maintenance.maybe_run()
    finally:
        revalidation.run_pass = original
    assert len(passes) == 2
