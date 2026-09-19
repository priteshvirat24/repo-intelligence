export interface CapabilityDefinition {
  slug: string;
  name: string;
  category: string;
  description: string;
}

export const CANONICAL_CAPABILITIES: CapabilityDefinition[] = [
  // Data Ingestion
  {
    slug: 'web-crawling',
    name: 'Web Crawling',
    category: 'Data Ingestion',
    description: 'High-throughput URL traversal, sitemap parsing, and asynchronous page fetching.'
  },
  {
    slug: 'headless-browser-automation',
    name: 'Headless Browser Automation',
    category: 'Data Ingestion',
    description: 'DOM interaction, JavaScript execution, screenshotting, and bypassing dynamic page barriers via Playwright/Puppeteer.'
  },
  {
    slug: 'pdf-table-extraction',
    name: 'PDF & Document Table Extraction',
    category: 'Data Ingestion',
    description: 'Structured parsing of PDFs, Word documents, and complex layout tables into markdown or structured JSON.'
  },
  {
    slug: 'rss-parsing',
    name: 'RSS & Feed Ingestion',
    category: 'Data Ingestion',
    description: 'Parsing and polling of Atom/RSS feeds and syndication streams.'
  },

  // AI & Agents
  {
    slug: 'tool-calling',
    name: 'Tool & Function Calling',
    category: 'AI & Agents',
    description: 'Binding executable tools and JSON function schemas into LLM generation loops.'
  },
  {
    slug: 'multi-agent-orchestration',
    name: 'Multi-Agent Orchestration',
    category: 'AI & Agents',
    description: 'Coordinating autonomous agents via state machines, blackboard patterns, or hierarchical topologies.'
  },
  {
    slug: 'structured-llm-extraction',
    name: 'Structured LLM Extraction',
    category: 'AI & Agents',
    description: 'Constrained decoding and schema-validated JSON extraction from natural language using Pydantic/Zod.'
  },
  {
    slug: 'semantic-caching',
    name: 'Semantic LLM Caching',
    category: 'AI & Agents',
    description: 'Caching LLM outputs using vector similarity thresholding over prompt embeddings.'
  },

  // Storage & Memory
  {
    slug: 'vector-indexing',
    name: 'Vector Indexing & Search',
    category: 'Storage & Memory',
    description: 'Storing and executing k-NN/ANN vector similarity queries with HNSW or IVFFlat indexes.'
  },
  {
    slug: 'session-memory',
    name: 'Session & Conversational Memory',
    category: 'Storage & Memory',
    description: 'Maintaining episodic, semantic, or working memory buffers across multi-turn user dialogues.'
  },
  {
    slug: 'graph-rag',
    name: 'Graph RAG & Knowledge Graphs',
    category: 'Storage & Memory',
    description: 'Constructing and querying entity-relationship knowledge graphs for hybrid graph-vector retrieval.'
  },
  {
    slug: 'kv-caching',
    name: 'Key-Value Caching',
    category: 'Storage & Memory',
    description: 'In-memory or distributed key-value storage for high-speed state management.'
  },

  // Data Processing
  {
    slug: 'text-chunking',
    name: 'Text Chunking & Tokenization',
    category: 'Data Processing',
    description: 'Splitting documents by tokens, sentences, markdown headers, or recursive character boundaries.'
  },
  {
    slug: 'embedding-generation',
    name: 'Embedding Generation',
    category: 'Data Processing',
    description: 'Generating dense vector representations of text, images, or code via transformer models.'
  },
  {
    slug: 'markdown-conversion',
    name: 'HTML to Markdown Conversion',
    category: 'Data Processing',
    description: 'Cleaning raw HTML DOM trees into clean, LLM-optimized markdown representations.'
  },

  // API & Protocols
  {
    slug: 'rest-api-server',
    name: 'REST API Server',
    category: 'API & Protocols',
    description: 'Exposing HTTP REST endpoints with OpenAPI documentation and route handlers.'
  },
  {
    slug: 'sse-streaming',
    name: 'Server-Sent Events (SSE)',
    category: 'API & Protocols',
    description: 'Unidirectional real-time token streaming from server to client over HTTP.'
  },
  {
    slug: 'websocket-server',
    name: 'WebSocket Communication',
    category: 'API & Protocols',
    description: 'Bidirectional full-duplex communication channels over a single TCP connection.'
  },

  // Observability & Security
  {
    slug: 'opentelemetry-tracing',
    name: 'OpenTelemetry Tracing',
    category: 'Observability',
    description: 'Distributed tracing, latency attribution, and span metrics for LLM application calls.'
  },
  {
    slug: 'prompt-injection-sanitization',
    name: 'Prompt Injection Sanitization',
    category: 'Security',
    description: 'Guards, jailbreak detection, and input quarantine filters against malicious prompts.'
  }
];
