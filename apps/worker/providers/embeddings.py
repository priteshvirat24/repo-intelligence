import os
import math
import hashlib
from typing import List, Dict, Any, Optional
import httpx
from ..config import config

class BaseEmbeddingProvider:
    def get_dimensions(self) -> int:
        raise NotImplementedError

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        raise NotImplementedError

class MistralEmbeddingProvider(BaseEmbeddingProvider):
    """Mistral AI Embeddings (mistral-embed produces 1024-dimensional vectors)."""

    def __init__(self, api_key: str, model: str = "mistral-embed"):
        self.api_key = api_key
        self.model = model

    def get_dimensions(self) -> int:
        return 1024

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        embeddings: List[List[float]] = []
        batch_size = 32  # Mistral API supports batch embedding requests

        with httpx.Client(timeout=60.0) as client:
            for i in range(0, len(texts), batch_size):
                batch = texts[i:i+batch_size]
                payload = {
                    "model": self.model,
                    "input": batch
                }
                resp = client.post("https://api.mistral.ai/v1/embeddings", headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
                for item in data.get("data", []):
                    embeddings.append(item["embedding"])

        return embeddings

class OpenAIEmbeddingProvider(BaseEmbeddingProvider):
    """OpenAI Embeddings (text-embedding-3-small produces 1536-dimensional vectors)."""

    def __init__(self, api_key: str, model: str = "text-embedding-3-small"):
        self.api_key = api_key
        self.model = model

    def get_dimensions(self) -> int:
        return 1536

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }

        embeddings: List[List[float]] = []
        batch_size = 64

        with httpx.Client(timeout=60.0) as client:
            for i in range(0, len(texts), batch_size):
                batch = texts[i:i+batch_size]
                payload = {
                    "model": self.model,
                    "input": batch
                }
                resp = client.post("https://api.openai.com/v1/embeddings", headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
                for item in data.get("data", []):
                    embeddings.append(item["embedding"])

        return embeddings

class MockEmbeddingProvider(BaseEmbeddingProvider):
    """Deterministic pseudo-embeddings for testing and offline development."""

    def __init__(self, dimensions: int = 1024):
        self.dims = dimensions

    def get_dimensions(self) -> int:
        return self.dims

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        results = []
        dim = self.get_dimensions()

        for text in texts:
            h = hashlib.md5(text.encode("utf-8")).hexdigest()
            seed = int(h[:8], 16)
            vec = []
            for i in range(dim):
                vec.append(math.sin((seed + i) * 0.1))
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            results.append([v / norm for v in vec])

        return results

def get_embedding_provider() -> BaseEmbeddingProvider:
    provider = config.EMBEDDING_PROVIDER
    api_key = config.EMBEDDING_API_KEY

    if provider == "mistral" and api_key and api_key != "mock-key":
        return MistralEmbeddingProvider(api_key=api_key, model=config.EMBEDDING_MODEL)
    elif provider == "openai" and api_key and api_key != "mock-key":
        return OpenAIEmbeddingProvider(api_key=api_key, model=config.EMBEDDING_MODEL)
    return MockEmbeddingProvider(dimensions=config.EMBEDDING_DIMENSIONS)
