import { OpenQueryRequirements, CandidateScore, KnowledgeObject, RetrievalTrace, ResourceType, ResourceRole } from '@repo/shared';
import { query } from '@repo/database';
import { EmbeddingProvider } from './providers';

export interface RetrievedChunk {
  chunkId: string;
  repositoryId: string;
  resourceId: string;
  resourceType: ResourceType;
  resourceTitle: string;
  repoOwner: string;
  repoName: string;
  sourceUrl?: string;
  content: string;
  filePath: string;
  score: number;
}

export interface RetrievedKnowledgeObject {
  id: string;
  repositoryId: string;
  resourceId: string;
  resourceType: ResourceType;
  resourceRole: ResourceRole;
  resourceTitle: string;
  repoOwner: string;
  repoName: string;
  sourceUrl?: string;
  objectType: string;
  name: string;
  description: string;
  category?: string;
  importance?: string;
  score: number;
}

export const GENERIC_TECH_WORDS = new Set([
  'ai', 'artificial', 'intelligence', 'system', 'systems', 'data', 'pipeline', 'pipelines',
  'framework', 'frameworks', 'automation', 'tool', 'tools', 'engine', 'engines', 'service',
  'services', 'app', 'apps', 'application', 'applications', 'code', 'platform', 'platforms',
  'software', 'library', 'libraries', 'solution', 'solutions', 'project', 'projects',
  'model', 'models', 'agent', 'agents', 'feature', 'features', 'fast', 'simple', 'best',
  'smart', 'intelligent', 'build', 'using', 'based', 'with', 'from', 'into', 'over', 'open',
  'source', 'github', 'repo', 'repository', 'repositories', 'implementation', 'module',
  'modules', 'interface', 'interfaces', 'helper', 'helpers', 'utils', 'utilities',
  'modern', 'lightweight', 'flexible', 'advanced', 'easy', 'powerful', 'high', 'performance',
  'resource', 'resources', 'content', 'overview', 'guide', 'tutorial', 'document', 'page'
]);

export class MultiLevelHybridRetrievalEngine {
  constructor(private embeddingProvider: EmbeddingProvider) {}

  async retrieve(requirements: OpenQueryRequirements): Promise<{
    candidates: CandidateScore[];
    chunks: RetrievedChunk[];
    knowledgeObjects: RetrievedKnowledgeObject[];
    rawObjectsByRepo: Map<string, KnowledgeObject[]>;
    trace: RetrievalTrace;
  }> {
    const rawTokens = [
      requirements.problemSummary,
      ...requirements.requirements.map(r => r.name),
      ...requirements.queryExpansions
    ].join(' ').split(/[\s,;:!?()\[\]{}"]+/).filter(Boolean);

    // Suppress generic noise words while extracting distinctive domain/technical terms
    const suppressedGenericWords: string[] = [];
    const distinctiveTokens: string[] = [];
    const seenDistinctive = new Set<string>();

    for (const rawToken of rawTokens) {
      const lower = rawToken.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');
      if (!lower || lower.length < 2) continue;

      if (GENERIC_TECH_WORDS.has(lower)) {
        if (!suppressedGenericWords.includes(lower)) {
          suppressedGenericWords.push(lower);
        }
      } else if (lower.length >= 3 && !seenDistinctive.has(lower)) {
        seenDistinctive.add(lower);
        distinctiveTokens.push(lower);
      }
    }

    // FTS query prioritized by distinctive technical terms; fallback to full clean text
    const ftsSearchText = distinctiveTokens.length > 0
      ? distinctiveTokens.slice(0, 20).join(' ')
      : requirements.problemSummary.replace(/[^a-zA-Z0-9\s-]/g, ' ').trim();

    const vectorSearchText = [
      requirements.problemSummary,
      distinctiveTokens.slice(0, 10).join(' ')
    ].join(' ').trim();

    // 1. Generate query embedding for dense retrieval
    let queryEmbedding: number[] = [];
    try {
      queryEmbedding = await this.embeddingProvider.embedQuery(vectorSearchText);
    } catch (e) {
      console.warn('Embedding generation warning:', e);
    }

    const hasEmbedding = queryEmbedding.length > 0;
    const embStr = hasEmbedding ? `[${queryEmbedding.join(',')}]` : null;

    const ilikePatterns = [
      ...requirements.requirements.map(r => `%${r.name.slice(0, 20)}%`),
      ...distinctiveTokens.slice(0, 10).map(t => `%${t}%`)
    ];

    // 2. Query Knowledge Objects across all Universal Resources (GitHub, Web, YouTube, LinkedIn, PDF)
    let koRows: any[] = [];
    try {
      if (hasEmbedding) {
        const koRes = await query(`
          SELECT 
            ko.id,
            COALESCE(ko.resource_id, ko.repository_id) as resource_id,
            res.resource_type,
            res.resource_role,
            res.title as resource_title,
            res.source_url,
            COALESCE(r.owner, res.author, res.source_domain) as owner,
            COALESCE(r.name, res.title) as repo_name,
            r.primary_language,
            COALESCE(r.stars, 0) as stars,
            res.domain_tags,
            res.problems_solved,
            res.practical_uses,
            ko.object_type,
            ko.name,
            ko.description,
            ko.category,
            ko.importance,
            ko.confidence,
            ko.metadata_json,
            CASE 
              WHEN ko.embedding IS NOT NULL THEN 1.0 - (ko.embedding <=> $1::vector)
              ELSE 0.5
            END as vector_sim,
            ts_rank_cd(ko.tsv_content, plainto_tsquery('english', $2)) as text_rank
          FROM knowledge_objects ko
          JOIN resources res ON (ko.resource_id = res.id OR ko.repository_id = res.id)
          LEFT JOIN repositories r ON (r.resource_id = res.id OR r.id = res.id)
          WHERE res.status = 'READY'
            AND (
              (ko.embedding IS NOT NULL AND 1.0 - (ko.embedding <=> $1::vector) > 0.40)
              OR ko.tsv_content @@ plainto_tsquery('english', $2)
              OR ko.name ILIKE ANY($3::text[])
              OR res.title ILIKE ANY($3::text[])
            )
          ORDER BY vector_sim DESC, text_rank DESC
          LIMIT 60;
        `, [embStr, ftsSearchText, ilikePatterns]);
        koRows = koRes.rows;
      } else {
        const koRes = await query(`
          SELECT 
            ko.id,
            COALESCE(ko.resource_id, ko.repository_id) as resource_id,
            res.resource_type,
            res.resource_role,
            res.title as resource_title,
            res.source_url,
            COALESCE(r.owner, res.author, res.source_domain) as owner,
            COALESCE(r.name, res.title) as repo_name,
            r.primary_language,
            COALESCE(r.stars, 0) as stars,
            res.domain_tags,
            res.problems_solved,
            res.practical_uses,
            ko.object_type,
            ko.name,
            ko.description,
            ko.category,
            ko.importance,
            ko.confidence,
            ko.metadata_json,
            0.6 as vector_sim,
            ts_rank_cd(ko.tsv_content, plainto_tsquery('english', $1)) as text_rank
          FROM knowledge_objects ko
          JOIN resources res ON (ko.resource_id = res.id OR ko.repository_id = res.id)
          LEFT JOIN repositories r ON (r.resource_id = res.id OR r.id = res.id)
          WHERE res.status = 'READY'
            AND (
              ko.tsv_content @@ plainto_tsquery('english', $1)
              OR ko.name ILIKE ANY($2::text[])
              OR res.title ILIKE ANY($2::text[])
            )
          ORDER BY text_rank DESC
          LIMIT 40;
        `, [ftsSearchText, ilikePatterns]);
        koRows = koRes.rows;
      }
    } catch (err) {
      console.warn('Knowledge objects query fallback:', err);
      const fallbackRes = await query(`
        SELECT 
          ko.id,
          COALESCE(ko.resource_id, ko.repository_id) as resource_id,
          res.resource_type,
          res.resource_role,
          res.title as resource_title,
          res.source_url,
          COALESCE(r.owner, res.author, res.source_domain) as owner,
          COALESCE(r.name, res.title) as repo_name,
          r.primary_language,
          COALESCE(r.stars, 0) as stars,
          res.domain_tags,
          res.problems_solved,
          res.practical_uses,
          ko.object_type,
          ko.name,
          ko.description,
          ko.category,
          ko.importance,
          ko.confidence,
          ko.metadata_json,
          0.6 as vector_sim,
          0.5 as text_rank
        FROM knowledge_objects ko
        JOIN resources res ON (ko.resource_id = res.id OR ko.repository_id = res.id)
        LEFT JOIN repositories r ON (r.resource_id = res.id OR r.id = res.id)
        WHERE res.status = 'READY'
        LIMIT 30;
      `);
      koRows = fallbackRes.rows;
    }

    // 3. Query Code, Transcript, and Document Chunks
    let chunkRows: any[] = [];
    try {
      if (hasEmbedding) {
        const chunkRes = await query(`
          SELECT 
            c.id as chunk_id,
            COALESCE(c.resource_id, c.repository_id) as resource_id,
            res.resource_type,
            res.title as resource_title,
            res.source_url,
            COALESCE(r.owner, res.author, res.source_domain) as owner,
            COALESCE(r.name, res.title) as repo_name,
            d.file_path,
            c.content,
            1.0 - (c.embedding <=> $1::vector) as vector_sim,
            ts_rank_cd(c.tsv_content, plainto_tsquery('english', $2)) as text_rank
          FROM chunks c
          JOIN resources res ON (c.resource_id = res.id OR c.repository_id = res.id)
          LEFT JOIN repositories r ON (r.resource_id = res.id OR r.id = res.id)
          JOIN documents d ON c.document_id = d.id
          WHERE res.status = 'READY'
            AND (
              (c.embedding IS NOT NULL AND 1.0 - (c.embedding <=> $1::vector) > 0.40)
              OR c.tsv_content @@ plainto_tsquery('english', $2)
            )
          ORDER BY vector_sim DESC, text_rank DESC
          LIMIT 30;
        `, [embStr, ftsSearchText]);
        chunkRows = chunkRes.rows;
      } else {
        const chunkRes = await query(`
          SELECT 
            c.id as chunk_id,
            COALESCE(c.resource_id, c.repository_id) as resource_id,
            res.resource_type,
            res.title as resource_title,
            res.source_url,
            COALESCE(r.owner, res.author, res.source_domain) as owner,
            COALESCE(r.name, res.title) as repo_name,
            d.file_path,
            c.content,
            0.6 as vector_sim,
            ts_rank_cd(c.tsv_content, plainto_tsquery('english', $1)) as text_rank
          FROM chunks c
          JOIN resources res ON (c.resource_id = res.id OR c.repository_id = res.id)
          LEFT JOIN repositories r ON (r.resource_id = res.id OR r.id = res.id)
          JOIN documents d ON c.document_id = d.id
          WHERE res.status = 'READY'
          ORDER BY text_rank DESC
          LIMIT 20;
        `, [ftsSearchText]);
        chunkRows = chunkRes.rows;
      }
    } catch {
      chunkRows = [];
    }

    // Apply anti-clustering on chunks (max 3 per resource)
    const chunks: RetrievedChunk[] = [];
    const resourceChunkCount = new Map<string, number>();
    for (const row of chunkRows) {
      const resId = row.resource_id;
      const count = resourceChunkCount.get(resId) || 0;
      if (count < 3) {
        chunks.push({
          chunkId: row.chunk_id,
          repositoryId: resId,
          resourceId: resId,
          resourceType: row.resource_type || 'generic_url',
          resourceTitle: row.resource_title || row.repo_name,
          repoOwner: row.owner,
          repoName: row.repo_name,
          sourceUrl: row.source_url,
          content: row.content,
          filePath: row.file_path,
          score: Math.max(parseFloat(row.vector_sim || '0.5'), parseFloat(row.text_rank || '0.5'))
        });
        resourceChunkCount.set(resId, count + 1);
      }
    }

    // 4. Organize Knowledge Objects by Resource & Anti-Clustering (max 6 per resource)
    const rawObjectsByRepo = new Map<string, KnowledgeObject[]>();
    const knowledgeObjects: RetrievedKnowledgeObject[] = [];
    const resourceKoCount = new Map<string, number>();

    const resourceAggregates = new Map<string, {
      resourceId: string;
      resourceType: ResourceType;
      resourceRole: ResourceRole;
      sourceUrl: string;
      owner: string;
      repoName: string;
      primaryLanguage: string | null;
      stars: number;
      domainTags: string[];
      problemsSolved: string[];
      practicalUses: string[];
      maxVectorSim: number;
      maxTextRank: number;
      matchedCapabilities: Set<string>;
      matchedConcepts: Set<string>;
    }>();

    for (const row of koRows) {
      const resId = row.resource_id;

      // Group raw objects
      if (!rawObjectsByRepo.has(resId)) {
        rawObjectsByRepo.set(resId, []);
      }
      rawObjectsByRepo.get(resId)!.push({
        id: row.id,
        repositoryId: resId,
        resourceId: resId,
        sourceType: row.resource_type,
        objectType: row.object_type,
        name: row.name,
        description: row.description,
        category: row.category,
        importance: row.importance,
        confidence: parseFloat(row.confidence || '0.9')
      });

      // Aggregate candidate stats
      if (!resourceAggregates.has(resId)) {
        resourceAggregates.set(resId, {
          resourceId: resId,
          resourceType: row.resource_type || 'generic_url',
          resourceRole: row.resource_role || 'reference',
          sourceUrl: row.source_url,
          owner: row.owner,
          repoName: row.repo_name,
          primaryLanguage: row.primary_language,
          stars: row.stars || 0,
          domainTags: row.domain_tags || [],
          problemsSolved: row.problems_solved || [],
          practicalUses: row.practical_uses || [],
          maxVectorSim: 0,
          maxTextRank: 0,
          matchedCapabilities: new Set(),
          matchedConcepts: new Set()
        });
      }

      const agg = resourceAggregates.get(resId)!;
      const vSim = parseFloat(row.vector_sim || '0.5');
      const tRank = parseFloat(row.text_rank || '0.5');
      if (vSim > agg.maxVectorSim) agg.maxVectorSim = vSim;
      if (tRank > agg.maxTextRank) agg.maxTextRank = tRank;

      if (row.object_type === 'capability') {
        agg.matchedCapabilities.add(row.name);
      } else if (['concept', 'technique', 'feature'].includes(row.object_type)) {
        agg.matchedConcepts.add(row.name);
      }

      // Anti-clustering on retrieved KO list
      const koCount = resourceKoCount.get(resId) || 0;
      if (koCount < 6) {
        knowledgeObjects.push({
          id: row.id,
          repositoryId: resId,
          resourceId: resId,
          resourceType: row.resource_type || 'generic_url',
          resourceRole: row.resource_role || 'reference',
          resourceTitle: row.resource_title || row.repo_name,
          repoOwner: row.owner,
          repoName: row.repo_name,
          sourceUrl: row.source_url,
          objectType: row.object_type,
          name: row.name,
          description: row.description,
          category: row.category,
          importance: row.importance,
          score: Math.max(vSim, tRank)
        });
        resourceKoCount.set(resId, koCount + 1);
      }
    }

    // 5. Score and Rank Candidate Resources
    const candidates: CandidateScore[] = [];

    for (const [resId, agg] of resourceAggregates.entries()) {
      let matchedCount = 0;
      const matchedCapsList: string[] = Array.from(agg.matchedCapabilities);
      const matchedConceptsList: string[] = Array.from(agg.matchedConcepts);

      for (const req of requirements.requirements) {
        const reqLower = req.name.toLowerCase();
        const hasDirectMatch = matchedCapsList.some(c =>
          c.toLowerCase().includes(reqLower) || reqLower.includes(c.toLowerCase())
        );
        const hasConceptMatch = matchedConceptsList.some(c =>
          c.toLowerCase().includes(reqLower) || reqLower.includes(c.toLowerCase())
        );

        if (hasDirectMatch) {
          matchedCount += req.criticality === 'MUST' ? 2 : 1;
        } else if (hasConceptMatch) {
          matchedCount += req.criticality === 'MUST' ? 1 : 0.5;
        }
      }

      const totalReqWeight = requirements.requirements.reduce(
        (sum, r) => sum + (r.criticality === 'MUST' ? 2 : 1), 0
      ) || 1;

      const capabilityCoverageScore = Math.min(1.0, matchedCount / totalReqWeight);

      // Distinctive domain term boost
      let distinctiveTermBoost = 0;
      if (distinctiveTokens.length > 0) {
        const nameAndDomain = `${agg.repoName} ${agg.owner} ${agg.domainTags.join(' ')} ${agg.problemsSolved.join(' ')}`.toLowerCase();
        const matchingTokens = distinctiveTokens.filter(token => nameAndDomain.includes(token));
        if (matchingTokens.length > 0) {
          distinctiveTermBoost = Math.min(0.40, matchingTokens.length * 0.15);
        }
      }

      // Maturity score (stars for repos, verified status for media)
      const maturityScore = agg.stars > 0
        ? Math.min(1.0, Math.log10(agg.stars + 1) / 4.0)
        : 0.8;

      const finalScore = (
        0.30 * agg.maxVectorSim +
        0.20 * Math.min(1.0, agg.maxTextRank * 2) +
        0.30 * capabilityCoverageScore +
        0.10 * maturityScore +
        distinctiveTermBoost
      );

      candidates.push({
        repositoryId: resId,
        resourceId: resId,
        resourceType: agg.resourceType,
        resourceRole: agg.resourceRole,
        repositoryName: agg.repoName,
        owner: agg.owner,
        sourceUrl: agg.sourceUrl,
        primaryLanguage: agg.primaryLanguage,
        stars: agg.stars,
        domainTags: agg.domainTags,
        problemsSolved: agg.problemsSolved,
        practicalUses: agg.practicalUses,
        vectorSimilarity: agg.maxVectorSim,
        fullTextRank: agg.maxTextRank,
        capabilityCoverageScore,
        maturityScore,
        complexityPenalty: 0.0,
        conflictPenalty: 0.0,
        distinctiveTermBoost,
        finalScore,
        matchedCapabilities: matchedCapsList,
        matchedConcepts: matchedConceptsList,
        relevanceExplanation: `Matches ${matchedCapsList.length} capabilities and ${matchedConceptsList.length} concepts.`
      });
    }

    candidates.sort((a, b) => b.finalScore - a.finalScore);

    const topCandidates = candidates.slice(0, 5);

    const trace: RetrievalTrace = {
      queryText: requirements.problemSummary,
      hasEmbedding,
      suppressedGenericWords,
      distinctiveTokens,
      rawKnowledgeObjectsCount: koRows.length,
      rawChunksCount: chunkRows.length,
      candidatesScored: candidates.length,
      topCandidateNames: topCandidates.map(c => `${c.owner}/${c.repositoryName}`)
    };

    return {
      candidates: topCandidates,
      chunks,
      knowledgeObjects,
      rawObjectsByRepo,
      trace
    };
  }
}
