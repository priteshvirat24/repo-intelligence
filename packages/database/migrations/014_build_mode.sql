-- Migration 014: Phase 6 build mode and E1 execution (PRODUCT_DEFINITION 5.8, 7.1; SYSTEM_DESIGN 6, 11, 13)

-- 1. Builds: an authorised, sandboxed coding run for part of a brief's blueprint. Separate from the brief's
-- run graph: a build never changes research results, and research never starts a build.
--   queued             authorised by a maintainer, waiting for a worker
--   running            the bounded coding loop is running in a sandbox
--   succeeded          every test passed; the change set waits for a maintainer to deliver it
--   awaiting_approval  a change set exists but not every test passed: a person must judge it before delivery
--   failed             no usable change set (error, budget, sandbox unavailable)
--   delivered          a branch and pull request were opened after explicit approval
CREATE TABLE IF NOT EXISTS builds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_id UUID NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
    scope_json JSONB NOT NULL DEFAULT '{}'::jsonb,      -- {roadmapTaskIds: [...], requirements: [...]}
    status VARCHAR(30) NOT NULL DEFAULT 'queued',
    step VARCHAR(40),
    iterations INTEGER NOT NULL DEFAULT 0,
    max_iterations INTEGER NOT NULL DEFAULT 4,
    test_report_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    files_json JSONB NOT NULL DEFAULT '{}'::jsonb,       -- {path: content} of the final change set
    diff_text TEXT,
    error_message TEXT,
    delivery_json JSONB,                                 -- {repo, branch, pullRequestUrl, approvedBy, deliveredAt}
    attempts INTEGER NOT NULL DEFAULT 0,
    locked_at TIMESTAMPTZ,
    locked_by VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT builds_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'awaiting_approval', 'delivered'))
);

CREATE INDEX IF NOT EXISTS idx_builds_claim ON builds(status, created_at);
CREATE INDEX IF NOT EXISTS idx_builds_brief ON builds(brief_id, created_at DESC);
-- At most one queued or running build per brief: two concurrent authorisations cannot both start one
CREATE UNIQUE INDEX IF NOT EXISTS idx_builds_one_active ON builds(brief_id) WHERE status IN ('queued', 'running');

-- 2. Existing briefs get the execute task (E1 checks) between verify and blueprint. It starts done and
-- skipped, as it would have been without the per-project opt-in, so no blueprint re-runs because of it.
INSERT INTO tasks (brief_id, type, status, depends_on, output_json, finished_at)
SELECT t.brief_id, 'execute', 'done', ARRAY['understand', 'discover', 'verify']::varchar(40)[],
       '{"skipped": true, "reason": "not_authorised", "checks": []}'::jsonb, NOW()
FROM tasks t
WHERE t.type = 'verify'
ON CONFLICT (brief_id, type) DO NOTHING;

UPDATE tasks SET depends_on = array_append(depends_on, 'execute'::varchar(40))
WHERE type = 'blueprint' AND NOT ('execute' = ANY(depends_on));

-- 3. Existing briefs also get the recall task (Phase 4 memory, before discover). It starts done with nothing
-- remembered, as their discovery ran without memory, and every later task waits on it from now on.
INSERT INTO tasks (brief_id, type, status, depends_on, output_json, finished_at)
SELECT t.brief_id, 'recall', 'done', ARRAY['understand']::varchar(40)[],
       '{"candidates": [], "skipRequirements": [], "similarEpisodes": [], "procedures": []}'::jsonb, NOW()
FROM tasks t
WHERE t.type = 'understand'
ON CONFLICT (brief_id, type) DO NOTHING;

UPDATE tasks SET depends_on = array_append(depends_on, 'recall'::varchar(40))
WHERE type IN ('discover', 'verify', 'execute', 'blueprint') AND NOT ('recall' = ANY(depends_on));
