import { NextRequest } from 'next/server';
import { changeProcedureRoute } from '@/lib/memory/routes';

export const dynamic = 'force-dynamic';

/** Maintainers only, and only for a candidate with measured support. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return changeProcedureRoute(req, params.id, 'activate');
}
