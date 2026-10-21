import {
  WebExtractionProvider,
  ScrapeOptions,
  ScrapedPage,
  CrawlOptions
} from './types';
import { validateResourceUrlSecurity } from '../security/ssrf';

// Sites that only render their content with JavaScript, or refuse plain HTTP clients
const BROWSER_RENDERED_DOMAINS = ['linkedin.com', 'twitter.com', 'x.com'];
const DEFAULT_TIMEOUT_MS = 30000;
// The service may use its whole budget across both fetch tiers; the request waits a little longer
const REQUEST_MARGIN_MS = 5000;

function hostMatches(url: string, domains: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/**
 * Client for the worker's scraper service (apps/worker/scraper/api.py). It is used only when the
 * service URL is configured: WORKER_SCRAPER_URL (or SCRAPLING_API_URL), plus SCRAPER_SECRET when the
 * service listens beyond loopback.
 */
export class ScraplingProvider implements WebExtractionProvider {
  private baseUrl: string;

  constructor(customUrl?: string) {
    this.baseUrl = (customUrl || process.env.WORKER_SCRAPER_URL || process.env.SCRAPLING_API_URL || '').trim();
  }

  isAvailable(): boolean {
    return this.baseUrl.length > 0;
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (process.env.SCRAPER_SECRET) headers['X-Scraper-Secret'] = process.env.SCRAPER_SECRET;
    return headers;
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

    if (!this.isAvailable()) {
      return { url, title: this.extractTitleFromUrl(url), markdown: '', statusCode: 503, success: false, errorMessage: 'Scraper service is not configured' };
    }

    try {
      const needsBrowser = hostMatches(url, BROWSER_RENDERED_DOMAINS) || Boolean(options.waitFor && options.waitFor > 0);
      const timeout = options.timeout || DEFAULT_TIMEOUT_MS;

      const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/scrape`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          url,
          stealth: needsBrowser,
          timeout,
          waitFor: options.waitFor || 0
        }),
        signal: AbortSignal.timeout(timeout + REQUEST_MARGIN_MS)
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
    const ssrfCheck = await validateResourceUrlSecurity(url);
    if (!ssrfCheck.valid || !this.isAvailable()) {
      return [await this.scrape(url)];
    }
    try {
      const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/crawl`;
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: this.headers(),
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
