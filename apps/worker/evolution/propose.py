"""
Proposals for changes the stored features cannot decide (PRODUCT_DEFINITION 9.1 L2-L4; SYSTEM_DESIGN 9).

    python -m apps.worker.evolution.propose --suite eval/suite-v1 --tuning eval/candidates/<name>.json \
        --runs <candidate run id>,<id>,<id> [--baseline-runs <id>,<id>,<id>] --title "..." [--rationale "..."]
    python -m apps.worker.evolution.propose --level L4 --title "..." --rationale "..."

The candidate's benchmark runs (eval/results/<suite>/<run id>.json, run with --tuning <file>) must have been
made with exactly the candidate tuning (same content hash). They are re-scored against the current labels and
gated (unpaired) against runs of the promoted tuning:

- L1 (numbers and weights that need a replay, e.g. the stars floor): promoted automatically on a win,
  recorded as rejected otherwise, like the offline auto-tuner;
- L2 (prompts, models): a pending proposal with its evidence; a maintainer approves or rejects it on the
  Evolution page, and approval is refused without a benchmark win;
- L4 (code, security policy): recorded for humans, never applied.
"""
import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List

from ..eval.suite import aggregate, load_suite, score_brief
from . import gate as gate_rules
from . import offline, registry

ROOT = Path(__file__).resolve().parents[3]


def rescored(run: Dict[str, Any], briefs: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """A run's aggregate under the current labels, with its cost and latency fields."""
    scored = [score_brief(briefs[e["briefId"]], e["ranked"], e["shortlisted"]) for e in run["briefs"] if "ranked" in e and e["briefId"] in briefs]
    keep = {k: run["aggregate"].get(k) for k in gate_rules.COST_KEYS}
    return {**aggregate(scored), **keep}


def recurring_traps(candidate: List[Dict[str, Any]], baseline: List[Dict[str, Any]], briefs: Dict[str, Dict[str, Any]]) -> List[str]:
    """Traps the candidate shortlists in every run and the baseline in none: a warning for the maintainer."""
    def shortlisted(run):
        return {f"{e['briefId']}:{t}" for e in run["briefs"] if "ranked" in e and e["briefId"] in briefs
                for t in score_brief(briefs[e["briefId"]], e["ranked"], e["shortlisted"])["trapsShortlisted"]}
    if not candidate:
        return []
    always = set.intersection(*[shortlisted(r) for r in candidate])
    ever_before = set().union(*[shortlisted(r) for r in baseline]) if baseline else set()
    return sorted(always - ever_before)


def evidence_for(suite_dir: str, results_dir: Path, candidate_runs: List[str], baseline_runs: List[str], changed: List[str]) -> Dict[str, Any]:
    suite = load_suite(suite_dir)
    briefs = {b["id"]: b for b in suite["briefs"]}
    load = lambda rid: json.loads((results_dir / f"{rid}.json").read_text())
    cand = [rescored(load(r), briefs) for r in candidate_runs]
    base = [rescored(load(r), briefs) for r in baseline_runs]
    result = gate_rules.gate(base, cand, changed, allowed_keys=None, paired=False)
    result["recurringTraps"] = recurring_traps([load(r) for r in candidate_runs], [load(r) for r in baseline_runs], briefs)
    return {"runs": candidate_runs, "baselineRuns": baseline_runs, "suite": suite["version"], "method": "replay benchmark (unpaired)", "gate": result}


def main(argv: List[str] = None) -> int:
    parser = argparse.ArgumentParser(description="Propose a gated L1/L2 change, or record an L4 proposal")
    parser.add_argument("--suite")
    parser.add_argument("--results")
    parser.add_argument("--tuning", help="Candidate tuning file (overrides on the defaults)")
    parser.add_argument("--runs", help="Benchmark runs of the candidate")
    parser.add_argument("--baseline-runs", help="Runs of the promoted tuning (default: every stored run of it)")
    parser.add_argument("--level", choices=["L2", "L3", "L4"], help="Force a level (L3 workflow, L4 code); default from the changed keys")
    parser.add_argument("--title", required=True)
    parser.add_argument("--rationale", default="")
    args = parser.parse_args(argv)

    from ..db.repository import DatabaseRepository
    db = DatabaseRepository()

    if args.level == "L4":
        pid = registry.create_proposal(db, "L4", args.title, args.rationale, None, {}, {"note": "Code or security change: never self-applied"}, False, "cli")
        print(f"[propose] recorded L4 proposal {pid} for human review (never applied)")
        return 0
    if not (args.suite and args.tuning and args.runs):
        parser.error("--suite, --tuning and --runs are required for L1-L3 changes")

    base = registry.ensure_baseline(db)
    overrides = json.loads(Path(args.tuning).read_text())
    candidate = base.with_overrides(overrides)
    changed = offline.changed_keys(base, candidate)
    if not changed:
        print(f"[propose] {args.tuning} is identical to the promoted tuning {base.version}", file=sys.stderr)
        return 2
    suite = load_suite(args.suite)
    results_dir = Path(args.results) if args.results else ROOT / "eval" / "results" / suite["version"]
    run_ids = args.runs.split(",")
    for rid in run_ids:
        run = json.loads((results_dir / f"{rid}.json").read_text())
        if run.get("tuningVersion") != candidate.version:
            # eval/run.py applies --tuning to the built-in defaults: with a promoted non-default version the
            # file must also carry that version's changes, so the measured configuration is the proposed one
            print(f"[propose] {rid} ran {run.get('tuningVersion')}, not the proposed configuration {candidate.version}", file=sys.stderr)
            return 2
    if args.baseline_runs:
        baseline_ids = args.baseline_runs.split(",")
    else:
        baseline_ids = sorted(p.stem for p in results_dir.glob("*.json")
                              if json.loads(p.read_text()).get("tuningVersion") == base.version and json.loads(p.read_text()).get("system") == "b1")
    evidence = evidence_for(args.suite, results_dir, run_ids, baseline_ids, changed)
    win = evidence["gate"]["accepted"]
    level = args.level or registry.level_of(candidate)
    print(f"[propose] {level} {candidate.version} ({', '.join(changed)}): {' '.join(evidence['gate']['reasons'])}")

    if level == "L1":
        notes = f"L1 replay gate: {args.title}. " + " ".join(evidence["gate"]["reasons"])
        if win:
            registry.promote(db, candidate, evidence, notes, actor="replay-gate", parent=base.version)
            print(f"[propose] promoted {candidate.version} (L1 changes that pass the gate are promoted automatically)")
        else:
            registry.record_rejection(db, candidate, evidence, notes, actor="replay-gate", parent=base.version)
            print(f"[propose] recorded {candidate.version} as rejected")
        return 0
    pid = registry.create_proposal(db, level, args.title, args.rationale, candidate, overrides, evidence, win, "cli")
    print(f"[propose] proposal {pid} waits for a maintainer" + ("" if win else " (no benchmark win: it cannot be approved)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
