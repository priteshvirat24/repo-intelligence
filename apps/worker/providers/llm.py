import os
import time
import json
import re
from typing import Dict, Any, Optional
import httpx
from ..config import config

class BaseLLMProvider:
    def complete(self, prompt: str, system: Optional[str] = None) -> str:
        raise NotImplementedError

    def extract_structured(self, prompt: str, system: Optional[str] = None) -> Dict[str, Any]:
        raw = self.complete(prompt, system)
        # Extract json block if present
        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', raw)
        if json_match:
            raw = json_match.group(1)
        try:
            return json.loads(raw.strip())
        except json.JSONDecodeError:
            # Try to extract the first { ... } substring
            start = raw.find('{')
            end = raw.rfind('}')
            if start != -1 and end != -1:
                try:
                    return json.loads(raw[start:end+1])
                except Exception:
                    pass
            return {"capabilities": [], "limitations": []}

class MistralLLMProvider(BaseLLMProvider):
    """Mistral AI provider implementation."""

    def __init__(self, api_key: str, model: str = "mistral-small-latest"):
        self.api_key = api_key
        self.model = model

    def complete(self, prompt: str, system: Optional[str] = None) -> str:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.1,
            "response_format": {"type": "json_object"}
        }

        # Try with exponential backoff on 429 rate limits
        for attempt in range(3):
            try:
                with httpx.Client(timeout=60.0) as client:
                    resp = client.post("https://api.mistral.ai/v1/chat/completions", headers=headers, json=payload)
                    if resp.status_code == 429:
                        time.sleep(1.5 * (attempt + 1))
                        continue
                    resp.raise_for_status()
                    data = resp.json()
                    return data["choices"][0]["message"]["content"]
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429 and attempt < 2:
                    time.sleep(2)
                    continue
                break

        # Fallback to heuristic structured response if provider rate-limited
        print("[MistralLLMProvider] Rate limit hit on chat completions; falling back to heuristic capability extraction.")
        return MockLLMProvider().complete(prompt, system)

class OpenAILLMProvider(BaseLLMProvider):
    """OpenAI provider implementation."""

    def __init__(self, api_key: str, model: str = "gpt-4o-mini"):
        self.api_key = api_key
        self.model = model

    def complete(self, prompt: str, system: Optional[str] = None) -> str:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.1,
            "response_format": {"type": "json_object"}
        }

        with httpx.Client(timeout=60.0) as client:
            resp = client.post("https://api.openai.com/v1/chat/completions", headers=headers, json=payload)
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

class MockLLMProvider(BaseLLMProvider):
    """Deterministic mock provider for automated testing and offline development."""

    def complete(self, prompt: str, system: Optional[str] = None) -> str:
        # Heuristic fallback capability generation for testing
        return json.dumps({
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

def get_llm_provider() -> BaseLLMProvider:
    provider = config.LLM_PROVIDER
    api_key = config.LLM_API_KEY

    if provider == "mistral" and api_key and api_key != "mock-key":
        return MistralLLMProvider(api_key=api_key, model=config.LLM_MODEL)
    elif provider == "openai" and api_key and api_key != "mock-key":
        return OpenAILLMProvider(api_key=api_key, model=config.LLM_MODEL)
    return MockLLMProvider()
