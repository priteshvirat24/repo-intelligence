-- Migration 008: Config registry and LLM cost ledger (SYSTEM_DESIGN 9, 11; Phase 0)

-- Versioned tunable behaviour. id is the content hash of the full configuration (cfg-xxxxxxxxxxxx),
-- so an identical configuration always has the same id.
CREATE TABLE IF NOT EXISTS config_versions (
    id VARCHAR(40) PRIMARY KEY,
    parent_id VARCHAR(40) REFERENCES config_versions(id),
    level VARCHAR(4) NOT NULL DEFAULT 'L1', -- highest level among the keys that differ from the defaults
    content JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'candidate', -- candidate, promoted, retired
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    promoted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_config_versions_status ON config_versions(status, promoted_at DESC);

-- provider_usage becomes the ledger for every metered call: LLM calls as well as Tavily/Firecrawl.
-- scope ties a call to what it was spent on (brief, blueprint, repository job, eval run, chat).
ALTER TABLE provider_usage
    ADD COLUMN IF NOT EXISTS model VARCHAR(100),
    ADD COLUMN IF NOT EXISTS input_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS output_tokens INTEGER,
    ADD COLUMN IF NOT EXISTS scope_type VARCHAR(30),
    ADD COLUMN IF NOT EXISTS scope_id VARCHAR(100),
    ADD COLUMN IF NOT EXISTS purpose VARCHAR(100),
    ADD COLUMN IF NOT EXISTS tuning_version VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_provider_usage_scope ON provider_usage(scope_type, scope_id);
