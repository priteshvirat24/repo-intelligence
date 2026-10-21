"""
Evaluation harness (SYSTEM_DESIGN 10).

    python -m apps.worker.eval.run --suite eval/suite-v1 --system b1 --mode record
    python -m apps.worker.eval.run --suite eval/suite-v1 --system b1 --mode replay --requirements-from <run id>
    python -m apps.worker.eval.run --suite eval/suite-v1 --system b0 --mode replay

Systems: b0 (plain search baseline), b0s (the same, GitHub sorted by stars) and b1 (Open Eye: production decomposer, then discovery with the
given tuning). Modes: record (live, storing every GitHub/search response), replay (serving the snapshot;
a missing response fails that brief), fill (serving the snapshot and recording what is missing) and live.

LLM calls always run live; their tokens land in provider_usage under scope eval/<run id>:<brief>, and
the run's cost is read back from there. Results go to eval/results/<suite version>/<run id>.json.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import httpx

from ..config import config
from ..db.repository import DatabaseRepository
from ..discovery.github_search import GitHubSearchClient
from ..discovery.runner import DiscoveryRunner
from ..providers import ledger
from ..providers.llm import get_llm_provider
from ..tuning import default_tuning, load_tuning_file
from .baselines import run_b0
from .recording import RecordingTransport, ReplayMiss
from .suite import aggregate, load_suite, score_brief

ROOT = Path(__file__).resolve().parents[3]


def git_commit() -> str:
    try:
        return subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()
    except Exception:
        return "unknown"


def decompose(suite_dir: str, out_dir: Path, run_id: str):
    """B1 step 1: the production TypeScript decomposer, run as a script against the same database."""
    subprocess.run(
        ["npx", "tsx", "scripts/eval-decompose.ts", str(Path(suite_dir).resolve()), str(out_dir.resolve()), run_id],
        cwd=ROOT / "apps" / "web", check=True,
    )


def ledger_totals(db: DatabaseRepository, run_id: str) -> Dict[str, Dict[str, Any]]:
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT split_part(scope_id, ':', 2) AS brief, COUNT(*), COUNT(*) FILTER (WHERE NOT success),
                       COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
                       SUM(cost_cents), COUNT(*) FILTER (WHERE cost_cents IS NULL)
                FROM provider_usage WHERE scope_type = 'eval' AND scope_id LIKE %s GROUP BY 1
                """,
                (f"{run_id}:%",)
            )
            return {
                row[0]: {"llmCalls": row[1], "failedCalls": row[2], "inputTokens": row[3], "outputTokens": row[4],
                         "costCents": float(row[5]) if row[5] is not None and row[6] == 0 else None}
                for row in cur.fetchall()
            }
    finally:
        conn.close()


def pacing(transport: RecordingTransport, mode: str):
    """The runner's pause between searches respects GitHub's search quota. Only live requests count
    against it, so in replay and fill the pause is skipped when the last search came from the snapshot."""
    if mode == "replay":
        return lambda seconds: None
    last = {"fetched": transport.fetched}

    def sleep(seconds: float):
        if transport.fetched != last["fetched"]:
            time.sleep(seconds)
        last["fetched"] = transport.fetched
    return sleep


def main(argv: List[str] = None) -> int:
    parser = argparse.ArgumentParser(description="Open Eye evaluation harness")
    parser.add_argument("--suite", required=True)
    parser.add_argument("--system", choices=["b0", "b0s", "b1"], required=True)
    parser.add_argument("--mode", choices=["record", "replay", "fill", "live"], required=True)
    parser.add_argument("--tuning", help="JSON file of tuning overrides (B1)")
    parser.add_argument("--requirements-from", help="Reuse the decomposition of an earlier B1 run instead of decomposing again")
    parser.add_argument("--briefs", help="Comma-separated brief ids (default: all)")
    parser.add_argument("--note", default="")
    args = parser.parse_args(argv)

    suite = load_suite(args.suite)
    briefs = suite["briefs"]
    if args.briefs:
        wanted = set(args.briefs.split(","))
        briefs = [b for b in briefs if b["id"] in wanted]
    tuning = load_tuning_file(args.tuning) if args.tuning else default_tuning()
    run_id = f"{args.system}-{args.mode}-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}"
    snapshot_dir = ROOT / "eval" / "snapshots" / suite["version"]
    work_dir = ROOT / "eval" / "work"
    results_dir = ROOT / "eval" / "results" / suite["version"]
    results_dir.mkdir(parents=True, exist_ok=True)

    transport = RecordingTransport(str(snapshot_dir), args.mode)
    http = httpx.Client(transport=transport, timeout=30.0)
    db = DatabaseRepository()
    sink = ledger.DatabaseSink(db)
    ledger.add_sink(sink)

    requirements_dir = None
    if args.system == "b1":
        if args.requirements_from:
            requirements_dir = work_dir / args.requirements_from / "requirements"
        else:
            requirements_dir = work_dir / run_id / "requirements"
            decompose(args.suite, requirements_dir, run_id)

    per_brief = []
    for brief in briefs:
        started = time.time()
        entry: Dict[str, Any] = {"briefId": brief["id"], "domain": brief["domain"]}
        try:
            if args.system in ("b0", "b0s"):
                out = run_b0(brief, http, os.getenv("TAVILY_API_KEY"), sort="stars" if args.system == "b0s" else None)
                entry["details"] = out["details"]
            else:
                decomposition = json.loads((requirements_dir / f"{brief['id']}.json").read_text())
                github = GitHubSearchClient(http=http)
                runner = DiscoveryRunner(get_llm_provider(), github, tuning=tuning, sleep=pacing(transport, args.mode))
                with ledger.ledger_scope(scope_type="eval", scope_id=f"{run_id}:{brief['id']}", tuning_version=tuning.version):
                    result = runner.run(decomposition["requirements"])
                out = {
                    "ranked": [c["full_name"] for c in result["candidates"]],
                    "shortlisted": [c["full_name"] for c in result["candidates"] if c.get("shortlisted")],
                }
                entry["details"] = {
                    "decompositionMode": decomposition["mode"],
                    "requirements": [r["name"] for r in decomposition["requirements"].get("requirements", [])],
                    "queries": result["metrics"]["queries"],
                    "queryPlanner": result["metrics"]["queryPlanner"],
                    "readmesAssessed": result["metrics"]["readmesAssessed"],
                    "decompositionMs": decomposition.get("durationMs"),
                }
            entry["ranked"] = out["ranked"]
            entry["shortlisted"] = out["shortlisted"]
            entry["scores"] = score_brief(brief, out["ranked"], out["shortlisted"])
        except ReplayMiss as e:
            entry["error"] = f"REPLAY_MISS: {e}"
        except Exception as e:
            entry["error"] = f"{type(e).__name__}: {e}"
        entry["durationMs"] = int((time.time() - started) * 1000) + (entry.get("details", {}).get("decompositionMs") or 0)
        per_brief.append(entry)
        status = entry.get("error") or f"recall@10 {entry['scores']['recallAt10']}  shortlist precision {entry['scores']['shortlistPrecision']}"
        print(f"[eval] {brief['id']}: {status}", flush=True)

    ledger.remove_sink(sink)
    time.sleep(0.5)
    costs = ledger_totals(db, run_id)
    for entry in per_brief:
        entry["ledger"] = costs.get(entry["briefId"], {"llmCalls": 0, "failedCalls": 0, "inputTokens": 0, "outputTokens": 0, "costCents": 0.0 if args.system != "b1" else None})

    scored = [e["scores"] for e in per_brief if "scores" in e]
    llm_costs = [e["ledger"]["costCents"] for e in per_brief]
    run = {
        "runId": run_id,
        "suite": suite["version"],
        "labelsStatus": suite.get("labelsStatus"),
        "system": args.system,
        "mode": args.mode,
        "tuningVersion": tuning.version if args.system == "b1" else None,
        "requirementsFrom": args.requirements_from,
        "commit": git_commit(),
        "model": config.LLM_MODEL or None,
        "githubAuthenticated": bool(config.GITHUB_TOKEN),
        "note": args.note,
        "finishedAt": datetime.now(timezone.utc).isoformat(),
        "aggregate": {
            **aggregate(scored),
            "errors": sum(1 for e in per_brief if "error" in e),
            "meanDurationMs": int(sum(e["durationMs"] for e in per_brief) / max(1, len(per_brief))),
            "llmCalls": sum(e["ledger"]["llmCalls"] for e in per_brief),
            "inputTokens": sum(e["ledger"]["inputTokens"] for e in per_brief),
            "outputTokens": sum(e["ledger"]["outputTokens"] for e in per_brief),
            "costCents": round(sum(llm_costs), 4) if all(c is not None for c in llm_costs) else None,
        },
        "snapshot": {"recorded": transport.recorded, "replayed": transport.replayed, "fetchedLive": transport.fetched},
        "briefs": per_brief,
    }
    out_path = results_dir / f"{run_id}.json"
    out_path.write_text(json.dumps(run, indent=2))
    print(json.dumps(run["aggregate"], indent=2))
    print(f"[eval] wrote {out_path.relative_to(ROOT)}")
    return 1 if run["aggregate"]["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
