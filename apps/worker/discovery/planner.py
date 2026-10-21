import re
from typing import Any, Dict, List, Tuple

from ..providers.llm import BaseLLMProvider
from .output import list_from_output

MAX_QUERIES = 8
# GitHub ANDs every keyword: long queries return almost nothing
MAX_QUERY_WORDS = 4
OVERALL = "(overall)"

_STOPWORDS = {
    "a", "an", "and", "the", "of", "for", "to", "in", "on", "with", "using", "via", "from", "by", "or",
    "is", "be", "that", "this", "it", "as", "at", "into", "support", "supports", "ability", "able",
    "capability", "system", "service", "feature", "features", "based", "need", "needs", "must", "should",
}

# Words that only cost results in an AND-search ("eci to wgs84" -> "eci wgs84")
_QUERY_FILLER = {"a", "an", "the", "to", "of", "for", "in", "on", "with", "from", "using", "via", "by", "and", "or"}

CONSTRAINT_TYPES = {"deployment", "performance"}

CRITICALITY_ORDER = {"MUST": 0, "SHOULD": 1, "NICE_TO_HAVE": 2}

SYSTEM_PROMPT = """You plan GitHub repository searches that find existing open-source implementations of a project's requirements.

Rules:
1. Each query is 2 or 3 plain keywords. GitHub only returns repositories matching every keyword, so more words means fewer results.
2. Use the words a repository's name, description or topics would contain: established technical terms, algorithm and format names, library categories (e.g. "sgp4 propagation", "webgl globe", "pdf table extraction"). No marketing words.
3. Search for capabilities only. Constraints such as programming language, hosting, team or performance targets are not searches.
4. No GitHub qualifiers (language:, stars:), no quotes, no boolean operators.
5. Cover every MUST capability; add one query for the overall product (e.g. "satellite tracker").
6. "requirement" must be copied exactly from the given requirement names, or be "(overall)".
7. Output strictly valid JSON."""


def plan_queries(llm: BaseLLMProvider, requirements_json: Dict[str, Any]) -> Tuple[List[Dict[str, str]], str]:
    """Returns ([{query, requirement}], mode). mode is "llm", or "heuristic" when the LLM output was unusable."""
    names = [r["name"] for r in capability_requirements(requirements_json)]
    try:
        raw = list_from_output(llm.complete(_user_prompt(requirements_json), SYSTEM_PROMPT), "queries")
        planned = validate_queries(raw, names)
        if len(planned) >= 2:
            return planned, "llm"
        print(f"[DiscoveryPlanner] LLM returned {len(planned)} usable queries; using requirement keywords instead")
    except Exception as e:
        print(f"[DiscoveryPlanner] LLM query planning failed ({e}); using requirement keywords instead")
    return heuristic_queries(requirements_json), "heuristic"


def _user_prompt(requirements_json: Dict[str, Any]) -> str:
    lines = [f"Problem: {requirements_json.get('problemSummary', '')}"]
    domains = requirements_json.get("domains") or []
    if domains:
        lines.append(f"Domains: {', '.join(domains[:5])}")
    lines.append("Requirements:")
    for r in capability_requirements(requirements_json)[:12]:
        lines.append(f"- [{r.get('criticality', 'SHOULD')}] {r.get('name')}: {r.get('description', '')}")
    expansions = requirements_json.get("queryExpansions") or []
    if expansions:
        lines.append(f"Related terms: {', '.join(expansions[:10])}")
    lines.append(f"""
Return JSON: {{"queries": [{{"query": "2-3 keywords", "requirement": "exact requirement name or (overall)"}}]}} with at most {MAX_QUERIES} queries.""")
    return "\n".join(lines)


def sorted_requirements(requirements_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    reqs = [r for r in requirements_json.get("requirements", []) if r.get("name")]
    return sorted(reqs, key=lambda r: CRITICALITY_ORDER.get(r.get("criticality"), 1))


def capability_requirements(requirements_json: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Requirements describing what the software must do. Deployment and performance requirements
    ("Backend in Python", "handles 10,000 satellites") are constraints: searching for them or scoring
    coverage on them surfaces generic templates. Falls back to all requirements if none are capabilities."""
    reqs = sorted_requirements(requirements_json)
    return [r for r in reqs if r.get("type") not in CONSTRAINT_TYPES] or reqs


def clean_query(text: Any) -> str:
    """Plain keywords only: drops qualifiers (word:value), quotes, operators and filler words, keeps at most 4 words."""
    words = []
    for word in str(text or "").split():
        if ":" in word or word.upper() in {"AND", "OR", "NOT"} or word.lower() in _QUERY_FILLER:
            continue
        word = re.sub(r"[^\w.+#-]", "", word).strip(".-")
        if word:
            words.append(word)
    return " ".join(words[:MAX_QUERY_WORDS])


def validate_queries(raw: Any, requirement_names: List[str]) -> List[Dict[str, str]]:
    """requirement_names are the capability requirements: a query the model wrote for any other
    requirement (a constraint it was told not to search for) is dropped."""
    by_lower = {name.lower(): name for name in requirement_names}
    planned, seen = [], set()
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        query = clean_query(item.get("query"))
        if len(query.split()) < 1 or len(query) < 3 or query.lower() in seen:
            continue
        named = str(item.get("requirement", "")).strip().lower()
        if named != OVERALL and named not in by_lower:
            continue
        requirement = by_lower.get(named, OVERALL)
        seen.add(query.lower())
        planned.append({"query": query, "requirement": requirement})
        if len(planned) >= MAX_QUERIES:
            break
    return planned


def keywords(text: str, limit: int = 4) -> str:
    words = [w for w in re.findall(r"[A-Za-z0-9][\w.+#-]*", text) if w.lower() not in _STOPWORDS and len(w) > 1]
    return " ".join(words[:limit])


def heuristic_queries(requirements_json: Dict[str, Any]) -> List[Dict[str, str]]:
    """Requirement names reduced to keywords, MUST first, plus the decomposer's own search expansions."""
    planned, seen = [], set()

    def add(query: str, requirement: str):
        query = clean_query(query)
        if len(query) >= 3 and query.lower() not in seen and len(planned) < MAX_QUERIES:
            seen.add(query.lower())
            planned.append({"query": query, "requirement": requirement})

    for r in capability_requirements(requirements_json):
        add(keywords(r["name"], 3), r["name"])
    for expansion in requirements_json.get("queryExpansions") or []:
        add(keywords(str(expansion), 3), OVERALL)
    if not planned:
        add(keywords(requirements_json.get("problemSummary", ""), 5), OVERALL)
    return planned
