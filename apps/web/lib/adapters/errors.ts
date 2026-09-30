export interface NormalizedResourceError {
  status: 'BLOCKED' | 'FAILED';
  code:
    | 'SOURCE_BLOCKED'
    | 'RESOURCE_NOT_FOUND'
    | 'RATE_LIMITED'
    | 'NETWORK_ERROR'
    | 'UNSUPPORTED_RESOURCE'
    | 'CONTENT_EMPTY'
    | 'RESOURCE_TOO_LARGE'
    | 'PARSING_FAILED'
    | 'INTERNAL_ERROR';
  title: string;
  reason: string;
  action: string;
  isRetryable: boolean;
}

export function normalizeResourceError(
  rawError: string | Error | null | undefined,
  context?: { resourceType?: string; domain?: string }
): NormalizedResourceError {
  const message = (
    rawError instanceof Error ? rawError.message : (rawError || '')
  ).trim();
  const lower = message.toLowerCase();

  // 1. SSRF & Security Blocked
  if (
    lower.includes('ssrf') ||
    lower.includes('prohibited') ||
    lower.includes('loopback') ||
    lower.includes('private ip') ||
    lower.includes('metadata') ||
    lower.includes('localhost') ||
    lower.includes('internal')
  ) {
    return {
      status: 'BLOCKED',
      code: 'SOURCE_BLOCKED',
      title: 'Prohibited Destination',
      reason: 'Access to private networks, loopback addresses, or internal services is prohibited.',
      action: 'Provide a valid, publicly reachable internet URL.',
      isRetryable: false
    };
  }

  // 2. Authentication / Paywall / Bot Wall / 403 / 401
  if (
    lower.includes('403') ||
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('forbidden') ||
    lower.includes('requires login') ||
    lower.includes('authentication') ||
    lower.includes('captcha') ||
    lower.includes('cloudflare') ||
    lower.includes('blocked')
  ) {
    const isLinkedIn = context?.domain?.includes('linkedin.com') || lower.includes('linkedin');
    return {
      status: 'BLOCKED',
      code: 'SOURCE_BLOCKED',
      title: isLinkedIn ? 'LinkedIn Authentication Required' : 'Access Blocked or Requires Login',
      reason: isLinkedIn
        ? 'LinkedIn requires account authentication to access this content. Open Eye does not bypass access controls or store personal credentials.'
        : 'The page requires login credentials, an active session, or blocked automated access.',
      action: 'Use a publicly accessible article, repository, or documentation page.',
      isRetryable: false
    };
  }

  // 3. Not Found / 404
  if (lower.includes('404') || lower.includes('not found') || lower.includes('not exist')) {
    const isGithub = context?.resourceType === 'github_repository';
    return {
      status: 'FAILED',
      code: 'RESOURCE_NOT_FOUND',
      title: isGithub ? 'GitHub Repository Not Found' : 'Resource Not Found',
      reason: isGithub
        ? 'The GitHub repository could not be found. Check that the owner/repo path is accurate and the repository is public.'
        : 'The requested web resource could not be found at this address.',
      action: 'Verify the URL and ensure the resource is publicly accessible.',
      isRetryable: false
    };
  }

  // 4. Rate Limiting / 429
  if (lower.includes('429') || lower.includes('rate limit') || lower.includes('too many requests')) {
    return {
      status: 'FAILED',
      code: 'RATE_LIMITED',
      title: 'Provider Rate Limited',
      reason: 'The remote host or extraction provider received too many requests in a short period.',
      action: 'Please wait a moment and click Retry.',
      isRetryable: true
    };
  }

  // 5. Network / Timeout / Connection Reset
  if (
    lower.includes('timeout') ||
    lower.includes('timed out') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('network') ||
    lower.includes('fetch failed') ||
    lower.includes('abort')
  ) {
    return {
      status: 'FAILED',
      code: 'NETWORK_ERROR',
      title: 'Connection Timeout',
      reason: 'Unable to establish a reliable connection with the remote host within the timeout window.',
      action: 'Check that the site is responsive and try retrying.',
      isRetryable: true
    };
  }

  // 6. PDF / Document Parsing Error
  if (
    lower.includes('pdf') &&
    (lower.includes('parse') || lower.includes('extract') || lower.includes('corrupt') || lower.includes('encrypted'))
  ) {
    return {
      status: 'FAILED',
      code: 'PARSING_FAILED',
      title: 'Document Parsing Failed',
      reason: 'The PDF file could not be parsed reliably. It may be password-protected, corrupted, or an image-only scan without OCR text.',
      action: 'Ensure the PDF contains readable text and is not encrypted.',
      isRetryable: false
    };
  }

  // 7. Unsupported Resource / Subpath
  if (
    lower.includes('unsupported') ||
    lower.includes('not supported') ||
    lower.includes('issue') ||
    lower.includes('pull request') ||
    lower.includes('commit') ||
    lower.includes('profile') ||
    lower.includes('channel') ||
    lower.includes('playlist')
  ) {
    return {
      status: 'FAILED',
      code: 'UNSUPPORTED_RESOURCE',
      title: 'Unsupported Resource URL',
      reason: message || 'This specific subpath is not supported for full knowledge indexing.',
      action: 'Provide a direct link to a supported resource (repository, video, article, or PDF).',
      isRetryable: false
    };
  }

  // 8. Content Empty
  if (lower.includes('empty') || lower.includes('no readable text') || lower.includes('no content')) {
    return {
      status: 'FAILED',
      code: 'CONTENT_EMPTY',
      title: 'No Readable Content Found',
      reason: 'The page returned no readable content or is rendered entirely via client-side JavaScript without server HTML.',
      action: 'Provide a link with readable article or documentation content.',
      isRetryable: false
    };
  }

  // 9. Generic / Internal
  return {
    status: 'FAILED',
    code: 'INTERNAL_ERROR',
    title: 'Unable to Complete Ingestion',
    reason: message || 'An unexpected error occurred while analyzing this resource.',
    action: 'Check that the URL is correct or try again in a few moments.',
    isRetryable: true
  };
}
