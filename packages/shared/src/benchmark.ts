export interface TestCase {
  id: string;
  query: string;
  expectedRepositories: string[]; // e.g. ["crawl4ai"] or ["crawl4ai", "mem0"]
  expectedCapabilities: string[];
  redundancyExpectations?: {
    flaggedRepos: string[];
    reason: string;
  };
  negativeAssertions: {
    forbiddenRepositories: string[];
    forbiddenCapabilities: string[];
  };
  evaluationCriteria: string;
}

export const EVALUATION_BENCHMARK: TestCase[] = [
  {
    id: 'TC-01',
    query: 'We need low-latency headless browser crawling and web extraction for our research bot.',
    expectedRepositories: ['crawl4ai'],
    expectedCapabilities: ['headless-browser-automation', 'web-crawling'],
    negativeAssertions: {
      forbiddenRepositories: ['requests', 'httpx'],
      forbiddenCapabilities: ['session-memory']
    },
    evaluationCriteria: 'System must identify headless browser automation capabilities and retrieve crawl4ai as top-ranked candidate.'
  },
  {
    id: 'TC-02',
    query: 'We need persistent conversational memory and episodic retrieval for an AI agent.',
    expectedRepositories: ['mem0'],
    expectedCapabilities: ['session-memory', 'vector-indexing'],
    negativeAssertions: {
      forbiddenRepositories: ['crawl4ai'],
      forbiddenCapabilities: ['web-crawling']
    },
    evaluationCriteria: 'System must prioritize memory and vector indexing over web extraction tools.'
  },
  {
    id: 'TC-03',
    query: 'We want to combine browser automation with long-term user memory without redundant framework bloat.',
    expectedRepositories: ['crawl4ai', 'mem0'],
    expectedCapabilities: ['headless-browser-automation', 'session-memory'],
    redundancyExpectations: {
      flaggedRepos: ['langchain'],
      reason: 'LangChain provides redundant abstraction layer over direct crawl4ai and mem0 integration.'
    },
    negativeAssertions: {
      forbiddenRepositories: [],
      forbiddenCapabilities: ['pdf-table-extraction']
    },
    evaluationCriteria: 'System must synthesize multi-repo composition (Crawl4AI + Mem0) while auditing and warning against redundant orchestrators.'
  },
  {
    id: 'TC-04',
    query: 'Extract complex tables and structured schemas from financial PDF reports.',
    expectedRepositories: ['docling', 'marker'],
    expectedCapabilities: ['pdf-table-extraction', 'structured-llm-extraction'],
    negativeAssertions: {
      forbiddenRepositories: ['mem0'],
      forbiddenCapabilities: ['headless-browser-automation']
    },
    evaluationCriteria: 'System must identify document layout analysis and structured extraction capabilities.'
  }
];
