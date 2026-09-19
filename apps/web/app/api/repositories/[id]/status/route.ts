import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params;

    const res = await query(`
      SELECT 
        r.id as "repositoryId",
        r.status as "repositoryStatus",
        r.error_message as "error",
        j.status as "jobStatus",
        j.step,
        j.attempts
      FROM repositories r
      LEFT JOIN ingestion_jobs j ON r.id = j.repository_id
      WHERE r.id = $1
      ORDER BY j.created_at DESC
      LIMIT 1
    `, [id]);

    if (res.rows.length === 0) {
      return NextResponse.json({ error: 'Repository not found' }, { status: 404 });
    }

    const row = res.rows[0];

    // Compute approximate progress based on step
    let progress = 0;
    const step = (row.step || '').toUpperCase();
    if (row.repositoryStatus === 'READY') {
      progress = 100;
    } else if (step === 'QUEUED') {
      progress = 10;
    } else if (step === 'CLONING') {
      progress = 25;
    } else if (step === 'ANALYZING' || step === 'AST_ANALYSIS') {
      progress = 55;
    } else if (step === 'CAPABILITY_EXTRACTION') {
      progress = 75;
    } else if (step === 'INDEXING') {
      progress = 90;
    }

    return NextResponse.json({
      repositoryId: row.repositoryId,
      repositoryStatus: row.repositoryStatus,
      jobStatus: row.jobStatus || 'IDLE',
      step: row.step || 'IDLE',
      progress,
      error: row.error || null
    });
  } catch (error: any) {
    console.error('Error fetching repository status:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
