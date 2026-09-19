-- Seed Canonical Capabilities (Idempotent: ON CONFLICT (slug) DO UPDATE)
INSERT INTO capabilities (slug, name, category, description)
VALUES 
    -- Data Ingestion
    ('web-crawling', 'Web Crawling', 'Data Ingestion', 'High-throughput URL traversal, sitemap parsing, and asynchronous page fetching.'),
    ('headless-browser-automation', 'Headless Browser Automation', 'Data Ingestion', 'DOM interaction, JavaScript execution, screenshotting, and bypassing dynamic page barriers via Playwright/Puppeteer.'),
    ('pdf-table-extraction', 'PDF & Document Table Extraction', 'Data Ingestion', 'Structured parsing of PDFs, Word documents, and complex layout tables into markdown or structured JSON.'),
    ('rss-parsing', 'RSS & Feed Ingestion', 'Data Ingestion', 'Parsing and polling of Atom/RSS feeds and syndication streams.'),

    -- AI & Agents
    ('tool-calling', 'Tool & Function Calling', 'AI & Agents', 'Binding executable tools and JSON function schemas into LLM generation loops.'),
    ('multi-agent-orchestration', 'Multi-Agent Orchestration', 'AI & Agents', 'Coordinating autonomous agents via state machines, blackboard patterns, or hierarchical topologies.'),
    ('structured-llm-extraction', 'Structured LLM Extraction', 'AI & Agents', 'Constrained decoding and schema-validated JSON extraction from natural language using Pydantic/Zod.'),
    ('semantic-caching', 'Semantic LLM Caching', 'AI & Agents', 'Caching LLM outputs using vector similarity thresholding over prompt embeddings.'),

    -- Storage & Memory
    ('vector-indexing', 'Vector Indexing & Search', 'Storage & Memory', 'Storing and executing k-NN/ANN vector similarity queries with HNSW or IVFFlat indexes.'),
    ('session-memory', 'Session & Conversational Memory', 'Storage & Memory', 'Maintaining episodic, semantic, or working memory buffers across multi-turn user dialogues.'),
    ('graph-rag', 'Graph RAG & Knowledge Graphs', 'Storage & Memory', 'Constructing and querying entity-relationship knowledge graphs for hybrid graph-vector retrieval.'),
    ('kv-caching', 'Key-Value Caching', 'Storage & Memory', 'In-memory or distributed key-value storage for high-speed state management.'),

    -- Data Processing
    ('text-chunking', 'Text Chunking & Tokenization', 'Data Processing', 'Splitting documents by tokens, sentences, markdown headers, or recursive character boundaries.'),
    ('embedding-generation', 'Embedding Generation', 'Data Processing', 'Generating dense vector representations of text, images, or code via transformer models.'),
    ('markdown-conversion', 'HTML to Markdown Conversion', 'Data Processing', 'Cleaning raw HTML DOM trees into clean, LLM-optimized markdown representations.'),

    -- API & Protocols
    ('rest-api-server', 'REST API Server', 'API & Protocols', 'Exposing HTTP REST endpoints with OpenAPI documentation and route handlers.'),
    ('graphql-gateway', 'GraphQL Gateway', 'API & Protocols', 'Schema stitching, resolvers, and GraphQL query interfaces.'),
    ('sse-streaming', 'Server-Sent Events (SSE)', 'API & Protocols', 'Unidirectional real-time token streaming from server to client over HTTP.'),
    ('websocket-server', 'WebSocket Communication', 'API & Protocols', 'Bidirectional full-duplex communication channels over a single TCP connection.'),

    -- Observability
    ('opentelemetry-tracing', 'OpenTelemetry Tracing', 'Observability', 'Distributed tracing, latency attribution, and span metrics for LLM application calls.'),
    ('structured-logging', 'Structured Logging', 'Observability', 'JSON-formatted logging with contextual metadata, correlation IDs, and log levels.'),
    ('token-cost-tracking', 'Token & Cost Tracking', 'Observability', 'Tracking LLM prompt and completion token counts and estimating per-query operational costs.'),

    -- Security & Auth
    ('oauth2-client', 'OAuth2 Authentication', 'Security & Auth', 'Handling OAuth2 authorization flows, token exchanges, and refresh cycles.'),
    ('api-key-management', 'API Key Management', 'Security & Auth', 'Secure generation, hashing, rate limiting, and scoping of API keys.'),
    ('prompt-injection-sanitization', 'Prompt Injection Sanitization', 'Security & Auth', 'Guards, jailbreak detection, and input quarantine filters against malicious prompts.'),

    -- Execution
    ('sandbox-code-execution', 'Sandbox Code Execution', 'Execution', 'Isolated, secure runtime environments for executing untrusted user code (e.g. gVisor, Docker, WebAssembly).'),
    ('docker-orchestration', 'Docker Orchestration', 'Execution', 'Automating container lifecycle, volumes, network bridges, and compose clusters.'),
    ('cron-scheduling', 'Cron & Job Scheduling', 'Execution', 'Time-based recurring job dispatch and delayed task execution.')
ON CONFLICT (slug) DO UPDATE 
SET name = EXCLUDED.name,
    category = EXCLUDED.category,
    description = EXCLUDED.description;
