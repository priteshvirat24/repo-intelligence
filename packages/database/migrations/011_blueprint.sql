-- Migration 011: Phase 3 blueprint iteration (PRODUCT_DEFINITION 4.1 step 6, SYSTEM_DESIGN 7)
-- Challenges to blueprint decisions and requirements to investigate deeper, stored on the brief so that
-- only the affected tasks re-run: a challenge re-runs the blueprint, a deeper investigation re-runs discovery.

-- [{id, requirement, repo, note, createdAt, createdBy}], newest last; the blueprint answers the latest ones
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS challenges_json JSONB NOT NULL DEFAULT '[]'::jsonb;

-- [{requirement, createdAt}]: requirements the discovery planner spends extra queries on
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS focus_json JSONB NOT NULL DEFAULT '[]'::jsonb;
