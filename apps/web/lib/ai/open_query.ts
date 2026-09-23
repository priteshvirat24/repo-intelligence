import {
  OpenQueryRequirements,
  OpenRequirement,
  QueryIntent,
  RequirementConfidence,
  RequirementCriticality,
  RequirementType
} from '@repo/shared';
import { LLMProvider } from './providers';
import {
  ProblemDecompositionSchema,
  ValidatedProblemDecomposition
} from './validation/schema';

export class OpenProblemDecomposer {
  constructor(private llm: LLMProvider) {}

  async decompose(query: string): Promise<OpenQueryRequirements> {
    const qLower = query.toLowerCase().trim();

    // Check for collection-level questions
    const isCollectionOverview =
      qLower.includes('what can our collection do') ||
      qLower.includes('what can we build') ||
      qLower.includes('what repos do we have') ||
      qLower.includes('overview of repositories') ||
      qLower.includes('what does our collection know');

    const systemPrompt = `You are the Lead Open-World Systems Architect for Open Eye.
Analyze the user's natural language problem or question and extract its domain, technical requirements, intent, constraints, ambiguities, desired outputs, and search expansions.

CRITICAL INTELLIGENCE RULES:
1. Open-World Domain Discovery:
   - Domains are NOT constrained to a fixed taxonomy.
   - Discover domain-specific terminology accurately (e.g. "orbital mechanics", "photogrammetry", "hydrological modeling", "kinematic chain solving", "game collision manifolds", "phylogenetic reconstruction", "quantitative finance").
2. Multi-Intent Classification:
   - A query can have multiple simultaneous intents: "discovery", "comparison", "composition", "gap_analysis", "explanation".
   - Do NOT force every query into a single rigid intent.
3. Preserve Technical Ambiguity:
   - If a user requirement is ambiguous (e.g. "I need memory", "make this faster", "track state"), DO NOT assume a single narrow meaning.
   - Explicitly record ambiguous terms and their potential interpretations (e.g. "memory" -> ["in-memory cache", "persistent database", "vector embedding store", "agent conversational context"]).
4. Requirement Confidence Levels:
   - "explicit": Directly stated by the user (e.g. "Python", "GPU-accelerated", "using Docker").
   - "inferred": Deduced by systems engineering logic (e.g. "coordinate transformation" needed for "satellite positions to map").
   - "ambiguous": Requires further technical clarification.
   - NEVER present inferred requirements as user-specified explicit requirements.
5. Vague Query Reasoning:
   - For queries like "make this faster", identify performance profiling, caching, parallelization, and algorithmic optimization.
   - For queries like "turn satellite positions into visual map", infer trajectory/state data ingestion, coordinate transformation (ECI to Geodetic/WGS84), and map rendering without requiring predefined templates.
6. Output Format: Strictly valid JSON matching the schema.`;

    const userPrompt = `User Problem: "${query}"

Return JSON matching:
{
  "problemSummary": "Concise summary of the core technical challenge",
  "domains": ["discovered-domain-1", "discovered-domain-2"],
  "intents": ["discovery", "composition"],
  "requirements": [
    {
      "name": "Requirement Name",
      "description": "Specific technical capability needed",
      "type": "functional" | "technical" | "domain" | "deployment" | "performance" | "integration",
      "criticality": "MUST" | "SHOULD" | "NICE_TO_HAVE",
      "confidence": "explicit" | "inferred" | "ambiguous",
      "isAmbiguous": false,
      "ambiguousInterpretations": []
    }
  ],
  "ambiguities": [
    {
      "term": "ambiguous term if any",
      "possibleInterpretations": ["interpretation 1", "interpretation 2"]
    }
  ],
  "constraints": ["Constraint 1"],
  "desiredOutputs": ["Desired output format or artifact"],
  "queryExpansions": ["technical synonym 1", "algorithm name", "domain keyword"]
}`;

    try {
      const response = await this.llm.complete(userPrompt, systemPrompt);
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const rawJson = JSON.parse(jsonMatch[0]);
        const parseResult = ProblemDecompositionSchema.safeParse(rawJson);

        if (parseResult.success) {
          const valid = parseResult.data;
          const requirements: OpenRequirement[] = valid.requirements.map(r => ({
            name: r.name,
            description: r.description,
            type: r.type as RequirementType,
            criticality: r.criticality as RequirementCriticality,
            confidence: r.confidence,
            confidenceLevel: (typeof r.confidence === 'string' ? r.confidence : 'inferred') as RequirementConfidence,
            canonicalSlug: r.canonicalSlug || undefined,
            isAmbiguous: r.isAmbiguous,
            ambiguousInterpretations: r.ambiguousInterpretations
          }));

          return {
            problemSummary: valid.problemSummary,
            domains: valid.domains,
            intents: valid.intents as QueryIntent[],
            requirements,
            ambiguities: valid.ambiguities,
            constraints: valid.constraints,
            desiredOutputs: valid.desiredOutputs,
            queryExpansions: valid.queryExpansions
          };
        } else {
          console.warn('[OpenProblemDecomposer] Schema validation warning, attempting partial recovery:', parseResult.error.format());
        }
      }
    } catch (err) {
      console.warn('[OpenProblemDecomposer] LLM problem decomposition fallback engaged:', err);
    }

    return this.fallbackDecompose(query);
  }

  private fallbackDecompose(query: string): OpenQueryRequirements {
    const qLower = query.toLowerCase().trim();
    const reqs = this.fallbackRequirements(query);
    const expansions = this.fallbackExpansions(query);

    // Multi-intent detection
    const intents: QueryIntent[] = ['discovery'];
    if (qLower.includes('compare') || qLower.includes('vs') || qLower.includes('difference')) {
      intents.push('comparison');
    }
    if (qLower.includes('build') || qLower.includes('combine') || qLower.includes('together') || qLower.includes('architecture') || qLower.includes('compose')) {
      intents.push('composition');
    }
    if (qLower.includes('missing') || qLower.includes('gap') || qLower.includes('lack')) {
      intents.push('gap_analysis');
    }
    if (qLower.includes('explain') || qLower.includes('how does') || qLower.includes('what is')) {
      intents.push('explanation');
    }

    // Dynamic domain extraction from non-stopword tokens
    const tokens = query
      .replace(/[^a-zA-Z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map(t => t.toLowerCase())
      .filter(t => t.length > 3 && !COMMON_STOPWORDS.has(t));

    const domains = Array.from(new Set(tokens.slice(0, 3))).map(t => `${t}-systems`);
    if (domains.length === 0) domains.push('general-engineering');

    // Ambiguity detection for classic polysemic terms
    const ambiguities: Array<{ term: string; possibleInterpretations: string[] }> = [];
    if (/\bmemory\b/i.test(query)) {
      ambiguities.push({
        term: 'memory',
        possibleInterpretations: [
          'In-memory caching (Redis / Memcached)',
          'Vector database / semantic memory',
          'Agent conversational context buffer',
          'Relational database state persistence'
        ]
      });
    }
    if (/\bfaster\b/i.test(query) || /\bperformance\b/i.test(query)) {
      ambiguities.push({
        term: 'performance / speed',
        possibleInterpretations: [
          'Algorithmic complexity reduction',
          'Multi-threading / GPU concurrency',
          'Caching of repeated computations',
          'Network / database I/O batching'
        ]
      });
    }

    return {
      problemSummary: query.trim(),
      domains,
      intents,
      requirements: reqs,
      ambiguities,
      constraints: [],
      desiredOutputs: [],
      queryExpansions: expansions
    };
  }

  private fallbackRequirements(query: string): OpenRequirement[] {
    const reqs: OpenRequirement[] = [];

    // Check specific known vague engineering queries
    const qLower = query.toLowerCase();
    if (qLower.includes('satellite') && (qLower.includes('map') || qLower.includes('visual'))) {
      reqs.push({
        name: 'Satellite State & Orbit Propagation',
        description: 'Predict or ingest satellite state vectors / ephemeris from orbital parameters.',
        type: 'domain',
        criticality: 'MUST',
        confidence: 'inferred',
        confidenceLevel: 'inferred'
      });
      reqs.push({
        name: 'Geospatial Coordinate Transformation',
        description: 'Transform orbital positions (ECI/ECEF) to geodetic lat/lon/alt coordinates.',
        type: 'technical',
        criticality: 'MUST',
        confidence: 'inferred',
        confidenceLevel: 'inferred'
      });
      reqs.push({
        name: 'Cartographic / Map Visualization',
        description: 'Render geospatial ground tracks and satellite positions onto a map or 3D globe.',
        type: 'functional',
        criticality: 'MUST',
        confidence: 'inferred',
        confidenceLevel: 'inferred'
      });
      return reqs;
    }

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
      const criticality: RequirementCriticality = isMust ? 'MUST' : 'SHOULD';
      const title = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

      reqs.push({
        name: title,
        description: `Implementation capability for ${cleaned}`,
        type: i === 0 ? 'functional' : 'technical',
        criticality,
        confidence: 'inferred',
        confidenceLevel: 'inferred'
      });
    }

    if (reqs.length === 0) {
      reqs.push({
        name: query.trim().slice(0, 60),
        description: query.trim(),
        type: 'functional',
        criticality: 'MUST',
        confidence: 'inferred',
        confidenceLevel: 'inferred'
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

    for (const token of tokens) {
      expansions.add(token);
      if (token === token.toUpperCase() && token.length >= 2 && token.length <= 6) {
        expansions.add(`${token} protocol`);
        expansions.add(`${token} implementation`);
      }
    }

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
