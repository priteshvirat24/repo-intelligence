"""
Strategy records (procedural memory's measured input): what each evaluation run measured, per brief class
(the briefs' domain, plus 'all'), and with which tuning version. Ingested from the result files the
evaluation harness writes (eval/results/<suite>/*.json); re-ingesting a file updates its records.

    python -m apps.worker.memory.strategy eval/results/suite-v1          # a directory or files
"""
import glob
import json
import os
import sys
from typing import Any, Dict, Iterable, List

from psycopg2.extras import Json

# Per-brief scores averaged into a brief class's metrics
BRIEF_METRICS = ("recallAt10", "recallAll", "shortlistPrecision", "trapRejection")


def records_from_result(result: Dict[str, Any], source_file: str = "") -> List[Dict[str, Any]]:
    """One record for the whole run ('all', its aggregate) and one per domain (mean of its briefs)."""
    base = {
        "run_id": result["runId"], "suite": result.get("suite"), "system": result.get("system"), "mode": result.get("mode"),
        "tuning_version": result.get("tuningVersion"), "tuning_name": result.get("tuningName"), "code_commit": result.get("commit"),
        "model": result.get("model"), "labels_status": result.get("labelsStatus"), "source_file": source_file,
        "finished_at": result.get("finishedAt"),
    }
    aggregate = result.get("aggregate") or {}
    records = [{**base, "brief_class": "all", "briefs": int(aggregate.get("briefs") or len(result.get("briefs") or [])), "metrics": aggregate}]
    by_domain: Dict[str, List[Dict[str, Any]]] = {}
    for brief in result.get("briefs") or []:
        if brief.get("domain") and isinstance(brief.get("scores"), dict):
            by_domain.setdefault(brief["domain"], []).append(brief)
    for domain, briefs in sorted(by_domain.items()):
        metrics: Dict[str, Any] = {}
        for key in BRIEF_METRICS:
            values = [b["scores"][key] for b in briefs if isinstance(b["scores"].get(key), (int, float))]
            if values:
                metrics[key] = round(sum(values) / len(values), 4)
        durations = [b["durationMs"] for b in briefs if isinstance(b.get("durationMs"), (int, float))]
        if durations:
            metrics["meanDurationMs"] = int(sum(durations) / len(durations))
        calls = [(b.get("ledger") or {}).get("llmCalls") for b in briefs]
        if all(isinstance(c, int) for c in calls) and calls:
            metrics["llmCalls"] = sum(calls)
        metrics["briefIds"] = [b.get("briefId") for b in briefs]
        records.append({**base, "brief_class": domain, "briefs": len(briefs), "metrics": metrics})
    return records


def ingest(cur, paths: Iterable[str]) -> Dict[str, int]:
    """Ingests result files (or directories of them). Returns counts of files and records."""
    files: List[str] = []
    for path in paths:
        files += sorted(glob.glob(os.path.join(path, "*.json"))) if os.path.isdir(path) else [path]
    written = 0
    for path in files:
        with open(path, encoding="utf-8") as f:
            try:
                result = json.load(f)
            except json.JSONDecodeError:
                continue
        if not isinstance(result, dict) or "runId" not in result:
            continue
        for r in records_from_result(result, os.path.relpath(path)):
            cur.execute(
                """
                INSERT INTO strategy_records (run_id, suite, brief_class, system, mode, tuning_version, tuning_name, code_commit,
                    model, briefs, metrics_json, labels_status, source_file, finished_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (run_id, brief_class) DO UPDATE SET metrics_json = EXCLUDED.metrics_json, briefs = EXCLUDED.briefs,
                    tuning_version = EXCLUDED.tuning_version, tuning_name = EXCLUDED.tuning_name, labels_status = EXCLUDED.labels_status,
                    source_file = EXCLUDED.source_file, finished_at = EXCLUDED.finished_at
                """,
                (r["run_id"], r["suite"], r["brief_class"], r["system"], r["mode"], r["tuning_version"], r["tuning_name"],
                 r["code_commit"], r["model"], r["briefs"], Json(r["metrics"]), r["labels_status"], r["source_file"], r["finished_at"])
            )
            written += 1
    return {"files": len(files), "records": written}


def main(argv: List[str]) -> int:
    from ..db.repository import DatabaseRepository
    from .procedural import distill
    if not argv:
        print(__doc__)
        return 2
    db = DatabaseRepository()
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            counts = ingest(cur, argv)
            counts.update(distill(cur))
            conn.commit()
    finally:
        conn.close()
    print(f"[Memory] Ingested {counts['records']} strategy records from {counts['files']} files; {counts['proposed']} procedures proposed")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
