-- Migration 007: Verification and engineering blueprints for briefs
-- When discovery completes, the worker queues the top shortlisted repositories into the normal
-- repository indexer (clone, analysis, evidence gate) and creates one blueprint row per brief.
-- The blueprint row is its own queue: it becomes claimable once every repository it waits for has
-- finished indexing (READY or FAILED), or after a maximum wait, and is then written from verified
-- code evidence plus the README assessments.

CREATE TABLE IF NOT EXISTS brief_blueprints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_id UUID NOT NULL UNIQUE REFERENCES briefs(id) ON DELETE CASCADE,
    status VARCHAR(20) NOT NULL DEFAULT 'WAITING', -- WAITING, RUNNING, COMPLETED, FAILED
    step VARCHAR(50) DEFAULT 'VERIFYING', -- VERIFYING, COLLECTING_EVIDENCE, DESIGNING, DONE, FAILED
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    locked_at TIMESTAMPTZ, -- while WAITING: retry "not before" time; while RUNNING: lock heartbeat
    locked_by VARCHAR(100),
    -- [{fullName, repositoryId, resourceId, state: 'queued' | 'reused' | 'skipped', reason}]
    verification_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    blueprint_json JSONB DEFAULT '{}'::jsonb,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brief_blueprints_status ON brief_blueprints(status, locked_at);
