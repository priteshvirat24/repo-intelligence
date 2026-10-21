import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { getBrief, isUuid } from '@/lib/briefs/store';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Brief not found.' }, { status: 404 });
  }
  try {
    const brief = await getBrief(params.id);
    if (!brief) {
      return NextResponse.json({ error: 'Brief not found.' }, { status: 404 });
    }
    return NextResponse.json(brief);
  } catch (error: any) {
    console.error('Error loading brief:', error);
    return NextResponse.json({ error: 'Could not load the brief.' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'Brief not found.' }, { status: 404 });
  }
  try {
    // A running discovery notices the missing row at its next ownership check and writes nothing
    const res = await query(`DELETE FROM briefs WHERE id = $1`, [params.id]);
    if (res.rowCount === 0) {
      return NextResponse.json({ error: 'Brief not found.' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    console.error('Error deleting brief:', error);
    return NextResponse.json({ error: 'Could not delete the brief.' }, { status: 500 });
  }
}
