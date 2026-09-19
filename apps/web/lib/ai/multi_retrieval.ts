import { OpenQueryRequirements, CandidateScore, KnowledgeObject, RetrievalTrace } from '@repo/shared';
import { query } from '@repo/database';
import { EmbeddingProvider } from './providers';

export interface RetrievedChunk {
  chunkId: string;
  repositoryId: string;
  repoOwner: string;
  repoName: string;
  content: string;
  filePath: string;
  score: number;
}

export interface RetrievedKnowledgeObject {
  id: string;
  repositoryId: string;
  repoOwner: string;
  repoName: string;
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
  'modern', 'lightweight', 'flexible', 'advanced', 'easy', 'powerful', 'high', 'performance'
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

    // 2. Query Knowledge Objects across all tiers (Capabilities, Features, Concepts, Techniques, Use Cases, Interfaces, Inputs, Outputs)
    let koRows: any[] = [];
    try {
      if (hasEmbedding) {
        const koRes = await query(`
          SELECT 
            ko.id,
            ko.repository_id,
            r.owner,
            r.name as repo_name,
            r.primary_language,
            r.stars,
            r.domain_tags,
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
          JOIN repositories r ON ko.repository_id = r.id
          WHERE r.status = 'READY'
            AND (
              (ko.embedding IS NOT NULL AND 1.0 - (ko.embedding <=> $1::vector) > 0.45)
              OR ko.tsv_content @@ plainto_tsquery('english', $2)
              OR ko.name ILIKE ANY($3::text[])
            )
          ORDER BY vector_sim DESC, text_rank DESC
          LIMIT 60;
        `, [embStr, ftsSearchText, ilikePatterns]);
        koRows = koRes.rows;
      } else {
        const koRes = await query(`
          SELECT 
            ko.id,
            ko.repository_id,
            r.owner,
            r.name as repo_name,
            r.primary_language,
            r.stars,
            r.domain_tags,
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
          JOIN repositories r ON ko.repository_id = r.id
          WHERE r.status = 'READY'
            AND (
              ko.tsv_content @@ plainto_tsquery('english', $1)
              OR ko.name ILIKE ANY($2::text[])
            )
          ORDER BY text_rank DESC
          LIMIT 40;
        `, [ftsSearchText, ilikePatterns]);
        koRows = koRes.rows;
      }
    } catch (err) {
      console.warn('Knowledge objects query fallback:', err);
      // Basic fallback
      const fallbackRes = await query(`
        SELECT 
          ko.id,
          ko.repository_id,
          r.owner,
          r.name as repo_name,
          r.primary_language,
          r.stars,
          r.domain_tags,
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
        JOIN repositories r ON ko.repository_id = r.id
        WHERE r.status = 'READY'
        LIMIT 30;
      `);
      koRows = fallbackRes.rows;
    }

    // 3. Query Code & Doc Chunks with Anti-Clustering (max 3 per repository)
    let chunkRows: any[] = [];
    try {
      if (hasEmbedding) {
        const chunkRes = await query(`
          SELECT 
            c.id as chunk_id,
            c.repository_id,
            r.owner,
            r.name as repo_name,
            d.file_path,
            c.content,
            1.0 - (c.embedding <=> $1::vector) as vector_sim,
            ts_rank_cd(c.tsv_content, plainto_tsquery('english', $2)) as text_rank
          FROM chunks c
          JOIN repositories r ON c.repository_id = r.id
          JOIN documents d ON c.document_id = d.id
          WHERE r.status = 'READY'
            AND (
              (c.embedding IS NOT NULL AND 1.0 - (c.embedding <=> $1::vector) > 0.45)
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
            c.repository_id,
            r.owner,
            r.name as repo_name,
            d.file_path,
            c.content,
            0.6 as vector_sim,
            ts_rank_cd(c.tsv_content, plainto_tsquery('english', $1)) as text_rank
          FROM chunks c
          JOIN repositories r ON c.repository_id = r.id
          JOIN documents d ON c.document_id = d.id
          WHERE r.status = 'READY'
          ORDER BY text_rank DESC
          LIMIT 20;
        `, [ftsSearchText]);
        chunkRows = chunkRes.rows;
      }
    } catch {
      chunkRows = [];
    }

    // Apply anti-clustering on chunks (max 3 per repository)
    const chunks: RetrievedChunk[] = [];
    const repoChunkCount = new Map<string, number>();
    for (const row of chunkRows) {
      const count = repoChunkCount.get(row.repository_id) || 0;
      if (count < 3) {
        chunks.push({
          chunkId: row.chunk_id,
          repositoryId: row.repository_id,
          repoOwner: row.owner,
          repoName: row.repo_name,
          content: row.content,
          filePath: row.file_path,
          score: Math.max(parseFloat(row.vector_sim || '0.5'), parseFloat(row.text_rank || '0.5'))
        });
        repoChunkCount.set(row.repository_id, count + 1);
      }
    }

    // 4. Organize Knowledge Objects by Repository & Anti-Clustering (max 6 per repo)
    const rawObjectsByRepo = new Map<string, KnowledgeObject[]>();
    const knowledgeObjects: RetrievedKnowledgeObject[] = [];
    const repoKoCount = new Map<string, number>();

    const repoAggregates = new Map<string, {
      repositoryId: string;
      owner: string;
      repoName: string;
      primaryLanguage: string | null;
      stars: number;
      domainTags: string[];
      maxVectorSim: number;
      maxTextRank: number;
      matchedCapabilities: Set<string>;
      matchedConcepts: Set<string>;
    }>();

    for (const row of koRows) {
      const repoId = row.repository_id;

      // Group raw objects
      if (!rawObjectsByRepo.has(repoId)) {
        rawObjectsByRepo.set(repoId, []);
      }
      rawObjectsByRepo.get(repoId)!.push({
        id: row.id,
        repositoryId: repoId,
        objectType: row.object_type,
        name: row.name,
        description: row.description,
        category: row.category,
        importance: row.importance,
        confidence: parseFloat(row.confidence || '0.9')
      });

      // Aggregate candidate stats
      if (!repoAggregates.has(repoId)) {
        repoAggregates.set(repoId, {
          repositoryId: repoId,
          owner: row.owner,
          repoName: row.repo_name,
          primaryLanguage: row.primary_language,
          stars: row.stars || 0,
          domainTags: row.domain_tags || [],
          maxVectorSim: 0,
          maxTextRank: 0,
          matchedCapabilities: new Set(),
          matchedConcepts: new Set()
        });
      }

      const agg = repoAggregates.get(repoId)!;
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
      const koCount = repoKoCount.get(repoId) || 0;
      if (koCount < 6) {
        knowledgeObjects.push({
          id: row.id,
          repositoryId: repoId,
          repoOwner: row.owner,
          repoName: row.repo_name,
          objectType: row.object_type,
          name: row.name,
          description: row.description,
          category: row.category,
          importance: row.importance,
          score: Math.max(vSim, tRank)
        });
        repoKoCount.set(repoId, koCount + 1);
      }
    }

    // 5. Score and Rank Candidate Repositories
    const candidates: CandidateScore[] = [];
    const mustRequirements = requirements.requirements.filter(r => r.criticality === 'MUST');
    const mustCount = Math.max(1, mustRequirements.length);

    for (const agg of repoAggregates.values()) {
      // Calculate requirement coverage
      let matchedMustCount = 0;
      for (const req of mustRequirements) {
        const reqWords = req.name.toLowerCase().split(/\s+/);
        const hasMatch = Array.from(agg.matchedCapabilities).some(cap => {
          const capLower = cap.toLowerCase();
          return reqWords.some(w => w.length > 3 && capLower.includes(w));
        }) || Array.from(agg.matchedConcepts).some(conc => {
          const concLower = conc.toLowerCase();
          return reqWords.some(w => w.length > 3 && concLower.includes(w));
        });

        if (hasMatch) matchedMustCount++;
      }

      const capCoverageScore = matchedMustCount / mustCount;
      const maturityScore = Math.min(1.0, Math.log10(Math.max(10, agg.stars)) / 5.0);

      const vectorSim = agg.maxVectorSim > 0 ? agg.maxVectorSim : 0.7;
      const fullTextRank = agg.maxTextRank > 0 ? agg.maxTextRank : 0.5;

      // Distinctive token boost calculation
      let distinctiveMatches = 0;
      if (distinctiveTokens.length > 0) {
        const repoNameLower = agg.repoName.toLowerCase();
        const ownerLower = agg.owner.toLowerCase();
        const capsCombined = Array.from(agg.matchedCapabilities).join(' ').toLowerCase();
        const conceptsCombined = Array.from(agg.matchedConcepts).join(' ').toLowerCase();

        for (const token of distinctiveTokens) {
          if (repoNameLower.includes(token) || ownerLower.includes(token)) {
            distinctiveMatches += 2;
          } else if (capsCombined.includes(token) || conceptsCombined.includes(token)) {
            distinctiveMatches += 1;
          }
        }
      }
      const distinctiveTermBoost = Math.min(0.35, distinctiveMatches * 0.08);

      const baseScore = Math.max(
        0,
        0.40 * capCoverageScore +
        0.30 * vectorSim +
        0.15 * fullTextRank +
        0.15 * maturityScore
      );
      const finalScore = Math.min(1.0, baseScore + distinctiveTermBoost);

      candidates.push({
        repositoryId: agg.repositoryId,
        repositoryName: agg.repoName,
        owner: agg.owner,
        primaryLanguage: agg.primaryLanguage,
        stars: agg.stars,
        domainTags: agg.domainTags,
        vectorSimilarity: Math.round(vectorSim * 100) / 100,
        fullTextRank: Math.round(fullTextRank * 100) / 100,
        capabilityCoverageScore: Math.round(capCoverageScore * 100) / 100,
        maturityScore: Math.round(maturityScore * 100) / 100,
        distinctiveTermBoost: Math.round(distinctiveTermBoost * 100) / 100,
        complexityPenalty: 0,
        conflictPenalty: 0,
        finalScore: Math.round(finalScore * 100) / 100,
        matchedCapabilities: Array.from(agg.matchedCapabilities),
        matchedConcepts: Array.from(agg.matchedConcepts)
      });
    }

    // Sort descending by finalScore
    candidates.sort((a, b) => b.finalScore - a.finalScore);

    const trace: RetrievalTrace = {
      queryText: ftsSearchText,
      hasEmbedding,
      suppressedGenericWords,
      distinctiveTokens,
      rawKnowledgeObjectsCount: koRows.length,
      rawChunksCount: chunkRows.length,
      candidatesScored: candidates.length,
      topCandidateNames: candidates.slice(0, 5).map(c => `${c.owner}/${c.repositoryName}`)
    };

    return {
      candidates,
      chunks,
      knowledgeObjects,
      rawObjectsByRepo,
      trace
    };
  }
}
