import { NextResponse } from 'next/server';
import { query } from '@repo/database';
import { auth, authConfigured } from '@/auth';

// Who is asking, and in which workspace (PRODUCT_DEFINITION 12.1). Briefs are private to a workspace; the
// library of indexed public repositories is shared.
export const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000001';

export interface RequestContext {
  userId: string | null;
  workspaceId: string;
  role: 'member' | 'maintainer';
  /** false in single-workspace mode (no OAuth app configured) */
  authenticated: boolean;
}

export class AuthRequired extends Error {}

/**
 * The caller's workspace. With sign-in configured, an unsigned request is refused; without it, everyone
 * shares the default workspace, unless REQUIRE_AUTH=true says that must never happen (production).
 */
export async function requestContext(): Promise<RequestContext> {
  if (!authConfigured) {
    if (process.env.REQUIRE_AUTH === 'true') throw new AuthRequired('Sign-in is required but no OAuth app is configured');
    return { userId: null, workspaceId: DEFAULT_WORKSPACE_ID, role: 'maintainer', authenticated: false };
  }
  const session: any = await auth();
  if (!session?.userId) throw new AuthRequired('Sign in to continue');
  const res = await query(
    `SELECT workspace_id, role FROM workspace_members WHERE user_id = $1 ORDER BY role = 'maintainer' DESC, created_at ASC LIMIT 1`,
    [session.userId]
  );
  if (!res.rows[0]) throw new AuthRequired('No workspace for this account');
  return { userId: session.userId, workspaceId: res.rows[0].workspace_id, role: res.rows[0].role, authenticated: true };
}

export function authErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof AuthRequired) {
    return NextResponse.json({ error: error.message, kind: 'auth_required' }, { status: 401 });
  }
  return null;
}
