import { ResourceType, ResourceRole } from '@repo/shared';
import { ResourceDescriptor } from './types';

export class ResourceTypeDetector {
  /**
   * Forgivingly normalizes an incoming raw URL:
   * - Trims whitespace
   * - Prefixes https:// if protocol is omitted
   * - Normalizes short GitHub syntax "owner/repo" to "https://github.com/owner/repo"
   * - Strips common analytics/tracking query params (utm_*, ref, fbclid, gclid, si, etc.)
   * - Strips trailing slashes from pathnames
   * - Strips .git suffix from GitHub/GitLab repository URLs
   */
  static normalizeUrl(rawUrl: string): string {
    if (!rawUrl || typeof rawUrl !== 'string') return '';

    let trimmed = rawUrl.trim();
    if (!trimmed) return '';

    // Handle quick owner/repo shorthand for GitHub (e.g. "facebook/react" or "citrolabs/ego-lite")
    if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
      trimmed = `https://github.com/${trimmed}`;
    } else if (trimmed.startsWith('github.com/')) {
      trimmed = `https://${trimmed}`;
    } else if (trimmed.startsWith('www.github.com/')) {
      trimmed = `https://${trimmed.replace(/^www\./, '')}`;
    } else if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      if (trimmed.includes('.') && !trimmed.includes('://')) {
        trimmed = `https://${trimmed}`;
      }
    }

    try {
      const parsed = new URL(trimmed);

      // Strip common marketing and tracking parameters
      const trackingParams = [
        'utm_source',
        'utm_medium',
        'utm_campaign',
        'utm_term',
        'utm_content',
        'ref',
        'ref_src',
        'fbclid',
        'gclid',
        'si',
        'feature',
        'origin',
        'source'
      ];
      for (const p of trackingParams) {
        parsed.searchParams.delete(p);
      }

      const domain = parsed.hostname.replace(/^www\./, '').toLowerCase();

      // Normalization specific to GitHub
      if (domain === 'github.com' || domain === 'gitlab.com') {
        // Strip .git suffix
        if (parsed.pathname.endsWith('.git')) {
          parsed.pathname = parsed.pathname.slice(0, -4);
        }
        // Normalize repository URLs to lowercase owner/repo
        const parts = parsed.pathname.split('/').filter(Boolean);
        if (parts.length === 2) {
          parsed.pathname = `/${parts[0]}/${parts[1]}`;
        }
      }

      // Normalization specific to YouTube
      if (domain === 'youtube.com' || domain === 'm.youtube.com' || domain === 'youtu.be') {
        let videoId: string | null = null;
        if (domain === 'youtu.be') {
          videoId = parsed.pathname.slice(1).split('/')[0];
        } else if (parsed.searchParams.has('v')) {
          videoId = parsed.searchParams.get('v');
        } else if (parsed.pathname.includes('/embed/')) {
          videoId = parsed.pathname.split('/embed/')[1].split('/')[0];
        } else if (parsed.pathname.includes('/shorts/')) {
          videoId = parsed.pathname.split('/shorts/')[1].split('/')[0];
        }

        if (videoId) {
          // Canonicalize all YouTube video URLs to standard watch format
          return `https://www.youtube.com/watch?v=${videoId}`;
        }
      }

      // Normalization specific to ArXiv
      if (domain === 'arxiv.org') {
        const absMatch = parsed.pathname.match(/\/abs\/([0-9]+\.[0-9]+(?:v[0-9]+)?|[a-zA-Z-]+\/[0-9]+)/);
        if (absMatch) {
          return `https://arxiv.org/abs/${absMatch[1]}`;
        }
        const pdfMatch = parsed.pathname.match(/\/pdf\/([0-9]+\.[0-9]+(?:v[0-9]+)?|[a-zA-Z-]+\/[0-9]+)/);
        if (pdfMatch) {
          return `https://arxiv.org/abs/${pdfMatch[1]}`;
        }
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
   * Deterministically detect the resource type, role, domain, and validation status from URL.
   */
  static detect(rawUrl: string): ResourceDescriptor {
    if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
      return {
        resourceType: 'generic_url',
        sourceUrl: '',
        canonicalUrl: '',
        domain: '',
        estimatedRole: 'reference',
        isValid: false,
        isSupported: false,
        unsupportedReason: 'Please enter a valid public URL.'
      };
    }

    const canonicalUrl = this.normalizeUrl(rawUrl);

    let parsed: URL;
    try {
      parsed = new URL(canonicalUrl);
    } catch {
      return {
        resourceType: 'generic_url',
        sourceUrl: rawUrl,
        canonicalUrl,
        domain: '',
        estimatedRole: 'reference',
        isValid: false,
        isSupported: false,
        unsupportedReason: 'Malformed URL format. Expected a valid public HTTP or HTTPS address.'
      };
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        resourceType: 'generic_url',
        sourceUrl: rawUrl,
        canonicalUrl,
        domain: '',
        estimatedRole: 'reference',
        isValid: false,
        isSupported: false,
        unsupportedReason: `Unsupported protocol "${parsed.protocol}". Only public http:// and https:// URLs are supported.`
      };
    }

    const domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    const pathSegments = parsed.pathname.split('/').filter(Boolean);

    // 1. GitHub / GitLab
    if (domain === 'github.com' || domain === 'gitlab.com') {
      if (pathSegments.length === 0) {
        return {
          resourceType: 'github_repository',
          sourceUrl: rawUrl,
          canonicalUrl,
          domain,
          estimatedRole: 'software_component',
          isValid: false,
          isSupported: false,
          unsupportedReason: 'Root GitHub homepage cannot be indexed as a repository. Please enter a repository URL (e.g. https://github.com/owner/repo).'
        };
      }

      if (pathSegments.length === 1) {
        const reservedPages = ['explore', 'trending', 'pricing', 'features', 'enterprise', 'topics', 'collections', 'events', 'settings'];
        if (reservedPages.includes(pathSegments[0].toLowerCase())) {
          return {
            resourceType: 'github_repository',
            sourceUrl: rawUrl,
            canonicalUrl,
            domain,
            estimatedRole: 'software_component',
            isValid: false,
            isSupported: false,
            unsupportedReason: `"${pathSegments[0]}" is a general GitHub site page, not a software repository.`
          };
        }
        return {
          resourceType: 'github_repository',
          sourceUrl: rawUrl,
          canonicalUrl,
          domain,
          estimatedRole: 'software_component',
          isValid: false,
          isSupported: false,
          unsupportedReason: `This URL points to GitHub user profile or organization "${pathSegments[0]}". Open Eye indexes code repositories, not user profiles.`
        };
      }

      const [owner, rawRepo, subPath] = pathSegments;
      const repo = rawRepo.endsWith('.git') ? rawRepo.slice(0, -4) : rawRepo;

      if (subPath) {
        const sub = subPath.toLowerCase();
        if (sub === 'issues') {
          return {
            resourceType: 'github_repository',
            sourceUrl: rawUrl,
            canonicalUrl: `https://${domain}/${owner}/${repo}`,
            domain,
            estimatedRole: 'software_component',
            isValid: false,
            isSupported: false,
            unsupportedReason: `This URL points to a GitHub issue. Open Eye indexes the repository as a whole (https://${domain}/${owner}/${repo}).`
          };
        }
        if (sub === 'pull' || sub === 'pulls') {
          return {
            resourceType: 'github_repository',
            sourceUrl: rawUrl,
            canonicalUrl: `https://${domain}/${owner}/${repo}`,
            domain,
            estimatedRole: 'software_component',
            isValid: false,
            isSupported: false,
            unsupportedReason: `This URL points to a pull request. Open Eye indexes the main repository (https://${domain}/${owner}/${repo}).`
          };
        }
        if (sub === 'commit' || sub === 'commits') {
          return {
            resourceType: 'github_repository',
            sourceUrl: rawUrl,
            canonicalUrl: `https://${domain}/${owner}/${repo}`,
            domain,
            estimatedRole: 'software_component',
            isValid: false,
            isSupported: false,
            unsupportedReason: `This URL points to a commit. Open Eye indexes the repository (https://${domain}/${owner}/${repo}).`
          };
        }
        if (sub === 'blob' || sub === 'tree') {
          return {
            resourceType: 'github_repository',
            sourceUrl: rawUrl,
            canonicalUrl: `https://${domain}/${owner}/${repo}`,
            domain,
            estimatedRole: 'software_component',
            isValid: true,
            isSupported: true,
            previewTitle: `${owner}/${repo}`,
            previewDescription: `Indexing root repository for file path ${pathSegments.slice(2).join('/')}`,
            metadata: {
              owner,
              repo,
              specificPath: pathSegments.slice(3).join('/')
            }
          };
        }
      }

      const repoCanonical = `https://${domain}/${owner}/${repo}`;
      return {
        resourceType: 'github_repository',
        sourceUrl: rawUrl,
        canonicalUrl: repoCanonical,
        domain,
        estimatedRole: 'software_component',
        isValid: true,
        isSupported: true,
        previewTitle: `${owner}/${repo}`,
        previewDescription: `GitHub Repository by ${owner}`,
        metadata: {
          owner,
          repo
        }
      };
    }

    // 2. YouTube
    if (domain === 'youtube.com' || domain === 'm.youtube.com' || domain === 'youtu.be') {
      if (pathname.includes('/playlist')) {
        return {
          resourceType: 'youtube_video',
          sourceUrl: rawUrl,
          canonicalUrl,
          domain,
          estimatedRole: 'tutorial',
          isValid: false,
          isSupported: false,
          unsupportedReason: 'This URL points to a YouTube playlist. Open Eye currently indexes individual videos.'
        };
      }

      if (pathname.startsWith('/@') || pathname.startsWith('/channel/') || pathname.startsWith('/c/') || pathname.startsWith('/user/')) {
        return {
          resourceType: 'youtube_video',
          sourceUrl: rawUrl,
          canonicalUrl,
          domain,
          estimatedRole: 'tutorial',
          isValid: false,
          isSupported: false,
          unsupportedReason: 'This URL points to a YouTube channel. Open Eye indexes individual video resources, not entire channels.'
        };
      }

      let videoId: string | null = null;
      if (domain === 'youtu.be') {
        videoId = pathSegments[0] || null;
      } else if (parsed.searchParams.has('v')) {
        videoId = parsed.searchParams.get('v');
      } else if (pathname.includes('/embed/')) {
        videoId = pathname.split('/embed/')[1]?.split('/')[0] || null;
      } else if (pathname.includes('/shorts/')) {
        videoId = pathname.split('/shorts/')[1]?.split('/')[0] || null;
      }

      if (!videoId || videoId.length < 6) {
        return {
          resourceType: 'youtube_video',
          sourceUrl: rawUrl,
          canonicalUrl,
          domain,
          estimatedRole: 'tutorial',
          isValid: false,
          isSupported: false,
          unsupportedReason: 'Could not find a valid YouTube video ID in this URL.'
        };
      }

      const cleanVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
      return {
        resourceType: 'youtube_video',
        sourceUrl: rawUrl,
        canonicalUrl: cleanVideoUrl,
        domain,
        estimatedRole: 'tutorial',
        isValid: true,
        isSupported: true,
        previewTitle: `YouTube Video (ID: ${videoId})`,
        metadata: {
          videoId,
          videoUrl: cleanVideoUrl
        }
      };
    }

    // 3. ArXiv Research Papers
    if (domain === 'arxiv.org') {
      const match = pathname.match(/\/(abs|pdf)\/([0-9]+\.[0-9]+(?:v[0-9]+)?|[a-zA-Z-]+\/[0-9]+)/);
      if (match) {
        const arxivId = match[2].replace(/\.pdf$/, '');
        const pdfUrl = `https://arxiv.org/pdf/${arxivId}.pdf`;
        return {
          resourceType: 'research_paper',
          sourceUrl: rawUrl,
          canonicalUrl: `https://arxiv.org/abs/${arxivId}`,
          domain,
          estimatedRole: 'research',
          isValid: true,
          isSupported: true,
          previewTitle: `arXiv Paper: ${arxivId}`,
          previewDescription: `Scientific research paper on arXiv (${arxivId})`,
          metadata: {
            arxivId,
            pdfUrl,
            isArxiv: true
          }
        };
      }
    }

    // 4. PDF Documents
    if (pathname.endsWith('.pdf') || pathname.includes('/pdf/')) {
      const filename = pathSegments[pathSegments.length - 1] || 'document.pdf';
      return {
        resourceType: 'pdf',
        sourceUrl: rawUrl,
        canonicalUrl,
        domain,
        estimatedRole: 'reference',
        isValid: true,
        isSupported: true,
        previewTitle: decodeURIComponent(filename),
        previewDescription: `PDF Document from ${domain}`,
        metadata: {
          filename,
          isArxiv: false
        }
      };
    }

    // 5. LinkedIn
    if (domain.includes('linkedin.com')) {
      if (pathname.includes('/in/')) {
        return {
          resourceType: 'linkedin_post',
          sourceUrl: rawUrl,
          canonicalUrl,
          domain,
          estimatedRole: 'opinion',
          isValid: false,
          isSupported: false,
          unsupportedReason: 'This URL points to a personal LinkedIn profile. Open Eye indexes public technical posts and articles, not personal profiles.'
        };
      }

      if (pathname.includes('/posts/') || pathname.includes('/pulse/') || pathname.includes('/article/')) {
        return {
          resourceType: 'linkedin_post',
          sourceUrl: rawUrl,
          canonicalUrl,
          domain,
          estimatedRole: 'opinion',
          isValid: true,
          isSupported: true,
          previewTitle: 'Public LinkedIn Post',
          previewDescription: `Technical post from ${domain}`,
          metadata: {}
        };
      }

      return {
        resourceType: 'linkedin_post',
        sourceUrl: rawUrl,
        canonicalUrl,
        domain,
        estimatedRole: 'opinion',
        isValid: true,
        isSupported: true,
        previewTitle: 'LinkedIn Resource',
        previewDescription: `Public commentary from ${domain}`,
        metadata: {}
      };
    }

    // 6. Documentation Sites
    if (
      domain.includes('docs.') ||
      domain.includes('gitbook.io') ||
      domain.includes('readthedocs.io') ||
      domain.includes('developer.') ||
      pathname.includes('/docs') ||
      pathname.includes('/documentation') ||
      pathname.includes('/tutorial') ||
      pathname.includes('/guide') ||
      pathname.includes('/reference') ||
      pathname.includes('/api-reference')
    ) {
      return {
        resourceType: 'documentation_site',
        sourceUrl: rawUrl,
        canonicalUrl,
        domain,
        estimatedRole: 'documentation',
        isValid: true,
        isSupported: true,
        previewTitle: `Documentation (${domain})`,
        previewDescription: `Technical documentation and API guides from ${domain}`,
        metadata: {}
      };
    }

    // 7. Technical Articles & Blogs
    if (
      domain.includes('medium.com') ||
      domain.includes('substack.com') ||
      domain.includes('dev.to') ||
      domain.includes('hashnode.dev') ||
      domain.includes('hackernoon.com') ||
      pathname.includes('/blog') ||
      pathname.includes('/article') ||
      pathname.includes('/post')
    ) {
      return {
        resourceType: 'article',
        sourceUrl: rawUrl,
        canonicalUrl,
        domain,
        estimatedRole: 'article',
        isValid: true,
        isSupported: true,
        previewTitle: `Technical Article (${domain})`,
        previewDescription: `Article / blog publication from ${domain}`,
        metadata: {}
      };
    }

    // 8. Generic Public Web Page
    return {
      resourceType: 'web_page',
      sourceUrl: rawUrl,
      canonicalUrl,
      domain,
      estimatedRole: 'reference',
      isValid: true,
      isSupported: true,
      previewTitle: `Web Page (${domain})`,
      previewDescription: `Public technical resource from ${domain}`,
      metadata: {}
    };
  }
}
