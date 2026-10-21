import { NextResponse } from 'next/server';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { loadEvolution } from '@/lib/evolution/store';

export const dynamic = 'force-dynamic';

/** The evolution history: configuration versions, events, proposals and label proposals. */
export async function GET() {
  try {
    const ctx = await requestContext();
    return NextResponse.json(await loadEvolution(ctx));
  } catch (error: any) {
    const denied = authErrorResponse(error);
    if (denied) return denied;
    console.error('Error loading the evolution history:', error);
    return NextResponse.json({ error: 'Could not load the evolution history.' }, { status: 500 });
  }
}
