import { NextResponse } from 'next/server';
import { loadEvaluation } from '@/lib/eval/results';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(loadEvaluation());
  } catch (error: any) {
    console.error('Error loading evaluation results:', error);
    return NextResponse.json({ error: 'Could not load evaluation results.' }, { status: 500 });
  }
}
