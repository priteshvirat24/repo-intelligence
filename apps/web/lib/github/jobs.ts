import { pool } from '@repo/database';

export type QueueRepositoryJobResult =
  | { queued: true; jobId: string }
  | { queued: false; activeJobId: string; activeStatus: string; activeStep: string | null };

/**
 * Queues an ingestion job for a repository, serialized per repository.
 *
 * The repository row is locked (SELECT ... FOR UPDATE) for the whole check-and-insert, so concurrent
 * requests (double clicks, two tabs, add + reindex) cannot queue two jobs for the same repository.
 *
 * supersede:
 *   - 'always':   an active job is marked FAILED/SUPERSEDED and a new job is queued (the worker notices
 *                 it no longer owns the old job and abandons it)
 *   - 'if-stale': an active job is superseded only if it has not progressed for `staleMinutes`;
 *                 otherwise nothing is queued and the active job is returned
 */
export async function queueRepositoryJob(
  repositoryId: string,
  resourceId: string | null,
  options: { supersede: 'always' | 'if-stale'; staleMinutes?: number }
): Promise<QueueRepositoryJobResult> {
  const staleMinutes = options.staleMinutes ?? 10;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT id FROM repositories WHERE id = $1 FOR UPDATE', [repositoryId]);

    const active = await client.query(
      `SELECT id, status, step, updated_at < NOW() - make_interval(mins => $2) AS is_stale
       FROM ingestion_jobs
       WHERE repository_id = $1 AND status IN ('QUEUED', 'RUNNING')
       ORDER BY created_at DESC`,
      [repositoryId, staleMinutes]
    );

    if (active.rows.length > 0) {
      const newest = active.rows[0];
      if (options.supersede === 'if-stale' && !newest.is_stale) {
        await client.query('ROLLBACK');
        return { queued: false, activeJobId: newest.id, activeStatus: newest.status, activeStep: newest.step };
      }
      await client.query(
        `UPDATE ingestion_jobs
         SET status = 'FAILED', step = 'SUPERSEDED', error_message = 'Superseded by new ingestion job', updated_at = NOW()
         WHERE repository_id = $1 AND status IN ('QUEUED', 'RUNNING')`,
        [repositoryId]
      );
    }

    const job = await client.query(
      `INSERT INTO ingestion_jobs (repository_id, resource_id, status, step)
       VALUES ($1, $2, 'QUEUED', 'QUEUED')
       RETURNING id`,
      [repositoryId, resourceId]
    );
    await client.query('COMMIT');
    return { queued: true, jobId: job.rows[0].id };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
