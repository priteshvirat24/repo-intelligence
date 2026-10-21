"""Phase 3, iterating without restarting (PRODUCT_DEFINITION 4.1 step 6), against the database: the brief's
challenges and focus requirements reach the tasks that answer them, and a re-written blueprint keeps the
previous one visible until it replaces it and says what changed. The web side (storing a challenge and
invalidating only the blueprint task) is covered by apps/web/scripts/test-blueprint-iteration.ts."""
import pytest
from psycopg2.extras import Json

from apps.worker.db.briefs import BriefStore
from apps.worker.db.repository import DatabaseRepository
from apps.worker.orchestrator import store as task_store
from apps.worker.orchestrator.handlers import TaskContext, run_blueprint, run_discover
from apps.worker.tuning import default_tuning
from tests.worker.test_blueprint_stages import REQUIREMENTS, StagedLLM

SAT = "shashwatak/satellite-js"
PREVIOUS = {"revision": 1, "summary": "Old", "components": [{"requirement": "Ground tracks", "decision": "build", "class": 5, "repo": None}],
            "sources": [], "verification": [], "integrationSteps": [], "toBuild": [], "risks": []}
CHALLENGE = {"id": "c-1", "requirement": "Ground tracks", "repo": SAT, "note": "satellite.js has eciToGeodetic", "createdAt": "2026-10-21T00:00:00Z"}


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
def brief():
    db = DatabaseRepository()
    [(brief_id,)] = sql(db, """
        INSERT INTO briefs (title, brief_text, content_hash, requirements_json, workspace_id, constraints_json,
                            challenges_json, focus_json, discovery_json, understanding_json)
        VALUES ('Iteration test', 'text', 'iteration-test-hash', %s, '00000000-0000-0000-0000-000000000001', %s, %s, %s, %s, %s)
        RETURNING id
    """, (Json(REQUIREMENTS), Json({"licencePolicy": "permissive-only"}), Json([CHALLENGE]),
          Json([{"requirement": "Pass prediction", "createdAt": "2026-10-21T00:00:00Z"}]),
          Json({"queries": [{"query": "pass prediction python", "requirement": "Pass prediction", "results": 2}]}),
          Json({"acceptanceCriteria": ["Tracks the ISS"]})))
    brief_id = str(brief_id)
    sql(db, """
        INSERT INTO brief_candidates (brief_id, full_name, source_url, stars, forks, open_issues, license, matched_queries,
            matched_requirements, relevance_score, health_score, final_score, rank, shortlisted, assessment_json)
        VALUES (%s, %s, %s, 1000, 10, 1, 'MIT', '{}', '{}', 0.5, 0.5, 0.5, 1, TRUE, %s)
    """, (brief_id, SAT, f"https://github.com/{SAT}", Json({"summary": "SGP4 in JS", "coverage": {"Orbit propagation": "yes"}})))
    conn = db.get_connection()
    with conn.cursor() as cur:
        task_store.create_run(cur, brief_id)
        BriefStore.save_blueprint_state(cur, brief_id, "COMPLETED", "DONE", [], blueprint=PREVIOUS)
        conn.commit()
    conn.close()
    yield db, brief_id
    sql(db, "DELETE FROM briefs WHERE id = %s", (brief_id,))


def test_task_context_carries_challenges_and_focus(brief):
    db, brief_id = brief
    loaded = task_store.TaskStore(db).load_context(brief_id)["brief"]
    assert loaded["challenges_json"] == [CHALLENGE]
    assert [f["requirement"] for f in loaded["focus_json"]] == ["Pass prediction"]


def test_blueprint_inputs_include_policy_challenges_searches_and_the_previous_blueprint(brief):
    db, brief_id = brief
    conn = db.get_connection()
    try:
        inputs = BriefStore.load_blueprint_inputs(conn, brief_id, [])
    finally:
        conn.close()
    assert inputs["constraints"]["licencePolicy"] == "permissive-only"
    assert inputs["challenges"] == [CHALLENGE]
    assert inputs["discoveryQueries"][0]["query"] == "pass prediction python"
    assert inputs["acceptanceCriteria"] == ["Tracks the ISS"]
    assert inputs["previous"]["revision"] == 1


def test_rewritten_blueprint_answers_the_challenge_and_keeps_the_old_one_until_then(brief):
    db, brief_id = brief
    loaded = task_store.TaskStore(db).load_context(brief_id)
    ctx = TaskContext(task={"type": "blueprint", "output_json": {}}, brief=loaded["brief"], outputs={"verify": {"verification": []}},
                      tuning=default_tuning(), llm_for=lambda key: StagedLLM(), db=db)
    outcome = run_blueprint(ctx)
    # While the new one is prepared the previous blueprint is still there, marked as being revised
    [(status, kept)] = sql(db, "SELECT status, blueprint_json->>'summary' FROM brief_blueprints WHERE brief_id = %s", (brief_id,))
    assert (status, kept) == ("RUNNING", "Old")

    conn = db.get_connection()
    with conn.cursor() as cur:
        outcome.persist(cur)
        conn.commit()
    conn.close()
    [(bp,)] = sql(db, "SELECT blueprint_json FROM brief_blueprints WHERE brief_id = %s", (brief_id,))
    assert bp["revision"] == 2 and bp["licencePolicy"] == "permissive-only"
    answer = bp["challenges"][0]
    assert (answer["id"], answer["requirement"], answer["previousClass"]) == ("c-1", "Ground tracks", 5)
    # No code of satellite-js was verified in this brief: only its README is known, so the decision is upheld
    assert answer["repoEvidence"] == "readme-only" and answer["outcome"] == "upheld"
    assert outcome.output["classes"] == bp["classCounts"]


def test_discovery_receives_the_focus_requirements(brief, monkeypatch):
    db, brief_id = brief
    seen = {}

    class Runner:
        def __init__(self, *args, **kwargs):
            pass

        def run(self, requirements):
            seen.update(requirements)
            return {"candidates": [], "metrics": {}}

    class GitHub:
        def close(self):
            pass

    from apps.worker.orchestrator import handlers
    monkeypatch.setattr(handlers, "DiscoveryRunner", Runner)
    monkeypatch.setattr(handlers, "GitHubSearchClient", GitHub)
    loaded = task_store.TaskStore(db).load_context(brief_id)
    ctx = TaskContext(task={"type": "discover", "output_json": {}}, brief=loaded["brief"], outputs={"understand": {"requirements": REQUIREMENTS}},
                      tuning=default_tuning(), llm_for=lambda key: None, db=db)
    run_discover(ctx)
    assert seen["focusRequirements"] == ["Pass prediction"]
    assert "focusRequirements" not in REQUIREMENTS
