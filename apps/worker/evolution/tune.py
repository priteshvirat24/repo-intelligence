"""
L1 auto-tuning under the gate (PRODUCT_DEFINITION 9.1 L1, 9.2; SYSTEM_DESIGN 9).

    python -m apps.worker.evolution.tune --suite eval/suite-v1
    python -m apps.worker.evolution.tune --suite eval/suite-v1 --candidate my-weights.json   # gate one candidate
    python -m apps.worker.evolution.tune --suite eval/suite-v1 --dry-run                     # decide, write nothing

1. Baseline: the promoted tuning (config_versions, or the built-in defaults).
2. Evidence: the stored B1 runs of that tuning, or of a tuning that differs from it only in keys the
   re-ranking can decide (offline.OFFLINE_EXACT_KEYS), that carry ranking features. Every brief must
   reproduce its stored ranking under its run's own tuning before it is used.
3. Search: every single-key change on a fixed grid, plus seeded random combinations, re-ranked offline.
4. Gate: the best candidate must beat the baseline's run-to-run noise on recall@10 (or, with recall@10
   unchanged, on shortlist precision) in every run, with no guard regression (gate.py).
5. Decision: accepted, the candidate is registered and promoted automatically, with its evidence; rejected,
   it is registered as rejected with its evidence. Both are evolution events. A version once rejected or
   rolled back is never re-proposed automatically.

Runs recorded before features were stored cannot be used: run the harness again (eval/README.md).
"""
import argparse
import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from ..eval.suite import load_suite
from ..tuning import Tuning, default_tuning, load_active
from . import gate as gate_rules
from . import offline

ROOT = Path(__file__).resolve().parents[3]

# The grid each OFFLINE_EXACT_KEYS key is searched on
WEIGHT_STEP = 0.05


def weight_grid() -> List[Dict[str, float]]:
    out = []
    steps = int(round(1 / WEIGHT_STEP))
    for c in range(4, 15):           # coverage 0.20 .. 0.70
        for h in range(1, 11):       # health 0.05 .. 0.50
            r = steps - c - h        # relevance takes the rest, at least 0.05
            if r >= 1:
                out.append({"coverage": round(c * WEIGHT_STEP, 2), "relevance": round(r * WEIGHT_STEP, 2), "health": round(h * WEIGHT_STEP, 2)})
    return out


GRID: Dict[str, List[Any]] = {
    "ranking.final_weights": weight_grid(),
    "ranking.coverage_value": [{"partial": v} for v in (0.25, 0.5, 0.75)],
    "ranking.unassessed_factor": [0.4, 0.5, 0.6, 0.7, 0.8],
    "ranking.non_implementation_factor": [0.3, 0.4, 0.5, 0.6, 0.7],
    "ranking.duplicate_factor": [0.1, 0.2, 0.3, 0.4, 0.5],
    "discovery.shortlist_size": [4, 5, 6, 7, 8],
    "discovery.shortlist_max_stale_days": [365, 548, 730, 1095, 1460],
}
# discovery.max_stored_candidates only moves recall over all kept candidates, not the targets
assert set(GRID) <= set(offline.OFFLINE_EXACT_KEYS)


def candidates(base: Tuning, samples: int, seed: int) -> List[Tuple[Dict[str, Any], Tuning]]:
    """Single-key changes on the grid, then `samples` random combinations; identical tunings once."""
    seen = {base.version}
    out = []

    def add(overrides):
        t = base.with_overrides(overrides)
        if t.version not in seen:
            seen.add(t.version)
            out.append((overrides, t))

    for key, values in GRID.items():
        for v in values:
            add({key: v})
    rng = random.Random(seed)
    for _ in range(samples):
        keys = rng.sample(list(GRID), rng.randint(2, len(GRID)))
        add({k: rng.choice(GRID[k]) for k in keys})
    return out


def load_runs(results_dir: Path) -> List[Dict[str, Any]]:
    runs = []
    for path in sorted(results_dir.glob("*.json")):
        try:
            run = json.loads(path.read_text())
        except ValueError:
            continue
        if run.get("system") == "b1" and isinstance(run.get("briefs"), list):
            runs.append(run)
    return runs


def compatible_runs(runs: List[Dict[str, Any]], base: Tuning, briefs: Dict[str, Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Runs usable as evidence for `base`, keeping only the briefs whose features reproduce the stored
    ranking. A run qualifies when its full tuning version equals `base` with the run's values of the
    offline keys: it then searched, read and prompted exactly as `base` does."""
    usable, notes = [], []
    for run in runs:
        if not any(offline.has_features(e) for e in run["briefs"]):
            notes.append(f"{run['runId']}: no stored ranking features (recorded before they were stored)")
            continue
        run_t = offline.run_tuning(run)
        if run_t is None:
            notes.append(f"{run['runId']}: no stored tuning values")
            continue
        as_base = base.with_overrides({k: run_t.get(k) for k in offline.OFFLINE_EXACT_KEYS})
        if as_base.version != run.get("tuningVersion"):
            notes.append(f"{run['runId']}: tuning {run.get('tuningVersion')} differs from the baseline beyond the offline keys")
            continue
        kept, dropped = [], []
        for entry in run["briefs"]:
            if entry["briefId"] not in briefs or not offline.has_features(entry):
                continue
            if not entry["features"].get("complete") or not offline.reproduces(entry, run_t):
                dropped.append(entry["briefId"])
            else:
                kept.append(entry)
        if dropped:
            notes.append(f"{run['runId']}: briefs not reproduced exactly, left out: {', '.join(dropped)}")
        if kept:
            usable.append({**run, "briefs": kept})
    return usable, notes


def evaluate(prepared: List[offline.PreparedRun], base: Tuning, candidate: Tuning, baseline: List[Dict[str, Any]]) -> Dict[str, Any]:
    scored = [p.score(candidate)["aggregate"] for p in prepared]
    changed = offline.changed_keys(base, candidate)
    return gate_rules.gate(baseline, scored, changed, allowed_keys=offline.OFFLINE_EXACT_KEYS, paired=True)


def rank_key(result: Dict[str, Any], overrides: Dict[str, Any]) -> Tuple:
    m = result["metrics"]
    return (result["accepted"], m["recallAt10"]["delta"] or 0.0, m["shortlistPrecision"]["delta"] or 0.0, -len(overrides))


def tune(suite_dir: str, results_dir: Optional[Path], base: Tuning, candidate_overrides: Optional[Dict[str, Any]] = None,
         samples: int = 200, seed: int = 7, refused: Optional[set] = None) -> Dict[str, Any]:
    """The decision, without writing anything: baseline, evidence, every candidate's gate result, the chosen one."""
    suite = load_suite(suite_dir)
    briefs = {b["id"]: b for b in suite["briefs"]}
    results_dir = results_dir or ROOT / "eval" / "results" / suite["version"]
    runs, notes = compatible_runs(load_runs(results_dir), base, briefs)
    report: Dict[str, Any] = {
        "suite": suite["version"], "baseline": base.version, "evidenceRuns": [r["runId"] for r in runs], "notes": notes,
        "finishedAt": datetime.now(timezone.utc).isoformat(), "decision": None,
    }
    if len(runs) < gate_rules.MIN_RUNS:
        report["decision"] = {
            "accepted": False,
            "reasons": [f"{len(runs)} usable run(s) with ranking features for {base.version}; the gate needs {gate_rules.MIN_RUNS}. "
                        f"Record new B1 runs of the promoted tuning (they now store features)."],
        }
        return report

    prepared = [offline.PreparedRun(r, briefs, base) for r in runs]
    report["baselineMetrics"] = [p.score(base)["aggregate"] for p in prepared]
    if candidate_overrides is not None:
        pool = [(candidate_overrides, base.with_overrides(candidate_overrides))]
    else:
        pool = [(o, t) for o, t in candidates(base, samples, seed) if t.version not in (refused or set())]
    results = []
    for overrides, t in pool:
        results.append({"overrides": overrides, "version": t.version, "gate": evaluate(prepared, base, t, report["baselineMetrics"])})
    results.sort(key=lambda r: rank_key(r["gate"], r["overrides"]), reverse=True)
    report["evaluated"] = len(results)
    report["top"] = [
        {"version": r["version"], "overrides": r["overrides"], "accepted": r["gate"]["accepted"],
         "recallAt10": r["gate"]["metrics"]["recallAt10"]["delta"], "shortlistPrecision": r["gate"]["metrics"]["shortlistPrecision"]["delta"]}
        for r in results[:10]
    ]
    if results:
        best = results[0]
        report["decision"] = {"version": best["version"], "overrides": best["overrides"], "accepted": best["gate"]["accepted"],
                              "reasons": best["gate"]["reasons"], "gate": best["gate"]}
    else:
        report["decision"] = {"accepted": False, "reasons": ["No new candidate to evaluate."]}
    return report


def evidence_of(report: Dict[str, Any], report_path: Optional[str]) -> Dict[str, Any]:
    d = report["decision"]
    return {
        "runs": report["evidenceRuns"], "suite": report["suite"], "baseline": report["baseline"], "method": "offline re-ranking (paired)",
        "evaluated": report.get("evaluated"), "gate": d.get("gate"), "report": report_path,
    }


def notes_of(report: Dict[str, Any]) -> str:
    d = report["decision"]
    head = "Auto-tuner: promoted" if d.get("accepted") else "Auto-tuner: rejected"
    return f"{head} {json.dumps(d.get('overrides'), sort_keys=True)} over {report['baseline']}. " + " ".join(d.get("reasons") or [])


def main(argv: List[str] = None) -> int:
    parser = argparse.ArgumentParser(description="Open Eye L1 auto-tuner")
    parser.add_argument("--suite", required=True)
    parser.add_argument("--results", help="Directory of run files (default: eval/results/<suite version>)")
    parser.add_argument("--candidate", help="JSON file of L1 overrides to gate instead of searching")
    parser.add_argument("--samples", type=int, default=200)
    parser.add_argument("--seed", type=int, default=7)
    parser.add_argument("--dry-run", action="store_true", help="Decide and write the report, but change nothing in the database")
    parser.add_argument("--no-db", action="store_true", help="Use the built-in defaults as the baseline (implies --dry-run)")
    parser.add_argument("--report-dir", help="Where the decision report goes (default: eval/evolution/<suite version>)")
    args = parser.parse_args(argv)

    db = None
    refused: set = set()
    if args.no_db:
        base = default_tuning()
    else:
        from ..db.repository import DatabaseRepository
        from . import registry
        db = DatabaseRepository()
        base = load_active(db) if args.dry_run else registry.ensure_baseline(db)
        rows = registry._run(db, "SELECT id FROM config_versions WHERE status IN ('rejected', 'rolled_back')", fetch="all")
        refused = {r[0] for r in rows}

    overrides = json.loads(Path(args.candidate).read_text()) if args.candidate else None
    if overrides is not None:
        unknown = [k for k in overrides if k not in offline.OFFLINE_EXACT_KEYS]
        if unknown:
            print(f"[tune] Only offline L1 keys can be gated here ({', '.join(offline.OFFLINE_EXACT_KEYS)}); "
                  f"{', '.join(unknown)} need a replay benchmark and a proposal (apps.worker.evolution.propose).", file=sys.stderr)
            return 2
    report = tune(args.suite, Path(args.results) if args.results else None, base, overrides, args.samples, args.seed, refused)

    out_dir = Path(args.report_dir) if args.report_dir else ROOT / "eval" / "evolution" / report["suite"]
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"tune-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.json"
    out_path.write_text(json.dumps(report, indent=2))
    resolved = out_path.resolve()
    rel = str(resolved.relative_to(ROOT)) if resolved.is_relative_to(ROOT) else str(resolved)

    d = report["decision"]
    for note in report["notes"]:
        print(f"[tune] {note}")
    print(f"[tune] baseline {report['baseline']}, {len(report['evidenceRuns'])} evidence run(s), {report.get('evaluated', 0)} candidate(s)")
    verdict = "ACCEPTED" if d.get("accepted") else "REJECTED" if d.get("version") else "NO DECISION"
    print(f"[tune] {verdict}{' ' + json.dumps(d['overrides'], sort_keys=True) if d.get('version') else ''}: {' '.join(d.get('reasons') or [])}")
    print(f"[tune] wrote {rel}")

    if db is not None and not args.dry_run and d.get("version"):
        from . import registry
        candidate = base.with_overrides(d["overrides"])
        evidence = evidence_of(report, rel)
        if d["accepted"]:
            try:
                registry.promote(db, candidate, evidence, notes_of(report), actor="auto-tuner", parent=base.version)
            except registry.EvolutionRefused as e:
                print(f"[tune] not promoted: {e}", file=sys.stderr)
                return 1
            print(f"[tune] promoted {candidate.version}")
        else:
            registry.record_rejection(db, candidate, evidence, notes_of(report), actor="auto-tuner", parent=base.version)
            print(f"[tune] recorded {candidate.version} as rejected")
    return 0


if __name__ == "__main__":
    sys.exit(main())
