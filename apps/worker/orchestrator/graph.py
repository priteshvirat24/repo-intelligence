"""
The run graph for a brief (SYSTEM_DESIGN 4): which tasks exist, what each depends on, and how a task's
inputs are fingerprinted so an unchanged task is not run again.
"""
import hashlib
import json
from typing import Any, Dict, List

# Task type -> the task types whose outputs it consumes. One row per type per brief (tasks table).
PIPELINE: Dict[str, List[str]] = {
    "understand": [],
    "discover": ["understand"],
    "verify": ["discover"],
    "execute": ["verify"],
    "blueprint": ["verify", "execute"],
}
ORDER = list(PIPELINE)


def downstream(task_type: str) -> List[str]:
    """Every task that depends on task_type, directly or not, in pipeline order."""
    found: List[str] = []
    frontier = [task_type]
    while frontier:
        current = frontier.pop()
        for t, deps in PIPELINE.items():
            if current in deps and t not in found:
                found.append(t)
                frontier.append(t)
    return [t for t in ORDER if t in found]


def ancestors(task_type: str) -> List[str]:
    """Every task task_type depends on, directly or not. A task runs only when all of them are done: a stale
    task further upstream means its direct inputs are out of date too."""
    found: List[str] = []
    frontier = list(PIPELINE[task_type])
    while frontier:
        current = frontier.pop()
        if current not in found:
            found.append(current)
            frontier.extend(PIPELINE[current])
    return [t for t in ORDER if t in found]


def digest(value: Any) -> str:
    canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
