import { z } from 'zod';
import { ResourceRole, ResourceType } from '@repo/shared';

export const ResourceRoleEnum = z.enum([
  'software_component',
  'library',
  'framework',
  'documentation',
  'tutorial',
  'reference',
  'research',
  'dataset',
  'article',
  'video',
  'opinion',
  'guide',
  'specification'
]);

export const ResourceCapabilitySchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().min(5).max(1000),
  importance: z.enum(['critical', 'high', 'medium', 'low']).default('high')
});

export const ResourceConceptSchema = z.object({
  name: z.string().min(2).max(100),
  description: z.string().min(5).max(1000),
  importance: z.enum(['critical', 'high', 'medium', 'low']).default('medium')
});

export const ResourceLimitationSchema = z.object({
  name: z.string().min(2).max(150),
  description: z.string().min(5).max(1000)
});

export const ResourceInputOutputSchema = z.object({
  name: z.string().min(1).max(100),
  format: z.string().min(1).max(200)
});

export const ResourceAnalysisSchema = z.object({
  problemsSolved: z.array(z.string().min(3).max(300)).min(1).max(10),
  practicalUses: z.array(z.string().min(3).max(300)).min(1).max(10),
  valueProposition: z.string().min(10).max(1500),
  usefulFor: z.array(z.string().min(2).max(60)).default([]),
  domainTags: z.array(z.string().min(2).max(60)).min(1),
  resourceRole: ResourceRoleEnum.default('reference'),
  capabilities: z.array(ResourceCapabilitySchema).default([]),
  concepts: z.array(ResourceConceptSchema).default([]),
  techniques: z.array(ResourceConceptSchema).optional().default([]),
  limitations: z.array(ResourceLimitationSchema).default([]),
  inputs: z.array(ResourceInputOutputSchema).optional().default([]),
  outputs: z.array(ResourceInputOutputSchema).optional().default([])
});

export type ValidatedResourceAnalysis = z.infer<typeof ResourceAnalysisSchema>;

// Query Decomposition & Ambiguity Schemas
export const RequirementConfidenceEnum = z.enum(['explicit', 'inferred', 'ambiguous']);
export const QueryIntentEnum = z.enum(['discovery', 'comparison', 'composition', 'gap_analysis', 'explanation']);
export const RequirementTypeEnum = z.enum(['functional', 'technical', 'domain', 'deployment', 'performance', 'integration']);
export const RequirementCriticalityEnum = z.enum(['MUST', 'SHOULD', 'NICE_TO_HAVE']);

export const OpenRequirementSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().min(5).max(500),
  type: RequirementTypeEnum.default('functional'),
  criticality: RequirementCriticalityEnum.default('MUST'),
  confidence: z.union([z.number(), RequirementConfidenceEnum]).default('inferred'),
  confidenceLevel: RequirementConfidenceEnum.optional(),
  canonicalSlug: z.string().optional().nullable(),
  isAmbiguous: z.boolean().optional().default(false),
  ambiguousInterpretations: z.array(z.string()).optional().default([])
});

export const AmbiguityItemSchema = z.object({
  term: z.string().min(1).max(80),
  possibleInterpretations: z.array(z.string().min(2).max(200)).min(2)
});

export const ProblemDecompositionSchema = z.object({
  problemSummary: z.string().min(3).max(500),
  domains: z.array(z.string().min(2).max(80)).min(1),
  intents: z.array(QueryIntentEnum).default(['discovery']),
  requirements: z.array(OpenRequirementSchema).min(1),
  ambiguities: z.array(AmbiguityItemSchema).default([]),
  constraints: z.array(z.string().min(2).max(200)).default([]),
  desiredOutputs: z.array(z.string().min(2).max(200)).default([]),
  queryExpansions: z.array(z.string().min(2).max(80)).default([])
});

export type ValidatedProblemDecomposition = z.infer<typeof ProblemDecompositionSchema>;

// Trivial capability blacklist and anti-bloat filters
export const TRIVIAL_CAPABILITY_TERMS = new Set([
  'file reading',
  'read file',
  'reads file',
  'reading files',
  'file writing',
  'write file',
  'string processing',
  'process string',
  'parse string',
  'string manipulation',
  'data handling',
  'handling data',
  'data storage',
  'save data',
  'function execution',
  'run function',
  'execute function',
  'object creation',
  'create object',
  'error handling',
  'handle error',
  'logging',
  'log message',
  'loop execution',
  'variable assignment',
  'print text',
  'display output',
  'array filtering',
  'filter list',
  'basic math',
  'general utility',
  'helper function'
]);

export function isTrivialCapability(name: string, description: string): boolean {
  const lowerName = name.toLowerCase().trim();
  const lowerDesc = description.toLowerCase().trim();

  // Direct match in trivial set
  if (TRIVIAL_CAPABILITY_TERMS.has(lowerName)) return true;

  // Check if starts or ends with trivial action
  for (const term of TRIVIAL_CAPABILITY_TERMS) {
    if (lowerName === term || lowerName.startsWith(`${term} `) || lowerName.endsWith(` ${term}`)) {
      // If description also lacks technical depth, reject as bloat
      if (lowerDesc.length < 35) return true;
    }
  }

  // Check if name is merely generic single-word
  if (!lowerName.includes(' ') && ['utilities', 'helpers', 'tools', 'common', 'core', 'utils'].includes(lowerName)) {
    return true;
  }

  return false;
}

/**
 * Filter capabilities to keep only domain-significant, reusable engineering capabilities.
 */
export function filterMeaningfulCapabilities<T extends { name: string; description: string; importance?: string }>(
  items: T[],
  maxAllowed: number = 12
): Array<T & { importance: string }> {
  const filtered = items.filter(item => !isTrivialCapability(item.name, item.description));
  return filtered.slice(0, maxAllowed).map(item => ({
    ...item,
    importance: item.importance || 'high'
  }));
}

/**
 * Internal Resource Quality Evaluation structure.
 * Internal evaluation metrics only; never exposed as fake confidence to users.
 */
export interface ResourceQualityEvaluation {
  resourceId: string;
  understandingQuality: {
    domainAccuracy: number;       // 0.0 - 1.0 based on factual alignment
    purposeAccuracy: number;      // 0.0 - 1.0 based on factual purpose
    capabilityAccuracy: number;   // 0.0 - 1.0 based on non-bloat, substantive capabilities
    evidenceValidity: number;     // 0.0 - 1.0 based on actual quote backing
    useCaseAccuracy: number;      // 0.0 - 1.0 based on practical engineering usefulness
  };
  evaluationNotes?: string[];
}
