// Client side of POST /api/chat: request, SSE parsing and the source/citation vocabulary.

import { readJsonSafe, retryAfterSeconds } from './api';

export type ChatMode = 'INTERNAL' | 'WEB' | 'BOTH';

export interface ChatSource {
  /** '1','2',... for code/evidence, 'W1','W2',... for web */
  id: string;
  kind: 'code' | 'evidence' | 'web';
  repository?: string;
  repositoryId?: string;
  resourceId?: string;
  filePath?: string;
  startLine?: number;
  endLine?: number;
  symbol?: string;
  verified: boolean;
  snippet: string;
  url?: string;
  title?: string;
}

export type ChatErrorKind = 'rate_limited' | 'provider_unavailable' | 'config' | 'internal' | 'network';

export interface ChatError {
  message: string;
  kind?: ChatErrorKind | string;
  retryAfter?: number;
}

export interface ChatStatusEvent {
  stage: 'understanding' | 'searching_library' | 'searching_web' | 'writing' | string;
  label: string;
}

export interface ChatHandlers {
  onStatus?: (e: ChatStatusEvent) => void;
  onMetadata?: (data: any) => void;
  onText?: (text: string) => void;
  onError?: (err: ChatError) => void;
  onDone?: () => void;
}

export class ChatRequestError extends Error {
  kind?: string;
  retryAfter?: number;
  status: number;
  constructor(message: string, status: number, kind?: string, retryAfter?: number) {
    super(message);
    this.status = status;
    this.kind = kind;
    this.retryAfter = retryAfter;
  }
}

function parseBlock(block: string): { event: string; data: any } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''));
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

/**
 * Sends one question and dispatches SSE events until the stream ends. Throws ChatRequestError for
 * pre-stream failures (JSON body with {error, kind, retryAfter}) and rethrows AbortError on stop.
 */
export async function streamChat(
  body: { message: string; mode: ChatMode; history: Array<{ role: 'user' | 'assistant'; content: string }> },
  handlers: ChatHandlers,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
    signal
  });

  if (!res.ok || !res.body) {
    const data = await readJsonSafe(res);
    const kind = data?.kind || (res.status === 429 ? 'rate_limited' : res.status >= 500 ? 'internal' : undefined);
    const message =
      typeof data?.error === 'string' && data.error
        ? data.error
        : res.status === 429
          ? 'Too many questions in a short time.'
          : 'Open Eye could not start an answer.';
    throw new ChatRequestError(message, res.status, kind, retryAfterSeconds(res, data));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finished = false;

  const dispatch = (block: string) => {
    const parsed = parseBlock(block);
    if (!parsed) return;
    const { event, data } = parsed;
    if (event === 'status') handlers.onStatus?.(data);
    else if (event === 'metadata') handlers.onMetadata?.(data);
    else if (event === 'message') {
      if (typeof data?.text === 'string') handlers.onText?.(data.text);
    } else if (event === 'error') {
      handlers.onError?.({
        message: typeof data?.error === 'string' && data.error ? data.error : 'The answer was interrupted.',
        kind: data?.kind,
        retryAfter: typeof data?.retryAfter === 'number' ? data.retryAfter : undefined
      });
    } else if (event === 'done') {
      finished = true;
      handlers.onDone?.();
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      if (block.trim()) dispatch(block);
    }
  }
  if (buffer.trim()) dispatch(buffer);
  if (!finished) handlers.onDone?.();
}

export function sourcesUsedLabel(value?: string | null): string | null {
  switch (value) {
    case 'INTERNAL':
    case 'OPEN EYE':
      return 'Library';
    case 'WEB':
      return 'Web';
    case 'HYBRID':
    case 'OPEN EYE + WEB':
      return 'Library + Web';
    case 'NONE':
      return 'No matching sources';
    default:
      return null;
  }
}

export function errorTitle(kind?: string): string {
  switch (kind) {
    case 'rate_limited':
      return 'Too many questions at once';
    case 'provider_unavailable':
      return 'The answer service is unavailable';
    case 'config':
      return 'Open Eye is not set up to answer yet';
    case 'network':
      return 'Could not reach Open Eye';
    default:
      return 'Something went wrong';
  }
}

export const CITE_HREF_PREFIX = '#oe-cite-';

/**
 * Turns inline references like [1], [W2] (also adjacent: [1][3]) into Markdown links the renderer
 * can recognise. Code spans and fenced blocks are left alone; ids without a source stay as text.
 */
export function linkifyCitations(markdown: string, validIds: Set<string>): string {
  if (validIds.size === 0) return markdown;
  const parts = markdown.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part.replace(/\[(W?\d{1,3})\](?![(:])/g, (match, id: string) =>
        validIds.has(id) ? `[${id}](${CITE_HREF_PREFIX}${id})` : match
      );
    })
    .join('');
}
