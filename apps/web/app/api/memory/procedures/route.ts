import { NextResponse } from 'next/server';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { listProcedures, MIN_ACTIVATION_SUCCESSES } from '@/lib/memory/store';

export const dynamic = 'force-dynamic';

/** Procedural memory: learned procedures of the workspace and global ones, with who may change them. */
export async function GET() {
  try {
    const ctx = await requestContext();
    return NextResponse.json({
      procedures: await listProcedures(ctx.workspaceId),
      canManage: ctx.role === 'maintainer',
      minActivationSuccesses: MIN_ACTIVATION_SUCCESSES
    });
  } catch (error: any) {
    const denied = authErrorResponse(error);
    if (denied) return denied;
    console.error('Error loading procedures:', error);
    return NextResponse.json({ error: 'Could not load procedures.' }, { status: 500 });
  }
}
