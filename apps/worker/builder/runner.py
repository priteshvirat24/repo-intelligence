"""
The build runner: claims authorised builds (same claim/lock rules as tasks, separate from the brief's run
graph), runs the coding loop in the sandbox inside the brief's budget, and stores the change set, its diff
and the test report. It never delivers anything: delivery is a separate, explicitly approved request.
"""
import threading
from typing import Any, Callable, Dict, Optional

from psycopg2.extras import Json, RealDictCursor

from ..config import config
from ..db.repository import DatabaseRepository, JobLostError
from ..orchestrator.store import DEFAULT_BUDGET, TaskStore
from ..providers import ledger
from ..sandbox import SandboxNotConfigured, SandboxProvider, get_sandbox_provider
from .loop import BuildLimits, build_report, final_files, make_diff, run_build_loop
from .scope import build_spec


def path_prefix(build_id: str) -> str:
    """Where the change set lands in the target repository: its own directory, so nothing is overwritten."""
    return f"open-eye/build-{str(build_id)[:8]}"


class BuildStore:
    def __init__(self, db: DatabaseRepository):
        self.db = db

    def claim_next(self, worker_id: str) -> Optional[Dict[str, Any]]:
        stale = f"locked_at < NOW() - INTERVAL '{config.JOB_LOCK_TIMEOUT_MINUTES} minutes'"
        conn = self.db.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    f"""
                    UPDATE builds SET status = 'failed', locked_at = NULL, locked_by = NULL, finished_at = NOW(), updated_at = NOW(),
                        error_message = COALESCE(error_message, 'Build abandoned after repeated worker failures')
                    WHERE status = 'running' AND {stale} AND attempts >= {config.MAX_JOB_ATTEMPTS}
                    """
                )
                cur.execute(
                    f"""
                    UPDATE builds SET status = 'running', step = 'STARTING', locked_at = NOW(), locked_by = %s, attempts = attempts + 1,
                        started_at = COALESCE(started_at, NOW()), updated_at = NOW()
                    WHERE id = (
                        SELECT id FROM builds
                        WHERE (status = 'queued' OR (status = 'running' AND {stale})) AND attempts < {config.MAX_JOB_ATTEMPTS}
                        ORDER BY created_at ASC LIMIT 1
                        FOR UPDATE SKIP LOCKED
                    )
                    RETURNING id, brief_id, workspace_id, scope_json, max_iterations, attempts
                    """,
                    (worker_id,)
                )
                build = cur.fetchone()
                conn.commit()
                return dict(build) if build else None
        finally:
            conn.close()

    def load(self, build: Dict[str, Any]) -> Dict[str, Any]:
        conn = self.db.get_connection()
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT b.id, b.title, b.constraints_json, b.requirements_json, b.understanding_json, b.budget_json,
                           bp.status AS blueprint_status, bp.blueprint_json
                    FROM briefs b LEFT JOIN brief_blueprints bp ON bp.brief_id = b.id
                    WHERE b.id = %s
                    """,
                    (build["brief_id"],)
                )
                row = cur.fetchone()
                if row is None:
                    raise JobLostError(f"Brief {build['brief_id']} was deleted")
                return dict(row)
        finally:
            conn.close()

    def _update(self, build_id: str, worker_id: str, sql: str, params: tuple):
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute(sql + " WHERE id = %s AND status = 'running' AND locked_by = %s", params + (build_id, worker_id))
                owned = cur.rowcount > 0
                conn.commit()
        finally:
            conn.close()
        if not owned:
            raise JobLostError(f"Build {build_id} is no longer owned by {worker_id}")

    def progress(self, build_id: str, worker_id: str, step: str, iteration: int):
        self._update(build_id, worker_id, "UPDATE builds SET step = %s, iterations = %s, locked_at = NOW(), updated_at = NOW()", (step, iteration))

    def heartbeat(self, build_id: str, worker_id: str):
        self._update(build_id, worker_id, "UPDATE builds SET locked_at = NOW()", ())

    def finish(self, build_id: str, worker_id: str, status: str, report: Dict[str, Any], files: Dict[str, str],
               diff: Optional[str], error: Optional[str] = None):
        self._update(
            build_id, worker_id,
            """
            UPDATE builds SET status = %s, step = 'DONE', iterations = %s, test_report_json = %s, files_json = %s, diff_text = %s,
                error_message = %s, locked_at = NULL, locked_by = NULL, finished_at = NOW(), updated_at = NOW()
            """,
            (status, int(report.get("iterations") or 0), Json(report), Json(files), diff, (error or None) and error[:1000])
        )

    def release(self, build_id: str, worker_id: str):
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SET lock_timeout = '3s'")
                cur.execute("UPDATE builds SET status = 'queued', locked_at = NULL, locked_by = NULL, updated_at = NOW() "
                            "WHERE id = %s AND locked_by = %s AND status = 'running'", (build_id, worker_id))
                conn.commit()
        finally:
            conn.close()


def status_for(report: Dict[str, Any]) -> str:
    """succeeded: every test passed. awaiting_approval: a change set a person must judge. failed: nothing usable."""
    if report["outcome"] == "passed":
        return "succeeded"
    if report["outcome"] in ("partial", "failed"):
        return "awaiting_approval"
    return "failed"


def process_build(db: DatabaseRepository, build: Dict[str, Any], llm_for: Callable[[str], Any], worker_id: str,
                  provider_factory: Callable[[], SandboxProvider] = get_sandbox_provider,
                  limits: Optional[BuildLimits] = None) -> str:
    """Runs one claimed build to its end; returns the final status."""
    store = BuildStore(db)
    build_id, brief_id = str(build["id"]), str(build["brief_id"])
    stop_beat = threading.Event()

    def beat():
        while not stop_beat.wait(60):
            try:
                store.heartbeat(build_id, worker_id)
            except Exception:
                return

    threading.Thread(target=beat, name=f"build-heartbeat-{build_id[:8]}", daemon=True).start()
    try:
        brief = store.load(build)
        blueprint = brief.get("blueprint_json") or {}
        if brief.get("blueprint_status") != "COMPLETED" or not blueprint:
            return _fail(store, build_id, worker_id, "The brief has no completed blueprint to build from")
        try:
            spec = build_spec(brief, blueprint, build.get("scope_json") or {})
        except ValueError as e:
            return _fail(store, build_id, worker_id, str(e))
        try:
            provider = provider_factory()
        except SandboxNotConfigured as e:
            return _fail(store, build_id, worker_id, f"No sandbox is available, so nothing was run: {e}")

        limits = limits or BuildLimits(max_iterations=max(1, min(int(build.get("max_iterations") or config.BUILD_MAX_ITERATIONS),
                                                                 config.BUILD_MAX_ITERATIONS)),
                                       max_sandbox_seconds=config.BUILD_MAX_SANDBOX_SECONDS)
        budget_cfg = brief.get("budget_json") or {}
        budget = ledger.Budget({**DEFAULT_BUDGET, **(budget_cfg.get("limits") or {})},
                               TaskStore(db).budget_usage(brief_id, budget_cfg.get("resetAt")))
        with ledger.budget_scope(budget), ledger.ledger_scope(scope_type="brief", scope_id=brief_id, purpose="build"):
            result = run_build_loop(llm_for("models.blueprint"), provider, spec, limits,
                                    on_progress=lambda step, n: store.progress(build_id, worker_id, step, n))
        report = build_report(spec, result)
        report["pathPrefix"] = path_prefix(build_id)
        files = final_files(result)
        status = status_for(report)
        diff = make_diff(files, report["pathPrefix"]) if files else None
        error = None
        if status == "failed":
            error = "The brief's budget was used up before any code was written" if result["stopReason"] == "budget" else \
                "No usable change set was produced"
        store.finish(build_id, worker_id, status, report, files, diff, error)
        print(f"[{worker_id}] Build {build_id} for brief {brief_id}: {status} ({report['outcome']}, {report['iterations']} iterations)", flush=True)
        return status
    except JobLostError as e:
        print(f"[{worker_id}] Abandoning build {build_id}: {e}", flush=True)
        return "lost"
    except Exception as e:
        try:
            return _fail(store, build_id, worker_id, f"Build failed: {str(e)[:500]}")
        except JobLostError:
            return "lost"
    finally:
        stop_beat.set()


def _fail(store: BuildStore, build_id: str, worker_id: str, message: str) -> str:
    store.finish(build_id, worker_id, "failed", {"outcome": "not_run", "iterations": 0, "needsHuman": [], "error": message}, {}, None, message)
    return "failed"
