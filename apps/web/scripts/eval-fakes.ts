/**
 * Offline test doubles used only by the evaluation harness (scripts/run-eval.ts).
 * Production code must never fall back to these (see lib/ai/providers.ts).
 */
import crypto from 'crypto';
import type { LLMProvider, EmbeddingProvider } from '../lib/ai/providers';

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
