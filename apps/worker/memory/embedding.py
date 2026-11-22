"""
Embeddings for memory recall (migration 015): which records are embedded, the backfill pass, and the query side.

Only what recall reads is embedded: global claims about GitHub repositories of the recalled kinds, and run
episodes. Embedding happens in the idle-time maintenance pass, in batches, so writing a claim never waits on
the embedding provider; a record whose text changed since it was embedded (embedded_hash) is embedded again.

Recall uses embeddings only when they are available: no EMBEDDING_API_KEY, a provider error or a record not
yet embedded all fall back to full-text search alone, which is how recall worked before.
"""
import sys
from typing import Any, Callable, Dict, List, Optional

# Records embedded per maintenance pass, and per provider request
MAX_PER_PASS = 256
BATCH_SIZE = 32
# Cosine similarity a nearest neighbour needs to count as a match. mistral-embed puts unrelated technical
# sentences around 0.6-0.7, so the bar sits well above that; calibrate on labelled briefs before lowering it.
CLAIM_MIN_SIMILARITY = 0.82
EPISODE_MIN_SIMILARITY = 0.85
# The claims recall reads (semantic.RECALL_KINDS): only these are worth embedding
RECALL_KINDS = ("capability", "readme_summary", "limitation")

_TARGETS = {
    "claims": ("statement", "brief_id IS NULL AND subject LIKE 'github:%%' AND status <> 'refuted' AND kind IN %s", (RECALL_KINDS,)),
    "episodes": ("search_text", "kind = 'run' AND search_text <> ''", ()),
}


def vector_literal(vector: List[float]) -> str:
    return "[" + ",".join(f"{x:.7g}" for x in vector) + "]"


def embed_pending(cur, embedder, limit: int = MAX_PER_PASS) -> Dict[str, int]:
    """Embeds up to `limit` records that have no embedding, or whose text changed since. Returns counts per table.
    The caller commits; a provider error propagates (the pass is retried at the next interval)."""
    counts: Dict[str, int] = {}
    remaining = limit
    for table, (column, where, params) in _TARGETS.items():
        if remaining <= 0:
            break
        cur.execute(
            f"""
            SELECT id::text, {column} FROM {table}
            WHERE {where} AND (embedding IS NULL OR embedded_hash IS DISTINCT FROM md5({column}))
            ORDER BY id LIMIT %s
            """,
            params + (remaining,)
        )
        rows = cur.fetchall()
        done = 0
        for start in range(0, len(rows), BATCH_SIZE):
            batch = rows[start:start + BATCH_SIZE]
            vectors = embedder.embed_texts([text[:2000] for _, text in batch])
            if len(vectors) != len(batch):
                raise ValueError(f"EMBEDDING_COUNT_MISMATCH: expected {len(batch)} vectors, got {len(vectors)}")
            for (row_id, text), vector in zip(batch, vectors):
                cur.execute(
                    f"UPDATE {table} SET embedding = %s::vector, embedded_hash = md5({column}) WHERE id = %s",
                    (vector_literal(vector), row_id)
                )
            done += len(batch)
        counts[table] = done
        remaining -= done
    return counts


def query_vectors(embedder, texts: List[str]) -> Optional[List[List[float]]]:
    """Vectors for recall's query texts, or None when embeddings are unavailable (recall then uses full text only)."""
    if embedder is None or not texts:
        return None
    try:
        vectors = embedder.embed_texts([t[:2000] for t in texts])
    except Exception as e:  # no key, rate limit, network: recall must still work
        print(f"[Memory] Embedding recall unavailable, using full-text only: {e}", file=sys.stderr, flush=True)
        return None
    return vectors if len(vectors) == len(texts) else None


def default_embedder() -> Optional[Any]:
    """The configured embedding provider, or None without a key (recall falls back to full text)."""
    from ..providers.embeddings import get_embedding_provider
    try:
        return get_embedding_provider()
    except RuntimeError:
        return None


def maintenance_pass(db, embedder_factory: Callable[[], Optional[Any]] = default_embedder, limit: int = MAX_PER_PASS) -> Dict[str, int]:
    """One backfill pass in its own transaction; {} when no embedding provider is configured."""
    embedder = embedder_factory()
    if embedder is None:
        return {}
    from ..providers import ledger
    conn = db.get_connection()
    try:
        with ledger.ledger_scope(scope_type="memory", scope_id="embedding", purpose="memory_embedding"):
            with conn.cursor() as cur:
                counts = embed_pending(cur, embedder, limit)
                conn.commit()
        return counts
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
