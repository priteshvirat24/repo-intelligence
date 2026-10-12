import { query } from '@repo/database';
import { validateGitHubUrl } from '../validation/url';
import { GitHubClient } from '../github/client';
import { ResourceAdapter, ResourceDescriptor, IngestResult } from './types';
import { ResourceTypeDetector } from './detector';

export class GitHubResourceAdapter implements ResourceAdapter {
  name = 'GitHubResourceAdapter';

  canHandle(url: string): boolean {
    const desc = ResourceTypeDetector.detect(url);
    return desc.resourceType === 'github_repository';
  }

  detect(url: string): ResourceDescriptor {
    return ResourceTypeDetector.detect(url);
  }

  async ingest(url: string): Promise<IngestResult> {
    const desc = this.detect(url);
    const validation = validateGitHubUrl(desc.canonicalUrl);
    if (!validation.valid || !validation.owner || !validation.repo) {
      return {
        success: false,
        status: 'FAILED',
        title: desc.canonicalUrl,
        content: '',
        segments: [],
        metadata: {},
        contentHash: '',
        errorMessage: validation.error || 'Invalid GitHub repository URL'
      };
    }

    const { owner, repo, canonicalUrl } = validation;

    const ghClient = new GitHubClient();
    let meta: any;
    try {
      meta = await ghClient.fetchMetadata(owner, repo);
    } catch (err: any) {
      // No placeholder metadata (stars 0, branch "main", size 0): without real metadata we cannot
      // describe the repository or enforce the size limit, so nothing is queued.
      const message: string = err?.message || '';
      const definitive = /^(REPOSITORY_NOT_FOUND|PRIVATE_REPOSITORY|REPOSITORY_TOO_LARGE|ACCESS_FORBIDDEN)/.test(message);
      return {
        success: false,
        status: 'FAILED',
        title: `${owner}/${repo}`,
        content: '',
        segments: [],
        metadata: {},
        contentHash: '',
        errorMessage: definitive
          ? message
          : `GITHUB_UNAVAILABLE: Could not fetch repository metadata from GitHub (${message || 'network error'}). Please retry shortly.`
      };
    }

    // Insert or update resources table
    const resourceRes = await query(`
      INSERT INTO resources (
        resource_type,
        resource_role,
        source_url,
        canonical_url,
        title,
        description,
        author,
        publisher,
        source_domain,
        status,
        content_hash,
        metadata_json,
        updated_at
      ) VALUES (
        'github_repository',
        'software_component',
        $1,
        $1,
        $2,
        $3,
        $4,
        'GitHub',
        'github.com',
        'PENDING',
        $5,
        $6,
        NOW()
      )
      ON CONFLICT (source_url) DO UPDATE SET
        title = EXCLUDED.title,
        description = COALESCE(EXCLUDED.description, resources.description),
        content_hash = COALESCE(EXCLUDED.content_hash, resources.content_hash),
        metadata_json = EXCLUDED.metadata_json,
        status = 'PENDING',
        updated_at = NOW()
      RETURNING id;
    `, [
      canonicalUrl,
      `${owner}/${repo}`,
      meta.description,
      owner,
      meta.commitSha,
      JSON.stringify(meta)
    ]);

    const resourceId = resourceRes.rows[0].id;

    // Insert or update repositories table. GitHub owner/repo are case-insensitive and both (owner, name)
    // and url are UNIQUE, so find an existing row case-insensitively first; an ON CONFLICT on just one of
    // them fails with a unique violation on the other when the casing differs between submissions.
    const existingRepo = await query(`
      SELECT id FROM repositories
      WHERE lower(url) = lower($1) OR (lower(owner) = lower($2) AND lower(name) = lower($3))
      ORDER BY updated_at DESC
      LIMIT 1
    `, [canonicalUrl, meta.owner, meta.name]);

    const repoRes = existingRepo.rows.length > 0 ? await query(`
      UPDATE repositories SET
        resource_id = $1,
        description = COALESCE($2, description),
        default_branch = $3,
        stars = $4,
        license = COALESCE($5, license),
        primary_language = COALESCE($6, primary_language),
        latest_commit_hash = COALESCE($7, latest_commit_hash),
        status = 'PENDING',
        error_message = NULL,
        updated_at = NOW()
      WHERE id = $8
      RETURNING id;
    `, [
      resourceId,
      meta.description,
      meta.defaultBranch,
      meta.stars,
      meta.license,
      meta.primaryLanguage,
      meta.commitSha,
      existingRepo.rows[0].id
    ]) : await query(`
      INSERT INTO repositories (
        resource_id, owner, name, url, description, default_branch,
        stars, license, primary_language, latest_commit_hash, status, error_message, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', NULL, NOW()
      )
      ON CONFLICT (owner, name) DO UPDATE SET
        resource_id = EXCLUDED.resource_id,
        description = COALESCE(EXCLUDED.description, repositories.description),
        default_branch = EXCLUDED.default_branch,
        stars = EXCLUDED.stars,
        license = COALESCE(EXCLUDED.license, repositories.license),
        primary_language = COALESCE(EXCLUDED.primary_language, repositories.primary_language),
        latest_commit_hash = COALESCE(EXCLUDED.latest_commit_hash, repositories.latest_commit_hash),
        status = 'PENDING',
        error_message = NULL,
        updated_at = NOW()
      RETURNING id;
    `, [
      resourceId,
      meta.owner,
      meta.name,
      canonicalUrl,
      meta.description,
      meta.defaultBranch,
      meta.stars,
      meta.license,
      meta.primaryLanguage,
      meta.commitSha
    ]);

    const repositoryId = repoRes.rows[0].id;

    // Cancel any stale/existing active jobs for this repository
    await query(`
      UPDATE ingestion_jobs
      SET status = 'FAILED', error_message = 'Superseded by new ingestion job', updated_at = NOW()
      WHERE repository_id = $1 AND status IN ('QUEUED', 'RUNNING')
    `, [repositoryId]);

    // Queue ingestion job
    const jobRes = await query(`
      INSERT INTO ingestion_jobs (repository_id, resource_id, status, step)
      VALUES ($1, $2, 'QUEUED', 'QUEUED')
      RETURNING id;
    `, [repositoryId, resourceId]);

    return {
      success: true,
      status: 'PENDING',
      title: `${owner}/${repo}`,
      description: meta.description || '',
      author: owner,
      publisher: 'GitHub',
      content: `GitHub Repository ${owner}/${repo}`,
      segments: [],
      metadata: {
        repositoryId,
        resourceId,
        jobId: jobRes.rows[0].id,
        stars: meta.stars,
        language: meta.primaryLanguage
      },
      contentHash: meta.commitSha || ''
    };
  }
}
