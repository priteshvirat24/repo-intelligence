import os
import time
import json
import re
from typing import Dict, Any, Optional
import httpx
from ..config import config
from . import ledger


def _metered_post(client: httpx.Client, provider: str, model: str, url: str, headers: Dict[str, str], payload: Dict[str, Any]) -> httpx.Response:
    """POST a chat completion and record it in the cost ledger: tokens when the provider reports usage,
    failures (rate limits, errors, output cut off at the length limit) as unsuccessful calls."""
    started = time.time()
    try:
        resp = client.post(url, headers=headers, json=payload)
    except Exception as e:
        ledger.record(provider, "chat_completion", model, int((time.time() - started) * 1000), False, error=str(e))
        raise
    duration = int((time.time() - started) * 1000)
    if resp.status_code != 200:
        ledger.record(provider, "chat_completion", model, duration, False, error=f"HTTP {resp.status_code}")
        return resp
    try:
        data = resp.json()
        input_tokens, output_tokens = ledger.usage_tokens(data)
        truncated = (data.get("choices") or [{}])[0].get("finish_reason") == "length"
    except Exception:
        input_tokens = output_tokens = None
        truncated = False
    ledger.record(provider, "chat_completion", model, duration, not truncated, input_tokens, output_tokens,
                  error="output truncated at length limit" if truncated else None)
    return resp

class BaseLLMProvider:
    def complete(self, prompt: str, system: Optional[str] = None) -> str:
        raise NotImplementedError

    def extract_structured(self, prompt: str, system: Optional[str] = None) -> Dict[str, Any]:
        raw = self.complete(prompt, system)
        result = parse_json_object(raw)
        if result is None:
            # Never substitute an empty/default analysis: the job must fail visibly instead
            raise ValueError(f"LLM_INVALID_JSON: could not parse a JSON object from model output ({raw[:200]!r})")
        return result


def parse_json_object(raw: str) -> Optional[Dict[str, Any]]:
    """
    Extracts a JSON object from model output. Tries the raw text first: a valid response may
    itself contain ``` fences inside string values (e.g. quoted README install blocks), which a
    fence-first approach would cut apart.
    """
    text = raw.strip()
    candidates = [text]
    fence = re.search(r'^```(?:json)?\s*([\s\S]*?)\s*```\s*$', text)
    if fence:
        candidates.append(fence.group(1))
    for candidate in candidates:
        try:
            value = json.loads(candidate)
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            pass
    # Fall back to the outermost object embedded in surrounding prose ("Here you go: {...}"). Only the
    # first top-level "{" is tried: decoding from a later brace would return a nested fragment (one
    # evidence item) of a truncated response as if it were the whole answer.
    start = text.find('{')
    if start != -1:
        try:
            value, _ = json.JSONDecoder().raw_decode(text, start)
            if isinstance(value, dict):
                return value
        except json.JSONDecodeError:
            pass
    return None

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

        # Try with exponential backoff on rate limits and timeouts
        for attempt in range(3):
            try:
                with httpx.Client(timeout=120.0) as client:
                    resp = _metered_post(client, "mistral", self.model, "https://api.mistral.ai/v1/chat/completions", headers, payload)
                    if resp.status_code == 429:
                        time.sleep(2.0 * (attempt + 1))
                        continue
                    resp.raise_for_status()
                    return _completion_text(resp.json())
            except (httpx.HTTPStatusError, httpx.RequestError, httpx.TimeoutException) as e:
                print(f"[MistralLLMProvider] Attempt {attempt + 1}/3 error: {e}")
                if attempt < 2:
                    time.sleep(2.0 * (attempt + 1))
                    continue
                break
            except Exception as e:
                print(f"[MistralLLMProvider] Unexpected error on attempt {attempt + 1}: {e}")
                if attempt < 2:
                    time.sleep(2.0)
                    continue
                break

        # Fail the job rather than persisting canned mock output as if it were real analysis
        raise RuntimeError("LLM_UNAVAILABLE: Mistral chat completions failed after 3 attempts")

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
            resp = _metered_post(client, "openai", self.model, "https://api.openai.com/v1/chat/completions", headers, payload)
            resp.raise_for_status()
            return _completion_text(resp.json())


def _completion_text(data: Dict[str, Any]) -> str:
    """Returns the completion text, refusing output the model did not finish (cut off at the length limit)."""
    choice = data["choices"][0]
    if choice.get("finish_reason") == "length":
        raise ValueError("LLM_INVALID_JSON: model output was truncated at the length limit")
    return choice["message"]["content"]


def get_llm_provider(model: Optional[str] = None) -> BaseLLMProvider:
    """Returns the configured real LLM provider. There is deliberately no mock fallback.
    model overrides LLM_MODEL (model routing from the active tuning)."""
    provider = config.LLM_PROVIDER.strip()
    api_key = config.LLM_API_KEY.strip()

    if not api_key:
        raise RuntimeError("LLM_API_KEY is not set; refusing to analyze repositories without a real LLM provider.")
    if provider == "mistral":
        return MistralLLMProvider(api_key=api_key, model=model or config.LLM_MODEL or "mistral-small-latest")
    if provider == "openai":
        return OpenAILLMProvider(api_key=api_key, model=model or config.LLM_MODEL or "gpt-4o-mini")
    raise RuntimeError(f"Unsupported LLM_PROVIDER={provider!r}; expected 'mistral' or 'openai'.")
