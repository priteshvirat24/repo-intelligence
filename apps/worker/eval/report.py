"""
Summarises evaluation runs into a Markdown report: per system, mean and range across runs of each metric,
and per brief the essential repositories that were missed.

    python -m apps.worker.eval.report eval/results/suite-v1/<run>.json ... [--out eval/results/suite-v1/BASELINE.md]
"""
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List

METRICS = [("recallAt10", "Recall@10"), ("recallAll", "Recall (all kept)"), ("shortlistPrecision", "Shortlist precision"),
           ("trapRejection", "Trap rejection (all traps)"), ("trapRejectionSurfaced", "Trap rejection (traps it found)")]


def fmt(values: List[float], digits: int = 3) -> str:
    values = [v for v in values if v is not None]
    if not values:
        return "n/a"
    mean = sum(values) / len(values)
    if len(values) == 1 or min(values) == max(values):
        return f"{mean:.{digits}f}"
    return f"{mean:.{digits}f} ({min(values):.{digits}f}–{max(values):.{digits}f})"


def variant(run: Dict[str, Any]) -> str:
    """b0, b0s, or b1:<tuning name>: runs of one system with different tunings are compared, not averaged."""
    name = run.get("tuningName")
    return f"{run['system']}:{name}" if name else run["system"]


def build(runs: List[Dict[str, Any]]) -> str:
    by_system: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for r in runs:
        by_system[variant(r)].append(r)
    first = runs[0]
    lines = [
        f"# Evaluation report: {first['suite']}",
        "",
        f"Labels: {first.get('labelsStatus')}",
        "",
        "Values are means over runs, with the range across runs in brackets. Each run is the macro average over briefs.",
        "",
        "| Metric | " + " | ".join(f"{s.upper()} ({len(rs)} run{'s' if len(rs) > 1 else ''})" for s, rs in sorted(by_system.items())) + " |",
        "|---|" + "---|" * len(by_system),
    ]
    for key, label in METRICS:
        lines.append(f"| {label} | " + " | ".join(fmt([r["aggregate"].get(key) for r in rs]) for _, rs in sorted(by_system.items())) + " |")
    def total(key):
        return " | ".join(fmt([r["aggregate"][key] for r in rs], 0) for _, rs in sorted(by_system.items()))
    lines.append(f"| LLM calls per run | {total('llmCalls')} |")
    lines.append(f"| Input tokens per run | {total('inputTokens')} |")
    lines.append(f"| Output tokens per run | {total('outputTokens')} |")
    lines.append("| Cost per run (cents) | " + " | ".join(
        fmt([r["aggregate"]["costCents"] for r in rs]) if any(r["aggregate"]["costCents"] is not None for r in rs) else "not priced"
        for _, rs in sorted(by_system.items())) + " |")
    lines.append("| Mean time per brief (s) | " + " | ".join(fmt([r["aggregate"]["meanDurationMs"] / 1000 for r in rs], 1) for _, rs in sorted(by_system.items())) + " |")
    lines.append("| Briefs with errors | " + " | ".join(fmt([r["aggregate"]["errors"] for r in rs], 0) for _, rs in sorted(by_system.items())) + " |")
    lines += ["", "## Runs", "", "| Run | System | Mode | Tuning | Commit | Model | Snapshot (recorded / replayed) |", "|---|---|---|---|---|---|---|"]
    for r in runs:
        lines.append(f"| `{r['runId']}` | {r['system']} | {r['mode']} | {r.get('tuningVersion') or '—'} | {r['commit']} | {r.get('model') or '—'} | {r['snapshot']['recorded']} / {r['snapshot']['replayed']} |")

    lines += ["", "## Per brief", "", "Recall@10 per run, and the essential repositories missed in the latest run of each system.", ""]
    brief_ids = [b["briefId"] for b in first["briefs"]]
    header = "| Brief | " + " | ".join(f"{s.upper()} recall@10" for s in sorted(by_system)) + " | Missed essentials (latest " + ", ".join(s.upper() for s in sorted(by_system)) + ") |"
    lines += [header, "|---|" + "---|" * len(by_system) + "---|"]
    for bid in brief_ids:
        cells, missed = [], []
        for s, rs in sorted(by_system.items()):
            vals = []
            for r in rs:
                b = next((x for x in r["briefs"] if x["briefId"] == bid), None)
                vals.append(b["scores"]["recallAt10"] if b and "scores" in b else None)
            cells.append(fmt(vals))
            latest = next((x for x in rs[-1]["briefs"] if x["briefId"] == bid), None)
            if latest and "scores" in latest:
                missed.append(f"{s.upper()}: {', '.join(latest['scores']['missedEssential']) or '—'}")
            elif latest:
                missed.append(f"{s.upper()}: error ({latest.get('error', '')[:60]})")
        lines.append(f"| {bid} | " + " | ".join(cells) + " | " + "<br>".join(missed) + " |")
    return "\n".join(lines) + "\n"


def main(argv=None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    out = None
    if "--out" in args:
        i = args.index("--out")
        out = args[i + 1]
        args = args[:i] + args[i + 2:]
    runs = [json.loads(Path(p).read_text()) for p in args]
    text = build(runs)
    if out:
        Path(out).write_text(text)
        print(f"[report] wrote {out}")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
