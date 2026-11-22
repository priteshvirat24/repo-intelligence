"""Embedding retrieval for memory recall (migration 015, apps/worker/memory/embedding.py), with a fake embedder."""
import pytest

from apps.worker import claims, memory
from apps.worker.memory import embedding
from apps.worker.memory.embedding import embed_pending, query_vectors

from tests.worker.test_memory import ORBIT, REQUIREMENTS, brief, candidate, conn, db, finish_run, workspace  # noqa: F401 (fixtures)

DIMENSIONS = 1024
# Words of one concept land on the same axis, so the cosine similarity is exactly 1 within a concept, 0 across
CONCEPTS = [
    {"satellite", "satellites", "orbit", "orbits", "sgp4", "spacecraft", "tle", "propagation", "propagate", "ephemeris"},
    {"invoice", "invoices", "ocr", "receipt"},
]


class ConceptEmbedder:
    def __init__(self):
        self.calls = 0
        self.texts = []

    def embed_texts(self, texts):
        self.calls += 1
        self.texts += texts
        out = []
        for text in texts:
            words = {w.strip(".,:;()").lower() for w in text.split()}
            axis = next((i for i, c in enumerate(CONCEPTS) if words & c), len(CONCEPTS))
            out.append([1.0 if d == axis else 0.0 for d in range(DIMENSIONS)])
        return out


SPACECRAFT = "Predicts where spacecraft will be from two-line element sets"


def test_backfill_embeds_recall_claims_once_and_again_after_a_text_change(conn):
    with conn.cursor() as cur:
        claim_id = claims.upsert_claim(cur, "github:p4test-emb/predictor", "capability", SPACECRAFT, "E2", {"method": "code_located"})
        project = claims.upsert_claim(cur, "github:p4test-emb/predictor", "maintenance", "Last push on 2026-01-01", "E3", {"method": "platform_api"})
        fake = ConceptEmbedder()
        embed_pending(cur, fake, limit=100000)
        cur.execute("SELECT embedding IS NOT NULL, embedded_hash = md5(statement) FROM claims WHERE id = %s", (claim_id,))
        assert cur.fetchone() == (True, True)
        cur.execute("SELECT embedding IS NULL FROM claims WHERE id = %s", (project,))
        assert cur.fetchone() == (True,)  # maintenance claims are not read by recall: not embedded
        before = len(fake.texts)
        embed_pending(cur, fake, limit=100000)
        assert SPACECRAFT not in fake.texts[before:]  # unchanged text is not embedded again
        cur.execute("UPDATE claims SET statement = statement || ' and debris' WHERE id = %s", (claim_id,))
        embed_pending(cur, fake, limit=100000)
        assert SPACECRAFT + " and debris" in fake.texts[before:]


def test_recall_finds_a_claim_worded_differently_only_with_embeddings(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        claims.upsert_claim(cur, "github:p4test-emb/predictor", "capability", SPACECRAFT, "E2", {"method": "code_located"})
        embed_pending(cur, ConceptEmbedder(), limit=100000)
        b = brief(cur, ws, discovered=False)
        words_only = memory.recall(cur, {"id": b, "workspace_id": ws, "title": "Satellite tracker"}, REQUIREMENTS)
        assert "p4test-emb/predictor" not in [c["fullName"] for c in words_only["candidates"]]
        assert words_only["embeddingRecall"] is False
        fake = ConceptEmbedder()
        with_meaning = memory.recall(cur, {"id": b, "workspace_id": ws, "title": "Satellite tracker"}, REQUIREMENTS, embedder=fake)
        found = {c["fullName"]: c for c in with_meaning["candidates"]}
        assert "p4test-emb/predictor" in found and "embedding" in found["p4test-emb/predictor"]["via"]
        assert found["p4test-emb/predictor"]["matchedRequirements"] == [ORBIT["name"]]
        assert fake.calls == 1 and with_meaning["embeddingRecall"] is True  # one request for the whole brief


def test_an_unrelated_claim_is_not_recalled_by_embedding(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        claims.upsert_claim(cur, "github:p4test-emb/scanner", "capability", "Reads totals from scanned receipts", "E2", {"method": "code_located"})
        embed_pending(cur, ConceptEmbedder(), limit=100000)
        b = brief(cur, ws, discovered=False)
        result = memory.recall(cur, {"id": b, "workspace_id": ws, "title": "Satellite tracker"}, REQUIREMENTS, embedder=ConceptEmbedder())
        assert "p4test-emb/scanner" not in [c["fullName"] for c in result["candidates"]]


def test_similar_runs_are_found_by_meaning(conn):
    with conn.cursor() as cur:
        ws = workspace(cur)
        past = brief(cur, ws, "Spacecraft ephemeris viewer", {"problemSummary": "Show where spacecraft are", "requirements": [
            {"name": "Ephemeris", "description": "spacecraft ephemeris", "criticality": "MUST"}]})
        candidate(cur, past, "p4test-emb/viewer", shortlisted=True)
        finish_run(cur, past)
        embed_pending(cur, ConceptEmbedder(), limit=100000)
        now = brief(cur, ws, "Satellite tracker", discovered=False)
        # Few shared words, so full text alone may miss it; by meaning it is the same problem
        similar = memory.recall(cur, {"id": now, "workspace_id": ws, "title": "Satellite tracker"}, REQUIREMENTS,
                                embedder=ConceptEmbedder())["similarEpisodes"]
        assert past in [e["briefId"] for e in similar]
        match = next(e for e in similar if e["briefId"] == past)
        assert match["similarity"] == pytest.approx(1.0)


def test_a_failing_embedder_falls_back_to_full_text(conn):
    class Failing:
        def embed_texts(self, texts):
            raise RuntimeError("EMBEDDING_RATE_LIMITED: 429")

    assert query_vectors(Failing(), ["x"]) is None and query_vectors(None, ["x"]) is None
    with conn.cursor() as cur:
        ws = workspace(cur)
        b = brief(cur, ws, discovered=False)
        result = memory.recall(cur, {"id": b, "workspace_id": ws, "title": "Satellite tracker"}, REQUIREMENTS, embedder=Failing())
        assert result["embeddingRecall"] is False


def test_maintenance_pass_does_nothing_without_a_provider(db):
    assert embedding.maintenance_pass(db, lambda: None) == {}
