-- Migration 003: Open-World Knowledge Model & Multi-Level Semantic Indexing

-- 1. Extend repositories table with open-world domain tags and knowledge JSON
ALTER TABLE repositories 
ADD COLUMN IF NOT EXISTS domain_tags TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS open_knowledge_json JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_repositories_domain_tags ON repositories USING gin(domain_tags);

-- 2. Open-world Knowledge Objects Table (Capabilities, Features, Concepts, Techniques, Use Cases, Interfaces, Components, etc.)
CREATE TABLE IF NOT EXISTS knowledge_objects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    repository_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    object_type VARCHAR(50) NOT NULL, -- 'capability', 'feature', 'concept', 'technique', 'use_case', 'component', 'interface', 'input', 'output', 'constraint', 'limitation', 'integration', 'repository_profile'
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100),
    importance VARCHAR(20) DEFAULT 'medium', -- 'critical', 'high', 'medium', 'low'
    confidence NUMERIC(3, 2) DEFAULT 0.90,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    embedding vector({{EMBEDDING_DIMENSIONS}}),
    tsv_content tsvector GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || description)) STORED,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_objects_repo ON knowledge_objects(repository_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_objects_type ON knowledge_objects(object_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_objects_name ON knowledge_objects(name);
CREATE INDEX IF NOT EXISTS idx_knowledge_objects_tsv ON knowledge_objects USING gin(tsv_content);

-- Conditionally create HNSW index for knowledge_objects embedding
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        BEGIN
            CREATE INDEX IF NOT EXISTS idx_knowledge_objects_embedding 
            ON knowledge_objects USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not create HNSW index on knowledge_objects: %', SQLERRM;
        END;
    END IF;
END $$;

-- 3. Knowledge Relationships Table (Semantic links between objects and repositories)
CREATE TABLE IF NOT EXISTS knowledge_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_id UUID NOT NULL REFERENCES knowledge_objects(id) ON DELETE CASCADE,
    target_id UUID REFERENCES knowledge_objects(id) ON DELETE CASCADE,
    source_repo_id UUID NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
    target_repo_id UUID REFERENCES repositories(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) NOT NULL, -- 'is-a', 'part-of', 'depends-on', 'extends', 'complements', 'overlaps-with', 'alternative-to', 'produces', 'consumes', 'enables'
    confidence NUMERIC(3, 2) DEFAULT 0.85,
    evidence_snippet TEXT,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_krel_source ON knowledge_relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_krel_target ON knowledge_relationships(target_id);
CREATE INDEX IF NOT EXISTS idx_krel_type ON knowledge_relationships(relationship_type);
CREATE INDEX IF NOT EXISTS idx_krel_repos ON knowledge_relationships(source_repo_id, target_repo_id);

-- 4. Connect evidence directly to knowledge_objects
ALTER TABLE evidence 
ADD COLUMN IF NOT EXISTS knowledge_object_id UUID REFERENCES knowledge_objects(id) ON DELETE CASCADE;

ALTER TABLE evidence 
ALTER COLUMN repository_capability_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_evidence_knowledge_obj ON evidence(knowledge_object_id);
