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
      meta = {
        owner,
        name: repo,
        description: null,
        defaultBranch: 'main',
        stars: 0,
        license: null,
        primaryLanguage: null,
        sizeKb: 0,
        commitSha: null
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

    // Insert or update repositories table
    const repoRes = await query(`
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
