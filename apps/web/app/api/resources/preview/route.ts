import { NextRequest, NextResponse } from 'next/server';
import { query } from '@repo/database';
import { checkRateLimit } from '@/lib/security/rate_limit';
import { validateResourceUrlSecurity } from '@/lib/security/ssrf';
import { ResourceTypeDetector } from '@/lib/adapters/detector';

export async function GET(req: NextRequest) {
  const rateLimit = checkRateLimit(req, 'preview_resource', { maxRequests: 40, windowMs: 60 * 1000 });
  if (!rateLimit.allowed && rateLimit.response) {
    return rateLimit.response;
  }

  const { searchParams } = new URL(req.url);
  const rawUrl = searchParams.get('url');

  if (!rawUrl || typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return NextResponse.json({ valid: false, error: 'Please enter a URL' }, { status: 400 });
  }

  // 1. SSRF Security Check
  const ssrfCheck = await validateResourceUrlSecurity(rawUrl);
  if (!ssrfCheck.valid) {
    return NextResponse.json({
      valid: false,
      supported: false,
      error: ssrfCheck.error,
      errorCode: ssrfCheck.errorCode
    }, { status: 400 });
  }

  // 2. Source Detection & Canonicalization
  const desc = ResourceTypeDetector.detect(rawUrl);

  if (!desc.isValid || !desc.isSupported) {
    return NextResponse.json({
      valid: false,
      supported: false,
      resourceType: desc.resourceType,
      error: desc.unsupportedReason || 'This URL is not supported for indexing.'
    }, { status: 400 });
  }

  // 3. Duplicate & Ingestion State Check
  const existingRes = await query(`
    SELECT id, title, status, error_message as "errorMessage", indexed_at as "indexedAt", updated_at as "updatedAt"
    FROM resources
    WHERE canonical_url = $1 OR source_url = $2
    LIMIT 1
  `, [desc.canonicalUrl, desc.canonicalUrl]);

  let alreadyExists = false;
  let alreadyProcessing = false;
  let existingResource: any = null;

  if (existingRes.rows.length > 0) {
    const row = existingRes.rows[0];
    existingResource = {
      id: row.id,
      title: row.title,
      status: row.status,
      indexedAt: row.indexedAt,
      errorMessage: row.errorMessage
    };

    if (row.status === 'READY' || row.status === 'PARTIAL') {
      alreadyExists = true;
    } else if (['FETCHING', 'ANALYZING', 'INDEXING', 'PENDING', 'CLONING'].includes(row.status)) {
      alreadyProcessing = true;
    }
  }

  // 4. Lightweight Metadata Preview Acquisition
  let title = desc.previewTitle || desc.canonicalUrl;
  let description = desc.previewDescription || '';
  let author = desc.domain;
  let thumbnailUrl: string | null = null;
  let willAnalyze: string[] = [];
  let metadata: Record<string, any> = {};

  try {
    if (desc.resourceType === 'github_repository') {
      const owner = desc.metadata?.owner;
      const repo = desc.metadata?.repo;
      willAnalyze = [
        'Inspect repository code structure & dependency manifests',
        'Analyze AST symbols, functions, and module boundaries',
        'Discover domain capabilities with evidence verification',
        'Build searchable multi-level vector embeddings'
      ];

      if (owner && repo) {
        try {
          const ghHeaders: Record<string, string> = {
            'User-Agent': 'Open-Eye-Universal-Bot',
            Accept: 'application/vnd.github.v3+json'
          };
          if (process.env.GITHUB_TOKEN) {
            ghHeaders.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
          }
          const ghRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
            headers: ghHeaders,
            signal: AbortSignal.timeout(4000)
          });
          if (ghRes.ok) {
            const data = await ghRes.json();
            title = data.full_name || `${owner}/${repo}`;
            description = data.description || '';
            author = data.owner?.login || owner;
            metadata = {
              stars: data.stargazers_count,
              language: data.language,
              license: data.license?.spdx_id || data.license?.name,
              isPrivate: data.private
            };
          } else if (ghRes.status === 404) {
            return NextResponse.json({
              valid: true,
              supported: false,
              resourceType: 'github_repository',
              error: `GitHub repository "${owner}/${repo}" was not found or is private. Open Eye only indexes public repositories.`
            }, { status: 404 });
          }
        } catch {
          // If GitHub API call times out, keep detected fallback
        }
      }
    } else if (desc.resourceType === 'youtube_video') {
      const videoId = desc.metadata?.videoId;
      thumbnailUrl = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
      willAnalyze = [
        'Extract video title, channel, and public metadata',
        'Retrieve and segment timestamped transcript if available',
        'Synthesize core engineering concepts and takeaways',
        'Index searchable timestamp locators into knowledge base'
      ];

      try {
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(desc.canonicalUrl)}&format=json`;
        const oembedRes = await fetch(oembedUrl, { signal: AbortSignal.timeout(3500) });
        if (oembedRes.ok) {
          const data = await oembedRes.json();
          title = data.title || title;
          author = data.author_name || 'YouTube Creator';
          if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
        }
      } catch {}
    } else if (desc.resourceType === 'research_paper') {
      const arxivId = desc.metadata?.arxivId;
      title = `arXiv Research Paper (${arxivId || 'Paper'})`;
      description = `Scientific publication on arXiv (${arxivId})`;
      willAnalyze = [
        'Extract paper abstract, methodology, and conclusions',
        'Structure document pages into semantic sections',
        'Extract specialized techniques, formulas, and concepts',
        'Index page-level citations for evidence verification'
      ];
    } else if (desc.resourceType === 'pdf') {
      title = desc.metadata?.filename || 'PDF Document';
      description = `Document from ${desc.domain}`;
      willAnalyze = [
        'Extract document text and page structure safely',
        'Analyze key concepts, architectures, and guidelines',
        'Generate dense semantic vector chunks',
        'Index page-level citations into knowledge base'
      ];
    } else if (desc.resourceType === 'documentation_site') {
      title = `Documentation (${desc.domain})`;
      description = `Technical documentation and API guides from ${desc.domain}`;
      willAnalyze = [
        'Crawl technical guides, tutorials, and API endpoints',
        'Extract code blocks, signatures, and architectural patterns',
        'Synthesize library use-cases and developer capabilities',
        'Index section-level anchors into knowledge base'
      ];
    } else if (desc.resourceType === 'article') {
      title = `Technical Article (${desc.domain})`;
      description = `Article publication from ${desc.domain}`;
      willAnalyze = [
        'Extract article markdown content via web parser',
        'Analyze problems solved and practical recommendations',
        'Generate semantic embeddings for Studio Chat reasoning'
      ];
    } else if (desc.resourceType === 'linkedin_post') {
      title = `LinkedIn Post (${desc.domain})`;
      description = `Public commentary from ${desc.domain}`;
      willAnalyze = [
        'Verify public accessibility and authentication barriers',
        'Extract technical post text if publicly readable',
        'Analyze industry perspectives and practical insights'
      ];
    } else {
      title = `Web Page (${desc.domain})`;
      description = `Public resource from ${desc.domain}`;
      willAnalyze = [
        'Extract main text content using intelligent web scraper',
        'Synthesize core capabilities, problems solved, and uses',
        'Generate multi-level vector embeddings'
      ];
    }
  } catch (err: any) {
    console.warn('Metadata preview warning:', err.message);
  }

  return NextResponse.json({
    valid: true,
    supported: true,
    resourceType: desc.resourceType,
    estimatedRole: desc.estimatedRole,
    canonicalUrl: desc.canonicalUrl,
    domain: desc.domain,
    title,
    description,
    author,
    thumbnailUrl,
    willAnalyze,
    metadata,
    alreadyExists,
    alreadyProcessing,
    existingResource
  });
}
