"""
Open Eye's memory (PRODUCT_DEFINITION 8, SYSTEM_DESIGN 8): one API per memory type, so other code never
queries the memory tables directly.

  semantic    facts about the world: graded claims, source reliability, revalidation
  episodic    what happened in a run: run and event episodes, build and test experiences
  procedural  how to do things: procedures distilled from episodes and strategy records

Every record carries provenance, a timestamp, a confidence or grade, a scope and a revalidation rule.
"""
from ..discovery.planner import capability_requirements
from .embedding import query_vectors
from .episodic import list_episodes, record_event, record_experience, record_run, search_text, similar_episodes
from .procedural import ProcedureError, activate, active_for, distill, list_procedures, record_outcome, retire
from .revalidation import MemoryMaintenance, check_subject, run_pass
from .semantic import (confirm_claim, corroborate_coverage, merge_remembered, recall_candidates, refute_claim,
                       reliability, search_claims)
from .strategy import ingest as ingest_strategy_records


def recall(cur, brief, requirements, embedder=None):
    """The recall task's read across all three types for one brief: remembered candidates (semantic),
    similar past runs (episodic) and the active procedures that match it (procedural).
    embedder (the embedding provider, optional) adds matches by meaning to the full-text ones: one request
    embeds every requirement and the brief; without it, or if it fails, recall is full-text only."""
    workspace_id = str(brief["workspace_id"]) if brief.get("workspace_id") else None
    brief_id = str(brief["id"]) if brief.get("id") else None
    reqs = capability_requirements(requirements or {})
    title = brief.get("title") or ""
    texts = [f"{r['name']} {r.get('description', '')}".strip() for r in reqs] + [search_text(title, requirements or {})]
    vectors = query_vectors(embedder, texts)
    remembered = recall_candidates(cur, workspace_id, brief_id, requirements, vectors=vectors[:len(reqs)] if vectors else None)
    return {
        "candidates": remembered["candidates"],
        "skipRequirements": remembered["skipRequirements"],
        "similarEpisodes": similar_episodes(cur, workspace_id, brief_id, title, requirements,
                                            vector=vectors[-1] if vectors else None),
        "procedures": active_for(cur, workspace_id, requirements),
        "embeddingRecall": vectors is not None,
    }


__all__ = [
    "recall", "recall_candidates", "merge_remembered", "search_claims", "refute_claim", "confirm_claim", "corroborate_coverage",
    "reliability", "run_pass", "check_subject", "MemoryMaintenance",
    "record_run", "record_event", "record_experience", "similar_episodes", "list_episodes",
    "distill", "active_for", "record_outcome", "activate", "retire", "list_procedures", "ProcedureError",
    "ingest_strategy_records",
]
