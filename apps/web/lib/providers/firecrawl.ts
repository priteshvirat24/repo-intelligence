import { pool, query } from '@repo/database';
import {
  WebExtractionProvider,
  ScrapeOptions,
  ScrapedPage,
  CrawlOptions
} from './types';

export class FirecrawlProvider implements WebExtractionProvider {
  private apiKey: string | null;
  private baseUrl: string = 'https://api.firecrawl.dev/v1';

  constructor(apiKey?: string) {
    this.apiKey = apiKey || process.env.FIRECRAWL_API_KEY || null;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey && this.apiKey.trim().length > 0);
  }

  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapedPage> {
    const startTime = Date.now();

    // 1. If Firecrawl API key is available, attempt Firecrawl API v1
    if (this.isAvailable()) {
      try {
        const res = await fetch(`${this.baseUrl}/scrape`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`
          },
          body: JSON.stringify({
            url,
            formats: options.formats || ['markdown'],
            onlyMainContent: options.onlyMainContent ?? true,
            waitFor: options.waitFor || 0
          }),
          signal: AbortSignal.timeout(options.timeout || 25000)
        });

        const durationMs = Date.now() - startTime;

        if (res.ok) {
          const data = await res.json();
          const pageData = data.data || {};
          await this.logUsage('scrape', durationMs, true);

          return {
            url,
            canonicalUrl: pageData.metadata?.canonical || pageData.metadata?.sourceURL || url,
            title: pageData.metadata?.title || this.extractTitleFromUrl(url),
            description: pageData.metadata?.description || '',
            markdown: pageData.markdown || pageData.content || '',
            author: pageData.metadata?.author,
            publishedTime: pageData.metadata?.publishedTime,
            links: pageData.links || [],
            statusCode: pageData.metadata?.statusCode || 200,
            success: true
          };
        } else {
          const errText = await res.text();
          console.warn(`[FirecrawlProvider] API ${res.status}: ${errText.slice(0, 150)}. Falling back to native fetch.`);
          await this.logUsage('scrape', durationMs, false, `Firecrawl API ${res.status}`);
        }
      } catch (err: any) {
        console.warn(`[FirecrawlProvider] Network error: ${err.message}. Falling back to native fetch.`);
      }
    }

    // 2. Native Resilient Fallback Extractor
    return this.nativeScrapeFallback(url, startTime);
  }

  async crawl(url: string, options: CrawlOptions = {}): Promise<ScrapedPage[]> {
    const limit = options.limit || 5;
    // Scrape root page first
    const rootPage = await this.scrape(url);
    if (!rootPage.success) return [rootPage];

    const results: ScrapedPage[] = [rootPage];
    const discoveredLinks = (rootPage.links || [])
      .filter(link => {
        try {
          const linkUrl = new URL(link, url);
          const rootUrl = new URL(url);
          // Only crawl same domain & subpaths for docs
          return linkUrl.hostname === rootUrl.hostname && linkUrl.pathname.startsWith(rootUrl.pathname);
        } catch {
          return false;
        }
      })
      .slice(0, limit - 1);

    for (const link of discoveredLinks) {
      if (results.some(r => r.url === link)) continue;
      const subPage = await this.scrape(link, { onlyMainContent: true });
      if (subPage.success && subPage.markdown.length > 50) {
        results.push(subPage);
      }
    }

    return results;
  }

  private async nativeScrapeFallback(url: string, startTime: number): Promise<ScrapedPage> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (Open Eye Universal Resource Bot)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        signal: controller.signal
      });
      clearTimeout(timeout);

      const durationMs = Date.now() - startTime;

      if (!res.ok) {
        await this.logUsage('native_fetch', durationMs, false, `HTTP ${res.status}`);
        return {
          url,
          title: this.extractTitleFromUrl(url),
          markdown: '',
          statusCode: res.status,
          success: false,
          errorMessage: `HTTP ${res.status} ${res.statusText}`
        };
      }

      const html = await res.text();
      const { title, description, markdown, links } = this.cleanHtmlToMarkdown(html, url);

      await this.logUsage('native_fetch', durationMs, true);

      return {
        url,
        canonicalUrl: url,
        title: title || this.extractTitleFromUrl(url),
        description: description || '',
        markdown: markdown,
        links: links,
        statusCode: res.status,
        success: true
      };
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      await this.logUsage('native_fetch', durationMs, false, err.message);
      return {
        url,
        title: this.extractTitleFromUrl(url),
        markdown: '',
        success: false,
        errorMessage: err.message || 'Resource access failed'
      };
    }
  }

  private cleanHtmlToMarkdown(html: string, baseUrl: string): {
    title: string;
    description: string;
    markdown: string;
    links: string[];
  } {
    // Extract title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Extract meta description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
    const description = descMatch ? descMatch[1].trim() : '';

    // Extract links
    const linkRegex = /<a[^>]+href=["']([^"']+)["']/gi;
    const links: string[] = [];
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      try {
        const absolute = new URL(match[1], baseUrl).href;
        if (absolute.startsWith('http') && !links.includes(absolute)) {
          links.push(absolute);
        }
      } catch {}
    }

    // Strip scripts, styles, iframes, SVGs, and header/footer/nav boilerplate
    let clean = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '')
      .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, '')
      .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, '')
      .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '');

    // Convert common tags to simple markdown
    clean = clean
      .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
      .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
      .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
      .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
      .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
      .replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n')
      .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`')
      .replace(/<br\s*\/?>/gi, '\n');

    // Strip remaining tags
    clean = clean.replace(/<[^>]+>/g, ' ');

    // Normalize entities and whitespace
    clean = clean
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\r\n|\r/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();

    return {
      title,
      description,
      markdown: clean,
      links
    };
  }

  private extractTitleFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        return parts[parts.length - 1].replace(/[-_]/g, ' ');
      }
      return parsed.hostname;
    } catch {
      return url;
    }
  }

  private async logUsage(
    operation: string,
    durationMs: number,
    success: boolean,
    errorMessage?: string
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO provider_usage (provider, operation, duration_ms, success, error_message)
         VALUES ($1, $2, $3, $4, $5)`,
        ['firecrawl', operation, durationMs, success, errorMessage || null]
      );
    } catch {}
  }
}
