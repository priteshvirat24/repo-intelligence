import { NextRequest } from 'next/server';
import { correctClaim } from '@/lib/memory/routes';

export const dynamic = 'force-dynamic';

/** { note? }: the claim is right. Recorded as evidence; the claim's sources gain reliability. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return correctClaim(req, params.id, 'confirm');
}
