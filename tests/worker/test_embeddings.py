import pytest
from apps.worker.providers.embeddings import MockEmbeddingProvider
from apps.worker.analyzer.chunker import SecretSanitizer

def test_mock_embedding_dimensions():
    provider = MockEmbeddingProvider(dimensions=1024)
    assert provider.get_dimensions() == 1024
    vecs = provider.embed_texts(["sample query", "another document"])
    assert len(vecs) == 2
    assert len(vecs[0]) == 1024
    assert len(vecs[1]) == 1024

def test_deterministic_embeddings():
    provider = MockEmbeddingProvider(dimensions=1024)
    vec1 = provider.embed_texts(["identical text"])[0]
    vec2 = provider.embed_texts(["identical text"])[0]
    assert vec1 == vec2

def test_secret_sanitization():
    raw_text = "API key sk-1234567890abcdef1234567890 and token ghp_123456789012345678901234567890123456"
    sanitized = SecretSanitizer.sanitize(raw_text)
    assert "sk-" not in sanitized
    assert "ghp_" not in sanitized
    assert "[REDACTED_API_KEY]" in sanitized
    assert "[REDACTED_GITHUB_TOKEN]" in sanitized
