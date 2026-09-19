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
    const qLower = query.toLowerCase();
    const reqs = this.fallbackRequirements(query);
    const expansions = this.fallbackExpansions(query);

    const domains: string[] = [];
    if (qLower.includes('satellite') || qLower.includes('orbit') || qLower.includes('space')) domains.push('satellite-systems');
    if (qLower.includes('geo') || qLower.includes('coordinate') || qLower.includes('map')) domains.push('geospatial');
    if (qLower.includes('image') || qLower.includes('vision') || qLower.includes('detect') || qLower.includes('reconstruction')) domains.push('computer-vision');
    if (qLower.includes('robot') || qLower.includes('ros') || qLower.includes('kinematic')) domains.push('robotics');
    if (qLower.includes('crawl') || qLower.includes('scrape') || qLower.includes('browser')) domains.push('web-automation');
    if (qLower.includes('agent') || qLower.includes('llm') || qLower.includes('rag')) domains.push('artificial-intelligence');
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
    const qLower = query.toLowerCase();
    const reqs: OpenRequirement[] = [];

    // Satellite / Orbit
    if (qLower.includes('satellite') || qLower.includes('orbit') || qLower.includes('sgp4')) {
      reqs.push({
        name: 'SGP4 orbital propagation & trajectory simulation',
        description: 'Propagates satellite state vectors and computes ephemeris trajectories.',
        type: 'domain',
        criticality: 'MUST',
        confidence: 0.95
      });
    }

    // Geospatial
    if (qLower.includes('geospatial') || qLower.includes('coordinate') || qLower.includes('geo')) {
      reqs.push({
        name: 'Geospatial coordinate transformations',
        description: 'Transforms coordinates between WGS84, ECEF, and local projections.',
        type: 'technical',
        criticality: 'MUST',
        confidence: 0.92
      });
    }

    // 3D / Globe rendering
    if (qLower.includes('globe') || qLower.includes('3d') || qLower.includes('render') || qLower.includes('webgl') || qLower.includes('visualization')) {
      reqs.push({
        name: 'Interactive 3D Globe & Spatial Visualization',
        description: 'Renders geospatial entities and satellite trajectories on an interactive globe.',
        type: 'functional',
        criticality: 'MUST',
        confidence: 0.94
      });
    }

    // Computer Vision
    if (qLower.includes('detect') || qLower.includes('vision') || qLower.includes('object') || qLower.includes('image')) {
      reqs.push({
        name: 'Computer Vision & Object Detection',
        description: 'Detects objects, boundaries, or changes from imagery.',
        type: 'domain',
        criticality: 'MUST',
        confidence: 0.90
      });
    }

    // Web Automation
    if (qLower.includes('crawl') || qLower.includes('scrape') || qLower.includes('browser')) {
      reqs.push({
        name: 'Headless Browser Automation & Crawling',
        description: 'Automates browser rendering, DOM extraction, and page crawling.',
        type: 'functional',
        criticality: 'MUST',
        confidence: 0.95,
        canonicalSlug: 'headless-browser-automation'
      });
    }

    // Memory
    if (qLower.includes('memory') || qLower.includes('remember') || qLower.includes('session')) {
      reqs.push({
        name: 'Persistent Agent Memory',
        description: 'Manages multi-turn conversation state and persistent semantic recall.',
        type: 'functional',
        criticality: 'MUST',
        confidence: 0.95,
        canonicalSlug: 'session-memory'
      });
    }

    // Vector Indexing
    if (qLower.includes('vector') || qLower.includes('embedding') || qLower.includes('rag')) {
      reqs.push({
        name: 'Vector Indexing & Similarity Search',
        description: 'High-performance nearest-neighbor indexing over dense vector spaces.',
        type: 'technical',
        criticality: 'MUST',
        confidence: 0.95,
        canonicalSlug: 'vector-indexing'
      });
    }

    // Document Extraction
    if (qLower.includes('pdf') || qLower.includes('table') || qLower.includes('document')) {
      reqs.push({
        name: 'Document & Table Extraction',
        description: 'Parses complex documents and structures tables into queryable formats.',
        type: 'functional',
        criticality: 'MUST',
        confidence: 0.95,
        canonicalSlug: 'pdf-table-extraction'
      });
    }

    if (reqs.length === 0) {
      reqs.push({
        name: 'Core System Capability',
        description: query.trim(),
        type: 'functional',
        criticality: 'MUST',
        confidence: 0.85
      });
    }

    return reqs;
  }

  private fallbackExpansions(query: string): string[] {
    const words = query.split(/\s+/).filter(w => w.length > 3);
    const expansions = new Set<string>(words);

    const qLower = query.toLowerCase();
    if (qLower.includes('satellite')) {
      expansions.add('orbital propagation');
      expansions.add('TLE');
      expansions.add('ephemeris');
      expansions.add('SGP4');
    }
    if (qLower.includes('globe') || qLower.includes('visualize')) {
      expansions.add('WebGL');
      expansions.add('Three.js');
      expansions.add('Cesium');
      expansions.add('3D canvas');
    }
    if (qLower.includes('geo') || qLower.includes('coordinate')) {
      expansions.add('WGS84');
      expansions.add('lat/lon');
      expansions.add('ECEF');
      expansions.add('GIS');
    }
    if (qLower.includes('vision') || qLower.includes('detect')) {
      expansions.add('object detection');
      expansions.add('bounding box');
      expansions.add('YOLO');
      expansions.add('segmentation');
    }

    return Array.from(expansions).slice(0, 8);
  }
}
