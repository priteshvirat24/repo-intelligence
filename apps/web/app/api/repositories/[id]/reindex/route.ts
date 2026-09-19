import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { GitHubClient } from '@/lib/github/client';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;

    // 1. Fetch current repository record
    const repoRes = await query(`
      SELECT id, owner, name, default_branch, latest_commit_hash, status
      FROM repositories
      WHERE id = $1
    `, [id]);

    if (repoRes.rows.length === 0) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
    }
    const repo = repoRes.rows[0];

    // 2. Prevent duplicate simultaneous running jobs
    const activeJobRes = await query(`
      SELECT id, status, step FROM ingestion_jobs
      WHERE repository_id = $1 AND status IN ('QUEUED', 'RUNNING')
      LIMIT 1
    `, [id]);

    if (activeJobRes.rows.length > 0) {
      return NextResponse.json({
        message: 'An ingestion job is already active for this repository.',
        jobId: activeJobRes.rows[0].id,
        status: activeJobRes.rows[0].status,
        step: activeJobRes.rows[0].step
      }, { status: 409 });
    }

    // 3. Fetch latest commit SHA from GitHub
    const ghClient = new GitHubClient();
    let currentSha: string | null = null;
    try {
      const meta = await ghClient.fetchMetadata(repo.owner, repo.name);
      currentSha = meta.commitSha;
    } catch (err: any) {
      console.warn('Could not check remote commit SHA, queuing reindex anyway:', err.message);
    }

    // 4. Compare commit SHA: If unchanged, return idempotent no-op response
    if (currentSha && repo.latest_commit_hash && currentSha === repo.latest_commit_hash) {
      return NextResponse.json({
        reindexed: false,
        message: 'Repository is already up-to-date with latest commit.',
        commitHash: currentSha,
        status: repo.status
      }, { status: 200 });
    }

    // 5. If changed or unverified: update status to PENDING and queue job
    await query(`
      UPDATE repositories
      SET status = 'PENDING', error_message = NULL, updated_at = NOW()
      WHERE id = $1
    `, [id]);

    const jobRes = await query(`
      INSERT INTO ingestion_jobs (repository_id, status, step)
      VALUES ($1, 'QUEUED', 'QUEUED')
      RETURNING id, status, step;
    `, [id]);

    return NextResponse.json({
      reindexed: true,
      repositoryId: id,
      jobId: jobRes.rows[0].id,
      status: 'PENDING',
      previousCommit: repo.latest_commit_hash,
      targetCommit: currentSha
    }, { status: 202 });

  } catch (error: any) {
    console.error('Error during reindex:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
