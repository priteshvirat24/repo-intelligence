import { ResourceTypeDetector } from '../apps/web/lib/adapters/detector';
import { validateResourceUrlSecurity } from '../apps/web/lib/security/ssrf';
import { normalizeResourceError } from '../apps/web/lib/adapters/errors';

interface TestCase {
  name: string;
  url: string;
  expectedType?: string;
  expectedSupported?: boolean;
  expectedSsrfBlocked?: boolean;
}

const testCases: TestCase[] = [
  // 1. GitHub variants
  { name: 'GitHub standard', url: 'https://github.com/owner/repo', expectedType: 'github_repository', expectedSupported: true },
  { name: 'GitHub trailing slash', url: 'https://github.com/owner/repo/', expectedType: 'github_repository', expectedSupported: true },
  { name: 'GitHub with .git', url: 'https://github.com/owner/repo.git', expectedType: 'github_repository', expectedSupported: true },
  { name: 'GitHub with UTM tracking', url: 'https://github.com/owner/repo?utm_source=test', expectedType: 'github_repository', expectedSupported: true },
  
  // 2. YouTube variants
  { name: 'YouTube standard', url: 'https://youtube.com/watch?v=ABC12345678', expectedType: 'youtube_video', expectedSupported: true },
  { name: 'YouTube www', url: 'https://www.youtube.com/watch?v=ABC12345678', expectedType: 'youtube_video', expectedSupported: true },
  { name: 'YouTube short link', url: 'https://youtu.be/ABC12345678', expectedType: 'youtube_video', expectedSupported: true },
  { name: 'YouTube shorts path', url: 'https://youtube.com/shorts/ABC12345678', expectedType: 'youtube_video', expectedSupported: true },

  // 3. arXiv & PDF
  { name: 'arXiv abstract page', url: 'https://arxiv.org/abs/2301.00001', expectedType: 'research_paper', expectedSupported: true },
  { name: 'arXiv pdf link', url: 'https://arxiv.org/pdf/2301.00001.pdf', expectedType: 'research_paper', expectedSupported: true },
  { name: 'Generic PDF file', url: 'https://example.com/files/whitepaper.pdf', expectedType: 'pdf', expectedSupported: true },

  // 4. Web & Docs & LinkedIn
  { name: 'Documentation URL', url: 'https://example.com/docs/guide', expectedType: 'documentation_site', expectedSupported: true },
  { name: 'Article URL', url: 'https://example.com/blog/article-title', expectedType: 'article', expectedSupported: true },
  { name: 'Generic Web URL', url: 'https://example.com/about', expectedType: 'web_page', expectedSupported: true },
  { name: 'LinkedIn post', url: 'https://www.linkedin.com/posts/someone_activity-123456', expectedType: 'linkedin_post', expectedSupported: true },

  // 5. Incompatible / Unsupported subpaths (Should be detected as unsupported!)
  { name: 'GitHub user profile', url: 'https://github.com/torvalds', expectedSupported: false },
  { name: 'GitHub issue', url: 'https://github.com/owner/repo/issues/42', expectedSupported: false },
  { name: 'GitHub PR', url: 'https://github.com/owner/repo/pull/10', expectedSupported: false },
  { name: 'GitHub commit', url: 'https://github.com/owner/repo/commit/abcdef', expectedSupported: false },
  { name: 'YouTube channel', url: 'https://youtube.com/@mkbhd', expectedSupported: false },
  { name: 'YouTube playlist', url: 'https://www.youtube.com/playlist?list=PL123456789', expectedSupported: false },

  // 6. Security / Malformed / SSRF attacks (Must be blocked!)
  { name: 'Loopback localhost', url: 'http://localhost:3000', expectedSsrfBlocked: true },
  { name: 'Loopback IP 127.0.0.1', url: 'http://127.0.0.1/admin', expectedSsrfBlocked: true },
  { name: 'Private IP 10.x', url: 'http://10.0.0.1/secret', expectedSsrfBlocked: true },
  { name: 'Private IP 192.168.x', url: 'http://192.168.1.1', expectedSsrfBlocked: true },
  { name: 'Cloud metadata 169.254', url: 'http://169.254.169.254/latest/meta-data', expectedSsrfBlocked: true },
  { name: 'FTP scheme', url: 'ftp://ftp.example.com/file', expectedSsrfBlocked: true },
  { name: 'Javascript URI', url: 'javascript:alert(1)', expectedSsrfBlocked: true },
  { name: 'Data URI', url: 'data:text/html,<b>pwn</b>', expectedSsrfBlocked: true }
];

async function runTestSuite() {
  console.log('====================================================');
  console.log('   OPEN EYE ADD RESOURCE LAYER AUDIT TEST SUITE     ');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    process.stdout.write(`Testing: ${tc.name.padEnd(28)} `);

    // 1. Security Check
    if (tc.expectedSsrfBlocked) {
      const ssrf = await validateResourceUrlSecurity(tc.url);
      if (!ssrf.valid) {
        console.log(`[PASS] Blocked securely: ${ssrf.error}`);
        passed++;
      } else {
        console.log(`[FAIL] Security vulnerability! Expected block for ${tc.url}`);
        failed++;
      }
      continue;
    }

    // 2. Detection & Canonicalization Check
    const desc = ResourceTypeDetector.detect(tc.url);

    if (tc.expectedSupported !== undefined) {
      if (desc.isSupported !== tc.expectedSupported) {
        console.log(`[FAIL] isSupported expected ${tc.expectedSupported}, got ${desc.isSupported} (${desc.unsupportedReason})`);
        failed++;
        continue;
      }
    }

    if (tc.expectedType && desc.resourceType !== tc.expectedType) {
      console.log(`[FAIL] Type expected ${tc.expectedType}, got ${desc.resourceType}`);
      failed++;
      continue;
    }

    console.log(`[PASS] Type: ${desc.resourceType.padEnd(18)} Canonical: ${desc.canonicalUrl}`);
    passed++;
  }

  // 3. Error Normalization Checks
  console.log('\n--- Testing Error Normalization ---');
  const err1 = normalizeResourceError('HTTP 403 Forbidden', { domain: 'linkedin.com' });
  const err2 = normalizeResourceError('HTTP 429 Too Many Requests');
  const err3 = normalizeResourceError('HTTP 404 Not Found', { resourceType: 'github_repository' });

  if (err1.status === 'BLOCKED' && !err1.isRetryable && err1.code === 'SOURCE_BLOCKED') {
    console.log('[PASS] LinkedIn 403 normalized to BLOCKED, non-retryable');
    passed++;
  } else {
    console.log('[FAIL] LinkedIn 403 normalization mismatch');
    failed++;
  }

  if (err2.code === 'RATE_LIMITED' && err2.isRetryable) {
    console.log('[PASS] 429 normalized to RATE_LIMITED, retryable');
    passed++;
  } else {
    console.log('[FAIL] 429 normalization mismatch');
    failed++;
  }

  if (err3.code === 'RESOURCE_NOT_FOUND' && err3.title.includes('GitHub')) {
    console.log('[PASS] GitHub 404 normalized to Repository Not Found, actionable');
    passed++;
  } else {
    console.log('[FAIL] GitHub 404 normalization mismatch');
    failed++;
  }

  console.log('\n====================================================');
  console.log(`Summary: ${passed} Passed, ${failed} Failed`);
  console.log('====================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch(err => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
