"""
Live monitoring and automatic rollback (PRODUCT_DEFINITION 9.2 step 9, SYSTEM_DESIGN 9).

People mark what a run recommended as useful or not (feedback table). Each verdict carries the tuning
version that produced the target, so the share of negative verdicts ("not useful", "wrong") can be
compared between the promoted version and the one it replaced. When the promoted version is worse by more
than ROLLBACK_MARGIN, on at least MIN_FEEDBACK verdicts each, and the difference is unlikely to be chance
(one-sided two-proportion z-test), the predecessor is promoted again and the rollback is logged.

The worker runs check() when idle, at most every MONITOR_INTERVAL_SECONDS.
"""
import math
import os
from typing import Any, Dict, Optional

from . import registry

MIN_FEEDBACK = 30
ROLLBACK_MARGIN = 0.10
Z_THRESHOLD = 1.64
MONITOR_INTERVAL_SECONDS = float(os.getenv("EVOLUTION_MONITOR_INTERVAL_SECONDS", str(6 * 3600)))

NEGATIVE = ("not_useful", "wrong")


def version_stats(db, version: Optional[str]) -> Dict[str, Any]:
    if version is None:
        return {"version": None, "total": 0, "negative": 0, "rate": None}
    row = registry._run(db, """
        SELECT COUNT(*), COUNT(*) FILTER (WHERE verdict IN %s) FROM feedback WHERE tuning_version = %s
    """, (NEGATIVE, version), fetch="one")
    total, negative = int(row[0]), int(row[1])
    return {"version": version, "total": total, "negative": negative, "rate": round(negative / total, 4) if total else None}


def predecessor(db, version: str) -> Optional[str]:
    """The version the promoted one replaced (its latest promotion event), else its parent."""
    row = registry._run(db, """
        SELECT active_before FROM evolution_events WHERE kind = 'promoted' AND version = %s ORDER BY created_at DESC, id DESC LIMIT 1
    """, (version,), fetch="one")
    if row:
        return row[0]
    row = registry._run(db, "SELECT parent_id FROM config_versions WHERE id = %s", (version,), fetch="one")
    return row[0] if row else None


def z_score(neg_a: int, n_a: int, neg_b: int, n_b: int) -> float:
    """How many standard errors rate a is above rate b (pooled two-proportion test)."""
    pooled = (neg_a + neg_b) / (n_a + n_b)
    se = math.sqrt(pooled * (1 - pooled) * (1 / n_a + 1 / n_b))
    if se == 0:
        return 0.0
    return (neg_a / n_a - neg_b / n_b) / se


def check(db, actor: str = "monitor") -> Dict[str, Any]:
    current = registry.promoted_version(db)
    if current is None:
        return {"action": "none", "reason": "Nothing promoted: the built-in defaults are active."}
    previous = predecessor(db, current)
    if previous is None:
        return {"action": "none", "version": current, "reason": "The promoted version has no predecessor to compare with."}
    now, before = version_stats(db, current), version_stats(db, previous)
    out: Dict[str, Any] = {"action": "none", "version": current, "previous": previous, "current": now, "predecessor": before}
    if now["total"] < MIN_FEEDBACK or before["total"] < MIN_FEEDBACK:
        out["reason"] = f"Not enough feedback yet ({now['total']} and {before['total']} verdicts; {MIN_FEEDBACK} each needed)."
        return out
    diff = now["rate"] - before["rate"]
    z = z_score(now["negative"], now["total"], before["negative"], before["total"])
    out.update({"difference": round(diff, 4), "z": round(z, 2)})
    if diff <= ROLLBACK_MARGIN or z < Z_THRESHOLD:
        out["reason"] = f"Within bounds: not-useful rate {now['rate']:.2f} against {before['rate']:.2f} (z {z:.2f})."
        return out
    reason = (f"Live regression: {now['negative']} of {now['total']} verdicts on {current} were negative ({now['rate']:.0%}) "
              f"against {before['negative']} of {before['total']} on {previous} ({before['rate']:.0%}); z {z:.2f}.")
    try:
        restored = registry.rollback(db, actor, reason, {"current": now, "predecessor": before, "difference": round(diff, 4), "z": round(z, 2)}, expected=current)
    except registry.EvolutionRefused as e:
        out["reason"] = f"Rollback refused: {e}"
        return out
    out.update({"action": "rolled_back", "restored": restored, "reason": reason})
    return out
