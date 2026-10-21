import json
import re
from typing import Any, List

from ..providers.llm import parse_json_object


def list_from_output(raw: str, key: str) -> List[Any]:
    """The model is asked for {key: [...]}, but even in JSON mode it sometimes returns the bare array.
    parse_json_object would then return the array's first element as if it were the whole answer."""
    text = raw.strip()
    fence = re.search(r'^```(?:json)?\s*([\s\S]*?)\s*```\s*$', text)
    if fence:
        text = fence.group(1)
    try:
        value = json.loads(text)
    except json.JSONDecodeError:
        value = parse_json_object(text)
    if isinstance(value, list):
        # [{"queries": [...]}]: the requested object wrapped in an array (seen from ministral-8b in JSON mode)
        if value and all(isinstance(v, dict) and isinstance(v.get(key), list) for v in value):
            return [item for v in value for item in v[key]]
        return value
    if isinstance(value, dict) and isinstance(value.get(key), list):
        return value[key]
    raise ValueError(f"LLM_INVALID_JSON: expected a {key!r} list in model output ({raw[:200]!r})")
