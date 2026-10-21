import { NextResponse } from 'next/server';
import { auth, authConfigured } from '@/auth';
import { authErrorResponse, requestContext } from '@/lib/auth/context';

export const dynamic = 'force-dynamic';

/** The signed-in user and workspace, or the single-workspace mode, for the navbar. */
export async function GET() {
  try {
    const ctx = await requestContext();
    const session: any = authConfigured ? await auth() : null;
    return NextResponse.json({
      authConfigured,
      authenticated: ctx.authenticated,
      workspaceId: ctx.workspaceId,
      role: ctx.role,
      user: session?.user ? { name: session.user.name, image: session.user.image } : null
    });
  } catch (error) {
    const denied = authErrorResponse(error);
    if (denied) return NextResponse.json({ authConfigured, authenticated: false }, { status: 200 });
    return NextResponse.json({ error: 'Could not read the session' }, { status: 500 });
  }
}
