
import { recordUsage, usageOf } from './ledger';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMProvider {
  complete(prompt: string, system?: string, history?: ChatTurn[]): Promise<string>;
  /** `history` is sent as real prior conversation turns, before the current prompt */
  stream(prompt: string, system?: string, history?: ChatTurn[]): AsyncIterable<string>;
}

export interface EmbeddingProvider {
  getDimensions(): number;
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

async function fetchWithBackoff(
  url: string,
  options: RequestInit,
  maxRetries: number = 3,
  callerName: string = 'Provider'
): Promise<Response> {
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      const response = await fetch(url, options);

      // Retry on 429 (rate limit) or 5xx (server error)
      if ((response.status === 429 || (response.status >= 500 && response.status <= 504)) && attempt <= maxRetries) {
        const jitter = Math.random() * 400;
        const delayMs = attempt * 1500 + jitter;
        console.warn(`[${callerName}] HTTP ${response.status} encountered. Retrying attempt ${attempt}/${maxRetries} in ${Math.round(delayMs)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      return response;
    } catch (err: any) {
      if (attempt <= maxRetries) {
        const jitter = Math.random() * 400;
        const delayMs = attempt * 1500 + jitter;
        console.warn(`[${callerName}] Network error (${err.message}). Retrying attempt ${attempt}/${maxRetries} in ${Math.round(delayMs)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }
      throw err;
    }
  }
}

export class MistralEmbeddingProvider implements EmbeddingProvider {
  private dimensions: number = 1024;

  constructor(private apiKey: string, private model: string = 'mistral-embed') {}

  getDimensions(): number {
    return this.dimensions;
  }

  async embedQuery(text: string): Promise<number[]> {
    const res = await this.embedDocuments([text]);
    if (!res[0]) {
      throw new Error('[MistralEmbeddingProvider] Received empty embedding for query');
    }
    return res[0];
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Batch in groups of 16 to respect request payload sizes
    const batchSize = 16;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const startedAt = Date.now();
      const response = await fetchWithBackoff(
        'https://api.mistral.ai/v1/embeddings',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.model,
            input: batch
          })
        },
        3,
        'MistralEmbeddingProvider'
      );

      if (!response.ok) {
        const errText = await response.text();
        recordUsage({ provider: 'mistral', operation: 'embedding', model: this.model, startedAt, success: false, error: `HTTP ${response.status}` });
        throw new Error(`[MistralEmbeddingProvider] API error HTTP ${response.status}: ${errText}`);
      }

      const data = await response.json();
      recordUsage({ provider: 'mistral', operation: 'embedding', model: this.model, startedAt, success: true, inputTokens: usageOf(data).inputTokens, outputTokens: 0 });
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('[MistralEmbeddingProvider] Malformed response from Mistral embeddings API');
      }

      for (const item of data.data) {
        allEmbeddings.push(item.embedding);
      }
    }

    return allEmbeddings;
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  constructor(
    private apiKey: string,
    private model: string = 'text-embedding-3-small',
    private dimensions: number = 1024
  ) {}

  getDimensions(): number {
    return this.dimensions;
  }

  async embedQuery(text: string): Promise<number[]> {
    const res = await this.embedDocuments([text]);
    if (!res[0]) {
      throw new Error('[OpenAIEmbeddingProvider] Received empty embedding for query');
    }
    return res[0];
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const batchSize = 64;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const startedAt = Date.now();
      const response = await fetchWithBackoff(
        'https://api.openai.com/v1/embeddings',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          // `dimensions` must match the worker and the vector(EMBEDDING_DIMENSIONS) column
          body: JSON.stringify({ model: this.model, input: batch, dimensions: this.dimensions })
        },
        3,
        'OpenAIEmbeddingProvider'
      );

      if (!response.ok) {
        const errText = await response.text();
        recordUsage({ provider: 'openai', operation: 'embedding', model: this.model, startedAt, success: false, error: `HTTP ${response.status}` });
        throw new Error(`[OpenAIEmbeddingProvider] API error HTTP ${response.status}: ${errText}`);
      }

      const data = await response.json();
      recordUsage({ provider: 'openai', operation: 'embedding', model: this.model, startedAt, success: true, inputTokens: usageOf(data).inputTokens, outputTokens: 0 });
      if (!data.data || !Array.isArray(data.data)) {
        throw new Error('[OpenAIEmbeddingProvider] Malformed response from OpenAI embeddings API');
      }

      for (const item of data.data) {
        allEmbeddings.push(item.embedding);
      }
    }

    return allEmbeddings;
  }
}

export class MistralLLMProvider implements LLMProvider {
  constructor(private apiKey: string, private model: string = 'ministral-8b-latest') {}

  async complete(prompt: string, system?: string, history: ChatTurn[] = []): Promise<string> {
    const messages: any[] = [];
    if (system) messages.push({ role: 'system', content: system });
    for (const turn of history) messages.push({ role: turn.role, content: turn.content });
    messages.push({ role: 'user', content: prompt });

    const isJson = (system && (system.includes('JSON') || system.includes('json'))) || prompt.includes('Return JSON');

    const startedAt = Date.now();
    const res = await fetchWithBackoff(
      'https://api.mistral.ai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: 0.1,
          response_format: isJson ? { type: 'json_object' } : undefined
        })
      },
      3,
      'MistralLLMProvider'
    );

    if (!res.ok) {
      const errText = await res.text();
      recordUsage({ provider: 'mistral', operation: 'chat_completion', model: this.model, startedAt, success: false, error: `HTTP ${res.status}` });
      throw new Error(`[MistralLLMProvider] HTTP ${res.status} ${res.statusText}: ${errText}`);
    }

    const data = await res.json();
    recordUsage({ provider: 'mistral', operation: 'chat_completion', model: this.model, startedAt, success: true, ...usageOf(data) });
    return data.choices[0].message.content;
  }

  async *stream(prompt: string, system?: string, history: ChatTurn[] = []): AsyncIterable<string> {
    const messages: any[] = [];
    if (system) messages.push({ role: 'system', content: system });
    for (const turn of history) messages.push({ role: turn.role, content: turn.content });
    messages.push({ role: 'user', content: prompt });

    let emittedAny = false;
    const startedAt = Date.now();
    let usage: { inputTokens: number | null; outputTokens: number | null } = { inputTokens: null, outputTokens: null };
    try {
      const res = await fetchWithBackoff(
        'https://api.mistral.ai/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: this.model,
            messages,
            temperature: 0.1,
            stream: true
          })
        },
        2,
        'MistralLLMProvider.stream'
      );

      if (!res.ok || !res.body) {
        console.warn(`[MistralLLMProvider.stream] Streaming HTTP ${res.status}; falling back to non-streaming complete.`);
        const completeText = await this.complete(prompt, system, history);
        const words = completeText.split(' ');
        for (const word of words) {
          yield word + ' ';
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const dataStr = trimmed.slice(6);
              if (dataStr === '[DONE]') return;
              try {
                const parsed = JSON.parse(dataStr);
                if (parsed.usage) usage = usageOf(parsed);
                const delta = parsed.choices[0]?.delta?.content;
                if (delta) {
                  emittedAny = true;
                  yield delta;
                }
              } catch {}
            }
          }
        }
      } finally {
        recordUsage({ provider: 'mistral', operation: 'chat_stream', model: this.model, startedAt, success: emittedAny, ...usage });
      }
    } catch (err: any) {
      // Once text has reached the client, replaying a full completion would duplicate the answer
      if (emittedAny) throw err;
      console.warn('[MistralLLMProvider.stream] Stream error, using complete:', err.message);
      const completeText = await this.complete(prompt, system, history);
      const words = completeText.split(' ');
      for (const word of words) {
        yield word + ' ';
      }
    }
  }
}

export class OpenAILLMProvider implements LLMProvider {
  constructor(private apiKey: string, private model: string = 'gpt-4o-mini') {}

  async complete(prompt: string, system?: string, history: ChatTurn[] = []): Promise<string> {
    const messages: any[] = [];
    if (system) messages.push({ role: 'system', content: system });
    for (const turn of history) messages.push({ role: turn.role, content: turn.content });
    messages.push({ role: 'user', content: prompt });

    const startedAt = Date.now();
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.2
      })
    });

    if (!res.ok) {
      recordUsage({ provider: 'openai', operation: 'chat_completion', model: this.model, startedAt, success: false, error: `HTTP ${res.status}` });
      throw new Error(`OpenAI API error: ${res.statusText}`);
    }

    const data = await res.json();
    recordUsage({ provider: 'openai', operation: 'chat_completion', model: this.model, startedAt, success: true, ...usageOf(data) });
    return data.choices[0].message.content;
  }

  async *stream(prompt: string, system?: string, history: ChatTurn[] = []): AsyncIterable<string> {
    const messages: any[] = [];
    if (system) messages.push({ role: 'system', content: system });
    for (const turn of history) messages.push({ role: turn.role, content: turn.content });
    messages.push({ role: 'user', content: prompt });

    const startedAt = Date.now();
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.2,
        stream: true,
        // The final chunk then carries token usage for the ledger
        stream_options: { include_usage: true }
      })
    });

    if (!res.ok || !res.body) {
      recordUsage({ provider: 'openai', operation: 'chat_stream', model: this.model, startedAt, success: false, error: `HTTP ${res.status}` });
      throw new Error(`OpenAI stream error: ${res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let usage: { inputTokens: number | null; outputTokens: number | null } = { inputTokens: null, outputTokens: null };
    let emitted = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') return;
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.usage) usage = usageOf(parsed);
              const delta = parsed.choices[0]?.delta?.content;
              if (delta) {
                emitted = true;
                yield delta;
              }
            } catch {}
          }
        }
      }
    } finally {
      recordUsage({ provider: 'openai', operation: 'chat_stream', model: this.model, startedAt, success: emitted, ...usage });
    }
  }
}

export class ProviderConfigError extends Error {}

/** Returns the configured real LLM provider. There is deliberately no mock fallback. */
/**
 * `purpose: 'answer'` selects the model that writes chat answers. Answers need instruction-following
 * (citing [n] sources, not inventing files), which small models do poorly, so they default to a larger
 * model when CHAT_LLM_MODEL is set, while quick structured tasks (question decomposition) keep LLM_MODEL.
 */
export function getLLMProvider(purpose: 'default' | 'answer' = 'default'): LLMProvider {
  const provider = (process.env.LLM_PROVIDER || 'mistral').trim().toLowerCase();
  const apiKey = (process.env.LLM_API_KEY || '').trim();

  if (!apiKey) {
    throw new ProviderConfigError('LLM_API_KEY is not set; Open Eye will not generate answers or analysis without a real LLM provider.');
  }
  if (provider === 'mistral') {
    // Larger models write better-cited answers, but Mistral's free tier only serves the ministral
    // models (mistral-small/medium are rate-capped, large is not included), so answers default to
    // LLM_MODEL; set CHAT_LLM_MODEL (e.g. mistral-small-latest) on a paid tier.
    const model = purpose === 'answer'
      ? process.env.CHAT_LLM_MODEL || process.env.LLM_MODEL || 'ministral-8b-latest'
      : process.env.LLM_MODEL || 'ministral-8b-latest';
    return new MistralLLMProvider(apiKey, model);
  }
  if (provider === 'openai') {
    const model = purpose === 'answer'
      ? process.env.CHAT_LLM_MODEL || process.env.LLM_MODEL || 'gpt-4o-mini'
      : process.env.LLM_MODEL || 'gpt-4o-mini';
    return new OpenAILLMProvider(apiKey, model);
  }
  throw new ProviderConfigError(`Unsupported LLM_PROVIDER "${provider}"; expected "mistral" or "openai".`);
}

/** Returns the configured real embedding provider. There is deliberately no mock fallback. */
export function getEmbeddingProvider(): EmbeddingProvider {
  // Same default as the worker (apps/worker/config.py): both sides must embed into the same vector space
  const provider = (process.env.EMBEDDING_PROVIDER || 'mistral').trim().toLowerCase();
  const apiKey = (process.env.EMBEDDING_API_KEY || '').trim();

  if (!apiKey) {
    throw new ProviderConfigError('EMBEDDING_API_KEY is not set; Open Eye will not index or search without a real embedding provider.');
  }
  if (provider === 'mistral') {
    return new MistralEmbeddingProvider(apiKey, process.env.EMBEDDING_MODEL || 'mistral-embed');
  }
  if (provider === 'openai') {
    // Must mirror the worker's provider choice: query vectors are compared against vectors it stored
    const model = process.env.EMBEDDING_MODEL && process.env.EMBEDDING_MODEL !== 'mistral-embed'
      ? process.env.EMBEDDING_MODEL
      : 'text-embedding-3-small';
    return new OpenAIEmbeddingProvider(apiKey, model, parseInt(process.env.EMBEDDING_DIMENSIONS || '1024', 10));
  }
  throw new ProviderConfigError(`Unsupported EMBEDDING_PROVIDER "${provider}"; expected "mistral" or "openai".`);
}
