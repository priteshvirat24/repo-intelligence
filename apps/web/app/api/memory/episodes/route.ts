import { NextResponse } from 'next/server';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { listEpisodes } from '@/lib/memory/store';

export const dynamic = 'force-dynamic';

/** Episodic memory: the workspace's past runs and what happened to them since. */
export async function GET() {
  try {
    const ctx = await requestContext();
    return NextResponse.json({ episodes: await listEpisodes(ctx.workspaceId) });
  } catch (error: any) {
    const denied = authErrorResponse(error);
    if (denied) return denied;
    console.error('Error loading episodes:', error);
    return NextResponse.json({ error: 'Could not load past runs.' }, { status: 500 });
  }
}
