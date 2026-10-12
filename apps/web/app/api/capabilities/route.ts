import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';

// Reads live database state: must never be prerendered/cached at build time
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const res = await query(`
      SELECT 
        MIN(ko.name) as name,
        MIN(ko.category) as category,
        MIN(ko.description) as description,
        COUNT(DISTINCT ko.repository_id)::int as "repoCount",
        json_agg(
          DISTINCT jsonb_build_object(
            'id', r.id,
            'owner', r.owner,
            'name', r.name
          )
        ) as repositories
      FROM knowledge_objects ko
      JOIN repositories r ON ko.repository_id = r.id
      WHERE ko.object_type = 'capability' AND r.status = 'READY'
      -- Group by capability name only: descriptions/categories are generated per repository, so
      -- grouping on them split one capability into many cards that each counted 1 repository
      GROUP BY lower(ko.name)
      ORDER BY "repoCount" DESC, MIN(ko.name) ASC
      LIMIT 100;
    `);

    return NextResponse.json({ capabilities: res.rows });
  } catch (error: any) {
    console.error('Error fetching dynamic capabilities:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
