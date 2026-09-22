import { NextRequest, NextResponse } from 'next/server';
import { TavilyProvider } from '@/lib/providers/tavily';
import { ResourceTypeDetector } from '@/lib/adapters/detector';
import { checkRateLimit } from '@/lib/security/rate_limit';
import { WebSearchResult } from '@repo/shared';

export async function POST(req: NextRequest) {
  const rateLimit = checkRateLimit(req, 'live_web_search', { maxRequests: 20, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  try {
    const body = await req.json();
    const searchQuery = body.query;

    if (!searchQuery || typeof searchQuery !== 'string') {
      return NextResponse.json({ error: 'Search query is required' }, { status: 400 });
    }

    const tavily = new TavilyProvider();
    const response = await tavily.search(searchQuery, {
      maxResults: body.maxResults || 5,
      searchDepth: 'basic'
    });

    const webResults: WebSearchResult[] = response.results.map(r => {
      const desc = ResourceTypeDetector.detect(r.url);
      return {
        title: r.title,
        url: r.url,
        content: r.content,
        domain: r.domain || desc.domain,
        score: r.score,
        publishedDate: r.publishedDate,
        canSave: true,
        sourceType: desc.resourceType
      };
    });

    return NextResponse.json({
      query: searchQuery,
      results: webResults,
      answer: response.answer,
      fromCache: response.fromCache ?? false,
      available: tavily.isAvailable()
    });
  } catch (error: any) {
    console.error('Error executing live web search:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
