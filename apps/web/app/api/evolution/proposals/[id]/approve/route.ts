import { NextRequest } from 'next/server';
import { decideProposal } from '@/lib/evolution/decide';

export const dynamic = 'force-dynamic';

/** Approves a pending L2/L3 proposal and promotes its version (maintainers; needs a recorded benchmark win). */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return decideProposal(req, params.id, true);
}
