def pytest_configure(config):
    config.addinivalue_line("markers", "docker: runs a real container through the local docker daemon (skipped when docker is unavailable)")


import pytest


@pytest.fixture(autouse=True)
def no_real_embeddings(monkeypatch):
    """Tests never call a real embedding provider, even when the developer's .env has a key: memory recall and
    the maintenance pass then fall back to full text, as they do without a key. Tests that need embeddings
    pass a fake embedder explicitly."""
    from apps.worker.memory import embedding
    from apps.worker.orchestrator import handlers
    monkeypatch.setattr(embedding, "default_embedder", lambda: None)
    monkeypatch.setattr(handlers, "default_embedder", lambda: None)
