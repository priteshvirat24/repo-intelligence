-- Migration 006: Briefs and GitHub discovery
-- A brief is a developer's problem statement (pasted text or an uploaded file). The web app parses it
-- and decomposes it into requirements; the worker then searches GitHub for existing implementations.
-- The briefs table is its own queue (same claim/lock rules as ingestion_jobs), so discovery never
-- touches repository indexing.

CREATE TABLE IF NOT EXISTS briefs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    source_type VARCHAR(20) NOT NULL DEFAULT 'text', -- 'text', 'markdown', 'pdf', 'docx'
    source_filename TEXT,
    brief_text TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    requirements_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- OpenQueryRequirements
    decomposition_mode VARCHAR(20) NOT NULL DEFAULT 'llm', -- 'llm' or 'heuristic' (LLM unavailable)
    status VARCHAR(20) NOT NULL DEFAULT 'QUEUED', -- QUEUED, RUNNING, COMPLETED, FAILED
    step VARCHAR(50) DEFAULT 'QUEUED',
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    locked_at TIMESTAMPTZ, -- while QUEUED: retry "not before" time; while RUNNING: lock heartbeat
    locked_by VARCHAR(100),
    discovery_json JSONB DEFAULT '{}'::jsonb, -- queries run, candidate counts, durations
    discovered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_briefs_status_locked ON briefs(status, locked_at);
CREATE INDEX IF NOT EXISTS idx_briefs_hash ON briefs(content_hash);
CREATE INDEX IF NOT EXISTS idx_briefs_created ON briefs(created_at DESC);

CREATE TABLE IF NOT EXISTS brief_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_id UUID NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL, -- owner/name
    source_url TEXT NOT NULL,
    description TEXT,
    primary_language VARCHAR(100),
    topics TEXT[] DEFAULT '{}',
    stars INTEGER DEFAULT 0,
    forks INTEGER DEFAULT 0,
    open_issues INTEGER DEFAULT 0,
    license VARCHAR(100),
    pushed_at TIMESTAMPTZ,
    candidate_kind VARCHAR(30) DEFAULT 'unknown', -- implementation, library, framework, curated_list, tutorial, unknown
    matched_queries TEXT[] DEFAULT '{}',
    matched_requirements TEXT[] DEFAULT '{}',
    relevance_score NUMERIC(5, 4) DEFAULT 0,
    health_score NUMERIC(5, 4) DEFAULT 0,
    coverage_score NUMERIC(5, 4), -- NULL when the README was not assessed
    final_score NUMERIC(5, 4) DEFAULT 0,
    rank INTEGER NOT NULL,
    shortlisted BOOLEAN DEFAULT FALSE,
    duplicate_of TEXT, -- full_name of the candidate this one mirrors
    assessment_json JSONB DEFAULT '{}'::jsonb, -- LLM README assessment: summary, per-requirement coverage
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_brief_candidate UNIQUE (brief_id, full_name)
);

CREATE INDEX IF NOT EXISTS idx_brief_candidates_brief ON brief_candidates(brief_id, rank);
