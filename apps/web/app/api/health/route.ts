import { NextResponse } from 'next/server';
import { query } from '@repo/database';

export const dynamic = 'force-dynamic';

export async function GET() {
  const startTime = Date.now();

  try {
    // 1. Check Database connection & latency
    const dbStart = Date.now();
    await query('SELECT 1');
    const dbLatencyMs = Date.now() - dbStart;

    // 2. Check Worker Heartbeat
    const heartbeatRes = await query(`
      SELECT 
        worker_id,
        status,
        current_job_id,
        last_seen_at,
        metadata
      FROM worker_heartbeats
      ORDER BY last_seen_at DESC
      LIMIT 1;
    `);

    let workerStatus: 'HEALTHY' | 'STALE' | 'OFFLINE' = 'OFFLINE';
    let workerData: any = null;

    if (heartbeatRes.rows.length > 0) {
      const hb = heartbeatRes.rows[0];
      const lastSeen = new Date(hb.last_seen_at).getTime();
      const secondsSinceHeartbeat = Math.round((Date.now() - lastSeen) / 1000);

      // Stale if last heartbeat was > 45 seconds ago
      if (secondsSinceHeartbeat <= 45 && hb.status !== 'STOPPED') {
        workerStatus = 'HEALTHY';
      } else if (secondsSinceHeartbeat <= 180) {
        workerStatus = 'STALE';
      } else {
        workerStatus = 'OFFLINE';
      }

      workerData = {
        workerId: hb.worker_id,
        reportedStatus: hb.status,
        currentJobId: hb.current_job_id,
        lastSeenAt: hb.last_seen_at,
        secondsSinceHeartbeat,
        metadata: hb.metadata
      };
    }

    // 3. Check Repository Queue / Counts
    const repoStatsRes = await query(`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'READY') as ready,
        COUNT(*) FILTER (WHERE status = 'PROCESSING') as processing,
        COUNT(*) FILTER (WHERE status = 'QUEUED') as queued,
        COUNT(*) FILTER (WHERE status = 'FAILED') as failed
      FROM repositories;
    `);

    const stats = repoStatsRes.rows[0];

    const isHealthy = workerStatus !== 'OFFLINE';

    return NextResponse.json({
      status: isHealthy ? 'healthy' : 'degraded',
      totalLatencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      database: {
        status: 'connected',
        latencyMs: dbLatencyMs
      },
      worker: {
        status: workerStatus,
        ...workerData
      },
      repositories: {
        total: parseInt(stats.total || '0', 10),
        ready: parseInt(stats.ready || '0', 10),
        processing: parseInt(stats.processing || '0', 10),
        queued: parseInt(stats.queued || '0', 10),
        failed: parseInt(stats.failed || '0', 10)
      }
    }, {
      status: isHealthy ? 200 : 200 // Still return 200 for degraded to allow monitoring dashboards to read stats
    });
  } catch (error: any) {
    console.error('Health check failed:', error);
    return NextResponse.json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message || 'Database or service unreachable'
    }, { status: 503 });
  }
}
