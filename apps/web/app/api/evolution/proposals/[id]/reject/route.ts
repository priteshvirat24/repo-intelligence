import { NextRequest } from 'next/server';
import { decideProposal } from '@/lib/evolution/decide';

export const dynamic = 'force-dynamic';

/** Rejects a pending proposal (maintainers); its version is marked rejected and never promoted. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return decideProposal(req, params.id, false);
}
