"""
Weakness mining (PRODUCT_DEFINITION 9.2 step 3): recurring failures in evaluation runs, as structured
findings, and drafts of the lowest-level change that could address them. Drafts are files for a person
to review and benchmark; nothing here changes a tuning or a label.

    python -m apps.worker.evolution.weakness --suite eval/suite-v1                      # latest variant's runs
    python -m apps.worker.evolution.weakness --suite eval/suite-v1 --runs <id>,<id> --draft-dir eval/candidates/drafts

Findings:
- essential_not_retrieved: an essential solution no search found (a retrieval problem: queries, L2)
- essential_ranked_low: found but below the top 10 (a ranking problem: weights, L1)
- trap_shortlisted: a labelled trap recommended as a starting point (assessment or freshness rule)
- zero_recall_brief: a brief with recall@10 of zero in every run
Each recurring finding counts the runs it occurred in; missed essentials are also summarised by
requirement type and by domain.
"""
import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from ..eval.suite import load_suite, norm, score_brief
from ..tuning import Tuning, default_tuning

ROOT = Path(__file__).resolve().parents[3]

# A finding must recur in at least this share of the runs
RECURRENCE = 0.5


def _essential_index(brief: Dict[str, Any]) -> Dict[str, List[Dict[str, Any]]]:
    """Essential repository -> the labelled requirements (id, name, type) it is essential for."""
    out: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for req in brief["labels"]["requirements"]:
        for s in req.get("solutions", []):
            if s["rating"] == "essential":
                out[norm(s["repo"])].append({"id": req.get("id"), "name": req.get("name"), "type": req.get("type", "functional")})
    for s in brief["labels"].get("products", []):
        if s["rating"] == "essential":
            out[norm(s["repo"])].append({"id": "product", "name": "whole product", "type": "product"})
    return out


def mine(suite: Dict[str, Any], runs: List[Dict[str, Any]]) -> Dict[str, Any]:
    briefs = {b["id"]: b for b in suite["briefs"]}
    n = len(runs)
    need = max(1, int(round(n * RECURRENCE + 1e-9))) if n else 1
    not_retrieved: Counter = Counter()
    ranked_low: Dict[tuple, List[int]] = defaultdict(list)
    traps: Counter = Counter()
    zero: Counter = Counter()
    seen_briefs: Counter = Counter()
    for run in runs:
        for entry in run["briefs"]:
            brief = briefs.get(entry["briefId"])
            if not brief or "ranked" not in entry:
                continue
            seen_briefs[brief["id"]] += 1
            scores = score_brief(brief, entry["ranked"], entry["shortlisted"])
            ranked = [norm(r) for r in entry["ranked"]]
            for repo in scores["missedEssential"]:
                if repo in ranked:
                    ranked_low[(brief["id"], repo)].append(ranked.index(repo) + 1)
                else:
                    not_retrieved[(brief["id"], repo)] += 1
            for t in scores["trapsShortlisted"]:
                traps[(brief["id"], t)] += 1
            if scores["recallAt10"] == 0:
                zero[brief["id"]] += 1

    findings: List[Dict[str, Any]] = []
    by_type: Counter = Counter()
    by_domain: Counter = Counter()
    for (bid, repo), count in sorted(not_retrieved.items()):
        if count < need:
            continue
        reqs = _essential_index(briefs[bid]).get(repo, [])
        for r in reqs:
            by_type[r["type"]] += 1
        by_domain[briefs[bid]["domain"]] += 1
        findings.append({"kind": "essential_not_retrieved", "briefId": bid, "domain": briefs[bid]["domain"], "repo": repo,
                         "requirements": reqs, "runs": count, "of": n, "level": "L2",
                         "suggestion": "No query found it: the planner did not name its kind of tool."})
    for (bid, repo), ranks in sorted(ranked_low.items()):
        if len(ranks) < need:
            continue
        reqs = _essential_index(briefs[bid]).get(repo, [])
        for r in reqs:
            by_type[r["type"]] += 1
        by_domain[briefs[bid]["domain"]] += 1
        findings.append({"kind": "essential_ranked_low", "briefId": bid, "domain": briefs[bid]["domain"], "repo": repo,
                         "requirements": reqs, "runs": len(ranks), "of": n, "bestRank": min(ranks), "level": "L1",
                         "suggestion": "Found but ranked below 10: a ranking change may lift it (apps.worker.evolution.tune)."})
    for (bid, repo), count in sorted(traps.items()):
        if count < need:
            continue
        reason = next((t.get("reason", "") for t in briefs[bid]["labels"].get("traps", []) if norm(t["repo"]) == repo), "")
        findings.append({"kind": "trap_shortlisted", "briefId": bid, "domain": briefs[bid]["domain"], "repo": repo, "reason": reason,
                         "runs": count, "of": n, "level": "L1" if _is_staleness(reason) else "L2",
                         "suggestion": "A freshness rule would exclude it." if _is_staleness(reason)
                         else "The README assessment accepts it: the assessment prompt should catch this kind of look-alike."})
    for bid, count in sorted(zero.items()):
        if count == seen_briefs[bid] and count >= need:
            findings.append({"kind": "zero_recall_brief", "briefId": bid, "domain": briefs[bid]["domain"], "runs": count, "of": n})

    kinds = Counter(f["kind"] for f in findings)
    return {
        "suite": suite["version"],
        "runs": [r["runId"] for r in runs],
        "recurrence": f"in at least {need} of {n} runs",
        "summary": {"byKind": dict(kinds), "missedEssentialByRequirementType": dict(by_type), "missedEssentialByDomain": dict(by_domain)},
        "findings": findings,
    }


def _is_staleness(reason: str) -> bool:
    text = reason.lower()
    return any(w in text for w in ("no push", "last push", "archived", "abandoned", "unmaintained"))


ASSESSMENT_RULE = ("A repository whose README says it is deprecated, archived, in maintenance mode, or points new users to a "
                   'successor project is not a good starting point: say so in reason and rate coverage at most "partial".')
PLANNER_RULE = ("For each MUST capability, add one query with the generic name the established tools in that space use to "
                'describe themselves (e.g. "workflow orchestration", "change data capture"), even when the brief words it differently.')


def insert_rule(prompt: str, rule: str) -> str:
    """Adds a numbered rule before the final "N. Output strictly valid JSON." rule (or at the end)."""
    match = re.search(r"(\d+)\. Output strictly valid JSON\.\s*$", prompt)
    if not match:
        return f"{prompt.rstrip()}\n- {rule}"
    n = int(match.group(1))
    return prompt[:match.start()] + f"{n}. {rule}\n{n + 1}. Output strictly valid JSON."


def drafts(report: Dict[str, Any], base: Optional[Tuning] = None) -> List[Dict[str, Any]]:
    """Candidate changes at the lowest level that addresses each kind of finding. They are drafts: they
    are written for a person to read, edit, benchmark and propose; none is registered or applied."""
    base = base or default_tuning()
    kinds = report["summary"]["byKind"]
    findings = report["findings"]
    out = []
    if kinds.get("essential_ranked_low"):
        out.append({"name": "ranking-search", "level": "L1", "overrides": None,
                    "rationale": f"{kinds['essential_ranked_low']} essential solution(s) are found but ranked below 10. Run the L1 "
                                 "auto-tuner (apps.worker.evolution.tune), which searches the ranking weights under the gate."})
    stale = [f for f in findings if f["kind"] == "trap_shortlisted" and f["level"] == "L1"]
    if stale and base.get("discovery.shortlist_max_stale_days"):
        days = max(365, int(base.get("discovery.shortlist_max_stale_days")) - 182)
        out.append({"name": "fresher-shortlist", "level": "L1", "overrides": {"discovery.shortlist_max_stale_days": days},
                    "rationale": f"{len(stale)} stale trap(s) shortlisted: {', '.join(f['repo'] for f in stale)}."})
    lookalikes = [f for f in findings if f["kind"] == "trap_shortlisted" and f["level"] == "L2"]
    prompt = base.get("prompts.readme_assessment")
    if lookalikes and ASSESSMENT_RULE not in prompt:
        out.append({"name": "assessment-successor-rule", "level": "L2",
                    "overrides": {"prompts.readme_assessment": insert_rule(prompt, ASSESSMENT_RULE)},
                    "rationale": f"{len(lookalikes)} look-alike trap(s) accepted by the README assessment: {', '.join(f['repo'] for f in lookalikes)}."})
    planner = base.get("prompts.discovery_planner")
    missed = kinds.get("essential_not_retrieved", 0)
    if missed and PLANNER_RULE not in planner:
        out.append({"name": "planner-generic-category", "level": "L2",
                    "overrides": {"prompts.discovery_planner": insert_rule(planner, PLANNER_RULE)},
                    "rationale": f"{missed} essential solution(s) were never retrieved by any query."})
    return out


def latest_runs(results_dir: Path) -> List[Dict[str, Any]]:
    """The runs of the most recently run B1 variant (system and tuning)."""
    runs = []
    for p in sorted(results_dir.glob("*.json")):
        try:
            run = json.loads(p.read_text())
        except ValueError:
            continue
        if run.get("system") == "b1" and isinstance(run.get("briefs"), list):
            runs.append(run)
    if not runs:
        return []
    runs.sort(key=lambda r: r.get("finishedAt") or "")
    latest = runs[-1].get("tuningVersion")
    return [r for r in runs if r.get("tuningVersion") == latest]


def main(argv: List[str] = None) -> int:
    parser = argparse.ArgumentParser(description="Recurring weaknesses in evaluation runs")
    parser.add_argument("--suite", required=True)
    parser.add_argument("--results", help="Directory of run files (default: eval/results/<suite version>)")
    parser.add_argument("--runs", help="Comma-separated run ids (default: the latest B1 variant's runs)")
    parser.add_argument("--draft-dir", help="Write draft candidate tuning files here (not applied)")
    args = parser.parse_args(argv)

    suite = load_suite(args.suite)
    results_dir = Path(args.results) if args.results else ROOT / "eval" / "results" / suite["version"]
    if args.runs:
        runs = [json.loads((results_dir / f"{rid}.json").read_text()) for rid in args.runs.split(",")]
    else:
        runs = latest_runs(results_dir)
    report = mine(suite, runs)
    report["drafts"] = [{k: v for k, v in d.items() if k != "overrides"} | {"hasOverrides": d["overrides"] is not None} for d in drafts(report)]
    print(json.dumps(report, indent=2))
    if args.draft_dir:
        out = Path(args.draft_dir)
        out.mkdir(parents=True, exist_ok=True)
        for d in drafts(report):
            if d["overrides"]:
                path = out / f"{d['name']}.json"
                path.write_text(json.dumps(d["overrides"], indent=2))
                print(f"[weakness] draft ({d['level']}) written to {path}: {d['rationale']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
