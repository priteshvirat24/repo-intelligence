-- Migration 005: Universal Resource Intelligence Model
-- Generalizes from GitHub-only repositories to Universal Resources:
-- GitHub, Web, Documentation, LinkedIn, YouTube, PDF, Research Papers, etc.

-- 1. Universal Resources Table
CREATE TABLE IF NOT EXISTS resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_type VARCHAR(50) NOT NULL DEFAULT 'generic_url',
    -- 'github_repository', 'web_page', 'documentation_site', 'article', 'linkedin_post', 'youtube_video', 'pdf', 'document', 'research_paper', 'generic_url'
    resource_role VARCHAR(50) DEFAULT 'reference',
    -- 'software_component', 'library', 'framework', 'documentation', 'tutorial', 'reference', 'research', 'dataset', 'article', 'video', 'opinion', 'guide', 'specification'
    source_url TEXT NOT NULL UNIQUE,
    canonical_url TEXT,
    title TEXT NOT NULL,
    description TEXT,
    author VARCHAR(255),
    publisher VARCHAR(255),
    source_domain VARCHAR(255),
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    -- 'PENDING', 'FETCHING', 'ANALYZING', 'INDEXING', 'READY', 'PARTIAL', 'FAILED', 'BLOCKED'
    error_message TEXT,
    content_hash VARCHAR(64),
    domain_tags TEXT[] DEFAULT '{}',
    problems_solved TEXT[] DEFAULT '{}',
    practical_uses TEXT[] DEFAULT '{}',
    value_proposition TEXT,
    useful_for TEXT[] DEFAULT '{}',
    published_at TIMESTAMPTZ,
    last_checked_at TIMESTAMPTZ,
    indexed_at TIMESTAMPTZ,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    analysis_json JSONB DEFAULT '{}'::jsonb,
    tsv_content tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || COALESCE(description, '') || ' ' || COALESCE(value_proposition, ''))) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resources_type ON resources(resource_type);
CREATE INDEX IF NOT EXISTS idx_resources_status ON resources(status);
CREATE INDEX IF NOT EXISTS idx_resources_domain ON resources(source_domain);
CREATE INDEX IF NOT EXISTS idx_resources_tags ON resources USING gin(domain_tags);
CREATE INDEX IF NOT EXISTS idx_resources_problems ON resources USING gin(problems_solved);
CREATE INDEX IF NOT EXISTS idx_resources_tsv ON resources USING gin(tsv_content);

-- 2. Foreign Key Links from Existing Tables to Universal Resources
-- Link repositories -> resources
ALTER TABLE repositories
ADD COLUMN IF NOT EXISTS resource_id UUID REFERENCES resources(id) ON DELETE CASCADE;

-- Link knowledge_objects -> resources
ALTER TABLE knowledge_objects
ADD COLUMN IF NOT EXISTS resource_id UUID REFERENCES resources(id) ON DELETE CASCADE;

-- Allow repository_id to be nullable in knowledge_objects for non-repo resources
ALTER TABLE knowledge_objects
ALTER COLUMN repository_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_knowledge_objects_resource ON knowledge_objects(resource_id);

-- Link knowledge_relationships -> resources
ALTER TABLE knowledge_relationships
ADD COLUMN IF NOT EXISTS source_resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS target_resource_id UUID REFERENCES resources(id) ON DELETE CASCADE;

ALTER TABLE knowledge_relationships
ALTER COLUMN source_repo_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_krel_resource ON knowledge_relationships(source_resource_id, target_resource_id);

-- Link documents -> resources
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS resource_id UUID REFERENCES resources(id) ON DELETE CASCADE;

ALTER TABLE documents
ALTER COLUMN repository_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_resource ON documents(resource_id);

-- Link chunks -> resources
ALTER TABLE chunks
ADD COLUMN IF NOT EXISTS resource_id UUID REFERENCES resources(id) ON DELETE CASCADE;

ALTER TABLE chunks
ALTER COLUMN repository_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chunks_resource ON chunks(resource_id);

-- Link evidence -> resources and add rich source-specific locators
ALTER TABLE evidence
ADD COLUMN IF NOT EXISTS resource_id UUID REFERENCES resources(id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS locator_type VARCHAR(50) DEFAULT 'github_line',
-- 'github_line', 'web_section', 'youtube_timestamp', 'pdf_page', 'linkedin_post', 'metadata'
ADD COLUMN IF NOT EXISTS locator_json JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_evidence_resource ON evidence(resource_id);
CREATE INDEX IF NOT EXISTS idx_evidence_locator_type ON evidence(locator_type);

-- Link ingestion_jobs -> resources
ALTER TABLE ingestion_jobs
ADD COLUMN IF NOT EXISTS resource_id UUID REFERENCES resources(id) ON DELETE CASCADE;

ALTER TABLE ingestion_jobs
ALTER COLUMN repository_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ingestion_jobs_resource ON ingestion_jobs(resource_id);

-- 3. Backfill Existing Repositories into Resources
INSERT INTO resources (
    id,
    resource_type,
    resource_role,
    source_url,
    canonical_url,
    title,
    description,
    author,
    publisher,
    source_domain,
    status,
    content_hash,
    domain_tags,
    problems_solved,
    practical_uses,
    value_proposition,
    useful_for,
    metadata_json,
    analysis_json,
    created_at,
    updated_at
)
SELECT
    id,
    'github_repository',
    'software_component',
    url,
    url,
    owner || '/' || name,
    description,
    owner,
    'GitHub',
    'github.com',
    status,
    latest_commit_hash,
    COALESCE(domain_tags, '{}'::TEXT[]),
    ARRAY[]::TEXT[],
    ARRAY[]::TEXT[],
    description,
    COALESCE(domain_tags, '{}'::TEXT[]),
    jsonb_build_object(
        'owner', owner,
        'name', name,
        'stars', stars,
        'primaryLanguage', primary_language,
        'license', license,
        'defaultBranch', default_branch,
        'latestCommitHash', latest_commit_hash
    ) || COALESCE(metadata_json, '{}'::jsonb),
    COALESCE(open_knowledge_json, '{}'::jsonb),
    created_at,
    updated_at
FROM repositories
ON CONFLICT (source_url) DO UPDATE SET
    updated_at = NOW();

-- Update backfilled references
UPDATE repositories SET resource_id = id WHERE resource_id IS NULL;
UPDATE knowledge_objects SET resource_id = repository_id WHERE resource_id IS NULL AND repository_id IS NOT NULL;
UPDATE knowledge_relationships SET source_resource_id = source_repo_id WHERE source_resource_id IS NULL AND source_repo_id IS NOT NULL;
UPDATE knowledge_relationships SET target_resource_id = target_repo_id WHERE target_resource_id IS NULL AND target_repo_id IS NOT NULL;
UPDATE documents SET resource_id = repository_id WHERE resource_id IS NULL AND repository_id IS NOT NULL;
UPDATE chunks SET resource_id = repository_id WHERE resource_id IS NULL AND repository_id IS NOT NULL;
UPDATE evidence SET resource_id = (SELECT repository_id FROM repository_capabilities WHERE id = evidence.repository_capability_id) WHERE resource_id IS NULL AND repository_capability_id IS NOT NULL;
UPDATE ingestion_jobs SET resource_id = repository_id WHERE resource_id IS NULL AND repository_id IS NOT NULL;

-- 4. Resource Versions Table (lightweight version & change tracking)
CREATE TABLE IF NOT EXISTS resource_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource_id UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL DEFAULT 1,
    content_hash VARCHAR(64) NOT NULL,
    change_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_resource_version UNIQUE (resource_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_resource_versions_resource ON resource_versions(resource_id);

-- 5. Provider Usage & Audit Log Table (Track Tavily, Firecrawl, LLM spend & latency)
CREATE TABLE IF NOT EXISTS provider_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider VARCHAR(50) NOT NULL, -- 'tavily', 'firecrawl', 'mistral', 'youtube'
    operation VARCHAR(100) NOT NULL, -- 'search', 'scrape', 'crawl', 'extract', 'llm_call', 'embedding'
    resource_id UUID REFERENCES resources(id) ON DELETE SET NULL,
    duration_ms INTEGER,
    tokens_used INTEGER DEFAULT 0,
    cost_cents NUMERIC(8, 4) DEFAULT 0,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_provider_usage_provider ON provider_usage(provider);
CREATE INDEX IF NOT EXISTS idx_provider_usage_created ON provider_usage(created_at);

-- 6. Web Search Cache Table (Tavily search cache to optimize costs & latency)
CREATE TABLE IF NOT EXISTS web_search_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    query_hash VARCHAR(64) NOT NULL UNIQUE,
    query_text TEXT NOT NULL,
    results_json JSONB NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_web_search_cache_hash ON web_search_cache(query_hash);
CREATE INDEX IF NOT EXISTS idx_web_search_cache_expires ON web_search_cache(expires_at);
