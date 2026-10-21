-- Migration 013: Controlled self-evolution (PRODUCT_DEFINITION 9, SYSTEM_DESIGN 9; Phase 5)
-- Feedback on what a run recommended, label proposals for the evaluation suite, L2/L3 proposals that wait
-- for a maintainer, and the evolution history. Promotion, rollback and proposal decisions are functions so
-- the worker (auto-tuner, monitor) and the web app (maintainers) apply exactly the same rules.

-- 1. config_versions: the evidence behind a decision. Status is one of
--    candidate, pending (L2/L3 waiting for approval), promoted, retired (superseded), rejected, rolled_back
ALTER TABLE config_versions
    ADD COLUMN IF NOT EXISTS evidence_json JSONB,
    ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ;

-- 2. Feedback from people on a brief's results. tuning_version is the version that produced the target,
-- so live quality can be compared between versions (monitoring and rollback).
CREATE TABLE IF NOT EXISTS feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brief_id UUID NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    target_kind VARCHAR(30) NOT NULL CHECK (target_kind IN ('candidate', 'blueprint_decision', 'claim')),
    target_id TEXT NOT NULL,          -- candidate: owner/name; blueprint_decision: requirement name; claim: claim id
    verdict VARCHAR(20) NOT NULL CHECK (verdict IN ('useful', 'not_useful', 'correct', 'wrong')),
    note TEXT,
    tuning_version VARCHAR(40),
    context_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- what was shown: rank, shortlisted, decision, repository
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- One verdict per person and target; changing your mind replaces it
CREATE UNIQUE INDEX IF NOT EXISTS idx_feedback_identity
    ON feedback(brief_id, target_kind, target_id, COALESCE(user_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX IF NOT EXISTS idx_feedback_version ON feedback(tuning_version, created_at);

-- 3. Label proposals: feedback turned into a suggested label change for the evaluation suite (a missing
-- solution, a trap, a decision to review). Stored for reviewers; never applied to the labels automatically.
CREATE TABLE IF NOT EXISTS label_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id UUID NOT NULL UNIQUE REFERENCES feedback(id) ON DELETE CASCADE,
    brief_id UUID NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
    kind VARCHAR(30) NOT NULL,        -- solution, trap, decision_review, claim_review
    repo TEXT,
    requirement TEXT,
    proposal_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, accepted, dismissed (by a reviewer)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_label_proposals_status ON label_proposals(status, created_at DESC);

-- 4. Proposals that need a person: L2 (prompts, strategies, models) and L3 (workflow) need a benchmark win
-- and a maintainer's approval; L4 (code, security policy) is recorded for humans and never applied.
CREATE TABLE IF NOT EXISTS evolution_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    level VARCHAR(4) NOT NULL CHECK (level IN ('L2', 'L3', 'L4')),
    title TEXT NOT NULL,
    rationale TEXT,
    config_version VARCHAR(40) REFERENCES config_versions(id),
    base_version VARCHAR(40),
    overrides_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- the candidate tuning file
    evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,  -- benchmark run ids, metrics, gate result
    benchmark_win BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    created_by TEXT NOT NULL DEFAULT 'system',
    decided_by TEXT,
    decided_at TIMESTAMPTZ,
    decision_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (level = 'L4' OR config_version IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_evolution_proposals_status ON evolution_proposals(status, created_at DESC);

-- 5. Evolution history: every promotion, rejection, rollback and proposal decision, with its evidence.
-- version is what the event is about; active_before/active_after are the promoted versions around it
-- (NULL: the built-in defaults).
CREATE TABLE IF NOT EXISTS evolution_events (
    id BIGSERIAL PRIMARY KEY,
    kind VARCHAR(30) NOT NULL,        -- promoted, rejected, rolled_back, proposed, proposal_rejected
    version VARCHAR(40) REFERENCES config_versions(id),
    active_before VARCHAR(40) REFERENCES config_versions(id),
    active_after VARCHAR(40) REFERENCES config_versions(id),
    level VARCHAR(4),
    actor TEXT NOT NULL,              -- auto-tuner, monitor, user:<id>, maintainer
    proposal_id UUID REFERENCES evolution_proposals(id) ON DELETE SET NULL,
    evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_evolution_events_created ON evolution_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evolution_events_version ON evolution_events(version, kind);

-- 6. The rules. One promoted version at a time, serialised by an advisory lock.

-- Promotes a registered version. Refuses without benchmark evidence (a non-empty "runs" list), and refuses a
-- version that was rejected, or rolled back unless a person approves it again through a proposal.
-- Returns the version that was active before (NULL: the built-in defaults).
CREATE OR REPLACE FUNCTION evolution_promote(p_version TEXT, p_actor TEXT, p_evidence JSONB, p_notes TEXT, p_proposal UUID DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v_level TEXT;
    v_status TEXT;
    v_previous TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('open-eye-evolution'));
    IF p_evidence IS NULL OR jsonb_typeof(p_evidence->'runs') IS DISTINCT FROM 'array' OR jsonb_array_length(p_evidence->'runs') = 0 THEN
        RAISE EXCEPTION 'EVOLUTION_NO_EVIDENCE: a version is promoted only with benchmark runs as evidence';
    END IF;
    SELECT level, status INTO v_level, v_status FROM config_versions WHERE id = p_version FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'EVOLUTION_UNKNOWN_VERSION: %', p_version;
    END IF;
    IF v_status = 'rejected' OR (v_status = 'rolled_back' AND p_proposal IS NULL) THEN
        RAISE EXCEPTION 'EVOLUTION_VERSION_REFUSED: % is %', p_version, v_status;
    END IF;
    SELECT id INTO v_previous FROM config_versions WHERE status = 'promoted' ORDER BY promoted_at DESC NULLS LAST LIMIT 1;
    IF v_previous = p_version THEN
        RETURN v_previous;
    END IF;
    UPDATE config_versions SET status = 'retired' WHERE status = 'promoted';
    UPDATE config_versions
       SET status = 'promoted', promoted_at = NOW(), decided_at = NOW(), evidence_json = p_evidence,
           notes = COALESCE(p_notes, notes), parent_id = COALESCE(parent_id, v_previous)
     WHERE id = p_version;
    INSERT INTO evolution_events (kind, version, active_before, active_after, level, actor, proposal_id, evidence_json, notes)
    VALUES ('promoted', p_version, v_previous, p_version, v_level, p_actor, p_proposal, p_evidence, p_notes);
    RETURN v_previous;
END;
$$;

-- Rolls back the promoted version to the one it replaced. p_expected guards against acting on a version
-- that changed since the caller looked. Returns the restored version (NULL: the built-in defaults).
CREATE OR REPLACE FUNCTION evolution_rollback(p_actor TEXT, p_reason TEXT, p_evidence JSONB, p_expected TEXT DEFAULT NULL)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    v_current TEXT;
    v_level TEXT;
    v_restore TEXT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('open-eye-evolution'));
    SELECT id, level INTO v_current, v_level FROM config_versions WHERE status = 'promoted' ORDER BY promoted_at DESC NULLS LAST LIMIT 1;
    IF v_current IS NULL THEN
        RAISE EXCEPTION 'EVOLUTION_NOTHING_TO_ROLL_BACK: the built-in defaults are active';
    END IF;
    IF p_expected IS NOT NULL AND p_expected <> v_current THEN
        RAISE EXCEPTION 'EVOLUTION_VERSION_CHANGED: % is no longer the promoted version', p_expected;
    END IF;
    SELECT active_before INTO v_restore FROM evolution_events
     WHERE kind = 'promoted' AND version = v_current ORDER BY created_at DESC, id DESC LIMIT 1;
    IF NOT FOUND THEN
        SELECT parent_id INTO v_restore FROM config_versions WHERE id = v_current;
    END IF;
    UPDATE config_versions SET status = 'rolled_back', decided_at = NOW() WHERE id = v_current;
    IF v_restore IS NOT NULL THEN
        UPDATE config_versions SET status = 'promoted', promoted_at = NOW() WHERE id = v_restore;
    END IF;
    INSERT INTO evolution_events (kind, version, active_before, active_after, level, actor, evidence_json, notes)
    VALUES ('rolled_back', v_current, v_current, v_restore, v_level, p_actor, COALESCE(p_evidence, '{}'::jsonb), p_reason);
    RETURN v_restore;
END;
$$;

-- A maintainer's decision on a pending proposal. Approval needs a recorded benchmark win and promotes the
-- version; L4 is never applied. Returns the proposal's new status.
CREATE OR REPLACE FUNCTION evolution_decide_proposal(p_id UUID, p_approve BOOLEAN, p_actor TEXT, p_note TEXT)
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
    r evolution_proposals%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('open-eye-evolution'));
    SELECT * INTO r FROM evolution_proposals WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'EVOLUTION_UNKNOWN_PROPOSAL: %', p_id;
    END IF;
    IF r.status <> 'pending' THEN
        RAISE EXCEPTION 'EVOLUTION_ALREADY_DECIDED: the proposal is %', r.status;
    END IF;
    IF p_approve THEN
        IF r.level = 'L4' THEN
            RAISE EXCEPTION 'EVOLUTION_L4_NEVER_APPLIED: code and security changes go through a reviewed pull request';
        END IF;
        IF NOT r.benchmark_win THEN
            RAISE EXCEPTION 'EVOLUTION_NO_BENCHMARK_WIN: approval needs a benchmark win';
        END IF;
        PERFORM evolution_promote(r.config_version, p_actor, r.evidence_json, r.title || COALESCE(': ' || p_note, ''), r.id);
        UPDATE evolution_proposals SET status = 'approved', decided_by = p_actor, decided_at = NOW(), decision_note = p_note WHERE id = p_id;
        RETURN 'approved';
    END IF;
    UPDATE evolution_proposals SET status = 'rejected', decided_by = p_actor, decided_at = NOW(), decision_note = p_note WHERE id = p_id;
    IF r.config_version IS NOT NULL THEN
        UPDATE config_versions SET status = 'rejected', decided_at = NOW() WHERE id = r.config_version AND status IN ('pending', 'candidate');
    END IF;
    INSERT INTO evolution_events (kind, version, level, actor, proposal_id, evidence_json, notes)
    VALUES ('proposal_rejected', r.config_version, r.level, p_actor, r.id, r.evidence_json, p_note);
    RETURN 'rejected';
END;
$$;
