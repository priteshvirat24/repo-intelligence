"""
Re-scores stored evaluation runs against the current labels and metric definitions, without re-running
anything: every result file keeps each brief's full ranking and shortlist.

    python -m apps.worker.eval.rescore eval/suite-v1 eval/results/suite-v1/*.json

Use it after the labels are reviewed or corrected, or after a metric is added, so every run is scored
the same way. The aggregate is recomputed; run metadata (cost, duration, snapshot counts) is kept.
"""
import json
import sys
from pathlib import Path

from .suite import aggregate, load_suite, score_brief


def main(argv=None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    suite = load_suite(args[0])
    briefs = {b["id"]: b for b in suite["briefs"]}
    for path in args[1:]:
        run = json.loads(Path(path).read_text())
        scored = []
        for entry in run["briefs"]:
            if "ranked" in entry and entry["briefId"] in briefs:
                entry["scores"] = score_brief(briefs[entry["briefId"]], entry["ranked"], entry["shortlisted"])
                scored.append(entry["scores"])
        run["aggregate"] = {**run["aggregate"], **aggregate(scored)}
        run["labelsStatus"] = suite.get("labelsStatus")
        Path(path).write_text(json.dumps(run, indent=2))
        print(f"[rescore] {Path(path).name}: recall@10 {run['aggregate']['recallAt10']}, traps surfaced {run['aggregate']['trapsSurfaced']}, "
              f"rejected among surfaced {run['aggregate']['trapRejectionSurfaced']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
