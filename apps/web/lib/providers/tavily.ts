import crypto from 'crypto';
import { pool, query } from '@repo/database';
import {
  WebSearchProvider,
  SearchOptions,
  SearchResponse,
  SearchResultItem
} from './types';

export class TavilyProvider implements WebSearchProvider {
  private apiKey: string | null;
  private baseUrl: string = 'https://api.tavily.com';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.TAVILY_API_KEY || null;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async search(searchQuery: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const trimmedQuery = searchQuery.trim();
    if (!trimmedQuery) {
      return { query: searchQuery, results: [], provider: 'tavily' };
    }

    const maxResults = options.maxResults || 5;
    const queryHash = crypto
      .createHash('sha256')
      .update(`${trimmedQuery}_${maxResults}_${options.searchDepth || 'basic'}`)
      .digest('hex');

    // 1. Check local search cache
    try {
      const cacheRes = await query(
        `SELECT results_json FROM web_search_cache WHERE query_hash = $1 AND expires_at > NOW()`,
        [queryHash]
      );
      if (cacheRes.rows.length > 0) {
        return {
          query: trimmedQuery,
          results: cacheRes.rows[0].results_json,
          provider: 'tavily',
          fromCache: true
        };
      }
    } catch (err) {
      console.warn('[TavilyProvider] Cache lookup error (continuing):', err);
    }

    // 2. If no API key configured, provide safe fallback
    if (!this.isAvailable()) {
      console.warn('[TavilyProvider] TAVILY_API_KEY is not configured; live web search disabled.');
      return {
        query: trimmedQuery,
        results: [],
        provider: 'tavily',
        answer: 'Live web search is unavailable because TAVILY_API_KEY is not configured.'
      };
    }

    const startTime = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          query: trimmedQuery,
          search_depth: options.searchDepth || 'basic',
          max_results: maxResults,
          include_domains: options.includeDomains,
          exclude_domains: options.excludeDomains,
          include_answer: options.includeAnswer ?? true
        })
      });

      const durationMs = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[TavilyProvider] API error ${response.status}:`, errorText);
        await this.logUsage('search', durationMs, 0, false, `HTTP ${response.status}: ${errorText.slice(0, 200)}`);
        return {
          query: trimmedQuery,
          results: [],
          provider: 'tavily',
          answer: `Live web search error: ${response.statusText}`
        };
      }

      const data = await response.json();
      const results: SearchResultItem[] = (data.results || []).map((r: any) => ({
        title: r.title || 'Untitled Web Page',
        url: r.url,
        content: r.content || '',
        score: r.score,
        publishedDate: r.published_date,
        domain: this.extractDomain(r.url)
      }));

      // Cache successful response for 24 hours
      try {
        await query(
          `INSERT INTO web_search_cache (query_hash, query_text, results_json, expires_at)
           VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')
           ON CONFLICT (query_hash) DO UPDATE SET
             results_json = EXCLUDED.results_json,
             expires_at = EXCLUDED.expires_at`,
          [queryHash, trimmedQuery, JSON.stringify(results)]
        );
      } catch (cacheErr) {
        console.warn('[TavilyProvider] Cache write error:', cacheErr);
      }

      await this.logUsage('search', durationMs, results.length, true);

      return {
        query: trimmedQuery,
        results,
        answer: data.answer,
        provider: 'tavily'
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      console.error('[TavilyProvider] Search execution failed:', err);
      await this.logUsage('search', durationMs, 0, false, err.message);
      return {
        query: trimmedQuery,
        results: [],
        provider: 'tavily',
        answer: `Web search failure: ${err.message}`
      };
    }
  }

  async extract(urls: string[]): Promise<Array<{ url: string; rawContent: string }>> {
    if (!this.isAvailable() || urls.length === 0) return [];
    try {
      const response = await fetch(`${this.baseUrl}/extract`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          urls
        })
      });
      if (!response.ok) return [];
      const data = await response.json();
      return (data.results || []).map((r: any) => ({
        url: r.url,
        rawContent: r.raw_content || ''
      }));
    } catch (err) {
      console.error('[TavilyProvider] Extract failed:', err);
      return [];
    }
  }

  private extractDomain(urlStr: string): string {
    try {
      const parsed = new URL(urlStr);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

  private async logUsage(
    operation: string,
    durationMs: number,
    itemCount: number,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO provider_usage (provider, operation, duration_ms, tokens_used, success, error_message)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        ['tavily', operation, durationMs, itemCount, success, errorMessage || null]
      );
    } catch {
      // Non-blocking usage logging
    }
  }
}
