import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    // 1. Fetch resource record
    const resRes = await query(`
      SELECT 
        r.id,
        r.resource_type as "resourceType",
        r.resource_role as "resourceRole",
        r.source_url as "sourceUrl",
        r.canonical_url as "canonicalUrl",
        r.title,
        r.description,
        r.author,
        r.publisher,
        r.source_domain as "sourceDomain",
        r.status,
        r.error_message as "errorMessage",
        r.content_hash as "contentHash",
        r.domain_tags as "domainTags",
        r.problems_solved as "problemsSolved",
        r.practical_uses as "practicalUses",
        r.value_proposition as "valueProposition",
        r.useful_for as "usefulFor",
        r.metadata_json as "metadata",
        r.analysis_json as "analysis",
        r.indexed_at as "indexedAt",
        r.created_at as "createdAt",
        r.updated_at as "updatedAt"
      FROM resources r
      WHERE r.id = $1
    `, [id]);

    if (resRes.rows.length === 0) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    const resource = resRes.rows[0];

    // 2. Fetch knowledge objects
    const koRes = await query(`
      SELECT 
        id,
        object_type as "objectType",
        name,
        description,
        category,
        importance,
        confidence
      FROM knowledge_objects
      WHERE resource_id = $1
      ORDER BY 
        CASE importance
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          ELSE 4
        END,
        confidence DESC
    `, [id]);

    // 3. Fetch evidence/citations
    const evRes = await query(`
      SELECT 
        e.id,
        e.knowledge_object_id as "knowledgeObjectId",
        e.file_path as "filePath",
        e.quote_snippet as "quoteSnippet",
        e.evidence_type as "evidenceType",
        e.evidence_strength as "evidenceStrength",
        e.locator_type as "locatorType",
        e.locator_json as "locatorJson",
        e.is_verified as "isVerified"
      FROM evidence e
      WHERE e.resource_id = $1
    `, [id]);

    // 4. Fetch counts
    const countRes = await query(`
      SELECT 
        (SELECT COUNT(*)::int FROM documents WHERE resource_id = $1) as "documentCount",
        (SELECT COUNT(*)::int FROM chunks WHERE resource_id = $1) as "chunkCount"
    `, [id]);

    const counts = countRes.rows[0] || { documentCount: 0, chunkCount: 0 };

    const capabilities = koRes.rows.filter(k => k.objectType === 'capability');
    const concepts = koRes.rows.filter(k => k.objectType === 'concept' || k.objectType === 'technique');
    const limitations = koRes.rows.filter(k => k.objectType === 'limitation' || k.objectType === 'constraint');
    const useCases = koRes.rows.filter(k => k.objectType === 'use_case');

    return NextResponse.json({
      ...resource,
      capabilities,
      concepts,
      limitations,
      useCases,
      evidence: evRes.rows,
      stats: {
        documents: counts.documentCount,
        chunks: counts.chunkCount,
        capabilities: capabilities.length,
        concepts: concepts.length
      }
    });
  } catch (error: any) {
    console.error('Error fetching resource details:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;

    const deleteRes = await query(`
      DELETE FROM resources
      WHERE id = $1
      RETURNING id, title;
    `, [id]);

    if (deleteRes.rows.length === 0) {
      return NextResponse.json({ error: 'Resource not found' }, { status: 404 });
    }

    return NextResponse.json({
      message: 'Resource deleted successfully',
      deleted: deleteRes.rows[0]
    });
  } catch (error: any) {
    console.error('Error deleting resource:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
