-- Migration 004: Production Hardening
-- Adds worker heartbeats, analysis completeness tracking, and evidence strength classification.

-- 1. Worker Heartbeats Table
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id VARCHAR(100) PRIMARY KEY,
  status VARCHAR(50) NOT NULL DEFAULT 'ALIVE',
  current_job_id UUID REFERENCES ingestion_jobs(id) ON DELETE SET NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_last_seen ON worker_heartbeats(last_seen_at);

-- 2. Analysis Completeness on Repositories
ALTER TABLE repositories 
ADD COLUMN IF NOT EXISTS analysis_completeness JSONB DEFAULT '{"level":"full","filesDiscovered":0,"filesAnalyzed":0,"subsystemsAnalyzed":0,"reason":null}'::jsonb;

-- 3. Evidence Strength Classification on Evidence
-- Values: DIRECT_IMPLEMENTATION, DIRECT_INTERFACE, DOCUMENTATION, EXAMPLE, INFERRED
ALTER TABLE evidence 
ADD COLUMN IF NOT EXISTS evidence_strength VARCHAR(50) DEFAULT 'DIRECT_IMPLEMENTATION';

CREATE INDEX IF NOT EXISTS idx_evidence_strength ON evidence(evidence_strength);
