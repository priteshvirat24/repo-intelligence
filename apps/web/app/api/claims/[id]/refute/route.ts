import { NextRequest } from 'next/server';
import { correctClaim } from '@/lib/memory/routes';

export const dynamic = 'force-dynamic';

/** { reason }: the claim is wrong. Downgrades it and re-writes the blueprints in this workspace that cite it. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return correctClaim(req, params.id, 'refute');
}
