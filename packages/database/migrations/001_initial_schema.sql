-- Enable UUID and full text trigram extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Safely try to enable pgvector
DO $$ 
BEGIN
    CREATE EXTENSION IF NOT EXISTS "vector";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pgvector extension not installed in this Postgres environment, creating fallback domain';
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
        CREATE DOMAIN vector AS real[];
    END IF;
END $$;

-- 1. Repositories Table
CREATE TABLE IF NOT EXISTS repositories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner VARCHAR(100) NOT NULL,
    name VARCHAR(100) NOT NULL,
    url TEXT UNIQUE NOT NULL,
    description TEXT,
    default_branch VARCHAR(100) DEFAULT 'main',
    latest_commit_hash VARCHAR(40),
    license VARCHAR(50),
    stars INTEGER DEFAULT 0,
    primary_language VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    -- Status: PENDING, CLONING, ANALYZING, INDEXING, READY, FAILED
    error_message TEXT,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_owner_repo UNIQUE (owner, name)
);

CREATE INDEX IF NOT EXISTS idx_repositories_status ON repositories(status);
CREATE INDEX IF NOT EXISTS idx_repositories_owner_name ON repositories(owner, name);

-- 2. Canonical Capabilities Dictionary
CREATE TABLE IF NOT EXISTS capabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug VARCHAR(100) UNIQUE NOT NULL,
    name VARCHAR(150) NOT NULL,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_capabilities_category ON capabilities(category);
CREATE INDEX IF NOT EXISTS idx_capabilities_slug ON capabilities(slug);

-- 3. Repository Capabilities (Relationship with confidence & notes)
CREATE TABLE IF NOT EXISTS repository_capabilities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    capability_id UUID NOT NULL REFERENCES capabilities(id) ON DELETE CASCADE,
    confidence NUMERIC(3, 2) NOT NULL CHECK (confidence >= 0.0 AND confidence <= 1.0),
    implementation_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_repo_capability UNIQUE (repository_id, capability_id)
);

CREATE INDEX IF NOT EXISTS idx_repo_caps_repo ON repository_capabilities(repository_id);
CREATE INDEX IF NOT EXISTS idx_repo_caps_cap ON repository_capabilities(capability_id);

-- 4. Evidence Supporting Claims
CREATE TABLE IF NOT EXISTS evidence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_capability_id UUID NOT NULL REFERENCES repository_capabilities(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    symbol_name VARCHAR(150),
    quote_snippet TEXT NOT NULL,
    evidence_type VARCHAR(30) NOT NULL, -- 'doc', 'code_ast', 'manifest', 'example'
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evidence_repo_cap ON evidence(repository_capability_id);

-- 5. Documents & Chunk Storage
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    doc_type VARCHAR(30) NOT NULL, -- 'readme', 'doc', 'code', 'config'
    language VARCHAR(50),
    token_count INTEGER NOT NULL,
    content_hash VARCHAR(64), -- SHA-256 hash of file content for incremental caching
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_repo_file UNIQUE (repository_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_documents_repo ON documents(repository_id);
CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(repository_id, content_hash);

CREATE TABLE IF NOT EXISTS chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    chunk_hash VARCHAR(64), -- SHA-256 hash of chunk content for embedding reuse
    embedding vector({{EMBEDDING_DIMENSIONS}}),
    tsv_content tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chunks_repo ON chunks(repository_id);
CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_tsv ON chunks USING gin (tsv_content);

-- Conditionally create HNSW index if pgvector extension is active
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        BEGIN
            CREATE INDEX IF NOT EXISTS idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not create HNSW index, skipping: %', SQLERRM;
        END;
    END IF;
END $$;

-- 6. Dependencies & Limitations
CREATE TABLE IF NOT EXISTS repository_dependencies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    package_name VARCHAR(150) NOT NULL,
    ecosystem VARCHAR(50) NOT NULL, -- 'npm', 'pypi', 'go', 'cargo', 'other'
    version_spec VARCHAR(50),
    is_runtime BOOLEAN DEFAULT TRUE,
    is_heavyweight BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dependencies_repo ON repository_dependencies(repository_id);
CREATE INDEX IF NOT EXISTS idx_dependencies_pkg ON repository_dependencies(package_name);

CREATE TABLE IF NOT EXISTS repository_limitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    description TEXT NOT NULL,
    file_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_limitations_repo ON repository_limitations(repository_id);

-- 7. Ingestion Jobs Queue (PostgreSQL-native queue with FOR UPDATE SKIP LOCKED)
CREATE TABLE IF NOT EXISTS ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'QUEUED', -- QUEUED, RUNNING, COMPLETED, FAILED
    step VARCHAR(50) DEFAULT 'INITIALIZING',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    error_message TEXT,
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(100),
    stage_metrics JSONB DEFAULT '{}'::jsonb, -- Observability: durations, files processed, symbols extracted
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_locked ON ingestion_jobs(status, locked_at);
CREATE INDEX IF NOT EXISTS idx_jobs_repo ON ingestion_jobs(repository_id);

-- 8. Chat Sessions & Messages
CREATE TABLE IF NOT EXISTS chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT DEFAULT 'New Architectural Conversation',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL,
    content TEXT NOT NULL,
    structured_context JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at);
