"""
Versioned tunable behaviour: the config registry (SYSTEM_DESIGN 9, PRODUCT_DEFINITION 9.1).

Every value that changes how well Open Eye discovers, ranks or writes (weights, thresholds, prompts,
model routing) is read from a Tuning object, never from a hard-coded constant at the point of use.
A Tuning is identified by a hash of its full content, so a run that records its tuning version can be
reproduced and compared, and a changed prompt or weight is always a different version.

The defaults are the module constants next to the code that uses them; overrides come from a promoted
row in config_versions (production) or from a file (evaluation candidates).
"""
import copy
import hashlib
import json
from typing import Any, Dict, Optional

# Level per key prefix (PRODUCT_DEFINITION 9.1): numbers and weights are L1, prompts and models are L2
L2_PREFIXES = ("prompts.", "models.")


class Tuning:
    def __init__(self, values: Dict[str, Any]):
        self._values = copy.deepcopy(values)
        canonical = json.dumps(self._values, sort_keys=True, separators=(",", ":"))
        self.version = "cfg-" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]

    def get(self, key: str) -> Any:
        return self._values[key]

    def values(self) -> Dict[str, Any]:
        return copy.deepcopy(self._values)

    def with_overrides(self, overrides: Dict[str, Any]) -> "Tuning":
        unknown = set(overrides) - set(self._values)
        if unknown:
            # A typo in a candidate config must fail loudly, not silently evaluate the baseline
            raise KeyError(f"Unknown tuning keys: {', '.join(sorted(unknown))}")
        merged = self.values()
        for key, value in overrides.items():
            if isinstance(merged[key], dict) and isinstance(value, dict):
                unknown_sub = set(value) - set(merged[key])
                if unknown_sub:
                    raise KeyError(f"Unknown keys for {key}: {', '.join(sorted(unknown_sub))}")
                merged[key] = {**merged[key], **value}
            else:
                merged[key] = value
        return Tuning(merged)

    @staticmethod
    def level(key: str) -> str:
        return "L2" if key.startswith(L2_PREFIXES) else "L1"


_DEFAULT: Optional[Tuning] = None


def default_tuning() -> Tuning:
    """The built-in defaults, collected from the modules that own them (imported lazily: those modules
    import this one)."""
    global _DEFAULT
    if _DEFAULT is None:
        from .discovery import assess, blueprint, planner, ranking, runner
        _DEFAULT = Tuning({
            "discovery.max_queries": planner.MAX_QUERIES,
            "discovery.max_query_words": planner.MAX_QUERY_WORDS,
            "discovery.results_per_query": runner.SEARCH_RESULTS_PER_QUERY,
            "discovery.min_stars": runner.MIN_STARS,
            "discovery.enough_results": runner.ENOUGH_RESULTS,
            "discovery.readme_assess_limit": runner.README_ASSESS_LIMIT,
            "discovery.max_stored_candidates": runner.MAX_STORED_CANDIDATES,
            "discovery.shortlist_size": runner.SHORTLIST_SIZE,
            "assess.batch_size": assess.BATCH_SIZE,
            "assess.max_requirements": assess.MAX_ASSESSED_REQUIREMENTS,
            "ranking.criticality_weight": dict(ranking.CRITICALITY_WEIGHT),
            "ranking.coverage_value": dict(ranking.COVERAGE_VALUE),
            "ranking.health_weights": dict(ranking.HEALTH_WEIGHTS),
            "ranking.relevance_weights": dict(ranking.RELEVANCE_WEIGHTS),
            "ranking.pre_weights": dict(ranking.PRE_WEIGHTS),
            "ranking.final_weights": dict(ranking.FINAL_WEIGHTS),
            "ranking.unassessed_factor": ranking.UNASSESSED_FACTOR,
            "ranking.non_implementation_factor": ranking.NON_IMPLEMENTATION_FACTOR,
            "ranking.duplicate_factor": ranking.DUPLICATE_FACTOR,
            "prompts.discovery_planner": planner.SYSTEM_PROMPT,
            "prompts.readme_assessment": assess.SYSTEM_PROMPT,
            "prompts.blueprint": blueprint.SYSTEM_PROMPT,
            # None: the provider's configured model (LLM_MODEL)
            "models.discovery": None,
            "models.blueprint": None,
        })
    return _DEFAULT


def resolve(tuning: Optional[Tuning]) -> Tuning:
    return tuning or default_tuning()


def load_tuning_file(path: str) -> Tuning:
    """A candidate configuration for evaluation: a JSON object of overrides on the defaults."""
    with open(path, encoding="utf-8") as f:
        return default_tuning().with_overrides(json.load(f))


# Registry (config_versions table)

def register(db, tuning: Tuning, status: str = "candidate", parent: Optional[str] = None, notes: str = "") -> str:
    """Stores a tuning version (idempotent on its content hash)."""
    from psycopg2.extras import Json
    changed = sorted(k for k, v in tuning.values().items() if v != default_tuning().get(k))
    level = "L2" if any(Tuning.level(k) == "L2" for k in changed) else "L1"
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO config_versions (id, parent_id, level, content, status, notes)
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                (tuning.version, parent, level, Json(tuning.values()), status, notes)
            )
            conn.commit()
    finally:
        conn.close()
    return tuning.version


def load_active(db) -> Tuning:
    """The most recently promoted version, or the built-in defaults when none has been promoted."""
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT content FROM config_versions WHERE status = 'promoted' ORDER BY promoted_at DESC NULLS LAST LIMIT 1")
            row = cur.fetchone()
    finally:
        conn.close()
    if not row:
        return default_tuning()
    # Keys added to the code since the version was promoted take their defaults
    stored = {k: v for k, v in row[0].items() if k in default_tuning().values()}
    return default_tuning().with_overrides(stored)
