import { NextRequest, NextResponse } from 'next/server';
import { ChatOrchestrator } from '@/lib/ai/chat';
import { checkRateLimit } from '@/lib/security/rate_limit';

export async function POST(req: NextRequest) {
  // Rate limit: 20 chat queries per minute per IP
  const rateLimit = checkRateLimit(req, 'chat_query', { maxRequests: 20, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  try {
    const { message, history } = await req.json();

    if (!message || typeof message !== 'string') {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const orchestrator = new ChatOrchestrator();
    const result = await orchestrator.processQuery(message, Array.isArray(history) ? history : []);

    // Create readable stream for SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // First emit metadata event with requirements, composition, architectureGraph, citations
        const metaEvent = `event: metadata\ndata: ${JSON.stringify({
          requirements: result.requirements,
          composition: result.composition,
          architectureGraph: result.architectureGraph,
          citations: result.citations
        })}\n\n`;
        controller.enqueue(encoder.encode(metaEvent));

        // Stream text deltas
        for await (const chunk of result.stream) {
          const textEvent = `event: message\ndata: ${JSON.stringify({ text: chunk })}\n\n`;
          controller.enqueue(encoder.encode(textEvent));
        }

        // Close stream
        controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
        controller.close();
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      }
    });
  } catch (error: any) {
    console.error('Chat endpoint error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
