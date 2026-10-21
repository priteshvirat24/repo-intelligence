import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { briefInWorkspace, isUuid } from '@/lib/briefs/store';
import { blueprintForBuild, listBuilds } from '@/lib/builds/store';
import { checkBuildRequest } from '@/lib/builds/policy';
import { roadmapItems } from '@/lib/builds/scope';
import { checkRateLimit } from '@/lib/security/rate_limit';

export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Brief not found.' }, { status: 404 });

/** The brief's builds, the items a build can cover, and what the caller may do. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return notFound();
  try {
    const ctx = await requestContext();
    if (!(await briefInWorkspace(params.id, ctx.workspaceId))) return notFound();
    const bp = await blueprintForBuild(params.id);
    return NextResponse.json({
      builds: await listBuilds(params.id, ctx.workspaceId),
      roadmap: bp.status === 'COMPLETED' ? roadmapItems(bp.blueprint) : [],
      requirements: bp.requirementNames,
      blueprintReady: bp.status === 'COMPLETED',
      canBuild: ctx.role === 'maintainer',
      pullRequestDelivery: Boolean(process.env.GITHUB_BUILD_TOKEN)
    });
  } catch (error: any) {
    const denied = authErrorResponse(error);
    if (denied) return denied;
    console.error('Error listing builds:', error);
    return NextResponse.json({ error: 'Could not load the builds.' }, { status: 500 });
  }
}

/**
 * Authorises a build (PRODUCT_DEFINITION 7.1: running a build needs approval). Maintainers only, with
 * { authorize: true, roadmapTaskIds?: string[], requirements?: string[] }. The worker runs it in the sandbox.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const rateLimit = checkRateLimit(req, 'authorise_build', { maxRequests: 5, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) return rateLimit.response;
  if (!isUuid(params.id)) return notFound();
  const body = await req.json().catch(() => null);
  try {
    const ctx = await requestContext();
    if (!(await briefInWorkspace(params.id, ctx.workspaceId))) return notFound();
    const bp = await blueprintForBuild(params.id);
    const active = await query(`SELECT 1 FROM builds WHERE brief_id = $1 AND status IN ('queued', 'running') LIMIT 1`, [params.id]);
    const decision = checkBuildRequest({
      role: ctx.role,
      body,
      blueprintStatus: bp.status,
      roadmapIds: roadmapItems(bp.blueprint).map((i) => i.id),
      requirementNames: bp.requirementNames,
      activeBuild: (active.rowCount || 0) > 0
    });
    if (!decision.ok) return NextResponse.json({ error: decision.error }, { status: decision.status });
    const res = await query(
      `INSERT INTO builds (brief_id, workspace_id, requested_by, scope_json) VALUES ($1, $2, $3, $4) RETURNING id, status`,
      [params.id, ctx.workspaceId, ctx.userId, JSON.stringify(decision.value)]
    );
    return NextResponse.json(res.rows[0], { status: 202 });
  } catch (error: any) {
    const denied = authErrorResponse(error);
    if (denied) return denied;
    if (error?.code === '23505') return NextResponse.json({ error: 'A build for this brief is already queued or running.' }, { status: 409 });
    console.error('Error authorising build:', error);
    return NextResponse.json({ error: 'Could not start the build.' }, { status: 500 });
  }
}
