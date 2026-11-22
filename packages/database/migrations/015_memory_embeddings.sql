-- Embedding retrieval for memory recall (PRODUCT_DEFINITION 8: "embedding retrieval" was a gap).
-- Recall matched global claims and past run episodes by full-text search only, so a requirement worded
-- differently from a stored claim ("orbit propagation" vs "SGP4 satellite position prediction") was missed.
-- Claims and run episodes now carry an embedding of their text, filled by the worker's memory maintenance
-- pass (apps/worker/memory/embedding.py), and recall adds nearest-neighbour matches to the full-text ones.
-- embedded_hash is md5 of the text that was embedded: a row whose text changed is embedded again.
-- Safe to re-run (migrate.ts applies every file on each deploy).

ALTER TABLE claims ADD COLUMN IF NOT EXISTS embedding vector({{EMBEDDING_DIMENSIONS}});
ALTER TABLE claims ADD COLUMN IF NOT EXISTS embedded_hash VARCHAR(32);
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS embedding vector({{EMBEDDING_DIMENSIONS}});
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS embedded_hash VARCHAR(32);

DO $$
BEGIN
    BEGIN
        CREATE INDEX IF NOT EXISTS idx_claims_embedding ON claims USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
        CREATE INDEX IF NOT EXISTS idx_episodes_embedding ON episodes USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
    EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'Could not create HNSW indexes for memory embeddings, skipping: %', SQLERRM;
    END;
END $$;
