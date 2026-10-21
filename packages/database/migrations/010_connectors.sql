-- Migration 010: Phase 2 discovery breadth and verification depth (SYSTEM_DESIGN 5, 6)
-- Connector response cache, candidate sources from package registries, and partial analysis of large repositories.

-- 1. Connector response cache (SYSTEM_DESIGN 5.1: the gateway caches by request hash with a TTL per connector).
-- Bodies are external content: untrusted data, never instructions. Rows past expires_at are ignored and replaced.
CREATE TABLE IF NOT EXISTS connector_cache (
    cache_key VARCHAR(64) PRIMARY KEY,        -- sha256 of connector, method, URL, sorted params and body without credentials
    connector VARCHAR(40) NOT NULL,           -- depsdev, osv, npm, crates, stackexchange, tavily, arxiv, docs
    operation VARCHAR(60) NOT NULL,
    url TEXT NOT NULL,                        -- request URL without query string (no credentials)
    status_code INTEGER NOT NULL,
    content_type VARCHAR(200),
    body TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    retrieved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_connector_cache_expiry ON connector_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_connector_cache_connector ON connector_cache(connector, retrieved_at DESC);

-- 2. Where each brief candidate was found (github, npm, crates) and the registry packages that point at it
ALTER TABLE brief_candidates
    ADD COLUMN IF NOT EXISTS sources TEXT[] NOT NULL DEFAULT '{github}',
    ADD COLUMN IF NOT EXISTS packages_json JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{system, name, version, url}]
    ADD COLUMN IF NOT EXISTS homepage TEXT;

-- 3. Partial analysis of repositories over the size limit (SYSTEM_DESIGN 6, "Large repositories"):
-- {mode: 'partial', reason, focusTerms} on the ingestion job; the indexer checks out only the most relevant directories.
ALTER TABLE ingestion_jobs
    ADD COLUMN IF NOT EXISTS scope_json JSONB;
