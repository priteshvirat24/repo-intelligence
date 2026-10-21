import { NextRequest, NextResponse } from 'next/server';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { briefInWorkspace, isUuid } from '@/lib/briefs/store';
import { getBuild } from '@/lib/builds/store';

export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'Build not found.' }, { status: 404 });

/** A build's status, test report and diff. ?format=diff downloads the diff (delivery without a GitHub token). */
export async function GET(req: NextRequest, { params }: { params: { id: string; buildId: string } }) {
  if (!isUuid(params.id) || !isUuid(params.buildId)) return notFound();
  try {
    const ctx = await requestContext();
    if (!(await briefInWorkspace(params.id, ctx.workspaceId))) return notFound();
    const build = await getBuild(params.id, params.buildId, ctx.workspaceId);
    if (!build) return notFound();
    if (req.nextUrl.searchParams.get('format') === 'diff') {
      if (!build.diff) return NextResponse.json({ error: 'This build has no change set.' }, { status: 404 });
      return new NextResponse(build.diff, {
        headers: {
          'Content-Type': 'text/x-diff; charset=utf-8',
          'Content-Disposition': `attachment; filename="open-eye-build-${build.id.slice(0, 8)}.diff"`,
          'Cache-Control': 'no-store'
        }
      });
    }
    const { fileContents, ...detail } = build;
    return NextResponse.json(detail);
  } catch (error: any) {
    const denied = authErrorResponse(error);
    if (denied) return denied;
    console.error('Error loading build:', error);
    return NextResponse.json({ error: 'Could not load the build.' }, { status: 500 });
  }
}
