import * as crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@repo/database';
import { authErrorResponse, requestContext } from '@/lib/auth/context';
import { createRun } from '@/lib/briefs/run';
import { BriefConstraints, BudgetLimits, parseBudget, parseConstraints, safeJson } from '@/lib/briefs/constraints';
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

export async function GET() {
  try {
    const ctx = await requestContext();
    return NextResponse.json({ items: await listBriefs(ctx.workspaceId) });
  } catch (error: any) {
    const denied = authErrorResponse(error);
    if (denied) return denied;
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
  let constraints: BriefConstraints = {};
  let budget: BudgetLimits | null = null;
  try {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      const declaredLength = Number(req.headers.get('content-length') || 0);
      if (declaredLength > MAX_BRIEF_FILE_BYTES + 64 * 1024) {
        return NextResponse.json({ error: 'The file is larger than 10 MB.' }, { status: 413 });
      }
      const form = await req.formData();
      title = String(form.get('title') || '').trim();
      constraints = parseConstraints(safeJson(form.get('constraints')));
      budget = parseBudget(safeJson(form.get('budget')));
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
      constraints = parseConstraints(body.constraints);
      budget = parseBudget(body.budget);
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

  let ctx;
  try {
    ctx = await requestContext();
  } catch (error) {
    return authErrorResponse(error) || NextResponse.json({ error: 'Could not read the session.' }, { status: 500 });
  }

  const client = await pool.connect();
  try {
    const existing = await client.query(
      `SELECT id FROM briefs WHERE content_hash = $1 AND workspace_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [contentHash, ctx.workspaceId]
    );
    if (existing.rows[0]) {
      return NextResponse.json({ id: existing.rows[0].id, alreadyExists: true });
    }

    // Understanding the brief is the run graph's first task, in the worker: nothing here waits for an LLM
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO briefs (title, source_type, source_filename, brief_text, content_hash, workspace_id, created_by,
                           constraints_json, budget_json, step)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'QUEUED')
       RETURNING id, status`,
      [finalTitle, parsed.sourceType, filename, parsed.text, contentHash, ctx.workspaceId, ctx.userId,
       JSON.stringify(constraints), JSON.stringify(budget ? { limits: budget } : {})]
    );
    await createRun(client, inserted.rows[0].id);
    await client.query('COMMIT');

    return NextResponse.json({ id: inserted.rows[0].id, status: inserted.rows[0].status, truncated: parsed.truncated }, { status: 202 });
  } catch (error: any) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Error creating brief:', error);
    return NextResponse.json({ error: 'The brief could not be saved. Try again.' }, { status: 500 });
  } finally {
    client.release();
  }
}
