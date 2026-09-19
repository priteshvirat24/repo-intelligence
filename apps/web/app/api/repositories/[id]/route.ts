import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;

    // 1. Fetch Repository Record
    const repoRes = await query(`
      SELECT 
        id, owner, name, url, description, default_branch as "defaultBranch",
        latest_commit_hash as "latestCommitHash", license, stars,
        primary_language as "primaryLanguage", status, domain_tags as "domainTags",
        open_knowledge_json as "openKnowledge", error_message as "errorMessage",
        created_at as "createdAt", updated_at as "updatedAt"
      FROM repositories
      WHERE id = $1
    `, [id]);

    if (repoRes.rows.length === 0) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
    }
    const repo = repoRes.rows[0];

    // 2. Fetch Open-World Knowledge Objects
    const koRes = await query(`
      SELECT 
        ko.id, ko.object_type as "objectType", ko.name, ko.description,
        ko.category, ko.importance, ko.confidence, ko.metadata_json as "metadata",
        COALESCE(
          json_agg(
            json_build_object(
              'id', e.id,
              'filePath', e.file_path,
              'startLine', e.start_line,
              'endLine', e.end_line,
              'symbolName', e.symbol_name,
              'quoteSnippet', e.quote_snippet,
              'evidenceType', e.evidence_type,
              'verified', e.is_verified
            )
          ) FILTER (WHERE e.id IS NOT NULL), '[]'
        ) as evidence
      FROM knowledge_objects ko
      LEFT JOIN evidence e ON ko.id = e.knowledge_object_id
      WHERE ko.repository_id = $1
      GROUP BY ko.id, ko.object_type, ko.name, ko.description, ko.category, ko.importance, ko.confidence, ko.metadata_json
      ORDER BY ko.confidence DESC;
    `, [id]);

    const knowledgeObjects = koRes.rows;
    const features = knowledgeObjects.filter((k: any) => k.objectType === 'feature');
    const concepts = knowledgeObjects.filter((k: any) => k.objectType === 'concept');
    const techniques = knowledgeObjects.filter((k: any) => k.objectType === 'technique');
    const useCases = knowledgeObjects.filter((k: any) => k.objectType === 'use_case');
    const components = knowledgeObjects.filter((k: any) => k.objectType === 'component');
    const interfaces = knowledgeObjects.filter((k: any) => k.objectType === 'interface');
    const inputs = knowledgeObjects.filter((k: any) => k.objectType === 'input');
    const outputs = knowledgeObjects.filter((k: any) => k.objectType === 'output');

    // Fetch Knowledge Relationships
    const relRes = await query(`
      SELECT 
        kr.id, kr.relationship_type as "relationshipType", kr.confidence,
        kr.evidence_snippet as "evidenceSnippet",
        sko.name as "sourceName", tko.name as "targetName"
      FROM knowledge_relationships kr
      JOIN knowledge_objects sko ON kr.source_id = sko.id
      LEFT JOIN knowledge_objects tko ON kr.target_id = tko.id
      WHERE kr.source_repo_id = $1
      ORDER BY kr.confidence DESC;
    `, [id]);

    // 2. Fetch Capabilities with verified evidence
    const capsRes = await query(`
      SELECT 
        c.slug,
        c.name,
        c.category,
        rc.confidence,
        rc.implementation_notes as "implementationNotes",
        COALESCE(
          json_agg(
            json_build_object(
              'id', e.id,
              'filePath', e.file_path,
              'startLine', e.start_line,
              'endLine', e.end_line,
              'symbolName', e.symbol_name,
              'quoteSnippet', e.quote_snippet,
              'evidenceType', e.evidence_type,
              'verified', e.is_verified
            )
          ) FILTER (WHERE e.id IS NOT NULL), '[]'
        ) as evidence
      FROM repository_capabilities rc
      JOIN capabilities c ON rc.capability_id = c.id
      LEFT JOIN evidence e ON rc.id = e.repository_capability_id
      WHERE rc.repository_id = $1
      GROUP BY rc.id, c.id, c.slug, c.name, c.category, rc.confidence, rc.implementation_notes
      ORDER BY rc.confidence DESC
    `, [id]);

    // 3. Fetch Dependencies
    const depsRes = await query(`
      SELECT 
        id, package_name as "packageName", ecosystem, version_spec as "versionSpec",
        is_runtime as "isRuntime", is_heavyweight as "isHeavyweight"
      FROM repository_dependencies
      WHERE repository_id = $1
      ORDER BY is_heavyweight DESC, package_name ASC
    `, [id]);

    // 4. Fetch Limitations
    const limitsRes = await query(`
      SELECT id, category, description, file_path as "filePath"
      FROM repository_limitations
      WHERE repository_id = $1
    `, [id]);

    // 5. Aggregate Stats
    const statsRes = await query(`
      SELECT 
        (SELECT COUNT(*)::int FROM documents WHERE repository_id = $1) as documents,
        (SELECT COUNT(*)::int FROM chunks WHERE repository_id = $1) as chunks,
        (SELECT COUNT(*)::int FROM repository_capabilities WHERE repository_id = $1) as capabilities
    `, [id]);

    return NextResponse.json({
      id: repo.id,
      owner: repo.owner,
      name: repo.name,
      url: repo.url,
      description: repo.description,
      defaultBranch: repo.defaultBranch,
      latestCommitHash: repo.latestCommitHash,
      license: repo.license,
      stars: repo.stars,
      primaryLanguage: repo.primaryLanguage,
      status: repo.status,
      domainTags: repo.domainTags || [],
      openKnowledge: repo.openKnowledge || {},
      errorMessage: repo.errorMessage,
      capabilities: capsRes.rows,
      features,
      concepts,
      techniques,
      useCases,
      components,
      interfaces,
      inputs,
      outputs,
      relationships: relRes.rows,
      dependencies: depsRes.rows,
      limitations: limitsRes.rows,
      stats: {
        documents: statsRes.rows[0]?.documents || 0,
        chunks: statsRes.rows[0]?.chunks || 0,
        capabilities: capsRes.rows.length || 0,
        knowledgeObjects: knowledgeObjects.length
      },
      createdAt: repo.createdAt,
      updatedAt: repo.updatedAt
    });
  } catch (error: any) {
    console.error('Error fetching repository detail:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;
    const res = await query('DELETE FROM repositories WHERE id = $1 RETURNING id', [id]);
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (error: any) {
    console.error('Error deleting repository:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
