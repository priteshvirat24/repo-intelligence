import pytest
from psycopg2.extras import Json

from apps.worker.db.briefs import BriefRepository
from apps.worker.db.repository import DatabaseRepository, JobLostError

REQUIREMENTS = {
    "problemSummary": "Queue test brief",
    "requirements": [{"name": "Orbit propagation", "description": "SGP4", "criticality": "MUST"}],
}


@pytest.fixture
def briefs():
    db = DatabaseRepository()
    repo = BriefRepository(db)
    conn = db.get_connection()
    with conn.cursor() as cur:
        # Older queued briefs from other tests or local use must not be claimed first
        cur.execute("UPDATE briefs SET status = 'COMPLETED' WHERE status IN ('QUEUED', 'RUNNING')")
        cur.execute(
            """
            INSERT INTO briefs (title, brief_text, content_hash, requirements_json, created_at)
            VALUES ('Queue test', 'text', 'queue-test-hash', %s, NOW() - INTERVAL '1 hour')
            RETURNING id
            """,
            (Json(REQUIREMENTS),)
        )
        brief_id = str(cur.fetchone()[0])
        conn.commit()
    yield repo, brief_id
    with conn.cursor() as cur:
        cur.execute("DELETE FROM briefs WHERE id = %s", (brief_id,))
        conn.commit()
    conn.close()


def candidate(full_name, rank):
    return {
        "full_name": full_name, "source_url": f"https://github.com/{full_name}", "description": "d",
        "primary_language": "Python", "topics": ["sgp4"], "stars": 10, "forks": 1, "open_issues": 0,
        "license": "MIT", "pushed_at": "2026-09-01T00:00:00Z", "candidate_kind": "library",
        "matched_queries": ["sgp4"], "matched_requirements": ["Orbit propagation"], "relevance_score": 0.5,
        "health_score": 0.5, "coverage_score": 1.0, "final_score": 0.8, "rank": rank, "shortlisted": rank == 1,
        "assessment": {"kind": "library", "coverage": {"Orbit propagation": "yes"}},
    }


def status_of(repo, brief_id):
    conn = repo.db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT status, step, (SELECT COUNT(*) FROM brief_candidates WHERE brief_id = briefs.id) FROM briefs WHERE id = %s", (brief_id,))
            return cur.fetchone()
    finally:
        conn.close()


def test_one_worker_claims_a_brief(briefs):
    repo, brief_id = briefs
    claimed = repo.claim_next_brief("worker-a")
    assert str(claimed["id"]) == brief_id
    assert claimed["requirements_json"]["problemSummary"] == "Queue test brief"
    assert repo.claim_next_brief("worker-b") is None
    assert status_of(repo, brief_id)[:2] == ("RUNNING", "PLANNING_QUERIES")


def test_only_the_owner_can_progress_or_persist(briefs):
    repo, brief_id = briefs
    repo.claim_next_brief("worker-a")
    with pytest.raises(JobLostError):
        repo.update_step(brief_id, "SEARCHING_GITHUB", "worker-b")
    with pytest.raises(JobLostError):
        repo.persist_discovery(brief_id, [candidate("a/b", 1)], {}, "worker-b")
    repo.update_step(brief_id, "SEARCHING_GITHUB", "worker-a")
    assert status_of(repo, brief_id)[1] == "SEARCHING_GITHUB"


def test_persist_replaces_previous_candidates(briefs):
    repo, brief_id = briefs
    repo.claim_next_brief("worker-a")
    repo.persist_discovery(brief_id, [candidate("a/one", 1), candidate("a/two", 2)], {"candidatesFound": 2}, "worker-a")
    assert status_of(repo, brief_id) == ("COMPLETED", "DONE", 2)

    conn = repo.db.get_connection()
    with conn.cursor() as cur:
        cur.execute("UPDATE briefs SET status = 'QUEUED', step = 'QUEUED', attempts = 0 WHERE id = %s", (brief_id,))
        conn.commit()
    conn.close()
    repo.claim_next_brief("worker-a")
    repo.persist_discovery(brief_id, [candidate("a/three", 1)], {"candidatesFound": 1}, "worker-a")
    assert status_of(repo, brief_id) == ("COMPLETED", "DONE", 1)


def test_retry_is_not_claimable_before_its_delay(briefs):
    repo, brief_id = briefs
    repo.claim_next_brief("worker-a")
    assert repo.requeue_for_retry(brief_id, "GITHUB_RATE_LIMITED", "worker-a", 300)
    assert status_of(repo, brief_id)[0] == "QUEUED"
    assert repo.claim_next_brief("worker-b") is None


def test_deleted_brief_is_abandoned(briefs):
    repo, brief_id = briefs
    repo.claim_next_brief("worker-a")
    conn = repo.db.get_connection()
    with conn.cursor() as cur:
        cur.execute("DELETE FROM briefs WHERE id = %s", (brief_id,))
        conn.commit()
    conn.close()
    with pytest.raises(JobLostError):
        repo.update_step(brief_id, "RANKING", "worker-a")
    with pytest.raises(JobLostError):
        repo.persist_discovery(brief_id, [candidate("a/b", 1)], {}, "worker-a")


# Verification queueing and the blueprint gate

TARGET = {
    "fullName": "Test-Owner/BP-Verify",
    "url": "https://github.com/test-owner/bp-verify",
    "meta": {"owner": "Test-Owner", "name": "BP-Verify", "description": "d", "default_branch": "develop",
             "stars": 42, "license": "MIT", "primary_language": "Python", "size_kb": 100},
}


@pytest.fixture
def clean_target(briefs):
    repo, _ = briefs
    def wipe():
        conn = repo.db.get_connection()
        with conn.cursor() as cur:
            cur.execute("DELETE FROM repositories WHERE lower(url) = %s", (TARGET["url"],))
            cur.execute("DELETE FROM resources WHERE lower(source_url) = %s", (TARGET["url"],))
            cur.execute("UPDATE brief_blueprints SET status = 'COMPLETED' WHERE status IN ('WAITING', 'RUNNING')")
            conn.commit()
        conn.close()
    wipe()
    yield
    wipe()


def run_sql(repo, sql, params=()):
    conn = repo.db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall() if cur.description else None
            conn.commit()
            return rows
    finally:
        conn.close()


def discover(repo, brief_id, targets):
    repo.claim_next_brief("worker-a")
    repo.persist_discovery(brief_id, [candidate("a/one", 1)], {}, "worker-a", targets)


def test_discovery_queues_verification_and_blueprint_waits_for_it(briefs, clean_target):
    repo, brief_id = briefs
    discover(repo, brief_id, [TARGET, {"fullName": "x/too-big", "url": "https://github.com/x/too-big", "state": "skipped", "reason": "REPOSITORY_TOO_LARGE"}])

    [(repo_id, status, branch, stars)] = run_sql(repo, "SELECT id, status, default_branch, stars FROM repositories WHERE lower(url) = %s", (TARGET["url"],))
    assert (status, branch, stars) == ("PENDING", "develop", 42)
    assert run_sql(repo, "SELECT status FROM ingestion_jobs WHERE repository_id = %s", (repo_id,)) == [("QUEUED",)]
    [(verification,)] = run_sql(repo, "SELECT verification_json FROM brief_blueprints WHERE brief_id = %s", (brief_id,))
    assert [v["state"] for v in verification] == ["queued", "skipped"]
    assert verification[0]["repositoryId"] == str(repo_id)

    # Still indexing: not claimable
    assert repo.claim_next_blueprint("worker-a") is None
    run_sql(repo, "UPDATE repositories SET status = 'READY' WHERE id = %s", (repo_id,))
    claimed = repo.claim_next_blueprint("worker-a")
    assert claimed and str(claimed["brief_id"]) == brief_id

    inputs = repo.load_blueprint_inputs(claimed)
    assert inputs["requirements"]["problemSummary"] == "Queue test brief"
    assert [v["repository"]["status"] if v["repository"] else None for v in inputs["verification"]] == ["READY", None]

    with pytest.raises(JobLostError):
        repo.persist_blueprint(str(claimed["id"]), {"summary": "x"}, "worker-b")
    repo.persist_blueprint(str(claimed["id"]), {"summary": "x"}, "worker-a")
    assert run_sql(repo, "SELECT status, blueprint_json->>'summary' FROM brief_blueprints WHERE id = %s", (claimed["id"],)) == [("COMPLETED", "x")]


def test_indexed_repository_is_reused_not_reindexed(briefs, clean_target):
    repo, brief_id = briefs
    discover(repo, brief_id, [TARGET])
    [(repo_id,)] = run_sql(repo, "SELECT id FROM repositories WHERE lower(url) = %s", (TARGET["url"],))
    run_sql(repo, "UPDATE repositories SET status = 'READY' WHERE id = %s", (repo_id,))
    run_sql(repo, "UPDATE ingestion_jobs SET status = 'COMPLETED' WHERE repository_id = %s", (repo_id,))
    run_sql(repo, "UPDATE briefs SET status = 'QUEUED', attempts = 0 WHERE id = %s", (brief_id,))

    discover(repo, brief_id, [TARGET])
    [(verification,)] = run_sql(repo, "SELECT verification_json FROM brief_blueprints WHERE brief_id = %s", (brief_id,))
    assert verification[0]["state"] == "reused"
    assert run_sql(repo, "SELECT COUNT(*) FROM ingestion_jobs WHERE repository_id = %s", (repo_id,)) == [(1,)]
    # One blueprint per brief: rediscovery replaced it
    assert run_sql(repo, "SELECT COUNT(*) FROM brief_blueprints WHERE brief_id = %s", (brief_id,)) == [(1,)]


def test_blueprint_stops_waiting_after_the_maximum_wait(briefs, clean_target):
    repo, brief_id = briefs
    discover(repo, brief_id, [TARGET])
    assert repo.claim_next_blueprint("worker-a") is None
    run_sql(repo, "UPDATE brief_blueprints SET created_at = NOW() - INTERVAL '2 days' WHERE brief_id = %s", (brief_id,))
    assert repo.claim_next_blueprint("worker-a") is not None
