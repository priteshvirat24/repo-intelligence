export type RepositoryStatus =
  | 'PENDING'
  | 'CLONING'
  | 'ANALYZING'
  | 'INDEXING'
  | 'READY'
  | 'FAILED';

export type ResourceType =
  | 'github_repository'
  | 'web_page'
  | 'documentation_site'
  | 'article'
  | 'linkedin_post'
  | 'youtube_video'
  | 'pdf'
  | 'document'
  | 'research_paper'
  | 'generic_url';

export type ResourceRole =
  | 'software_component'
  | 'library'
  | 'framework'
  | 'documentation'
  | 'tutorial'
  | 'reference'
  | 'research'
  | 'dataset'
  | 'article'
  | 'video'
  | 'opinion'
  | 'guide'
  | 'specification';

export type ResourceStatus =
  | 'PENDING'
  | 'FETCHING'
  | 'ANALYZING'
  | 'INDEXING'
  | 'READY'
  | 'PARTIAL'
  | 'FAILED'
  | 'BLOCKED';

export type ResourceLocatorType =
  | 'github_line'
  | 'web_section'
  | 'youtube_timestamp'
  | 'pdf_page'
  | 'linkedin_post'
  | 'metadata';

export type EvidenceStrength =
  | 'DIRECT_IMPLEMENTATION'
  | 'DIRECT_INTERFACE'
  | 'DOCUMENTATION'
  | 'EXAMPLE'
  | 'INFERRED';

export interface AnalysisCompleteness {
  level: 'full' | 'partial' | 'limited';
  filesDiscovered: number;
  filesAnalyzed: number;
  subsystemsAnalyzed: number;
  reason?: string | null;
}

export interface WorkerHeartbeat {
  workerId: string;
  status: 'ALIVE' | 'STALE' | 'STOPPED';
  currentJobId: string | null;
  lastSeenAt: string;
  metadata?: Record<string, any>;
}

export interface UniversalResource {
  id: string;
  resourceType: ResourceType;
  resourceRole: ResourceRole;
  sourceUrl: string;
  canonicalUrl?: string | null;
  title: string;
  description?: string | null;
  author?: string | null;
  publisher?: string | null;
  sourceDomain?: string | null;
  status: ResourceStatus;
  errorMessage?: string | null;
  contentHash?: string | null;
  domainTags?: string[];
  problemsSolved?: string[];
  practicalUses?: string[];
  valueProposition?: string | null;
  usefulFor?: string[];
  publishedAt?: string | null;
  lastCheckedAt?: string | null;
  indexedAt?: string | null;
  metadata?: Record<string, any>;
  analysis?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceDetail extends UniversalResource {
  knowledgeProfile?: OpenWorldRepositoryProfile;
  capabilities: KnowledgeObject[];
  features: KnowledgeObject[];
  concepts: KnowledgeObject[];
  useCases: KnowledgeObject[];
  limitations: KnowledgeObject[];
  relationships?: KnowledgeRelationship[];
  citations?: ResourceCitation[];
  stats: {
    documents: number;
    chunks: number;
    capabilities: number;
    concepts: number;
  };
}

export interface ResourceCitation {
  id?: string;
  resourceId: string;
  resourceTitle: string;
  resourceType: ResourceType;
  sourceUrl: string;
  locatorType: ResourceLocatorType;
  locator: {
    filePath?: string;
    startLine?: number;
    endLine?: number;
    symbolName?: string;
    sectionHeading?: string;
    startSeconds?: number;
    endSeconds?: number;
    timestampLabel?: string;
    pageNumber?: number;
    author?: string;
    postId?: string;
  };
  snippet: string;
  formattedCitation: string;
  isVerified: boolean;
}

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  domain?: string;
  score?: number;
  publishedDate?: string;
  canSave: boolean;
  sourceType?: ResourceType;
}

export type ChatSourceMode = 'INTERNAL' | 'WEB' | 'BOTH';

export interface Repository {
  id: string;
  resourceId?: string;
  owner: string;
  name: string;
  url: string;
  description: string | null;
  defaultBranch: string;
  latestCommitHash: string | null;
  license: string | null;
  stars: number;
  primaryLanguage: string | null;
  status: RepositoryStatus;
  domainTags?: string[];
  openKnowledge?: OpenWorldRepositoryProfile;
  analysisCompleteness?: AnalysisCompleteness;
  errorMessage?: string | null;
  metadata?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export type KnowledgeObjectType =
  | 'capability'
  | 'feature'
  | 'concept'
  | 'technique'
  | 'use_case'
  | 'component'
  | 'interface'
  | 'input'
  | 'output'
  | 'constraint'
  | 'limitation'
  | 'integration'
  | 'architecture'
  | 'technical_insight'
  | 'repository_profile';

export type KnowledgeRelationshipType =
  | 'is-a'
  | 'part-of'
  | 'depends-on'
  | 'extends'
  | 'complements'
  | 'overlaps-with'
  | 'alternative-to'
  | 'produces'
  | 'consumes'
  | 'enables'
  | 'explains'
  | 'references'
  | 'implements'
  | 'demonstrates'
  | 'contradicts'
  | 'supports'
  | 'related-to';

export interface Evidence {
  id?: string;
  repositoryCapabilityId?: string;
  knowledgeObjectId?: string;
  resourceId?: string;
  filePath?: string;
  startLine?: number | null;
  endLine?: number | null;
  symbolName?: string | null;
  quoteSnippet: string;
  evidenceType: 'doc' | 'code_ast' | 'manifest' | 'example' | 'inferred' | 'web_section' | 'youtube_transcript' | 'pdf_page' | 'post';
  evidenceStrength?: EvidenceStrength;
  locatorType?: ResourceLocatorType;
  locatorJson?: Record<string, any>;
  isVerified: boolean;
  verificationNotes?: string;
  createdAt?: string;
}

export interface KnowledgeObject {
  id?: string;
  repositoryId?: string;
  resourceId?: string;
  sourceType?: ResourceType;
  objectType: KnowledgeObjectType;
  name: string;
  description: string;
  category?: string;
  importance?: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;
  metadata?: Record<string, any>;
  evidence?: Evidence[];
}

export interface KnowledgeRelationship {
  id?: string;
  sourceId?: string;
  targetId?: string;
  sourceRepoId?: string;
  targetRepoId?: string;
  sourceResourceId?: string;
  targetResourceId?: string;
  sourceName?: string;
  targetName?: string;
  relationshipType: KnowledgeRelationshipType;
  confidence: number;
  evidenceSnippet?: string;
  metadata?: Record<string, any>;
}

export interface OpenWorldRepositoryProfile {
  domains: string[];
  purpose: string;
  problemSpace: string;
  problemsSolved?: string[];
  practicalUses?: string[];
  valueProposition?: string;
  capabilities: KnowledgeObject[];
  features: KnowledgeObject[];
  concepts: KnowledgeObject[];
  techniques: KnowledgeObject[];
  useCases: KnowledgeObject[];
  architecture: {
    patternType?: string;
    description?: string;
    majorSubsystems?: string[];
  };
  components: KnowledgeObject[];
  interfaces: KnowledgeObject[];
  inputs: KnowledgeObject[];
  outputs: KnowledgeObject[];
  integrations: KnowledgeObject[];
  constraints: KnowledgeObject[];
  limitations: KnowledgeObject[];
  importantFiles?: Array<{
    filePath: string;
    importance: 'critical' | 'high' | 'medium' | 'low';
    reason: string;
  }>;
  relationships?: KnowledgeRelationship[];
}

export interface RepositoryDependency {
  id: string;
  repositoryId: string;
  packageName: string;
  ecosystem: 'npm' | 'pypi' | 'go' | 'cargo' | 'system' | 'other';
  versionSpec: string | null;
  isRuntime: boolean;
  isHeavyweight: boolean;
}

export interface RepositoryDetail extends Repository {
  knowledgeProfile?: OpenWorldRepositoryProfile;
  capabilities: KnowledgeObject[];
  features: KnowledgeObject[];
  concepts: KnowledgeObject[];
  useCases: KnowledgeObject[];
  dependencies: RepositoryDependency[];
  limitations: KnowledgeObject[];
  relationships?: KnowledgeRelationship[];
  stats: {
    documents: number;
    chunks: number;
    capabilities: number;
  };
}

export interface IngestionJob {
  id: string;
  repositoryId?: string;
  resourceId?: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  step: string;
  attempts: number;
  maxAttempts: number;
  errorMessage: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
  stageMetrics?: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export type RequirementCriticality = 'MUST' | 'SHOULD' | 'NICE_TO_HAVE';
export type RequirementType = 'functional' | 'technical' | 'domain' | 'deployment' | 'performance' | 'integration';
export type RequirementConfidence = 'explicit' | 'inferred' | 'ambiguous';
export type QueryIntent = 'discovery' | 'comparison' | 'composition' | 'gap_analysis' | 'explanation';
export type CompatibilityLevel = 'VERIFIED' | 'STRONGLY_INFERRED' | 'POSSIBLE' | 'UNKNOWN';

export interface OpenRequirement {
  name: string;
  description: string;
  type: RequirementType;
  criticality: RequirementCriticality;
  confidence: number | RequirementConfidence;
  confidenceLevel?: RequirementConfidence;
  canonicalSlug?: string;
  isAmbiguous?: boolean;
  ambiguousInterpretations?: string[];
}

export interface OpenQueryRequirements {
  problemSummary: string;
  domains: string[];
  intents?: QueryIntent[];
  requirements: OpenRequirement[];
  ambiguities?: Array<{
    term: string;
    possibleInterpretations: string[];
  }>;
  constraints: string[];
  desiredOutputs: string[];
  queryExpansions: string[];
}

export interface CandidateScore {
  repositoryId?: string;
  resourceId?: string;
  resourceType?: ResourceType;
  resourceRole?: ResourceRole;
  repositoryName: string;
  owner?: string;
  sourceUrl?: string;
  primaryLanguage?: string | null;
  stars?: number;
  domainTags?: string[];
  vectorSimilarity: number;
  fullTextRank: number;
  capabilityCoverageScore: number;
  maturityScore: number;
  complexityPenalty: number;
  conflictPenalty: number;
  finalScore: number;
  matchedCapabilities: string[];
  matchedConcepts?: string[];
  distinctiveTermBoost?: number;
  relevanceExplanation?: string;
  problemsSolved?: string[];
  practicalUses?: string[];
}

export interface RetrievalTrace {
  queryText: string;
  hasEmbedding: boolean;
  suppressedGenericWords: string[];
  distinctiveTokens: string[];
  rawKnowledgeObjectsCount: number;
  rawChunksCount: number;
  candidatesScored: number;
  topCandidateNames: string[];
}

export interface ArchitectureNode {
  id: string;
  label: string;
  role: string;
  resourceType?: ResourceType;
  resourceRole?: ResourceRole;
  domain?: string;
}

export interface ArchitectureEdge {
  from: string;
  to: string;
  relationship: string;
  label?: string;
  boundary?: 'same-process' | 'library' | 'sdk' | 'http-service' | 'cli' | 'file-exchange' | 'database' | 'message-queue';
  compatibilityLevel?: CompatibilityLevel;
  reason?: string;
  dataFlowSnippet?: string;
  evidenceRef?: string;
}

export interface ArchitectureGraphData {
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
}

export interface CompositionPlan {
  recommendedRepositories: CandidateScore[];
  architectureGraph: ArchitectureGraphData;
  capabilityCoverage: Record<string, {
    providedBy: string[];
    status: 'COVERED' | 'PARTIAL' | 'MISSING';
    notes?: string;
  }>;
  redundancies: Array<{
    capabilityOrFeature: string;
    overlappingRepositories: string[];
    overlapType: 'full' | 'partial' | 'complementary' | 'optional_alternative';
    recommendation: string;
  }>;
  dataFlow: Array<{
    producerRepo: string;
    output: string;
    consumerRepo: string;
    input: string;
    boundary: string;
    compatibilityLevel?: CompatibilityLevel;
    evidence?: string;
  }>;
  knowledgeReferences?: Array<{
    resourceId: string;
    resourceTitle: string;
    resourceRole: ResourceRole;
    sourceUrl: string;
    contributionType: 'methodology' | 'tutorial_guide' | 'api_specification' | 'conceptual_background';
    explanation: string;
  }>;
  uncoveredRequirements: OpenRequirement[];
  synthesisSummary: string;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  structuredContext?: {
    requirements?: OpenQueryRequirements;
    composition?: CompositionPlan;
    architectureGraph?: ArchitectureGraphData;
    sourceMode?: ChatSourceMode;
    sourcesUsed?: 'OPEN EYE' | 'WEB' | 'OPEN EYE + WEB';
    citations?: Array<{
      repo: string;
      filePath: string;
      lines?: string;
      quote: string;
      symbolName?: string;
      verified: boolean;
    }>;
    universalCitations?: ResourceCitation[];
    webSources?: WebSearchResult[];
  };
  createdAt: string;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages?: ChatMessage[];
}

// Briefs and GitHub discovery

export type BriefSourceType = 'text' | 'markdown' | 'pdf' | 'docx';
export type BriefStatus = 'QUEUED' | 'RUNNING' | 'AWAITING_INPUT' | 'COMPLETED' | 'FAILED' | 'STOPPED';
export type DiscoveryStep =
  | 'QUEUED'
  | 'UNDERSTANDING'
  | 'RECALLING_MEMORY'
  | 'PLANNING_QUERIES'
  | 'SEARCHING_GITHUB'
  | 'READING_READMES'
  | 'RANKING'
  | 'READING_DOCS'
  | 'VERIFYING'
  | 'EXECUTING'
  | 'DESIGNING'
  | 'DONE'
  | 'FAILED';
export type CandidateKind = 'implementation' | 'library' | 'framework' | 'curated_list' | 'tutorial' | 'unknown';
export type RequirementCoverage = 'yes' | 'partial' | 'no' | 'unknown';

export interface BriefSummary {
  id: string;
  title: string;
  sourceType: BriefSourceType;
  sourceFilename?: string | null;
  status: BriefStatus;
  step: DiscoveryStep;
  errorMessage?: string | null;
  requirementCount: number;
  candidateCount: number;
  shortlistedCount: number;
  createdAt: string;
  discoveredAt?: string | null;
}

export interface DiscoveryQuery {
  query: string;
  requirement: string;
  results: number;
  /** The GitHub searches actually run for this query, strictest first */
  searchedAs?: string[];
}

export interface DiscoveryMetrics {
  queryPlanner?: 'llm' | 'heuristic';
  queries?: DiscoveryQuery[];
  candidatesFound?: number;
  duplicatesRemoved?: number;
  readmesAssessed?: number;
  githubAuthenticated?: boolean;
  durationMs?: number;
  /** Version of the tuning (weights, thresholds, prompts) discovery ran with */
  tuningVersion?: string;
}

export interface CandidateAssessment {
  summary?: string;
  kind?: CandidateKind;
  coverage?: Record<string, RequirementCoverage>;
  reason?: string;
}

export interface BriefCandidate {
  id: string;
  fullName: string;
  sourceUrl: string;
  description?: string | null;
  primaryLanguage?: string | null;
  topics: string[];
  stars: number;
  forks: number;
  openIssues: number;
  license?: string | null;
  pushedAt?: string | null;
  candidateKind: CandidateKind;
  matchedQueries: string[];
  matchedRequirements: string[];
  relevanceScore: number;
  healthScore: number;
  coverageScore: number | null;
  finalScore: number;
  rank: number;
  shortlisted: boolean;
  duplicateOf?: string | null;
  assessment: CandidateAssessment;
}

export type BlueprintStatus = 'WAITING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
export type BlueprintDecision = 'reuse' | 'adapt' | 'investigate' | 'build';

export interface BlueprintVerification {
  fullName: string;
  state: 'queued' | 'reused' | 'skipped';
  reason?: string | null;
  repositoryId?: string | null;
  resourceId?: string | null;
  /** Live indexing state of the repository (from the repositories table and its latest job) */
  repositoryStatus?: string | null;
  jobStep?: string | null;
}

export interface BlueprintSource {
  id: string; // C1 (verified code), R1 (README assessment), L1 (known limitation)
  kind: 'code' | 'readme' | 'limitation';
  repo: string;
  title: string;
  text: string;
  filePath?: string | null;
  startLine?: number | null;
  endLine?: number | null;
  symbol?: string | null;
  quote?: string;
  url: string;
  /** The graded claim behind this source (claims table), when there is one */
  claimId?: string;
  grade?: 'E1' | 'E2' | 'E3' | 'E4' | 'E5';
  claimStatus?: 'needs_revalidation' | 'refuted';
}

export interface BlueprintComponent {
  requirement: string;
  criticality: RequirementCriticality;
  isConstraint: boolean;
  decision: BlueprintDecision;
  repo: string | null;
  how: string;
  sources: string[];
  /** verified: code evidence about this requirement; unconfirmed: README claims or code about something else */
  evidence: 'verified' | 'unconfirmed' | 'none';
}

export interface BlueprintItem {
  title: string;
  detail: string;
  sources?: string[];
  requirements?: string[];
  /** Added from repository data or coverage gaps, not written by the model */
  generated?: boolean;
}

export interface EngineeringBlueprint {
  summary: string;
  components: BlueprintComponent[];
  integrationSteps: BlueprintItem[];
  toBuild: BlueprintItem[];
  risks: BlueprintItem[];
  sources: BlueprintSource[];
  verification: Array<{ fullName: string; status: 'verified' | 'failed' | 'skipped' | 'pending'; capabilities: number; reason?: string | null; repositoryId?: string | null }>;
  generatedAt: string;
  tuningVersion?: string;
}

export interface BriefBlueprint {
  status: BlueprintStatus;
  step: string;
  errorMessage?: string | null;
  verification: BlueprintVerification[];
  blueprint: EngineeringBlueprint | null;
  completedAt?: string | null;
}

/** What a brief's run spent, from the cost ledger (provider_usage) */
export interface BriefUsage {
  calls: number;
  failedCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** null when any call's model has no price in LLM_PRICES_JSON */
  costCents: number | null;
  byStage: Array<{ stage: 'understanding' | 'discovery' | 'verification' | 'blueprint' | 'execution'; calls: number; inputTokens: number; outputTokens: number }>;
}

export type TaskStatus = 'pending' | 'running' | 'waiting' | 'awaiting_input' | 'done' | 'failed' | 'stale' | 'cancelled';

export interface BriefTask {
  type: 'understand' | 'recall' | 'discover' | 'verify' | 'docs' | 'execute' | 'blueprint';
  status: TaskStatus;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  updatedAt: string;
}

export interface ClarifyingQuestion {
  question: string;
  why: string;
  blocking: boolean;
}

export interface BriefUnderstanding {
  acceptanceCriteria: string[];
  clarifyingQuestions: ClarifyingQuestion[];
  assumptions: string[];
  mode?: 'llm' | 'heuristic';
}

export interface BriefBudget {
  limits: { llmCalls: number; tokens: number; githubRequests: number; sourceRequests: number };
  used: { llmCalls: number; tokens: number; githubRequests: number; sourceRequests: number };
}

export interface BriefDetail extends BriefSummary {
  briefText: string;
  constraints: Record<string, string>;
  answers: Record<string, string>;
  understanding: BriefUnderstanding | null;
  budget: BriefBudget;
  stopReason?: string | null;
  tasks: BriefTask[];
  decompositionMode: 'llm' | 'heuristic';
  requirements: OpenQueryRequirements;
  discovery: DiscoveryMetrics;
  candidates: BriefCandidate[];
  blueprint: BriefBlueprint | null;
  usage: BriefUsage;
}

// Phase 4: memory (PRODUCT_DEFINITION 8, SYSTEM_DESIGN 8). Three types: semantic (claims, source reliability),
// episodic (run and event episodes) and procedural (procedures learned from episodes and evaluations).

export type MemoryType = 'semantic' | 'episodic' | 'procedural';
export type ClaimGrade = 'E1' | 'E2' | 'E3' | 'E4' | 'E5';
export type ClaimStatus = 'current' | 'needs_revalidation' | 'refuted' | 'superseded';

export interface ClaimEvidenceItem {
  method: string;
  grade?: ClaimGrade;
  sourceUrl?: string;
  locator?: { filePath?: string; startLine?: number; endLine?: number; symbol?: string; commit?: string };
  excerpt?: string;
  reason?: string;
  claimId?: string;
  at?: string;
}

/** A semantic memory record as the audit view shows it */
export interface MemoryClaim {
  id: string;
  subject: string;
  subjectVersion?: string | null;
  kind: string;
  statement: string;
  grade: ClaimGrade;
  status: ClaimStatus;
  scope: 'global' | 'workspace';
  briefId?: string | null;
  evidence: ClaimEvidenceItem[];
  observedAt: string;
  revalidateAfter?: string | null;
  revalidatedAt?: string | null;
  /** status current and not past revalidateAfter; anything else is shown as "last verified on" */
  current: boolean;
  sourceReliability?: number | null;
}

export interface MemoryEpisode {
  id: string;
  briefId?: string | null;
  parentId?: string | null;
  kind: 'run' | 'event';
  outcome: 'completed' | 'stopped' | 'failed' | 'refuted' | 'confirmed' | 'feedback';
  title?: string | null;
  summary?: string | null;
  tuningVersion?: string | null;
  queries: Array<{ query: string; requirement: string; results?: number; newCandidates?: number; shortlistedFound?: string[] }>;
  shortlisted: string[];
  rejected: Array<{ fullName: string; reason: string }>;
  decisions: Array<{ component?: string; decision?: string; repo?: string | null }>;
  budget: { llmCalls?: number; tokens?: number; githubRequests?: number };
  memory: { memoryCandidates?: number; searchesAvoided?: number; similarEpisodes?: string[] };
  feedback: Array<{ outcome: string; claimId?: string; subject?: string; reason?: string }>;
  detail: Record<string, unknown>;
  finishedAt: string;
}

export type ProcedureStatus = 'candidate' | 'active' | 'retired';

export interface MemoryProcedure {
  id: string;
  workspaceId?: string | null;
  kind: 'query_pattern' | 'research_strategy' | 'integration_recipe' | 'avoidance';
  name: string;
  trigger: { requirementTerms?: string[]; domain?: string; language?: string };
  steps: Record<string, unknown>;
  evidence: { episodes?: string[]; evalRuns?: string[]; briefs?: number };
  successCount: number;
  failureCount: number;
  usesCount: number;
  confidence?: number | null;
  status: ProcedureStatus;
  scope: 'global' | 'workspace';
  revalidationRule: string;
  activatedAt?: string | null;
  retiredAt?: string | null;
  updatedAt: string;
}

/** What memory contributed to a brief's discovery (declaration merging onto DiscoveryMetrics) */
export interface DiscoveryMetrics {
  memoryCandidates?: number;
  memoryAlsoFound?: number;
  searchesAvoided?: number;
  queriesSkipped?: string[];
  proceduresApplied?: string[];
}

export interface BriefCandidate {
  /** where the candidate came from: search, memory or both */
  provenance?: Array<'search' | 'memory'>;
  memory?: {
    claims?: Array<{ id: string; kind: string; grade: ClaimGrade; statement: string; status: ClaimStatus; current: boolean; observedAt?: string; revalidatedAt?: string | null }>;
    lastVerifiedAt?: string | null;
    assessedFromBrief?: string | null;
  };
}

// Phase 3: the complete engineering blueprint (PRODUCT_DEFINITION 5) and iterating on it (4.1 step 6).
// BlueprintComponent, BlueprintItem, EngineeringBlueprint and BriefDetail below MERGE with the declarations
// above (TypeScript declaration merging). Every Phase 3 field is optional, so blueprints written before
// Phase 3 still type-check and render.

export type EvidenceGrade = 'E1' | 'E2' | 'E3' | 'E4' | 'E5';
/** PRODUCT_DEFINITION 5.4: 1 available and verified, 2 needs configuration or integration, 3 needs modification,
 * 4 partially solved, 5 missing (must be built), 6 unresolved */
export type BuildReuseClass = 1 | 2 | 3 | 4 | 5 | 6;
export type InventoryAction = 'reuse' | 'adapt' | 'investigate' | 'reject';
export type LicencePolicyName = 'copyleft-flagged' | 'permissive-only' | 'any';
export type LicenceStatus = 'compatible' | 'flagged' | 'conflict' | 'missing' | 'unknown';
export type BlueprintStageName = 'classify' | 'inventory' | 'architecture' | 'guide' | 'roadmap' | 'executive';
export type BlueprintStageMode = 'llm' | 'fallback' | 'single-call';

export interface BlueprintComponent {
  class?: BuildReuseClass;
  classLabel?: string;
  reason?: string;
  /** class 2: the configuration or glue work */
  setup?: string;
  /** class 3: the modification needed */
  change?: string;
  /** class 4: the part no candidate covers */
  uncovered?: string;
  /** class 6: the evidence that would resolve it */
  resolveBy?: string;
  /** class 5: the discovery queries attributed to this requirement */
  searched?: string[];
  evidenceGrades?: EvidenceGrade[];
  generated?: boolean;
}

/** Integration guide steps are BlueprintItems with these fields (PRODUCT_DEFINITION 5.6) */
export interface BlueprintItem {
  phase?: 'prerequisites' | 'install' | 'configuration' | 'integration' | 'verification';
  /** Environment variable names only, never values */
  envVars?: string[];
  /** Names no cited source mentions: proposed by the model */
  envVarsProposed?: string[];
  /** Only when a cited source states it */
  version?: string;
  code?: string;
  /** No step has been executed until build mode (Phase 6) */
  executed?: boolean;
  basis?: 'cited' | 'inferred';
  id?: string;
}

export interface BlueprintLicenceCheck {
  licence: string | null;
  family: 'permissive' | 'copyleft' | 'none' | 'unknown';
  policy: LicencePolicyName;
  status: LicenceStatus;
  note: string;
  grade?: EvidenceGrade;
  claimId?: string;
}

export interface BlueprintInventoryEntry {
  repo: string;
  url?: string;
  kind?: string;
  version: { commit: string | null; basis: string };
  verification: 'verified' | 'failed' | 'skipped' | 'not-verified';
  /** Source ids of cited capabilities */
  capabilities: string[];
  modules: Array<{ filePath: string; symbol?: string | null; source: string; url?: string }>;
  licence: BlueprintLicenceCheck;
  maintenance: { lastPush: string | null; risk: 'low' | 'medium' | 'high' | 'unknown'; detail: string; grade: EvidenceGrade; dependencies: string[]; basis: string };
  /** Source ids of located limitations */
  limitations: string[];
  limitationsNote?: string;
  /** Requirements its README assessment says it does not cover */
  missing: string[];
  action: InventoryAction;
  reason: string;
  requirements: string[];
  generated?: boolean;
}

export interface BlueprintArchitectureComponent {
  name: string;
  responsibility: string;
  origin: 'reused' | 'adapted' | 'new';
  repo: string | null;
  requirements: string[];
  sources: string[];
  generated?: boolean;
}

export interface BlueprintArchitecture {
  components: BlueprintArchitectureComponent[];
  dataFlows: Array<{ from: string; to: string; data: string; contract: string }>;
  interfaces: Array<{ name: string; provider: string; consumer: string; contract: string; sources: string[] }>;
  storage: Array<{ name: string; purpose: string; technology: string }>;
  externalDependencies: Array<{ name: string; purpose: string; sources: string[] }>;
  auth: string;
  failureHandling: string;
  observability: string;
  deployment: string;
  scaling: string;
  tradeoffs: Array<{ decision: string; reason: string; alternatives: string[] }>;
  rejectedAlternatives: Array<{ option: string; reason: string; generated?: boolean }>;
  basis: string;
}

export interface BlueprintRoadmapTask {
  id: string;
  order: number;
  priority: 1 | 2 | 3;
  title: string;
  description: string;
  requirements: string[];
  dependsOn: string[];
  output: string;
  /** Estimates, not facts */
  complexity: 'S' | 'M' | 'L';
  uncertainty: 'low' | 'medium' | 'high';
  estimate: true;
  estimateBasis: string;
  risks: Array<{ risk: string; mitigation: string }>;
  acceptanceCriteria: string[];
  tests: string[];
  acceptanceGenerated?: boolean;
  testsGenerated?: boolean;
  generated?: boolean;
}

export interface BlueprintHumanDecision {
  id: string;
  title: string;
  detail: string;
  requirement?: string;
  repo?: string;
}

export interface BlueprintUncertainty {
  traceability: Array<{ recommendation: string; requirement?: string; sources: string[]; grades: EvidenceGrade[] }>;
  conflicts: Array<{ title: string; detail: string; requirement?: string; sources: string[] }>;
  stale: Array<{ title: string; detail: string; sources: string[] }>;
  weakDependencies: Array<{ requirement: string | null; detail: string; sources: string[]; grades: EvidenceGrade[] }>;
  missingVerification: Array<{ repo: string | null; detail: string }>;
  incompleteResearch: Array<{ title: string; detail: string; requirement?: string }>;
  humanDecisions: BlueprintHumanDecision[];
  basis: string;
}

export interface BlueprintExecutive {
  strategy: string;
  buildingBlocks: string[];
  challenges: string[];
  remainingWork: { estimate: string; taskCounts: { S: number; M: number; L: number }; label: 'estimate' };
  topRisks: Array<BlueprintItem & { id: string }>;
  humanDecisions: BlueprintHumanDecision[];
  mode: 'llm' | 'fallback';
}

/** How the blueprint answered a challenge */
export interface BlueprintChallengeResponse {
  id?: string;
  ref: string;
  requirement: string;
  repo?: string | null;
  note: string;
  /** Computed from the previous and new classification, not taken from the model */
  outcome: 'changed' | 'upheld';
  previousClass?: BuildReuseClass | null;
  newClass: BuildReuseClass;
  response: string;
  repoEvidence?: 'verified' | 'readme-only' | 'none' | 'not-a-candidate';
  evidenceNote?: string;
  sources?: string[];
}

export interface BlueprintChange {
  requirement: string;
  from: { class: BuildReuseClass | null; decision: BlueprintDecision; repo: string | null } | null;
  to: { class: BuildReuseClass; decision: BlueprintDecision; repo: string | null };
  reason: string;
}

export interface EngineeringBlueprint {
  schemaVersion?: number;
  executive?: BlueprintExecutive;
  classCounts?: Record<string, number>;
  inventory?: BlueprintInventoryEntry[];
  architecture?: BlueprintArchitecture;
  roadmap?: BlueprintRoadmapTask[];
  uncertainty?: BlueprintUncertainty;
  challenges?: BlueprintChallengeResponse[];
  changes?: BlueprintChange[];
  licencePolicy?: LicencePolicyName;
  stages?: Partial<Record<BlueprintStageName, BlueprintStageMode>>;
  revision?: number;
}

/** A challenge stored on the brief (POST /api/briefs/[id]/challenge) */
export interface BlueprintChallenge {
  id: string;
  requirement: string;
  repo: string | null;
  note: string;
  createdAt: string;
  createdBy?: string | null;
}

/** A requirement to investigate deeper (POST /api/briefs/[id]/deepen) */
export interface BlueprintFocus {
  requirement: string;
  createdAt: string;
}

export interface BriefDetail {
  challenges?: BlueprintChallenge[];
  focus?: BlueprintFocus[];
}

// Phase 6: sandboxed execution (E1) and build mode

export type BuildStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'awaiting_approval' | 'delivered';

/** A work item a build can be authorised for: a roadmap task, or a to-build item when there is no roadmap */
export interface BuildRoadmapItem {
  id: string;
  title: string;
  detail: string;
  acceptanceCriteria: string[];
  tests: string[];
  requirements: string[];
  source: 'roadmap' | 'toBuild';
}

export interface BuildScope {
  roadmapTaskIds: string[];
  requirements: string[];
}

export interface BuildTestCase {
  name: string;
  status: 'passed' | 'failed' | 'error' | 'skipped';
  message?: string;
}

export interface BuildCriterion {
  criterion: string;
  status: 'passed' | 'failed' | 'untested';
  tests: string[];
}

export interface BuildIteration {
  iteration: number;
  phase: 'generate' | 'install' | 'test' | 'sandbox';
  exitCode?: number | null;
  timedOut?: boolean | null;
  totals?: { passed: number; failed: number; error: number; skipped: number } | null;
  passed: boolean;
  durationMs?: number | null;
  error?: string | null;
  notes?: string | null;
  output?: string;
}

/** What passed, failed, remains untested, or needs a human (PRODUCT_DEFINITION 5.8) */
export interface BuildTestReport {
  outcome: 'passed' | 'partial' | 'failed' | 'not_run';
  stopReason?: 'all_passed' | 'max_iterations' | 'budget' | 'sandbox_time' | 'sandbox_error';
  iterations: number;
  maxIterations?: number;
  runtime?: 'python' | 'node' | null;
  image?: string | null;
  sandbox?: { provider: string; image: string; imageDigest: string | null } | null;
  installCommand?: string | null;
  testCommand?: string | null;
  network?: string | null;
  sandboxSeconds?: number;
  totals?: { passed: number; failed: number; error: number; skipped: number };
  tests?: BuildTestCase[];
  criteria?: BuildCriterion[];
  passed?: string[];
  failed?: string[];
  untested?: string[];
  needsHuman: string[];
  history?: BuildIteration[];
  notes?: string;
  dependencies?: string[];
  pathPrefix?: string;
  error?: string;
}

export interface BuildDelivery {
  /** set while a delivery is in progress or after one failed; absent once delivered */
  state?: 'delivering' | 'failed';
  error?: string;
  repo?: string;
  branch?: string;
  baseBranch?: string;
  pullRequestUrl?: string;
  pullRequestNumber?: number;
  approvedBy?: string | null;
  deliveredAt?: string;
}

export interface BuildSummary {
  id: string;
  briefId: string;
  status: BuildStatus;
  step: string | null;
  scope: BuildScope;
  iterations: number;
  maxIterations: number;
  outcome: BuildTestReport['outcome'] | null;
  errorMessage: string | null;
  delivery: BuildDelivery | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface BuildDetail extends BuildSummary {
  report: BuildTestReport | null;
  diff: string | null;
  files: string[];
}

// Phase 2: discovery breadth and verification depth (package registries, advisories, official docs, forums)

/** Where a candidate was found: GitHub search, or a package registry whose package names the repository */
export type CandidateSource = 'github' | 'npm' | 'crates';

export interface CandidatePackage {
  system: string; // NPM, CARGO, PYPI, GO, ...
  name: string;
  version?: string | null;
  url?: string;
}

export type Phase2ClaimKind = 'licence' | 'licence_conflict' | 'maintenance' | 'vulnerability' | 'capability' | 'known_issue';

/** A graded claim about a candidate from the docs task, as shown on the brief page */
export interface CandidateClaim {
  id: string;
  kind: Phase2ClaimKind;
  statement: string;
  grade: 'E1' | 'E2' | 'E3' | 'E4' | 'E5';
  status: 'current' | 'needs_revalidation' | 'refuted';
  sourceUrl?: string | null;
  /** The quoted passage (docs evidence) */
  excerpt?: string | null;
  section?: string | null;
  advisoryIds?: string[];
  severity?: string | null;
}

// Declaration merging: these fields are added to the interfaces declared above
export interface BriefCandidate {
  sources?: CandidateSource[];
  packages?: CandidatePackage[];
  homepage?: string | null;
  /** Registry, advisory, docs and forum claims from the docs task (shortlisted candidates) */
  evidence?: CandidateClaim[];
}

export interface DiscoveryQuery {
  /** Not run: diminishing returns */
  skipped?: boolean;
}

export interface DiscoveryMetrics {
  /** Queries not run because the previous ones stopped finding new candidates */
  diminishingReturns?: { skippedQueries: string[]; afterUnproductive: number } | null;
  registries?: {
    searches: Array<{ registry: string; query: string; results: number; resolved: number }>;
    repositoriesFound: Record<string, number>;
    newRepositoriesFetched: number;
    unavailable: string[];
  } | null;
}

// Phase 5: controlled self-evolution (PRODUCT_DEFINITION 9)

export type FeedbackTargetKind = 'candidate' | 'blueprint_decision' | 'claim';
/** useful / not_useful for candidates; correct / wrong for blueprint decisions and claims */
export type FeedbackVerdict = 'useful' | 'not_useful' | 'correct' | 'wrong';

export interface FeedbackEntry {
  targetKind: FeedbackTargetKind;
  targetId: string;
  verdict: FeedbackVerdict;
  note?: string | null;
  tuningVersion?: string | null;
  updatedAt?: string;
}

export type ConfigVersionStatus = 'candidate' | 'pending' | 'promoted' | 'retired' | 'rejected' | 'rolled_back';

/** Gate metrics recorded with a decision (apps/worker/evolution/gate.py) */
export type EvolutionMetrics = Record<string, { baseline: number | null; candidate: number | null; delta: number | null; band?: number }>;

export interface ConfigVersionSummary {
  id: string;
  parentId: string | null;
  level: 'L1' | 'L2' | 'L3';
  status: ConfigVersionStatus;
  notes: string | null;
  /** keys that differ from the parent version (or, without one, from the oldest registered version) */
  changedKeys: string[];
  evidence: { runs?: string[]; method?: string; gate?: { target?: string | null; reasons?: string[]; metrics?: EvolutionMetrics } } | null;
  createdAt: string;
  promotedAt: string | null;
  decidedAt: string | null;
  /** live feedback on results this version produced */
  feedback: { total: number; negative: number; rate: number | null };
}

export interface EvolutionEvent {
  id: number;
  kind: 'promoted' | 'rejected' | 'rolled_back' | 'proposed' | 'proposal_rejected';
  version: string | null;
  activeBefore: string | null;
  activeAfter: string | null;
  level: string | null;
  actor: string;
  notes: string | null;
  createdAt: string;
}

export interface EvolutionProposal {
  id: string;
  level: 'L2' | 'L3' | 'L4';
  title: string;
  rationale: string | null;
  configVersion: string | null;
  baseVersion: string | null;
  changedKeys: string[];
  benchmarkWin: boolean;
  evidence: {
    runs?: string[];
    baselineRuns?: string[];
    gate?: { reasons?: string[]; recurringTraps?: string[]; metrics?: EvolutionMetrics };
  } | null;
  status: 'pending' | 'approved' | 'rejected';
  createdBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface LabelProposal {
  id: string;
  briefId: string;
  briefTitle: string;
  kind: 'solution' | 'trap' | 'decision_review' | 'claim_review';
  repo: string | null;
  requirement: string | null;
  proposal: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'dismissed';
  createdAt: string;
}

export interface EvolutionData {
  /** the promoted version; null when the built-in defaults are active */
  active: string | null;
  versions: ConfigVersionSummary[];
  events: EvolutionEvent[];
  proposals: EvolutionProposal[];
  /** label proposals from the caller's workspace, for reviewers of the evaluation suite */
  labelProposals: LabelProposal[];
  /** whether the caller may approve, reject and roll back */
  canGovern: boolean;
}
