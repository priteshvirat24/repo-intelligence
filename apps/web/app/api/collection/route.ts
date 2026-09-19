import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';

export async function GET(req: NextRequest) {
  try {
    // 1. Fetch Repository summaries
    const reposRes = await query(`
      SELECT 
        r.id, r.owner, r.name, r.description, r.primary_language as "primaryLanguage",
        r.stars, r.domain_tags as "domainTags", r.status,
        (SELECT COUNT(*)::int FROM knowledge_objects ko WHERE ko.repository_id = r.id AND ko.object_type = 'capability') as "capabilitiesCount"
      FROM repositories r
      WHERE r.status = 'READY'
      ORDER BY r.stars DESC;
    `);

    // 2. Fetch Aggregated Counts
    const statsRes = await query(`
      SELECT 
        (SELECT COUNT(*)::int FROM repositories WHERE status = 'READY') as "totalRepos",
        (SELECT COUNT(DISTINCT name)::int FROM knowledge_objects WHERE object_type = 'capability') as "totalCapabilities",
        (SELECT COUNT(*)::int FROM knowledge_objects WHERE object_type IN ('concept', 'technique')) as "totalConcepts",
        (SELECT COUNT(*)::int FROM knowledge_objects WHERE object_type = 'use_case') as "totalUseCases",
        (SELECT COUNT(*)::int FROM evidence WHERE is_verified = true) as "totalVerifiedEvidence";
    `);

    // 3. Aggregate Domain Clusters
    const domainClusters: Record<string, { count: number; repos: Array<{ id: string; name: string }> }> = {};
    for (const repo of reposRes.rows) {
      const tags = repo.domainTags || ['general-engineering'];
      for (const tag of tags) {
        if (!domainClusters[tag]) {
          domainClusters[tag] = { count: 0, repos: [] };
        }
        domainClusters[tag].count++;
        domainClusters[tag].repos.push({ id: repo.id, name: `${repo.owner}/${repo.name}` });
      }
    }

    return NextResponse.json({
      stats: statsRes.rows[0] || {},
      repositories: reposRes.rows,
      domainClusters
    });
  } catch (error: any) {
    console.error('Error fetching collection intelligence:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
