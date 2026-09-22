import crypto from 'crypto';
import { FirecrawlProvider } from '../providers/firecrawl';
import { ResourceAdapter, ResourceDescriptor, IngestResult, ContentSegment } from './types';
import { ResourceTypeDetector } from './detector';

export class WebResourceAdapter implements ResourceAdapter {
  name = 'WebResourceAdapter';
  private firecrawl: FirecrawlProvider;

  constructor() {
    this.firecrawl = new FirecrawlProvider();
  }

  canHandle(url: string): boolean {
    const desc = ResourceTypeDetector.detect(url);
    return ['web_page', 'documentation_site', 'article', 'generic_url'].includes(desc.resourceType);
  }

  detect(url: string): ResourceDescriptor {
    return ResourceTypeDetector.detect(url);
  }

  async ingest(url: string): Promise<IngestResult> {
    const desc = this.detect(url);
    let scraped;

    if (desc.resourceType === 'documentation_site') {
      // Crawl top 3 pages for documentation sites
      const pages = await this.firecrawl.crawl(desc.canonicalUrl, { limit: 3 });
      scraped = pages[0] || { success: false, title: '', markdown: '' };
      // Combine pages if multiple
      if (pages.length > 1) {
        scraped.markdown = pages
          .map(p => `## Page: ${p.title}\nSource: ${p.url}\n\n${p.markdown}`)
          .join('\n\n---\n\n');
      }
    } else {
      scraped = await this.firecrawl.scrape(desc.canonicalUrl);
    }

    if (!scraped.success || !scraped.markdown.trim()) {
      return {
        success: false,
        status: 'FAILED',
        title: scraped.title || 'Inaccessible Web Resource',
        content: '',
        segments: [],
        metadata: { domain: desc.domain, error: scraped.errorMessage },
        contentHash: '',
        errorMessage: scraped.errorMessage || 'Could not extract content from web page'
      };
    }

    const content = scraped.markdown;
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    // Segment by markdown headings
    const segments: ContentSegment[] = [];
    const sections = content.split(/(?=^#{1,3}\s+)/m);

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed) continue;
      const headingMatch = trimmed.match(/^#{1,3}\s+(.+)$/m);
      const heading = headingMatch ? headingMatch[1].trim() : 'Overview';

      segments.push({
        title: heading,
        content: trimmed,
        locatorType: 'web_section',
        locator: {
          sectionHeading: heading,
          url: desc.canonicalUrl
        }
      });
    }

    return {
      success: true,
      status: 'READY',
      title: scraped.title || desc.canonicalUrl,
      description: scraped.description || '',
      author: scraped.author,
      publisher: desc.domain,
      content,
      segments: segments.length > 0 ? segments : [{
        title: 'Main Content',
        content,
        locatorType: 'web_section',
        locator: { sectionHeading: 'Main Content', url: desc.canonicalUrl }
      }],
      metadata: {
        domain: desc.domain,
        links: scraped.links?.slice(0, 20) || []
      },
      contentHash
    };
  }
}
