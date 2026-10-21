-- Migration 012: Phase 4 memory (PRODUCT_DEFINITION 8, SYSTEM_DESIGN 8)
-- Memory is organised in three types, each with one store, one write path and one read path
-- (apps/worker/memory):
--   semantic    facts about the world: claims (009), source_stats, revalidation_checks
--   episodic    what happened in a run: episodes, experiences (build and test outcomes, Phase 6)
--   procedural  how to do things, learned from episodes and evaluations: procedures, strategy_records
-- Every record carries provenance, a timestamp, a confidence or grade, a scope and a revalidation rule.

-- 1. Semantic memory: claims gain search, a revalidation date and a status for superseded API facts
ALTER TABLE claims ADD COLUMN IF NOT EXISTS revalidated_at TIMESTAMPTZ;
-- status: current, needs_revalidation, refuted, superseded (a newer API fact replaced it)
CREATE INDEX IF NOT EXISTS idx_claims_statement_fts ON claims USING GIN (to_tsvector('english', statement));
CREATE INDEX IF NOT EXISTS idx_claims_due ON claims(revalidate_after) WHERE status IN ('current', 'needs_revalidation');

-- Source reliability (semantic metadata): per source and source type, how often its claims were later
-- corroborated or refuted, and how often they went stale. Weighted counts decay (half-life 90 days) so
-- recent evidence weighs more. source '*' holds the aggregate per source type.
CREATE TABLE IF NOT EXISTS source_stats (
    source VARCHAR(300) NOT NULL,            -- github:owner/name, api.github.com, '*'
    source_type VARCHAR(40) NOT NULL,        -- readme, code, platform_api, docs, inferred, ...
    claims_verified INTEGER NOT NULL DEFAULT 0,
    claims_refuted INTEGER NOT NULL DEFAULT 0,
    claims_stale INTEGER NOT NULL DEFAULT 0,
    verified_weight DOUBLE PRECISION NOT NULL DEFAULT 0,
    refuted_weight DOUBLE PRECISION NOT NULL DEFAULT 0,
    last_event_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (source, source_type)
);

-- One row per revalidation check of a subject (audit of "revalidated on ..."); a changed source records
-- the re-index it queued, and the claims are rewritten from the new commit once that index is READY
CREATE TABLE IF NOT EXISTS revalidation_checks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject VARCHAR(300) NOT NULL,
    outcome VARCHAR(20) NOT NULL,            -- unchanged, changed, missing, error
    previous_version VARCHAR(100),
    current_version VARCHAR(100),
    pushed_at TIMESTAMPTZ,
    claims_affected INTEGER NOT NULL DEFAULT 0,
    repository_id UUID REFERENCES repositories(id) ON DELETE SET NULL,
    reindex_status VARCHAR(20),              -- queued, applied, null when no re-index was needed
    error_message TEXT,
    checked_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_revalidation_checks_subject ON revalidation_checks(subject, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_revalidation_checks_reindex ON revalidation_checks(reindex_status) WHERE reindex_status = 'queued';

-- 2. Episodic memory: one 'run' episode per finished, stopped or failed run of a brief, and 'event'
-- episodes for what happened later (a refutation, a confirmation, feedback). Workspace-private.
CREATE TABLE IF NOT EXISTS episodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    brief_id UUID REFERENCES briefs(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES episodes(id) ON DELETE CASCADE, -- an event's run episode
    kind VARCHAR(20) NOT NULL DEFAULT 'run',  -- run, event
    run_key VARCHAR(64),                      -- identity of a run episode (the run's task outputs)
    outcome VARCHAR(20) NOT NULL,             -- run: completed, stopped, failed; event: refuted, confirmed, feedback
    title TEXT,
    problem_summary TEXT,
    summary TEXT,                             -- one readable sentence
    tuning_version VARCHAR(40),
    requirements_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    understanding_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    queries_json JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{query, requirement, results, newCandidates, shortlistedFound}]
    shortlisted_json JSONB NOT NULL DEFAULT '[]'::jsonb, -- [fullName]
    rejected_json JSONB NOT NULL DEFAULT '[]'::jsonb,    -- [{fullName, reason}]
    decisions_json JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{component, decision, repo}]
    budget_json JSONB NOT NULL DEFAULT '{}'::jsonb,      -- what the run spent
    memory_json JSONB NOT NULL DEFAULT '{}'::jsonb,      -- what memory contributed (remembered candidates, searches avoided)
    feedback_json JSONB NOT NULL DEFAULT '[]'::jsonb,    -- later feedback and refutations
    procedures_used UUID[] NOT NULL DEFAULT '{}',
    detail_json JSONB NOT NULL DEFAULT '{}'::jsonb,      -- events: claim id, reason, actor
    search_text TEXT NOT NULL DEFAULT '',
    provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    scope VARCHAR(20) NOT NULL DEFAULT 'workspace',
    revalidation_rule VARCHAR(60) NOT NULL DEFAULT 'permanent history',
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_episodes_run ON episodes(brief_id, run_key) WHERE kind = 'run';
CREATE INDEX IF NOT EXISTS idx_episodes_workspace ON episodes(workspace_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_search ON episodes USING GIN (to_tsvector('english', search_text));

-- Experiences: outcomes of build and test steps (an integration that worked or failed, a compatibility
-- problem, a test result). Episodic; tied to the versions involved and flagged when those change.
CREATE TABLE IF NOT EXISTS experiences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    brief_id UUID REFERENCES briefs(id) ON DELETE SET NULL,
    episode_id UUID REFERENCES episodes(id) ON DELETE SET NULL,
    kind VARCHAR(40) NOT NULL,                -- integration, compatibility, debugging, test_result
    outcome VARCHAR(20) NOT NULL,             -- worked, failed, partial
    summary TEXT NOT NULL,
    context_json JSONB NOT NULL DEFAULT '{}'::jsonb,   -- {resources: [{subject, version}]}
    subjects VARCHAR(300)[] NOT NULL DEFAULT '{}',
    result_json JSONB NOT NULL DEFAULT '{}'::jsonb,    -- the measured result
    test_runs_json JSONB NOT NULL DEFAULT '[]'::jsonb, -- linked test runs
    provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    confidence NUMERIC(3, 2),
    scope VARCHAR(20) NOT NULL DEFAULT 'workspace',
    status VARCHAR(20) NOT NULL DEFAULT 'current',     -- current, needs_revalidation (a version changed)
    revalidation_rule VARCHAR(60) NOT NULL DEFAULT 'versions changed',
    observed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_experiences_workspace ON experiences(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_experiences_subjects ON experiences USING GIN (subjects);

-- 3. Procedural memory. Strategy records: measured metrics per brief class and tuning version, ingested
-- from evaluation runs (global, no project content); they feed procedure distillation.
CREATE TABLE IF NOT EXISTS strategy_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id VARCHAR(100) NOT NULL,
    suite VARCHAR(60),
    brief_class VARCHAR(100) NOT NULL,        -- the briefs' domain, or 'all'
    system VARCHAR(20),
    mode VARCHAR(20),
    tuning_version VARCHAR(40),
    tuning_name VARCHAR(100),
    code_commit VARCHAR(40),
    model VARCHAR(100),
    briefs INTEGER NOT NULL DEFAULT 0,
    metrics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    labels_status TEXT,                       -- how far the ground truth can be trusted
    source_file TEXT,
    scope VARCHAR(20) NOT NULL DEFAULT 'global',
    status VARCHAR(20) NOT NULL DEFAULT 'current', -- current, superseded
    revalidation_rule VARCHAR(60) NOT NULL DEFAULT 'superseded by a better-measured strategy',
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_strategy_record UNIQUE (run_id, brief_class)
);
CREATE INDEX IF NOT EXISTS idx_strategy_records_class ON strategy_records(brief_class, tuning_version);

-- Procedures: a named way of doing something (a query pattern that found the solution for a kind of
-- requirement, an integration recipe, an avoidance rule), distilled from recurring successful episodes
-- or from strategy records. Proposed as candidate; active only with measured support and a maintainer's
-- approval; retired when it stops working.
CREATE TABLE IF NOT EXISTS procedures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL: global (from evaluations)
    kind VARCHAR(30) NOT NULL,                -- query_pattern, research_strategy, integration_recipe, avoidance
    name TEXT NOT NULL,
    trigger_key VARCHAR(64) NOT NULL,         -- identity: kind + normalised trigger + steps
    trigger_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- {requirementTerms, domain, language}
    steps_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- {episodes: [ids], evalRuns: [ids], contradicting: [ids]}
    success_count INTEGER NOT NULL DEFAULT 0,
    failure_count INTEGER NOT NULL DEFAULT 0,
    uses_count INTEGER NOT NULL DEFAULT 0,
    confidence NUMERIC(3, 2),
    status VARCHAR(20) NOT NULL DEFAULT 'candidate', -- candidate, active, retired
    provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    scope VARCHAR(20) NOT NULL DEFAULT 'workspace',
    revalidation_rule VARCHAR(100) NOT NULL DEFAULT 'retire when failures reach half of uses (at least 4 uses)',
    activated_at TIMESTAMPTZ,
    activated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    retired_at TIMESTAMPTZ,
    retired_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_procedures_identity
    ON procedures(kind, trigger_key, COALESCE(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_procedures_status ON procedures(status, workspace_id);

-- Candidates a brief got from memory rather than from search (provenance shown in the brief)
ALTER TABLE brief_candidates
    ADD COLUMN IF NOT EXISTS provenance TEXT[] NOT NULL DEFAULT '{search}',
    ADD COLUMN IF NOT EXISTS memory_json JSONB NOT NULL DEFAULT '{}'::jsonb;
