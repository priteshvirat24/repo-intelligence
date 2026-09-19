import pytest
import psycopg2
from apps.worker.db.repository import DatabaseRepository
from apps.worker.config import config

@pytest.fixture
def db_repo():
    return DatabaseRepository()

def test_queue_skip_locked_concurrency(db_repo):
    """Verifies that two simultaneous workers cannot claim the same job."""
    conn = db_repo.get_connection()
    with conn.cursor() as cur:
        # Create a test repo and queued job
        cur.execute(
            """
            INSERT INTO repositories (owner, name, url, status)
            VALUES ('test-owner', 'test-queue-repo', 'https://github.com/test-owner/test-queue-repo', 'PENDING')
            ON CONFLICT (owner, name) DO UPDATE SET status = 'PENDING'
            RETURNING id;
            """
        )
        repo_id = cur.fetchone()[0]

        cur.execute("DELETE FROM ingestion_jobs WHERE repository_id = %s", (repo_id,))
        cur.execute(
            """
            INSERT INTO ingestion_jobs (repository_id, status, step, attempts, created_at)
            VALUES (%s, 'QUEUED', 'QUEUED', 0, NOW() - INTERVAL '2 hours')
            RETURNING id;
            """,
            (repo_id,)
        )
        job_id = cur.fetchone()[0]
        conn.commit()

    try:
        # Worker 1 claims job
        worker1 = DatabaseRepository()
        worker2 = DatabaseRepository()

        claimed_job_1 = worker1.claim_next_job(worker_id="worker-test-1")
        assert claimed_job_1 is not None
        assert claimed_job_1["id"] == job_id

        # Worker 2 attempts to claim while Worker 1 has it locked/RUNNING
        claimed_job_2 = worker2.claim_next_job(worker_id="worker-test-2")
        # Should NOT be the same job
        if claimed_job_2:
            assert claimed_job_2["id"] != job_id

    finally:
        # Cleanup
        with conn.cursor() as cur:
            cur.execute("DELETE FROM repositories WHERE id = %s", (repo_id,))
            conn.commit()
        conn.close()

def test_stale_job_recovery(db_repo):
    """Verifies that a RUNNING job with an expired lock is recovered."""
    conn = db_repo.get_connection()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO repositories (owner, name, url, status)
            VALUES ('test-owner', 'test-stale-repo', 'https://github.com/test-owner/test-stale-repo', 'PENDING')
            ON CONFLICT (owner, name) DO UPDATE SET status = 'PENDING'
            RETURNING id;
            """
        )
        repo_id = cur.fetchone()[0]

        cur.execute("DELETE FROM ingestion_jobs WHERE repository_id = %s", (repo_id,))
        cur.execute(
            """
            INSERT INTO ingestion_jobs (repository_id, status, step, attempts, locked_at, locked_by)
            VALUES (%s, 'RUNNING', 'CLONING', 1, NOW() - INTERVAL '30 minutes', 'crashed-worker')
            RETURNING id;
            """,
            (repo_id,)
        )
        job_id = cur.fetchone()[0]
        conn.commit()

    try:
        # Stale job should be claimed for recovery
        recovered_job = db_repo.claim_next_job(worker_id="recovery-worker")
        assert recovered_job is not None
        assert recovered_job["id"] == job_id
        assert recovered_job["attempts"] == 2
    finally:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM repositories WHERE id = %s", (repo_id,))
            conn.commit()
        conn.close()
