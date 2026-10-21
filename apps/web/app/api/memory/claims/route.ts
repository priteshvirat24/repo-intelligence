import { NextRequest, NextResponse } from 'next/server';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { searchClaims } from '@/lib/memory/claims';

export const dynamic = 'force-dynamic';

const GRADES = new Set(['E1', 'E2', 'E3', 'E4', 'E5']);
const STATUSES = new Set(['current', 'needs_revalidation', 'refuted', 'superseded']);

/** Semantic memory audit: claims by text, subject, kind, grade, status and freshness. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    const ctx = await requestContext();
    const freshness = p.get('freshness');
    const claims = await searchClaims(ctx.workspaceId, {
      q: p.get('q') || undefined,
      kind: (p.get('kind') || '').slice(0, 40) || undefined,
      grade: GRADES.has(p.get('grade') || '') ? p.get('grade')! : undefined,
      status: STATUSES.has(p.get('status') || '') ? p.get('status')! : undefined,
      freshness: freshness === 'current' || freshness === 'stale' ? freshness : undefined,
      limit: Number(p.get('limit')) || 50
    });
    return NextResponse.json({ claims });
  } catch (error: any) {
    const denied = authErrorResponse(error);
    if (denied) return denied;
    console.error('Error searching memory:', error);
    return NextResponse.json({ error: 'Could not search memory.' }, { status: 500 });
  }
}
