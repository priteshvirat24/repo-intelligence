import crypto from 'crypto';

export interface LLMProvider {
  complete(prompt: string, system?: string): Promise<string>;
  stream(prompt: string, system?: string): AsyncIterable<string>;
}

export interface EmbeddingProvider {
  getDimensions(): number;
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}

export class MockEmbeddingProvider implements EmbeddingProvider {
  private dimensions: number;

  constructor(dimensions?: number) {
    this.dimensions = dimensions || parseInt(process.env.EMBEDDING_DIMENSIONS || '1024', 10);
  }

  getDimensions(): number {
    return this.dimensions;
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.generateDeterministicVector(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map(t => this.generateDeterministicVector(t));
  }

  private generateDeterministicVector(text: string): number[] {
    const dim = this.getDimensions();
    const hash = crypto.createHash('sha256').update(text).digest('hex');
    const seed = parseInt(hash.slice(0, 8), 16);
    const vec: number[] = [];

    for (let i = 0; i < dim; i++) {
      vec.push(Math.sin((seed + i) * 0.1));
    }

    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1.0;
    return vec.map(v => v / norm);
  }
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
        throw new Error(`[MistralEmbeddingProvider] API error HTTP ${response.status}: ${errText}`);
      }

      const data = await response.json();
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

export class MockLLMProvider implements LLMProvider {
  async complete(prompt: string, system?: string): Promise<string> {
    const isJsonRequest = (system && (system.includes('Return JSON matching') || system.includes('JSON schema') || system.includes('valid JSON'))) || prompt.includes('Return JSON');

    if (isJsonRequest) {
      const queryMatch = prompt.match(/User Problem:\s*"([^"]+)"/i);
      const userText = queryMatch ? queryMatch[1] : prompt.split('\n')[0].replace(/User Problem:\s*"?/i, '').replace(/"$/, '').trim();

      const rawTokens = userText
        .replace(/[^a-zA-Z0-9\s-]/g, ' ')
        .split(/\s+/)
        .map(t => t.trim().toLowerCase())
        .filter(t => t.length > 2 && !['and', 'for', 'with', 'the', 'system', 'tool'].includes(t));

      const domainName = rawTokens.length > 0 ? `${rawTokens[0]}-systems` : 'general-engineering';

      const rawClauses = userText
        .split(/(?:,|\band\b|\bwith\b|\balso\b|\bneed\b|\brequire\b|\bfor\b)/i)
        .map(c => c.trim().replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, ''))
        .filter(c => c.length > 3);

      const requirements = rawClauses.map((clause, idx) => {
        const title = clause.charAt(0).toUpperCase() + clause.slice(1);
        return {
          name: title,
          description: `Technical capability for ${clause}`,
          type: idx === 0 ? 'functional' : 'technical',
          criticality: idx === 0 ? 'MUST' : 'SHOULD',
          confidence: 'inferred'
        };
      });

      if (requirements.length === 0) {
        requirements.push({
          name: userText.charAt(0).toUpperCase() + userText.slice(1),
          description: `Capability to address: ${userText}`,
          type: 'functional',
          criticality: 'MUST',
          confidence: 'inferred'
        });
      }

      return JSON.stringify({
        problemSummary: userText,
        domains: [domainName],
        intents: ['discovery', 'composition'],
        requirements,
        ambiguities: [],
        constraints: [],
        desiredOutputs: [],
        queryExpansions: rawTokens.slice(0, 5)
      });
    }

    return this.synthesizeGroundedResponse(prompt, system);
  }

  private synthesizeGroundedResponse(prompt: string, system?: string): string {
    const repoMatches = (system || '').match(/\[(GitHub|repo):([^#\]]+)/g) || [];
    const uniqueRepos = Array.from(new Set(repoMatches.map(m => m.replace(/\[(GitHub|repo):/, ''))));

    const evidenceMatches = (system || '').match(/\[[^\]]+\] Quote: "([^"]+)"/g) || [];

    if (uniqueRepos.length === 0) {
      return `### Problem Analysis
We analyzed the technical requirements against the indexed knowledge base.

### Verification Status
No indexed resources in the current workspace directly substantiate this capability.

### Suggested Action
Verify whether this capability requires ingesting relevant repositories, documentation, or technical papers, or enabling Live Web discovery.`;
    }

    const repoList = uniqueRepos.map(r => `- **${r}** (Indexed resource)`).join('\n');
    const citationsList = evidenceMatches.slice(0, 4).map(e => `- ${e}`).join('\n');

    return `### Problem Analysis
The proposed technical solution coordinates indexed capabilities across the available resources.

### Referenced Components
${repoList}

### Architecture & Interface Boundaries
- Native library linkage where programming environments align.
- Service and data boundaries where distinct runtimes interface.

### Evidence Grounding
${citationsList || 'Grounded in indexed source documentation and AST.'}
`;
  }

  async *stream(prompt: string, system?: string): AsyncIterable<string> {
    const response = await this.complete(prompt, system);
    const words = response.split(' ');
    for (const word of words) {
      yield word + ' ';
      await new Promise(r => setTimeout(r, 10));
    }
  }
}

export class MistralLLMProvider implements LLMProvider {
  constructor(private apiKey: string, private model: string = 'ministral-8b-latest') {}

  async complete(prompt: string, system?: string): Promise<string> {
    const messages: any[] = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const isJson = (system && (system.includes('JSON') || system.includes('json'))) || prompt.includes('Return JSON');

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
      throw new Error(`[MistralLLMProvider] HTTP ${res.status} ${res.statusText}: ${errText}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  }

  async *stream(prompt: string, system?: string): AsyncIterable<string> {
    const messages: any[] = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

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
        const completeText = await this.complete(prompt, system);
        const words = completeText.split(' ');
        for (const word of words) {
          yield word + ' ';
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
              const delta = parsed.choices[0]?.delta?.content;
              if (delta) yield delta;
            } catch {}
          }
        }
      }
    } catch (err: any) {
      console.warn('[MistralLLMProvider.stream] Stream error, using complete:', err.message);
      const completeText = await this.complete(prompt, system);
      const words = completeText.split(' ');
      for (const word of words) {
        yield word + ' ';
      }
    }
  }
}

export class OpenAILLMProvider implements LLMProvider {
  constructor(private apiKey: string, private model: string = 'gpt-4o-mini') {}

  async complete(prompt: string, system?: string): Promise<string> {
    const messages: any[] = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

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
      throw new Error(`OpenAI API error: ${res.statusText}`);
    }

    const data = await res.json();
    return data.choices[0].message.content;
  }

  async *stream(prompt: string, system?: string): AsyncIterable<string> {
    const messages: any[] = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

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
        stream: true
      })
    });

    if (!res.ok || !res.body) {
      throw new Error(`OpenAI stream error: ${res.statusText}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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
            const delta = parsed.choices[0]?.delta?.content;
            if (delta) yield delta;
          } catch {}
        }
      }
    }
  }
}

export function getLLMProvider(): LLMProvider {
  const provider = (process.env.LLM_PROVIDER || 'mock').toLowerCase();
  const apiKey = process.env.LLM_API_KEY || '';

  if (provider === 'mistral' && apiKey && apiKey !== 'mock-key') {
    return new MistralLLMProvider(apiKey, process.env.LLM_MODEL || 'ministral-8b-latest');
  }
  if (provider === 'openai' && apiKey && apiKey !== 'mock-key') {
    return new OpenAILLMProvider(apiKey, process.env.LLM_MODEL || 'gpt-4o-mini');
  }
  return new MockLLMProvider();
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const provider = (process.env.EMBEDDING_PROVIDER || 'mock').toLowerCase();
  const apiKey = process.env.EMBEDDING_API_KEY || '';

  if (provider === 'mistral' && apiKey && apiKey !== 'mock-key') {
    return new MistralEmbeddingProvider(apiKey, process.env.EMBEDDING_MODEL || 'mistral-embed');
  }
  return new MockEmbeddingProvider();
}
