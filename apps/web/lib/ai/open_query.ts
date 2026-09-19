import { OpenQueryRequirements, OpenRequirement, CANONICAL_CAPABILITIES } from '@repo/shared';
import { LLMProvider } from './providers';

export class OpenProblemDecomposer {
  constructor(private llm: LLMProvider) {}

  async decompose(query: string): Promise<OpenQueryRequirements> {
    const qLower = query.toLowerCase().trim();

    // Check for collection-level questions
    const isCollectionOverview = 
      qLower.includes('what can our collection do') ||
      qLower.includes('what can we build') ||
      qLower.includes('what repos do we have') ||
      qLower.includes('overview of repositories');

    const systemPrompt = `You are the Lead Open-World Systems Architect for Repo Intelligence.
Analyze the user's natural language problem or question and extract its domain, technical requirements, constraints, desired outputs, and query expansions.

OPEN-WORLD PRINCIPLES:
1. Repositories can belong to ANY technical field, niche, or domain (e.g. satellite systems, computer vision, robotics, biology, finance, gaming, geospatial, civil engineering, data pipelines, AI/ML, etc.).
2. Do NOT constrain requirements to a fixed list. Discover domain-specific requirements (e.g. "SGP4 orbital propagation", "photogrammetric 3D reconstruction", "Kalman filtering", "geospatial coordinate transformation", "temporal change detection").
3. Assign criticality: MUST (essential for MVP), SHOULD (important), or NICE_TO_HAVE.
4. If a requirement closely matches a standard capability, you may optionally provide canonicalSlug, otherwise omit it.
5. Generate 4-8 search expansion terms (technical synonyms, algorithms, domain terminology) to assist hybrid search.
6. Output ONLY valid JSON matching the requested schema.`;

    const userPrompt = `User Problem: "${query}"

Return JSON matching:
{
  "problemSummary": "Concise summary of the core technical challenge",
  "domains": ["discovered-domain-1", "discovered-domain-2"],
  "requirements": [
    {
      "name": "Requirement Name",
      "description": "Technical capability needed",
      "type": "functional" | "technical" | "domain" | "deployment" | "performance" | "integration",
      "criticality": "MUST" | "SHOULD" | "NICE_TO_HAVE",
      "confidence": 0.95,
      "canonicalSlug": "optional-canonical-slug-or-null"
    }
  ],
  "constraints": ["Constraint 1", "Constraint 2"],
  "desiredOutputs": ["Desired output format or artifact"],
  "queryExpansions": ["term1", "term2", "term3", "term4", "term5"]
}`;

    try {
      const response = await this.llm.complete(userPrompt, systemPrompt);
      const cleaned = response.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

      // Validate & clean requirements
      const requirements: OpenRequirement[] = Array.isArray(parsed.requirements)
        ? parsed.requirements.map((r: any) => ({
            name: String(r.name || 'Functional Requirement'),
            description: String(r.description || ''),
            type: ['functional', 'technical', 'domain', 'deployment', 'performance', 'integration'].includes(r.type)
              ? r.type
              : 'functional',
            criticality: ['MUST', 'SHOULD', 'NICE_TO_HAVE'].includes(r.criticality) ? r.criticality : 'MUST',
            confidence: typeof r.confidence === 'number' ? Math.min(1.0, Math.max(0.1, r.confidence)) : 0.9,
            canonicalSlug: r.canonicalSlug || undefined
          }))
        : [];

      return {
        problemSummary: parsed.problemSummary || query,
        domains: Array.isArray(parsed.domains) && parsed.domains.length > 0 ? parsed.domains : ['general-software'],
        requirements: requirements.length > 0 ? requirements : this.fallbackRequirements(query),
        constraints: Array.isArray(parsed.constraints) ? parsed.constraints : [],
        desiredOutputs: Array.isArray(parsed.desiredOutputs) ? parsed.desiredOutputs : [],
        queryExpansions: Array.isArray(parsed.queryExpansions) && parsed.queryExpansions.length > 0
          ? parsed.queryExpansions
          : this.fallbackExpansions(query)
      };
    } catch (err) {
      console.warn('LLM problem decomposition fallback engaged:', err);
      return this.fallbackDecompose(query);
    }
  }

  private fallbackDecompose(query: string): OpenQueryRequirements {
    const reqs = this.fallbackRequirements(query);
    const expansions = this.fallbackExpansions(query);

    // Extract dynamic domain candidates from prominent technical tokens
    const tokens = query
      .replace(/[^a-zA-Z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map(t => t.toLowerCase())
      .filter(t => t.length > 3 && !COMMON_STOPWORDS.has(t));

    const domains = Array.from(new Set(tokens.slice(0, 3))).map(t => `${t}-systems`);
    if (domains.length === 0) domains.push('general-engineering');

    return {
      problemSummary: query.trim(),
      domains,
      requirements: reqs,
      constraints: [],
      desiredOutputs: [],
      queryExpansions: expansions
    };
  }

  private fallbackRequirements(query: string): OpenRequirement[] {
    const reqs: OpenRequirement[] = [];

    // Split query by common coordination delimiters
    const clauses = query
      .split(/(?:,|\band\b|\bwith\b|\balso\b|\bplus\b|\bas well as\b|\bneed\b|\brequire\b)/i)
      .map(c => c.trim())
      .filter(c => c.length > 3);

    for (let i = 0; i < clauses.length; i++) {
      const clause = clauses[i];
      const cleaned = clause
        .split(/\s+/)
        .filter(w => !COMMON_STOPWORDS.has(w.toLowerCase()))
        .join(' ')
        .trim();

      if (!cleaned || cleaned.length < 3) continue;

      const isMust = i === 0 || /\b(must|essential|require|critical|primary)\b/i.test(clause);
      const criticality = isMust ? 'MUST' : 'SHOULD';

      // Clean requirement title
      const title = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

      reqs.push({
        name: title,
        description: `Implementation for ${cleaned} as requested in problem specification.`,
        type: i === 0 ? 'functional' : 'technical',
        criticality,
        confidence: 0.88
      });
    }

    if (reqs.length === 0) {
      reqs.push({
        name: query.trim().slice(0, 60),
        description: query.trim(),
        type: 'functional',
        criticality: 'MUST',
        confidence: 0.80
      });
    }

    return reqs;
  }

  private fallbackExpansions(query: string): string[] {
    const tokens = query
      .replace(/[^a-zA-Z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !COMMON_STOPWORDS.has(w.toLowerCase()));

    const expansions = new Set<string>();

    // Add standalone tokens
    for (const token of tokens) {
      expansions.add(token);
      // If looks like an acronym (all caps, 2-6 chars)
      if (token === token.toUpperCase() && token.length >= 2 && token.length <= 6) {
        expansions.add(`${token} protocol`);
        expansions.add(`${token} implementation`);
      }
    }

    // Add adjacent pairs as compound phrases
    for (let i = 0; i < tokens.length - 1; i++) {
      expansions.add(`${tokens[i]} ${tokens[i + 1]}`);
    }

    return Array.from(expansions).slice(0, 8);
  }
}

const COMMON_STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'could', 'did', 'do', 'does', 'doing', 'down', 'during',
  'each', 'few', 'for', 'from', 'further',
  'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself',
  'just', 'me', 'more', 'most', 'my', 'myself',
  'need', 'needs', 'no', 'nor', 'not', 'now',
  'of', 'off', 'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
  'same', 'should', 'so', 'some', 'such',
  'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through', 'to', 'too',
  'under', 'until', 'up', 'very',
  'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would',
  'you', 'your', 'yours', 'yourself', 'yourselves'
]);
