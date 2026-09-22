import { ResourceType, ResourceRole } from '@repo/shared';
import { ResourceDescriptor } from './types';

export class ResourceTypeDetector {
  /**
   * Normalize an incoming URL by removing tracking query params, trailing slashes, etc.
   */
  static normalizeUrl(rawUrl: string): string {
    let trimmed = rawUrl.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      // If it looks like github.com/owner/repo or owner/repo, normalize to https://github.com/...
      if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
        trimmed = `https://github.com/${trimmed}`;
      } else {
        trimmed = `https://${trimmed}`;
      }
    }

    try {
      const parsed = new URL(trimmed);
      // Remove common tracking parameters
      const trackingParams = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'ref',
        'fbclid',
        'gclid',
        'si'
      ];
      for (const p of trackingParams) {
        parsed.searchParams.delete(p);
      }

      // Strip trailing slash from pathname if length > 1
      if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }

      return parsed.toString();
    } catch {
      return trimmed;
    }
  }

  /**
   * Deterministically detect the resource type, role, and domain from URL.
   */
  static detect(rawUrl: string): ResourceDescriptor {
    const canonicalUrl = this.normalizeUrl(rawUrl);
    let domain = '';
    let pathname = '';
    try {
      const parsed = new URL(canonicalUrl);
      domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
      pathname = parsed.pathname.toLowerCase();
    } catch {
      domain = 'unknown';
    }

    // 1. GitHub Repository
    if (domain === 'github.com' || domain === 'gitlab.com') {
      const parts = pathname.split('/').filter(Boolean);
      if (parts.length >= 2) {
        return {
          resourceType: 'github_repository',
          sourceUrl: canonicalUrl,
          canonicalUrl,
          domain,
          estimatedRole: 'software_component',
          metadata: {
            owner: parts[0],
            repo: parts[1]
          }
        };
      }
    }

    // 2. YouTube Video
    if (
      domain === 'youtube.com' ||
      domain === 'm.youtube.com' ||
      domain === 'youtu.be'
    ) {
      let videoId: string | null = null;
      try {
        const parsed = new URL(canonicalUrl);
        if (domain === 'youtu.be') {
          videoId = parsed.pathname.slice(1);
        } else if (parsed.searchParams.has('v')) {
          videoId = parsed.searchParams.get('v');
        } else if (pathname.includes('/embed/')) {
          videoId = pathname.split('/embed/')[1];
        }
      } catch {}

      return {
        resourceType: 'youtube_video',
        sourceUrl: canonicalUrl,
        canonicalUrl,
        domain,
        estimatedRole: 'tutorial',
        metadata: {
          videoId
        }
      };
    }

    // 3. LinkedIn Post / Article
    if (domain.includes('linkedin.com')) {
      return {
        resourceType: 'linkedin_post',
        sourceUrl: canonicalUrl,
        canonicalUrl,
        domain,
        estimatedRole: 'opinion',
        metadata: {}
      };
    }

    // 4. PDF Document / Research Paper
    if (pathname.endsWith('.pdf') || pathname.includes('/pdf/')) {
      const isArxiv = domain.includes('arxiv.org');
      return {
        resourceType: isArxiv ? 'research_paper' : 'pdf',
        sourceUrl: canonicalUrl,
        canonicalUrl,
        domain,
        estimatedRole: isArxiv ? 'research' : 'reference',
        metadata: {
          isArxiv
        }
      };
    }

    // 5. Documentation Site
    if (
      domain.includes('docs.') ||
      domain.includes('gitbook.io') ||
      domain.includes('readthedocs.io') ||
      pathname.includes('/docs') ||
      pathname.includes('/documentation') ||
      pathname.includes('/tutorial') ||
      pathname.includes('/guide')
    ) {
      return {
        resourceType: 'documentation_site',
        sourceUrl: canonicalUrl,
        canonicalUrl,
        domain,
        estimatedRole: 'documentation',
        metadata: {}
      };
    }

    // 6. Article / Blog Post
    if (
      domain.includes('medium.com') ||
      domain.includes('substack.com') ||
      domain.includes('dev.to') ||
      domain.includes('hashnode.dev') ||
      pathname.includes('/blog/') ||
      pathname.includes('/article/') ||
      pathname.includes('/post/')
    ) {
      return {
        resourceType: 'article',
        sourceUrl: canonicalUrl,
        canonicalUrl,
        domain,
        estimatedRole: 'article',
        metadata: {}
      };
    }

    // 7. Generic Web Page
    return {
      resourceType: 'web_page',
      sourceUrl: canonicalUrl,
      canonicalUrl,
      domain,
      estimatedRole: 'reference',
      metadata: {}
    };
  }
}
