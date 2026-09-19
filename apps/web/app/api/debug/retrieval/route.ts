import { NextRequest, NextResponse } from 'next/server';
import { OpenProblemDecomposer } from '@/lib/ai/open_query';
import { MultiLevelHybridRetrievalEngine } from '@/lib/ai/multi_retrieval';
import { getLLMProvider, getEmbeddingProvider } from '@/lib/ai/providers';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q');

  if (!q || q.trim().length === 0) {
    return NextResponse.json({
      error: 'Query parameter `q` is required. Example: /api/debug/retrieval?q=ego-lite'
    }, { status: 400 });
  }

  const startTime = Date.now();

  try {
    const llm = getLLMProvider();
    const decomposer = new OpenProblemDecomposer(llm);
    const retrieval = new MultiLevelHybridRetrievalEngine(getEmbeddingProvider());

    const decomposeStart = Date.now();
    const requirements = await decomposer.decompose(q);
    const decomposeMs = Date.now() - decomposeStart;

    const retrievalStart = Date.now();
    const { candidates, chunks, knowledgeObjects, trace } = await retrieval.retrieve(requirements);
    const retrievalMs = Date.now() - retrievalStart;

    return NextResponse.json({
      query: q,
      timing: {
        totalMs: Date.now() - startTime,
        decomposeMs,
        retrievalMs
      },
      requirements,
      trace,
      candidates,
      retrievedChunks: chunks.map(c => ({
        repo: `${c.repoOwner}/${c.repoName}`,
        filePath: c.filePath,
        score: c.score,
        snippet: c.content.slice(0, 300)
      })),
      retrievedKnowledgeObjects: knowledgeObjects.map(ko => ({
        repo: `${ko.repoOwner}/${ko.repoName}`,
        objectType: ko.objectType,
        name: ko.name,
        category: ko.category,
        score: ko.score,
        description: ko.description
      }))
    });
  } catch (error: any) {
    return NextResponse.json({
      error: error.message || 'Debug retrieval execution failed'
    }, { status: 500 });
  }
}
