import { NextRequest, NextResponse } from 'next/server';
import { ChatOrchestrator } from '@/lib/ai/chat';
import { ProviderConfigError } from '@/lib/ai/providers';
import { withLedgerScope } from '@/lib/ai/ledger';
import { checkRateLimit } from '@/lib/security/rate_limit';
import { ChatSourceMode } from '@repo/shared';

export const dynamic = 'force-dynamic';

type ErrorKind = 'rate_limited' | 'provider_unavailable' | 'config' | 'internal';

/** Maps internal failures to copy that is safe to show users; details stay in the server log. */
function toUserError(error: any): { error: string; kind: ErrorKind; retryAfter?: number } {
  const message: string = error?.message || '';
  if (error instanceof ProviderConfigError) {
    return { kind: 'config', error: 'Open Eye is not connected to an AI provider yet. Ask the administrator to set the API keys.' };
  }
  if (/\b429\b|rate limit|rate-limited|too many requests/i.test(message)) {
    return { kind: 'rate_limited', error: 'The AI provider is rate-limiting requests. Try again in a minute.', retryAfter: 60 };
  }
  if (/LLM|Mistral|OpenAI|embedding|HTTP \d{3}|fetch failed|timed? ?out|ECONN/i.test(message)) {
    return { kind: 'provider_unavailable', error: 'The AI provider did not respond. Try again in a moment.' };
  }
  return { kind: 'internal', error: 'Something went wrong while answering. Try again.' };
}

const VALID_MODES: ChatSourceMode[] = ['INTERNAL', 'WEB', 'BOTH'];

export async function POST(req: NextRequest) {
  // Rate limit: 20 chat queries per minute per IP
  const rateLimit = checkRateLimit(req, 'chat_query', { maxRequests: 20, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.', kind: 'internal' }, { status: 400 });
  }
  const { message, history } = body || {};
  if (!message || typeof message !== 'string' || !message.trim()) {
    return NextResponse.json({ error: 'Ask a question first.', kind: 'internal' }, { status: 400 });
  }
  const requestedMode = typeof body.mode === 'string' ? body.mode.toUpperCase() : 'INTERNAL';
  const sourceMode: ChatSourceMode = VALID_MODES.includes(requestedMode) ? requestedMode : 'INTERNAL';

  let orchestrator: ChatOrchestrator;
  try {
    orchestrator = new ChatOrchestrator();
  } catch (error: any) {
    console.error('Chat endpoint configuration error:', error);
    const userError = toUserError(error);
    return NextResponse.json(userError, { status: userError.kind === 'config' ? 503 : 500 });
  }

  // Open the stream immediately: understanding the question, searching and web lookups can take a
  // few seconds, and the client shows each stage instead of a silent wait.
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true; // client disconnected
        }
      };

      try {
        // Every LLM call made for this answer is attributed to chat in the cost ledger
        await withLedgerScope({ scopeType: 'chat', purpose: 'chat_answer' }, async () => {
          const result = await orchestrator.processQuery(message.trim(), Array.isArray(history) ? history : [], {
            mode: sourceMode,
            onStatus: (stage, label) => send('status', { stage, label })
          });

          send('metadata', {
            sources: result.sources,
            sourcesUsed: result.sourcesUsed,
            requirements: result.requirements,
            composition: result.composition,
            architectureGraph: result.architectureGraph,
            citations: result.citations,
            webSources: result.webSources,
            sourceMode,
            trace: result.trace
          });

          for await (const chunk of result.stream) {
            if (closed) break;
            send('message', { text: chunk });
          }
        });
      } catch (error: any) {
        console.error('Chat stream error:', error);
        send('error', toUserError(error));
      } finally {
        send('done', {});
        if (!closed) {
          try {
            controller.close();
          } catch {
            // already closed by the client
          }
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive'
    }
  });
}
