import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';

export async function GET(req: NextRequest) {
  try {
    const res = await query(`
      SELECT 
        ko.name,
        COALESCE(ko.category, 'domain-specific') as category,
        ko.description,
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
      GROUP BY ko.name, ko.category, ko.description
      ORDER BY "repoCount" DESC, ko.name ASC
      LIMIT 100;
    `);

    return NextResponse.json({ capabilities: res.rows });
  } catch (error: any) {
    console.error('Error fetching dynamic capabilities:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
