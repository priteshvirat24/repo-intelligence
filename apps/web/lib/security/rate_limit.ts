import { NextRequest, NextResponse } from 'next/server';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

interface ClientBucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, ClientBucket>();

// Periodic garbage collection of old client buckets
if (typeof setInterval !== 'undefined') {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets.entries()) {
      if (now - bucket.lastRefill > 10 * 60 * 1000) {
        buckets.delete(key);
      }
    }
  }, 5 * 60 * 1000);
  if (timer.unref) timer.unref();
}

export function checkRateLimit(
  request: NextRequest,
  action: string,
  config: RateLimitConfig
): { allowed: boolean; remaining: number; resetTime: number; response?: NextResponse } {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    request.headers.get('x-real-ip') ||
    '127.0.0.1';

  const key = `${action}:${ip}`;
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: config.maxRequests, lastRefill: now };
    buckets.set(key, bucket);
  } else {
    const elapsed = now - bucket.lastRefill;
    const refillAmount = (elapsed / config.windowMs) * config.maxRequests;
    if (refillAmount > 0) {
      bucket.tokens = Math.min(config.maxRequests, bucket.tokens + refillAmount);
      bucket.lastRefill = now;
    }
  }

  const resetTime = Math.ceil((bucket.lastRefill + config.windowMs) / 1000);

  if (bucket.tokens < 1) {
    const retryAfter = Math.ceil(Math.max(1, (config.windowMs - (now - bucket.lastRefill)) / 1000));
    const response = NextResponse.json(
      {
        error: 'Rate limit exceeded. Please retry later.',
        action,
        retryAfter
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfter),
          'X-RateLimit-Limit': String(config.maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(resetTime)
        }
      }
    );
    return { allowed: false, remaining: 0, resetTime, response };
  }

  bucket.tokens -= 1;
  const remaining = Math.floor(bucket.tokens);

  return { allowed: true, remaining, resetTime };
}
