import { NextRequest, NextResponse } from 'next/server';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { isUuid } from '@/lib/briefs/store';
import { parseFeedback } from '@/lib/evolution/rules';
import { NotFound, briefFeedback, saveFeedback } from '@/lib/evolution/store';
import { checkRateLimit } from '@/lib/security/rate_limit';

export const dynamic = 'force-dynamic';

/** The caller's verdicts on one brief: GET /api/feedback?briefId=<id> */
export async function GET(req: NextRequest) {
  const briefId = req.nextUrl.searchParams.get('briefId') || '';
  if (!isUuid(briefId)) return NextResponse.json({ error: 'briefId must be a brief id.' }, { status: 400 });
  try {
    const ctx = await requestContext();
    return NextResponse.json({ feedback: await briefFeedback(ctx, briefId) });
  } catch (error: any) {
    const denied = authErrorResponse(error);
    if (denied) return denied;
    console.error('Error loading feedback:', error);
    return NextResponse.json({ error: 'Could not load feedback.' }, { status: 500 });
  }
}

/**
 * Marks a candidate useful or not, or a blueprint decision or claim correct or wrong (PRODUCT_DEFINITION 9.2
 * step 2). Body: {briefId, targetKind, targetId, verdict | null, note?}. The verdict is stored with the tuning
 * version that produced the target, and may become a label proposal for the evaluation suite's reviewers.
 */
export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit(req, 'feedback', { maxRequests: 30, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) return rateLimit.response;
  const parsed = parseFeedback(await req.json().catch(() => null));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const ctx = await requestContext();
    const saved = await saveFeedback(ctx, parsed.value);
    return NextResponse.json({ saved: true, verdict: parsed.value.verdict, tuningVersion: saved.tuningVersion });
  } catch (error: any) {
    if (error instanceof NotFound) return NextResponse.json({ error: error.message }, { status: 404 });
    const denied = authErrorResponse(error);
    if (denied) return denied;
    console.error('Error saving feedback:', error);
    return NextResponse.json({ error: 'Could not save the feedback.' }, { status: 500 });
  }
}
