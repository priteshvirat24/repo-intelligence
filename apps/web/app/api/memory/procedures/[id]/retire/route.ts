import { NextRequest } from 'next/server';
import { changeProcedureRoute } from '@/lib/memory/routes';

export const dynamic = 'force-dynamic';

/** Maintainers only. A retired procedure is no longer shown to the planner. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return changeProcedureRoute(req, params.id, 'retire');
}
