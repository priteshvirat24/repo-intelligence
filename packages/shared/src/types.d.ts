export type RepositoryStatus = 'PENDING' | 'CLONING' | 'ANALYZING' | 'INDEXING' | 'READY' | 'FAILED';
export type ResourceType = 'github_repository' | 'web_page' | 'documentation_site' | 'article' | 'linkedin_post' | 'youtube_video' | 'pdf' | 'document' | 'research_paper' | 'generic_url';
export type ResourceRole = 'software_component' | 'library' | 'framework' | 'documentation' | 'tutorial' | 'reference' | 'research' | 'dataset' | 'article' | 'video' | 'opinion' | 'guide' | 'specification';
export type ResourceStatus = 'PENDING' | 'FETCHING' | 'ANALYZING' | 'INDEXING' | 'READY' | 'PARTIAL' | 'FAILED' | 'BLOCKED';
export type ResourceLocatorType = 'github_line' | 'web_section' | 'youtube_timestamp' | 'pdf_page' | 'linkedin_post' | 'metadata';
export type EvidenceStrength = 'DIRECT_IMPLEMENTATION' | 'DIRECT_INTERFACE' | 'DOCUMENTATION' | 'EXAMPLE' | 'INFERRED';
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
export type KnowledgeObjectType = 'capability' | 'feature' | 'concept' | 'technique' | 'use_case' | 'component' | 'interface' | 'input' | 'output' | 'constraint' | 'limitation' | 'integration' | 'architecture' | 'technical_insight' | 'repository_profile';
export type KnowledgeRelationshipType = 'is-a' | 'part-of' | 'depends-on' | 'extends' | 'complements' | 'overlaps-with' | 'alternative-to' | 'produces' | 'consumes' | 'enables' | 'explains' | 'references' | 'implements' | 'demonstrates' | 'contradicts' | 'supports' | 'related-to';
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
export interface OpenRequirement {
    name: string;
    description: string;
    type: RequirementType;
    criticality: RequirementCriticality;
    confidence: number;
    canonicalSlug?: string;
}
export interface OpenQueryRequirements {
    problemSummary: string;
    domains: string[];
    requirements: OpenRequirement[];
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
    boundary?: 'same-process' | 'library' | 'sdk' | 'http-service' | 'cli' | 'file-exchange' | 'database' | 'message-queue' | 'knowledge-reference' | 'tutorial-guide';
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
        overlapType: 'full' | 'partial' | 'complementary';
        recommendation: string;
    }>;
    dataFlow: Array<{
        producerRepo: string;
        output: string;
        consumerRepo: string;
        input: string;
        boundary: string;
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
