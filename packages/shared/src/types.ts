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
  | 'VERIFYING'
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
  byStage: Array<{ stage: 'understanding' | 'discovery' | 'verification' | 'blueprint'; calls: number; inputTokens: number; outputTokens: number }>;
}

export type TaskStatus = 'pending' | 'running' | 'waiting' | 'awaiting_input' | 'done' | 'failed' | 'stale' | 'cancelled';

export interface BriefTask {
  type: 'understand' | 'recall' | 'discover' | 'verify' | 'blueprint';
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
  limits: { llmCalls: number; tokens: number; githubRequests: number };
  used: { llmCalls: number; tokens: number; githubRequests: number };
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
