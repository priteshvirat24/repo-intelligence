import os
import math
import time
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
                batch_success = False
                for attempt in range(5):
                    try:
                        resp = client.post("https://api.mistral.ai/v1/embeddings", headers=headers, json=payload)
                        if resp.status_code == 429:
                            time.sleep(2 ** attempt + 0.5)
                            continue
                        resp.raise_for_status()
                        data = resp.json()
                        items = sorted(data.get("data", []), key=lambda item: item.get("index", 0))
                        if len(items) != len(batch):
                            raise RuntimeError(f"EMBEDDING_COUNT_MISMATCH: expected {len(batch)} vectors, got {len(items)}")
                        embeddings.extend(item["embedding"] for item in items)
                        batch_success = True
                        break
                    except httpx.HTTPStatusError as e:
                        if attempt == 4:
                            raise e
                        time.sleep(2 ** attempt)
                    except Exception as e:
                        if attempt == 4:
                            raise e
                        time.sleep(1)

                if not batch_success:
                    # Zero vectors make cosine distance NaN and silently poison retrieval; fail instead
                    raise RuntimeError("EMBEDDING_RATE_LIMITED: Mistral embeddings still rate-limited after 5 attempts")

        return embeddings

class OpenAIEmbeddingProvider(BaseEmbeddingProvider):
    """OpenAI Embeddings (text-embedding-3-small produces 1536-dimensional vectors)."""

    def __init__(self, api_key: str, model: str = "text-embedding-3-small", dimensions: int = 1536):
        self.api_key = api_key
        self.model = model
        self.dimensions = dimensions

    def get_dimensions(self) -> int:
        return self.dimensions

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
                    "input": batch,
                    # text-embedding-3 models can shorten vectors to match the pgvector column
                    "dimensions": self.dimensions
                }
                resp = client.post("https://api.openai.com/v1/embeddings", headers=headers, json=payload)
                resp.raise_for_status()
                data = resp.json()
                for item in data.get("data", []):
                    embeddings.append(item["embedding"])

        return embeddings

def get_embedding_provider() -> BaseEmbeddingProvider:
    """Returns the configured real embedding provider. There is deliberately no mock fallback."""
    provider = config.EMBEDDING_PROVIDER.strip()
    api_key = config.EMBEDDING_API_KEY.strip()

    if not api_key:
        raise RuntimeError("EMBEDDING_API_KEY is not set; refusing to index without a real embedding provider.")
    if provider == "mistral":
        return MistralEmbeddingProvider(api_key=api_key, model=config.EMBEDDING_MODEL)
    elif provider == "openai":
        # The default EMBEDDING_MODEL is Mistral's; don't send it to OpenAI
        model = config.EMBEDDING_MODEL if config.EMBEDDING_MODEL != "mistral-embed" else "text-embedding-3-small"
        return OpenAIEmbeddingProvider(api_key=api_key, model=model, dimensions=config.EMBEDDING_DIMENSIONS)
    raise RuntimeError(f"Unsupported EMBEDDING_PROVIDER={provider!r}; expected 'mistral' or 'openai'.")
