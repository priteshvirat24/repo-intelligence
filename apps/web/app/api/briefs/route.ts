import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { getLLMProvider, ProviderConfigError } from '@/lib/ai/providers';
import { OpenProblemDecomposer } from '@/lib/ai/open_query';
import { checkRateLimit } from '@/lib/security/rate_limit';
import {
  BriefParseError,
  MAX_BRIEF_FILE_BYTES,
  ParsedBrief,
  finishBrief,
  parseBriefFile,
  titleFromBrief
} from '@/lib/briefs/parse';
import { listBriefs } from '@/lib/briefs/store';

export const dynamic = 'force-dynamic';

// The decomposer prompt is built for a problem statement, not a whole document: send the opening of
// the brief (where goals and requirements usually are) and keep the full text in the database.
const DECOMPOSITION_INPUT_CHARS = 12_000;

export async function GET() {
  try {
    return NextResponse.json({ items: await listBriefs() });
  } catch (error: any) {
    console.error('Error listing briefs:', error);
    return NextResponse.json({ error: 'Could not load briefs.' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Every brief costs one LLM call now and a GitHub search run in the worker
  const rateLimit = checkRateLimit(req, 'create_brief', { maxRequests: 6, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  let parsed: ParsedBrief;
  let filename: string | null = null;
  let title = '';
  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const declaredLength = Number(req.headers.get('content-length') || 0);
      if (declaredLength > MAX_BRIEF_FILE_BYTES + 64 * 1024) {
        return NextResponse.json({ error: 'The file is larger than 10 MB.' }, { status: 413 });
      }
      const form = await req.formData();
      title = String(form.get('title') || '').trim();
      const file = form.get('file');
      if (file && typeof file !== 'string') {
        filename = file.name || 'brief';
        parsed = await parseBriefFile(filename, Buffer.from(await file.arrayBuffer()));
      } else {
        parsed = finishBrief(String(form.get('text') || ''), 'text');
      }
    } else {
      const body = await req.json().catch(() => null);
      if (!body || typeof body.text !== 'string') {
        return NextResponse.json({ error: 'Send the brief as text, or upload a file.' }, { status: 400 });
      }
      title = typeof body.title === 'string' ? body.title.trim() : '';
      parsed = finishBrief(body.text, 'text');
    }
  } catch (error: any) {
    if (error instanceof BriefParseError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('Error reading brief upload:', error);
    return NextResponse.json({ error: 'The brief could not be read.' }, { status: 400 });
  }

  const finalTitle = (title || titleFromBrief(parsed.text, filename)).slice(0, 200);
  const contentHash = crypto.createHash('sha256').update(parsed.text).digest('hex');

  try {
    const existing = await query(`SELECT id FROM briefs WHERE content_hash = $1 ORDER BY created_at DESC LIMIT 1`, [contentHash]);
    if (existing.rows[0]) {
      return NextResponse.json({ id: existing.rows[0].id, alreadyExists: true });
    }

    let llm;
    try {
      llm = getLLMProvider();
    } catch (error) {
      if (error instanceof ProviderConfigError) {
        return NextResponse.json(
          { error: 'Open Eye is not connected to an AI provider yet. Ask the administrator to set the API keys.' },
          { status: 503 }
        );
      }
      throw error;
    }

    const input = `Project brief: ${finalTitle}\n\n${parsed.text.slice(0, DECOMPOSITION_INPUT_CHARS)}`;
    const { requirements, mode } = await new OpenProblemDecomposer(llm).decomposeDetailed(input);

    const inserted = await query(
      `INSERT INTO briefs (title, source_type, source_filename, brief_text, content_hash, requirements_json, decomposition_mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, status`,
      [finalTitle, parsed.sourceType, filename, parsed.text, contentHash, JSON.stringify(requirements), mode]
    );

    return NextResponse.json(
      {
        id: inserted.rows[0].id,
        status: inserted.rows[0].status,
        decompositionMode: mode,
        requirementCount: requirements.requirements.length,
        truncated: parsed.truncated
      },
      { status: 202 }
    );
  } catch (error: any) {
    console.error('Error creating brief:', error);
    return NextResponse.json({ error: 'The brief could not be saved. Try again.' }, { status: 500 });
  }
}
