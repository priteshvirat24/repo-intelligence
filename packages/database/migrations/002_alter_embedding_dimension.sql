-- Controlled migration script for switching embedding vector dimension
-- Usage: Replace 1024/1536 with target EMBEDDING_DIMENSIONS and execute

DO $$
DECLARE
    target_dim INTEGER := 1024; -- Change to desired dimension (e.g. 1536 for OpenAI)
BEGIN
    -- Drop old HNSW index
    DROP INDEX IF EXISTS idx_chunks_embedding;
    
    -- Truncate or alter column to new dimension
    ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(1024);
    
    -- Recreate HNSW index
    CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
    
    RAISE NOTICE 'Successfully altered embedding column dimension to %', target_dim;
END $$;
