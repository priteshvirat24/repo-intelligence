"""
Evolution history and decisions on config_versions (SYSTEM_DESIGN 9).

The state changes themselves (promote, roll back, decide a proposal) are database functions from migration
013, shared with the web app, so a maintainer's approval and the auto-tuner follow the same rules: one
promoted version at a time, no promotion without benchmark runs as evidence, L4 never applied.
"""
from typing import Any, Dict, List, Optional

from psycopg2.extras import Json

from ..tuning import Tuning, default_tuning, load_active, register


class EvolutionRefused(Exception):
    """The database refused a promotion, rollback or decision (the message carries its EVOLUTION_* code)."""


def _run(db, query: str, params=(), fetch: str = "none"):
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            try:
                cur.execute(query, params)
            except Exception as e:
                conn.rollback()
                message = str(getattr(e, "pgerror", None) or e).strip()
                if "EVOLUTION_" in message:
                    raise EvolutionRefused(message[message.index("EVOLUTION_"):].splitlines()[0]) from e
                raise
            out = None
            if fetch == "one":
                out = cur.fetchone()
            elif fetch == "all":
                out = cur.fetchall()
            conn.commit()
            return out
    finally:
        conn.close()


def version_status(db, version: str) -> Optional[str]:
    row = _run(db, "SELECT status FROM config_versions WHERE id = %s", (version,), fetch="one")
    return row[0] if row else None


def promoted_version(db) -> Optional[str]:
    row = _run(db, "SELECT id FROM config_versions WHERE status = 'promoted' ORDER BY promoted_at DESC NULLS LAST LIMIT 1", fetch="one")
    return row[0] if row else None


def ensure_baseline(db) -> Tuning:
    """The active tuning, registered as the promoted version when nothing has been promoted yet (the built-in
    defaults are then what runs), so later promotions have a predecessor to roll back to."""
    active = load_active(db)
    if promoted_version(db) is None:
        register(db, active, status="promoted", notes="Built-in defaults, registered as the baseline")
        _run(db, "UPDATE config_versions SET status = 'promoted', promoted_at = COALESCE(promoted_at, NOW()) WHERE id = %s", (active.version,))
    return active


def promote(db, tuning: Tuning, evidence: Dict[str, Any], notes: str, actor: str, parent: Optional[str] = None) -> Optional[str]:
    """Registers and promotes a version. Returns the version it replaced."""
    register(db, tuning, status="candidate", parent=parent, notes=notes)
    row = _run(db, "SELECT evolution_promote(%s, %s, %s, %s)", (tuning.version, actor, Json(evidence), notes), fetch="one")
    return row[0]


def record_rejection(db, tuning: Tuning, evidence: Dict[str, Any], notes: str, actor: str, parent: Optional[str] = None) -> None:
    """A candidate that failed the gate: kept in the history with its evidence, never promoted."""
    register(db, tuning, status="rejected", parent=parent, notes=notes)
    _run(db, """
        UPDATE config_versions SET status = 'rejected', decided_at = NOW(), evidence_json = %s, notes = %s
        WHERE id = %s AND status IN ('candidate', 'rejected')
    """, (Json(evidence), notes, tuning.version))
    _run(db, """
        INSERT INTO evolution_events (kind, version, active_before, active_after, level, actor, evidence_json, notes)
        SELECT 'rejected', c.id, p.id, p.id, c.level, %s, %s, %s
        FROM config_versions c LEFT JOIN LATERAL (
            SELECT id FROM config_versions WHERE status = 'promoted' ORDER BY promoted_at DESC NULLS LAST LIMIT 1
        ) p ON TRUE
        WHERE c.id = %s
    """, (actor, Json(evidence), notes, tuning.version))


def rollback(db, actor: str, reason: str, evidence: Optional[Dict[str, Any]] = None, expected: Optional[str] = None) -> Optional[str]:
    """Re-promotes the predecessor of the promoted version. Returns the restored version (None: defaults)."""
    row = _run(db, "SELECT evolution_rollback(%s, %s, %s, %s)", (actor, reason, Json(evidence or {}), expected), fetch="one")
    return row[0]


def create_proposal(db, level: str, title: str, rationale: str, tuning: Optional[Tuning], overrides: Dict[str, Any],
                    evidence: Dict[str, Any], benchmark_win: bool, created_by: str) -> str:
    """An L2/L3 change waiting for a maintainer (or an L4 note for humans). The candidate version is
    registered as pending; it is promoted only by evolution_decide_proposal."""
    version = None
    base = load_active(db)
    if tuning is not None:
        register(db, tuning, status="pending", parent=base.version if version_status(db, base.version) else None, notes=title)
        version = tuning.version
    row = _run(db, """
        INSERT INTO evolution_proposals (level, title, rationale, config_version, base_version, overrides_json, evidence_json, benchmark_win, created_by)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id
    """, (level, title, rationale, version, base.version, Json(overrides), Json(evidence), benchmark_win, created_by), fetch="one")
    proposal_id = str(row[0])
    _run(db, """
        INSERT INTO evolution_events (kind, version, level, actor, proposal_id, evidence_json, notes)
        VALUES ('proposed', %s, %s, %s, %s, %s, %s)
    """, (version, level, created_by, proposal_id, Json(evidence), title))
    return proposal_id


def decide_proposal(db, proposal_id: str, approve: bool, actor: str, note: Optional[str] = None) -> str:
    row = _run(db, "SELECT evolution_decide_proposal(%s::uuid, %s, %s, %s)", (proposal_id, approve, actor, note), fetch="one")
    return row[0]


def events(db, limit: int = 50) -> List[Dict[str, Any]]:
    rows = _run(db, """
        SELECT kind, version, active_before, active_after, level, actor, notes FROM evolution_events
        ORDER BY created_at DESC, id DESC LIMIT %s
    """, (limit,), fetch="all")
    keys = ("kind", "version", "activeBefore", "activeAfter", "level", "actor", "notes")
    return [dict(zip(keys, r)) for r in rows]


def level_of(tuning: Tuning) -> str:
    base = default_tuning().values()
    changed = [k for k, v in tuning.values().items() if base.get(k) != v]
    return "L2" if any(Tuning.level(k) == "L2" for k in changed) else "L1"
