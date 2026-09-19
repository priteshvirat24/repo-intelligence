export type RepositoryStatus = 'PENDING' | 'CLONING' | 'ANALYZING' | 'INDEXING' | 'READY' | 'FAILED';
export interface Repository {
    id: string;
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
    errorMessage?: string | null;
    metadata?: Record<string, any>;
    createdAt: string;
    updatedAt: string;
}
export type KnowledgeObjectType = 'capability' | 'feature' | 'concept' | 'technique' | 'use_case' | 'component' | 'interface' | 'input' | 'output' | 'constraint' | 'limitation' | 'integration' | 'architecture' | 'repository_profile';
export type KnowledgeRelationshipType = 'is-a' | 'part-of' | 'depends-on' | 'extends' | 'complements' | 'overlaps-with' | 'alternative-to' | 'produces' | 'consumes' | 'enables';
export interface Evidence {
    id?: string;
    repositoryCapabilityId?: string;
    knowledgeObjectId?: string;
    filePath: string;
    startLine?: number | null;
    endLine?: number | null;
    symbolName?: string | null;
    quoteSnippet: string;
    evidenceType: 'doc' | 'code_ast' | 'manifest' | 'example' | 'inferred';
    isVerified: boolean;
    verificationNotes?: string;
    createdAt?: string;
}
export interface KnowledgeObject {
    id?: string;
    repositoryId?: string;
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
    importantFiles: Array<{
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
    repositoryId: string;
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
    repositoryId: string;
    repositoryName: string;
    owner: string;
    primaryLanguage: string | null;
    stars: number;
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
    relevanceExplanation?: string;
}
export interface ArchitectureNode {
    id: string;
    label: string;
    role: string;
    domain?: string;
}
export interface ArchitectureEdge {
    from: string;
    to: string;
    relationship: string;
    label?: string;
    boundary?: 'same-process' | 'library' | 'sdk' | 'http-service' | 'cli' | 'file-exchange' | 'database' | 'message-queue';
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
        citations?: Array<{
            repo: string;
            filePath: string;
            lines?: string;
            quote: string;
            symbolName?: string;
            verified: boolean;
        }>;
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
