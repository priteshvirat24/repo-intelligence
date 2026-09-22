import { NextResponse } from 'next/server';
import { query } from '@repo/database';
import { FirecrawlProvider } from '@/lib/providers/firecrawl';
import { TavilyProvider } from '@/lib/providers/tavily';

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

    // 3. Check Universal Resource Counts
    const resourceStatsRes = await query(`
      SELECT 
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status = 'READY')::int as ready,
        COUNT(*) FILTER (WHERE status IN ('FETCHING', 'ANALYZING', 'INDEXING'))::int as processing,
        COUNT(*) FILTER (WHERE status = 'PENDING')::int as pending,
        COUNT(*) FILTER (WHERE status IN ('FAILED', 'BLOCKED'))::int as failed,
        COUNT(*) FILTER (WHERE resource_type = 'github_repository')::int as repositories,
        COUNT(*) FILTER (WHERE resource_type IN ('web_page', 'article', 'documentation_site', 'generic_url'))::int as web_sources,
        COUNT(*) FILTER (WHERE resource_type = 'youtube_video')::int as videos,
        COUNT(*) FILTER (WHERE resource_type IN ('pdf', 'research_paper', 'document'))::int as documents,
        COUNT(*) FILTER (WHERE resource_type = 'linkedin_post')::int as linkedin
      FROM resources;
    `);

    const stats = resourceStatsRes.rows[0];

    // 4. Check Provider Connectivity (without exposing keys)
    const firecrawl = new FirecrawlProvider();
    const tavily = new TavilyProvider();

    const providers = {
      firecrawl: firecrawl.isAvailable() ? 'Connected' : 'Not configured',
      tavily: tavily.isAvailable() ? 'Connected' : 'Not configured',
      llm: Boolean(process.env.LLM_API_KEY) ? 'Connected' : 'Not configured',
      database: 'Healthy'
    };

    return NextResponse.json({
      product: 'Open Eye',
      status: 'healthy',
      totalLatencyMs: Date.now() - startTime,
      timestamp: new Date().toISOString(),
      database: {
        status: 'connected',
        latencyMs: dbLatencyMs
      },
      providers,
      worker: {
        status: workerStatus,
        ...workerData
      },
      resources: {
        total: stats.total,
        ready: stats.ready,
        processing: stats.processing,
        pending: stats.pending,
        failed: stats.failed,
        byType: {
          repositories: stats.repositories,
          webSources: stats.web_sources,
          videos: stats.videos,
          documents: stats.documents,
          linkedin: stats.linkedin
        }
      }
    });
  } catch (error: any) {
    console.error('Health check failed:', error);
    return NextResponse.json({
      product: 'Open Eye',
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message || 'Database or service unreachable'
    }, { status: 503 });
  }
}
