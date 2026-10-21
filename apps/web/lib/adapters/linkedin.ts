import crypto from 'crypto';
import { FirecrawlProvider } from '../providers/firecrawl';
import { ScraplingProvider } from '../providers/scrapling';
import { ResourceAdapter, ResourceDescriptor, IngestResult } from './types';
import { ResourceTypeDetector } from './detector';

export class LinkedInResourceAdapter implements ResourceAdapter {
  name = 'LinkedInResourceAdapter';
  private firecrawl: FirecrawlProvider;
  private scrapling: ScraplingProvider;

  constructor() {
    this.firecrawl = new FirecrawlProvider();
    this.scrapling = new ScraplingProvider();
  }

  canHandle(url: string): boolean {
    const desc = ResourceTypeDetector.detect(url);
    return desc.resourceType === 'linkedin_post';
  }

  detect(url: string): ResourceDescriptor {
    return ResourceTypeDetector.detect(url);
  }

  async ingest(url: string): Promise<IngestResult> {
    const desc = this.detect(url);

    // 1. Attempt stealth extraction via Scrapling + Camoufox (bypasses HTTP 999 botwalls)
    let scraped: any = null;
    if (this.scrapling.isAvailable()) {
      const stealthRes = await this.scrapling.scrape(desc.canonicalUrl, { waitFor: 2000 });
      if (stealthRes.success && stealthRes.markdown.length > 100) {
        scraped = stealthRes;
      }
    }

    // 2. Fall back to Firecrawl or native fetch
    if (!scraped || !scraped.success) {
      scraped = await this.firecrawl.scrape(desc.canonicalUrl);
    }

    // LinkedIn frequently returns 999, 403, or redirects to authwall / login
    const isAuthWalled =
      !scraped.success ||
      scraped.statusCode === 999 ||
      scraped.statusCode === 403 ||
      scraped.markdown.toLowerCase().includes('sign in') && scraped.markdown.length < 500 ||
      scraped.markdown.toLowerCase().includes('authwall');

    if (isAuthWalled) {
      return {
        success: false,
        status: 'BLOCKED',
        title: `LinkedIn Post (${desc.domain})`,
        content: '',
        segments: [],
        metadata: {
          domain: desc.domain,
          accessStatus: 'RESOURCE_ACCESS_FAILED'
        },
        contentHash: '',
        errorMessage: 'RESOURCE_ACCESS_FAILED: Content requires authentication or is restricted by LinkedIn platform policies. Open Eye does not bypass authentication.'
      };
    }

    const content = scraped.markdown;
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    return {
      success: true,
      status: 'READY',
      title: scraped.title || desc.canonicalUrl,
      description: scraped.description || '',
      author: scraped.author || undefined,
      publisher: 'LinkedIn',
      content,
      segments: [
        {
          title: 'Post Content',
          content,
          locatorType: 'linkedin_post',
          locator: {
            author: scraped.author || 'Unknown',
            url: desc.canonicalUrl
          }
        }
      ],
      metadata: {
        domain: desc.domain,
        author: scraped.author
      },
      contentHash
    };
  }
}
