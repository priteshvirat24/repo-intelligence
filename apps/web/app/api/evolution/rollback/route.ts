import { NextRequest } from 'next/server';
import { rollback } from '@/lib/evolution/decide';

export const dynamic = 'force-dynamic';

/** Rolls the promoted configuration back to its predecessor (maintainers). Body: {expected, note?}. */
export async function POST(req: NextRequest) {
  return rollback(req);
}
