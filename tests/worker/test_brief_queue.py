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
