import {
  WebExtractionProvider,
  ScrapeOptions,
  ScrapedPage,
  CrawlOptions
} from './types';
import { validateResourceUrlSecurity } from '../security/ssrf';

export class ScraplingProvider implements WebExtractionProvider {
  private baseUrl: string;

  constructor(customUrl?: string) {
    this.baseUrl =
      customUrl ||
      process.env.WORKER_SCRAPER_URL ||
      process.env.SCRAPLING_API_URL ||
      'http://127.0.0.1:8001';
  }

  isAvailable(): boolean {
    return Boolean(this.baseUrl && this.baseUrl.trim().length > 0);
  }

  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapedPage> {
    const ssrfCheck = await validateResourceUrlSecurity(url);
    if (!ssrfCheck.valid) {
      return {
        url,
        title: this.extractTitleFromUrl(url),
        markdown: '',
        statusCode: 403,
        success: false,
        errorMessage: `RESOURCE_ACCESS_BLOCKED: ${ssrfCheck.error}`
      };
    }

    try {
      const isStealthNeeded =
        url.includes('linkedin.com') ||
        url.includes('twitter.com') ||
        url.includes('x.com') ||
        (options.waitFor && options.waitFor > 0);

      const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/scrape`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          url,
          stealth: isStealthNeeded,
          timeout: options.timeout || 35000,
          waitFor: options.waitFor || 0
        }),
        signal: AbortSignal.timeout(options.timeout || 40000)
      });

      if (!res.ok) {
        const errText = await res.text();
        return {
          url,
          title: this.extractTitleFromUrl(url),
          markdown: '',
          statusCode: res.status,
          success: false,
          errorMessage: `Scrapling service returned HTTP ${res.status}: ${errText.slice(0, 100)}`
        };
      }

      const data = await res.json();
      return {
        url: data.url || url,
        title: data.title || this.extractTitleFromUrl(url),
        description: data.description || '',
        markdown: data.markdown || '',
        author: data.author || undefined,
        links: data.links || [],
        statusCode: data.status_code || 200,
        success: Boolean(data.success && data.markdown && data.markdown.trim().length > 0),
        errorMessage: data.error_message || undefined
      };
    } catch (err: any) {
      return {
        url,
        title: this.extractTitleFromUrl(url),
        markdown: '',
        statusCode: 500,
        success: false,
        errorMessage: `Scrapling connection error: ${err.message}`
      };
    }
  }

  async crawl(url: string, options: CrawlOptions = {}): Promise<ScrapedPage[]> {
    try {
      const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/crawl`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          limit: options.limit || 3
        }),
        signal: AbortSignal.timeout(60000)
      });

      if (!res.ok) {
        const fallback = await this.scrape(url);
        return [fallback];
      }

      const data = await res.json();
      if (Array.isArray(data.pages) && data.pages.length > 0) {
        return data.pages.map((p: any) => ({
          url: p.url || url,
          title: p.title || this.extractTitleFromUrl(url),
          description: p.description || '',
          markdown: p.markdown || '',
          author: p.author || undefined,
          links: p.links || [],
          statusCode: p.status_code || 200,
          success: Boolean(p.success),
          errorMessage: p.error_message || undefined
        }));
      }

      const fallback = await this.scrape(url);
      return [fallback];
    } catch {
      const fallback = await this.scrape(url);
      return [fallback];
    }
  }

  private extractTitleFromUrl(url: string): string {
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(Boolean);
      if (parts.length > 0) {
        return parts[parts.length - 1]
          .replace(/[-_]/g, ' ')
          .replace(/\.(html|php|aspx)$/, '')
          .replace(/^\w/, c => c.toUpperCase());
      }
      return parsed.hostname;
    } catch {
      return url;
    }
  }
}
