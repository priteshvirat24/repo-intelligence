// Small fetch helpers for client components: read JSON bodies defensively (error responses are not
// always JSON) and turn HTTP failures into user-facing copy.

export async function readJsonSafe<T = any>(res: Response): Promise<T | null> {
  try {
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

export function retryAfterSeconds(res: Response, body?: any): number | undefined {
  const fromBody = Number(body?.retryAfter);
  if (Number.isFinite(fromBody) && fromBody > 0) return Math.ceil(fromBody);
  const fromHeader = Number(res.headers.get('Retry-After'));
  if (Number.isFinite(fromHeader) && fromHeader > 0) return Math.ceil(fromHeader);
  return undefined;
}

/** Title for a failed request, chosen by HTTP status rather than a single generic label. */
export function httpErrorTitle(status: number): string {
  if (status === 429) return 'Rate limited';
  if (status === 404) return 'Not found';
  if (status === 403) return 'Not allowed';
  if (status === 413) return 'Too large';
  if (status >= 500) return 'Server error';
  if (status === 0) return 'Network error';
  return 'Request rejected';
}

export function formatRetryAfter(seconds?: number): string {
  if (!seconds) return 'Try again in a moment.';
  if (seconds < 60) return `Try again in ${seconds}s.`;
  return `Try again in ${Math.ceil(seconds / 60)} min.`;
}

export function shortDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
