import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { GitHubClient } from '@/lib/github/client';
import { queueRepositoryJob } from '@/lib/github/jobs';
import { checkRateLimit } from '@/lib/security/rate_limit';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  // Rate limit: 5 reindex operations per minute per IP
  const rateLimit = checkRateLimit(req, 'reindex_repo', { maxRequests: 5, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

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

    const url = new URL(req.url);
    const force = url.searchParams.get('force') === 'true';

    // 2. Check the remote repository. Definitive problems (deleted, made private, grown past the size
    // limit) are reported instead of queuing a job that can only fail; transient GitHub errors are not
    // fatal because the worker clones directly.
    const ghClient = new GitHubClient();
    let currentSha: string | null = null;
    try {
      const meta = await ghClient.fetchMetadata(repo.owner, repo.name);
      currentSha = meta.commitSha;
    } catch (err: any) {
      const message: string = err?.message || '';
      const definitive = message.match(/^(REPOSITORY_NOT_FOUND|PRIVATE_REPOSITORY|REPOSITORY_TOO_LARGE|REPOSITORY_EMPTY|ACCESS_FORBIDDEN)/);
      if (definitive) {
        const status = definitive[1] === 'REPOSITORY_TOO_LARGE' ? 413 : definitive[1] === 'REPOSITORY_NOT_FOUND' ? 404 : 403;
        return NextResponse.json({ error: message, code: definitive[1] }, { status });
      }
      console.warn('Could not check remote commit SHA, queuing reindex anyway:', message);
    }

    // 3. Unchanged commit and already READY: idempotent no-op unless forced
    if (!force && repo.status === 'READY' && currentSha && repo.latest_commit_hash && currentSha === repo.latest_commit_hash) {
      return NextResponse.json({
        reindexed: false,
        message: 'Repository is already up-to-date with latest commit.',
        commitHash: currentSha,
        status: repo.status
      }, { status: 200 });
    }

    // 4. Queue atomically: an active, non-stale job blocks a second one unless force=true
    const resourceRes = await query('SELECT resource_id FROM repositories WHERE id = $1', [id]);
    const queued = await queueRepositoryJob(id, resourceRes.rows[0]?.resource_id ?? null, {
      supersede: force ? 'always' : 'if-stale',
      staleMinutes: 10
    });
    if (!queued.queued) {
      return NextResponse.json({
        message: 'An ingestion job is already active for this repository.',
        jobId: queued.activeJobId,
        status: queued.activeStatus,
        step: queued.activeStep
      }, { status: 409 });
    }

    await query(`
      UPDATE repositories
      SET status = 'PENDING', error_message = NULL, updated_at = NOW()
      WHERE id = $1
    `, [id]);

    await query(`
      UPDATE resources
      SET status = 'PENDING', error_message = NULL, updated_at = NOW()
      WHERE id = (SELECT resource_id FROM repositories WHERE id = $1) OR id = $1
    `, [id]);

    return NextResponse.json({
      reindexed: true,
      repositoryId: id,
      jobId: queued.jobId,
      status: 'PENDING',
      previousCommit: repo.latest_commit_hash,
      targetCommit: currentSha
    }, { status: 202 });

  } catch (error: any) {
    console.error('Error during reindex:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
