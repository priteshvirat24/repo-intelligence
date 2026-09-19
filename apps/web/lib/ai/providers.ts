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
  getDimensions(): number {
    return 1536;
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.generateDeterministicVector(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map(t => this.generateDeterministicVector(t));
  }

  private generateDeterministicVector(text: string): number[] {
    const dim = this.getDimensions();
    const hash = crypto.createHash('md5').update(text).digest('hex');
    const seed = parseInt(hash.slice(0, 8), 16);
    const vec: number[] = [];

    for (let i = 0; i < dim; i++) {
      vec.push(Math.sin((seed + i) * 0.1));
    }

    const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1.0;
    return vec.map(v => v / norm);
  }
}

export class MockLLMProvider implements LLMProvider {
  async complete(prompt: string, system?: string): Promise<string> {
    const p = prompt.toLowerCase();
    if (system?.includes('JSON') || prompt.includes('Return JSON')) {
      const isImagery = p.includes('imagery') || p.includes('change detection') || p.includes('remote sensing') || p.includes('construction progress');
      const isSatellite = (p.includes('satellite') && !isImagery) || p.includes('orbit') || p.includes('sgp4');
      const isGeospatial = p.includes('geo') || p.includes('coordinate') || p.includes('wgs84');
      const isGlobe = p.includes('globe') || p.includes('3d') || p.includes('render');
      const isAgent = p.includes('agent') || p.includes('memory') || p.includes('crawl');
      const isPdf = p.includes('pdf') || p.includes('table') || p.includes('vector');
      const isCompiler = p.includes('compiler') || p.includes('ast') || p.includes('typescript');

      const reqs: any[] = [];
      const domains: string[] = [];

      if (isImagery) {
        domains.push('remote-sensing');
        reqs.push({
          name: 'satellite imagery acquisition',
          description: 'Acquires multi-temporal satellite imagery tiles',
          type: 'functional',
          criticality: 'MUST',
          confidence: 0.95
        });
        reqs.push({
          name: 'temporal change detection',
          description: 'Detects structural changes across image time-series',
          type: 'domain',
          criticality: 'MUST',
          confidence: 0.95
        });
      }

      if (isSatellite) {
        domains.push('satellite-systems');
        reqs.push({
          name: 'SGP4 orbital propagation',
          description: 'Calculates satellite orbital trajectory',
          type: 'domain',
          criticality: 'MUST',
          confidence: 0.96
        });
      }
      if (isGeospatial) {
        domains.push('geospatial');
        reqs.push({
          name: 'Geospatial coordinate transformation',
          description: 'Converts ECI vectors to WGS84 coordinates',
          type: 'technical',
          criticality: 'MUST',
          confidence: 0.94
        });
      }
      if (isGlobe) {
        domains.push('spatial-visualization');
        reqs.push({
          name: 'Interactive WebGL globe rendering',
          description: 'Renders 3D globe visualization',
          type: 'functional',
          criticality: 'MUST',
          confidence: 0.95
        });
      }
      if (isAgent) {
        domains.push('autonomous-agents');
        reqs.push({
          name: 'Web Crawling',
          description: 'Extracts web pages to markdown',
          type: 'functional',
          criticality: 'MUST',
          confidence: 0.95
        });
        reqs.push({
          name: 'Persistent Agent Memory',
          description: 'Maintains multi-turn conversation memory',
          type: 'functional',
          criticality: 'MUST',
          confidence: 0.95
        });
      }
      if (isPdf) {
        domains.push('document-processing');
        reqs.push({
          name: 'PDF Table Extraction',
          description: 'Extracts structured tables from PDFs',
          type: 'functional',
          criticality: 'MUST',
          confidence: 0.95
        });
        reqs.push({
          name: 'Vector Indexing',
          description: 'Dense vector search over extracted text',
          type: 'technical',
          criticality: 'MUST',
          confidence: 0.95
        });
      }
      if (isCompiler) {
        domains.push('compiler-engineering');
        reqs.push({
          name: 'TypeScript AST Parsing',
          description: 'Parses code into abstract syntax tree',
          type: 'technical',
          criticality: 'MUST',
          confidence: 0.95
        });
        reqs.push({
          name: 'WebAssembly Code Generation',
          description: 'Generates binary bytecode',
          type: 'technical',
          criticality: 'MUST',
          confidence: 0.94
        });
      }

      if (reqs.length === 0) {
        domains.push('general-engineering');
        reqs.push({
          name: 'Core System Capability',
          description: prompt.slice(0, 100),
          type: 'functional',
          criticality: 'MUST',
          confidence: 0.90
        });
      }

      return JSON.stringify({
        problemSummary: prompt.slice(0, 120).trim(),
        domains,
        requirements: reqs,
        constraints: [],
        desiredOutputs: [],
        queryExpansions: ['expansion-term-1', 'expansion-term-2']
      });
    }

    if (p.includes('crawling') || p.includes('crawler') || p.includes('browser')) {
      return `### 1. Requirements Identified\n- **MUST**: Headless browser automation (dynamic DOM rendering)\n- **MUST**: Async web crawling and markdown extraction\n\n### 2. Recommended Repositories\n- **unclecode/crawl4ai** ([repo:unclecode/crawl4ai#README.md:L15-L35])\n  - Capabilities: \`headless-browser-automation\`, \`web-crawling\`, \`structured-llm-extraction\`\n\n### 3. Architecture & Composition\nUse Crawl4AI's native AsyncWebCrawler. Connect directly to your application without wrapping in extra middleware.`;
    }
    return `### 1. Requirements Identified\n- Engineering problem analyzed.\n\n### 2. Recommendations\nBased on your indexed repositories, consider integrating your core components with clean API boundaries.`;
  }

  async *stream(prompt: string, system?: string): AsyncIterable<string> {
    const response = await this.complete(prompt, system);
    const words = response.split(' ');
    for (const word of words) {
      yield word + ' ';
      await new Promise(r => setTimeout(r, 15));
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

  if (provider === 'openai' && apiKey && apiKey !== 'mock-key') {
    return new OpenAILLMProvider(apiKey, process.env.LLM_MODEL || 'gpt-4o-mini');
  }
  return new MockLLMProvider();
}

export function getEmbeddingProvider(): EmbeddingProvider {
  return new MockEmbeddingProvider();
}
