"""
Test doubles for the worker's AI providers.

These live under tests/ on purpose: production code must never fall back to canned
LLM output or pseudo-embeddings (see apps/worker/providers/*.get_*_provider).
"""
import hashlib
import json
import math
from typing import List, Optional

from apps.worker.providers.embeddings import BaseEmbeddingProvider
from apps.worker.providers.llm import BaseLLMProvider


class FakeLLMProvider(BaseLLMProvider):
    """Returns one fixed JSON document covering the fields every analysis pass reads."""

    def complete(self, prompt: str, system: Optional[str] = None) -> str:
        return json.dumps({
            "purpose": "Test fixture repository",
            "problemSpace": "Test fixture problem space",
            "domains": ["test-domain"],
            "majorSubsystems": [],
            "capabilities": [
                {
                    "slug": "web-crawling",
                    "name": "Web Crawling",
                    "category": "Data Ingestion",
                    "confidence": 0.95,
                    "notes": "Automated crawling module",
                    "evidence": [
                        {
                            "file_path": "README.md",
                            "quote": "web crawler",
                            "symbol_name": None,
                            "evidence_type": "doc"
                        }
                    ]
                }
            ],
            "limitations": []
        })


class FakeEmbeddingProvider(BaseEmbeddingProvider):
    """Deterministic pseudo-embeddings for unit tests."""

    def __init__(self, dimensions: int = 1024):
        self.dims = dimensions

    def get_dimensions(self) -> int:
        return self.dims

    def embed_texts(self, texts: List[str]) -> List[List[float]]:
        results = []
        for text in texts:
            seed = int(hashlib.md5(text.encode("utf-8")).hexdigest()[:8], 16)
            vec = [math.sin((seed + i) * 0.1) for i in range(self.dims)]
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            results.append([v / norm for v in vec])
        return results
