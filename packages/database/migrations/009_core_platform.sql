-- Migration 009: Phase 1 core platform (SYSTEM_DESIGN 3, 4, 11)
-- Workspaces and users, the per-brief run graph, enforced budgets and graded claims.

-- 1. Users and workspaces (authentication; PRODUCT_DEFINITION 12.1: team workspaces, per-project privacy)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    github_id BIGINT UNIQUE,
    login VARCHAR(100),
    name TEXT,
    email TEXT,
    avatar_url TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL DEFAULT 'member', -- member, maintainer
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

-- The workspace used when sign-in is not configured (single-team mode)
INSERT INTO workspaces (id, name) VALUES ('00000000-0000-0000-0000-000000000001', 'Default workspace')
ON CONFLICT (id) DO NOTHING;

-- 2. Briefs become projects: owned by a workspace, with user constraints, answers and a budget
ALTER TABLE briefs
    ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS constraints_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS answers_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS understanding_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS budget_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS stop_reason VARCHAR(30);

UPDATE briefs SET workspace_id = '00000000-0000-0000-0000-000000000001' WHERE workspace_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_briefs_workspace ON briefs(workspace_id, created_at DESC);

-- 3. Run graph: one row per task type per brief. A task is re-run in place when an input changes;
-- inputs_fingerprint lets an unchanged task be marked done again without executing.
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_id UUID NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
    type VARCHAR(40) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending, running, waiting, awaiting_input, done, failed, stale, cancelled
    depends_on VARCHAR(40)[] NOT NULL DEFAULT '{}',
    inputs_fingerprint VARCHAR(64),
    output_json JSONB DEFAULT '{}'::jsonb,
    output_hash VARCHAR(64),
    error_message TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    not_before TIMESTAMPTZ,
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(100),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_brief_task UNIQUE (brief_id, type)
);

CREATE INDEX IF NOT EXISTS idx_tasks_claim ON tasks(status, not_before);
CREATE INDEX IF NOT EXISTS idx_tasks_brief ON tasks(brief_id);

-- 4. Claims: every factual statement with an evidence grade (PRODUCT_DEFINITION 5.1, SYSTEM_DESIGN 6)
CREATE TABLE IF NOT EXISTS claims (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subject VARCHAR(300) NOT NULL,            -- github:owner/name, npm:package, ...
    subject_version VARCHAR(100),             -- commit, release or content hash observed
    kind VARCHAR(40) NOT NULL,                -- capability, licence, maintenance, vulnerability, limitation, coverage, ...
    statement TEXT NOT NULL,
    statement_key VARCHAR(64) NOT NULL,       -- hash of the normalised statement, for de-duplication
    grade VARCHAR(2) NOT NULL,                -- E1 .. E5
    confidence NUMERIC(3, 2),
    scope VARCHAR(20) NOT NULL DEFAULT 'global', -- global (facts about public sources) or workspace
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    brief_id UUID REFERENCES briefs(id) ON DELETE CASCADE, -- set for project-scoped claims
    status VARCHAR(20) NOT NULL DEFAULT 'current', -- current, needs_revalidation, refuted
    evidence_json JSONB NOT NULL DEFAULT '[]'::jsonb, -- [{method, grade, sourceUrl, locator, excerpt, retrievedAt}]
    observed_at TIMESTAMPTZ DEFAULT NOW(),
    revalidate_after TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- One claim per subject, kind, statement and scope (brief_id NULL for global claims)
CREATE UNIQUE INDEX IF NOT EXISTS idx_claims_identity
    ON claims(subject, kind, statement_key, COALESCE(brief_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_claims_subject ON claims(subject, status);
CREATE INDEX IF NOT EXISTS idx_claims_brief ON claims(brief_id);
