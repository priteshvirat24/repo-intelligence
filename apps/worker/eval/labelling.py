"""
Tooling for the two-person labelling protocol (eval/README.md, "Labelling protocol"). The labelling itself is
human work; this does the bookkeeping around it.

    # 1. A blind sheet per labeller: the briefs only, no draft labels, no system output
    python -m apps.worker.eval.labelling sheets eval/suite-v1 --labeller alice --out eval/labelling/suite-v1/alice
    # 2. Each labeller fills in briefs/<id>.json, then checks it (shape) and the facts (repositories exist)
    python -m apps.worker.eval.labelling check eval/labelling/suite-v1/alice
    python -m apps.worker.eval.verify_labels eval/labelling/suite-v1/alice --fix
    # 3. Compare the two sheets: agreement, disputes, and a reconciled draft to discuss
    python -m apps.worker.eval.labelling compare eval/labelling/suite-v1/alice eval/labelling/suite-v1/bob \\
        --out eval/labelling/suite-v1/compare
    # 4. After the disputes in compare/draft are resolved: write the labels into the suite
    python -m apps.worker.eval.labelling finalize eval/labelling/suite-v1/compare eval/suite-v1 --status final

A sheet directory has the layout of a suite (suite.json and briefs/<id>.json), so verify_labels and
load_suite work on it unchanged.
"""
import argparse
import json
import re
import sys
from datetime import date
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from .suite import RATINGS, labelled, load_suite, norm

CRITICALITIES = ("MUST", "SHOULD", "NICE_TO_HAVE")
TYPES = ("functional", "technical", "integration", "deployment", "performance", "domain")
CLASSES = (1, 2, 3, 4, 5, 6)
REWRITE_BELOW = 0.5  # a brief whose essential-solution agreement is below this is rewritten (protocol step 4)
_REPO = re.compile(r"^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$")
_BRIEF_FIELDS = ("id", "domain", "outsideTeamExpertise", "title", "brief")


def _write(path: Path, data: Any):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")


def _briefs(sheet_dir: Path) -> Dict[str, Dict[str, Any]]:
    manifest = json.loads((sheet_dir / "suite.json").read_text())
    return {b: json.loads((sheet_dir / "briefs" / f"{b}.json").read_text()) for b in manifest["briefs"]}


# 1. Blind sheets

def make_sheets(suite_dir: str, labeller: str, out_dir: str) -> int:
    """One sheet per brief with the brief's own fields and empty labels: no draft labels, no system output."""
    suite = load_suite(suite_dir)
    out = Path(out_dir)
    if (out / "briefs").exists() and any((out / "briefs").iterdir()):
        raise SystemExit(f"{out} already has sheets; refusing to overwrite a labeller's work")
    for brief in suite["briefs"]:
        sheet = {k: brief[k] for k in _BRIEF_FIELDS if k in brief}
        sheet["labels"] = {"status": "draft", "labelledBy": [labeller], "reviewedBy": [],
                           "requirements": [], "products": [], "traps": []}
        _write(out / "briefs" / f"{brief['id']}.json", sheet)
    _write(out / "suite.json", {
        "version": f"{suite['version']}-sheet-{labeller}",
        "created": date.today().isoformat(),
        "labelsStatus": f"labelling sheet of {labeller} (blind: no draft labels, no system output)",
        "sourceSuite": suite["version"],
        "domains": suite.get("domains", []),
        "briefs": [b["id"] for b in suite["briefs"]],
        "howToFill": (
            "Per brief, list requirements (id, name, criticality MUST/SHOULD/NICE_TO_HAVE, type, expectedClass 1-6) and per "
            "requirement the solutions you know or found ({repo: owner/name, rating: essential|acceptable, foundAt: where you "
            "found it}); products comparable to the whole brief; traps with a checkable reason. Do not look at Open Eye output "
            "or the other labeller's sheet. See eval/README.md."
        ),
    })
    return len(suite["briefs"])


# 2. Checking a filled sheet

def check_brief(brief: Dict[str, Any]) -> Tuple[List[str], List[str]]:
    """(problems, warnings) for one filled brief."""
    problems, warnings = [], []
    bid = brief.get("id", "?")
    labels = brief.get("labels") or {}
    reqs = labels.get("requirements") or []
    if not reqs:
        problems.append(f"{bid}: no requirements labelled")
    ids: Set[str] = set()
    solution_repos: Set[str] = set()
    for i, r in enumerate(reqs):
        where = f"{bid} requirement {r.get('id') or i + 1}"
        if not r.get("id") or not r.get("name"):
            problems.append(f"{where}: needs an id and a name")
        elif r["id"] in ids:
            problems.append(f"{where}: duplicate id")
        ids.add(r.get("id"))
        if r.get("criticality") not in CRITICALITIES:
            problems.append(f"{where}: criticality must be one of {', '.join(CRITICALITIES)}")
        if r.get("type") not in TYPES:
            problems.append(f"{where}: type must be one of {', '.join(TYPES)}")
        if r.get("expectedClass") not in CLASSES:
            problems.append(f"{where}: expectedClass must be 1-6")
        for s in r.get("solutions") or []:
            problems += _check_solution(where, s, warnings)
            solution_repos.add(norm(s.get("repo") or ""))
    for s in labels.get("products") or []:
        problems += _check_solution(f"{bid} products", s, warnings)
    for t in labels.get("traps") or []:
        if not _REPO.match(t.get("repo") or ""):
            problems.append(f"{bid} trap {t.get('repo')!r}: repo must be owner/name")
        if not (t.get("reason") or "").strip():
            problems.append(f"{bid} trap {t.get('repo')}: needs a reason a reviewer can check")
        if norm(t.get("repo") or "") in solution_repos:
            problems.append(f"{bid} trap {t.get('repo')}: also listed as a solution")
    return problems, warnings


def _check_solution(where: str, s: Dict[str, Any], warnings: List[str]) -> List[str]:
    out = []
    if not _REPO.match(s.get("repo") or ""):
        out.append(f"{where}: solution {s.get('repo')!r} must be owner/name")
    if s.get("rating") not in RATINGS:
        out.append(f"{where}: {s.get('repo')} rating must be essential or acceptable")
    if not s.get("foundAt"):
        warnings.append(f"{where}: {s.get('repo')} has no foundAt (where it was found)")
    return out


def check_sheet(sheet_dir: str) -> Tuple[List[str], List[str]]:
    problems, warnings = [], []
    for brief in _briefs(Path(sheet_dir)).values():
        p, w = check_brief(brief)
        problems += p
        warnings += w
    return problems, warnings


# 3. Comparing two sheets

def _tokens(text: str) -> Set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", (text or "").lower()) if len(w) > 2}


def match_requirements(a: List[Dict[str, Any]], b: List[Dict[str, Any]], min_overlap: float = 0.3) -> List[Tuple[Dict, Dict]]:
    """Pairs of requirements the two labellers wrote about the same thing: the same id, else the best word overlap."""
    pairs, used = [], set()
    by_id = {r["id"]: r for r in b}
    for ra in a:
        if ra["id"] in by_id and ra["id"] not in used:
            pairs.append((ra, by_id[ra["id"]]))
            used.add(ra["id"])
    for ra in a:
        if any(ra is p[0] for p in pairs):
            continue
        best, score = None, 0.0
        for rb in b:
            if rb["id"] in used:
                continue
            ta, tb = _tokens(ra["name"]), _tokens(rb["name"])
            overlap = len(ta & tb) / len(ta | tb) if ta | tb else 0.0
            if overlap > score:
                best, score = rb, overlap
        if best is not None and score >= min_overlap:
            pairs.append((ra, best))
            used.add(best["id"])
    return pairs


def compare_brief(a: Dict[str, Any], b: Dict[str, Any], names: Tuple[str, str]) -> Dict[str, Any]:
    """Agreement numbers and disputes for one brief, and a reconciled draft of its labels."""
    ess_a, ess_b = labelled(a, "essential"), labelled(b, "essential")
    union = ess_a | ess_b
    essential_agreement = round(len(ess_a & ess_b) / len(union), 4) if union else None
    reqs_a, reqs_b = a["labels"]["requirements"], b["labels"]["requirements"]
    pairs = match_requirements(reqs_a, reqs_b)
    same_class = [ra["id"] for ra, rb in pairs if ra.get("expectedClass") == rb.get("expectedClass")]
    class_agreement = round(len(same_class) / len(pairs), 4) if pairs else None
    disputes: List[Dict[str, Any]] = []
    for repo in sorted(ess_a ^ ess_b):
        who = names[0] if repo in ess_a else names[1]
        disputes.append({"kind": "essential_by_one", "repo": repo, "essentialFor": who,
                         "note": f"rated essential by {who} only: decide essential or acceptable, and record why"})
    draft_reqs = []
    matched_b = {id(rb) for _, rb in pairs}
    for ra, rb in pairs:
        merged = {k: ra.get(k) for k in ("id", "name", "criticality", "type", "expectedClass")}
        if ra.get("criticality") != rb.get("criticality"):
            disputes.append({"kind": "criticality", "requirement": ra["id"], names[0]: ra.get("criticality"), names[1]: rb.get("criticality")})
        if ra.get("expectedClass") != rb.get("expectedClass"):
            disputes.append({"kind": "expected_class", "requirement": ra["id"], names[0]: ra.get("expectedClass"), names[1]: rb.get("expectedClass")})
        if rb["name"] != ra["name"]:
            merged["alsoNamed"] = rb["name"]
        merged["solutions"] = _merge_solutions(ra.get("solutions") or [], rb.get("solutions") or [])
        draft_reqs.append(merged)
    for ra in reqs_a:
        if not any(ra is p[0] for p in pairs):
            draft_reqs.append({**ra, "labelledBy": [names[0]]})
            disputes.append({"kind": "requirement_by_one", "requirement": ra["id"], "by": names[0]})
    for rb in reqs_b:
        if id(rb) not in matched_b:
            draft_reqs.append({**rb, "labelledBy": [names[1]]})
            disputes.append({"kind": "requirement_by_one", "requirement": rb["id"], "by": names[1]})
    traps_a = {norm(t["repo"]): t for t in a["labels"].get("traps") or []}
    traps_b = {norm(t["repo"]): t for t in b["labels"].get("traps") or []}
    for repo in sorted(set(traps_a) ^ set(traps_b)):
        disputes.append({"kind": "trap_by_one", "repo": repo, "by": names[0] if repo in traps_a else names[1]})
    traps = [{"repo": (traps_a.get(r) or traps_b[r])["repo"],
              "reason": "; ".join(dict.fromkeys(x["reason"] for x in (traps_a.get(r), traps_b.get(r)) if x))}
             for r in sorted(set(traps_a) | set(traps_b))]
    draft = {k: a[k] for k in _BRIEF_FIELDS if k in a}
    draft["labels"] = {
        "status": "draft", "labelledBy": list(names), "reviewedBy": [],
        "requirements": draft_reqs,
        "products": _merge_solutions(a["labels"].get("products") or [], b["labels"].get("products") or []),
        "traps": traps,
        # finalize refuses a brief while this list is not empty: resolve each item, then delete it
        "disputes": disputes,
    }
    return {
        "briefId": a["id"],
        "essentialAgreement": essential_agreement,
        "classAgreement": class_agreement,
        "essential": {names[0]: len(ess_a), names[1]: len(ess_b), "both": len(ess_a & ess_b)},
        "requirementsMatched": len(pairs),
        "requirementsUnmatched": len(reqs_a) + len(reqs_b) - 2 * len(pairs),
        "rewrite": essential_agreement is not None and essential_agreement < REWRITE_BELOW,
        "disputes": len(disputes),
        "draft": draft,
    }


def _merge_solutions(a: List[Dict[str, Any]], b: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Union by repository. Essential when both said so; otherwise acceptable (an essential-by-one is a dispute)."""
    out: Dict[str, Dict[str, Any]] = {}
    for side in (a, b):
        for s in side:
            key = norm(s["repo"])
            entry = out.setdefault(key, {"repo": s["repo"], "ratings": [], "foundAt": []})
            entry["ratings"].append(s["rating"])
            if s.get("foundAt") and s["foundAt"] not in entry["foundAt"]:
                entry["foundAt"].append(s["foundAt"])
    merged = []
    for key, e in out.items():
        both_essential = e["ratings"].count("essential") == 2
        item = {"repo": e["repo"], "rating": "essential" if both_essential else "acceptable"}
        if e["foundAt"]:
            item["foundAt"] = "; ".join(e["foundAt"])
        merged.append(item)
    return merged


def compare_sheets(dir_a: str, dir_b: str, out_dir: str) -> Dict[str, Any]:
    a_dir, b_dir, out = Path(dir_a), Path(dir_b), Path(out_dir)
    sheets_a, sheets_b = _briefs(a_dir), _briefs(b_dir)
    names = (_labeller(sheets_a, a_dir), _labeller(sheets_b, b_dir))
    if names[0] == names[1]:
        raise SystemExit("Both sheets name the same labeller: the protocol needs two people")
    missing = sorted(set(sheets_a) ^ set(sheets_b))
    if missing:
        raise SystemExit(f"The sheets cover different briefs: {', '.join(missing)}")
    per_brief = [compare_brief(sheets_a[b], sheets_b[b], names) for b in sorted(sheets_a)]
    for r in per_brief:
        _write(out / "draft" / "briefs" / f"{r['briefId']}.json", r.pop("draft"))
    manifest_a = json.loads((a_dir / "suite.json").read_text())
    _write(out / "draft" / "suite.json", {
        "version": f"{manifest_a.get('sourceSuite', 'suite')}-reconciled", "created": date.today().isoformat(),
        "labelsStatus": f"reconciliation draft of {names[0]} and {names[1]}",
        "sourceSuite": manifest_a.get("sourceSuite"), "domains": manifest_a.get("domains", []),
        "briefs": [r["briefId"] for r in per_brief],
    })

    def mean(key):
        values = [r[key] for r in per_brief if r[key] is not None]
        return round(sum(values) / len(values), 4) if values else None

    agreement = {
        "labellers": list(names),
        "comparedAt": date.today().isoformat(),
        "essentialAgreement": mean("essentialAgreement"),
        "classAgreement": mean("classAgreement"),
        "briefsToRewrite": [r["briefId"] for r in per_brief if r["rewrite"]],
        "briefs": per_brief,
    }
    _write(out / "agreement.json", agreement)
    (out / "report.md").write_text(report(agreement))
    return agreement


def _labeller(sheets: Dict[str, Dict[str, Any]], where: Path) -> str:
    names = {n for s in sheets.values() for n in (s["labels"].get("labelledBy") or [])}
    if len(names) != 1:
        raise SystemExit(f"{where}: a sheet must name exactly one labeller in labelledBy (found {sorted(names)})")
    return names.pop()


def report(agreement: Dict[str, Any]) -> str:
    a, b = agreement["labellers"]
    pct = lambda v: "n/a" if v is None else f"{v:.0%}"
    lines = [
        f"# Label agreement: {a} and {b}", "",
        f"Essential-solution agreement {pct(agreement['essentialAgreement'])} (share of essential solutions both found), "
        f"class agreement {pct(agreement['classAgreement'])} (matched requirements given the same expected class).", "",
        "| Brief | Essential agreement | Class agreement | Essential (" + a + " / " + b + " / both) | Disputes | Action |",
        "|---|---|---|---|---|---|",
    ]
    for r in agreement["briefs"]:
        e = r["essential"]
        action = "rewrite the brief (below 0.5)" if r["rewrite"] else "resolve disputes" if r["disputes"] else "ready"
        lines.append(f"| {r['briefId']} | {pct(r['essentialAgreement'])} | {pct(r['classAgreement'])} | {e[a]} / {e[b]} / {e['both']} | {r['disputes']} | {action} |")
    lines += ["", "Resolve each item under `labels.disputes` in `draft/briefs/<id>.json`, delete it, then run `finalize`."]
    return "\n".join(lines) + "\n"


# 4. Writing reconciled labels into the suite

def finalize(compare_dir: str, suite_dir: str, status: str = "final", reviewed_by: Optional[List[str]] = None) -> List[str]:
    """Writes the reconciled labels into the suite's brief files and the agreement into suite.json."""
    if status not in ("reviewed", "final"):
        raise SystemExit("status must be reviewed or final")
    compare, suite = Path(compare_dir), Path(suite_dir)
    agreement = json.loads((compare / "agreement.json").read_text())
    drafts = _briefs(compare / "draft")
    blocked = []
    for bid, draft in drafts.items():
        problems, _ = check_brief(draft)
        if draft["labels"].get("disputes"):
            problems.append(f"{bid}: {len(draft['labels']['disputes'])} disputes still open")
        if bid in agreement.get("briefsToRewrite", []):
            problems.append(f"{bid}: essential agreement below {REWRITE_BELOW}; rewrite the brief and label it again")
        blocked += problems
    if blocked:
        raise SystemExit("Not finalized:\n  " + "\n  ".join(blocked))
    written = []
    for bid, draft in drafts.items():
        path = suite / "briefs" / f"{bid}.json"
        brief = json.loads(path.read_text())
        if brief["labels"].get("status") == "final":
            raise SystemExit(f"{bid}: labels are already final; final labels change only through a new suite version")
        labels = {k: v for k, v in draft["labels"].items() if k != "disputes"}
        labels["requirements"] = [{k: v for k, v in r.items() if k not in ("labelledBy",)} for r in labels["requirements"]]
        labels.update({"status": status, "labelledBy": agreement["labellers"], "reviewedBy": reviewed_by or agreement["labellers"]})
        brief["labels"] = labels
        _write(path, brief)
        written.append(bid)
    manifest_path = suite / "suite.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["labelsStatus"] = (f"{status}: labelled independently by {' and '.join(agreement['labellers'])} and reconciled "
                                f"on {agreement['comparedAt']} (eval/README.md protocol)")
    manifest["agreement"] = {"essentialAgreement": agreement["essentialAgreement"], "classAgreement": agreement["classAgreement"],
                             "labellers": agreement["labellers"], "comparedAt": agreement["comparedAt"]}
    _write(manifest_path, manifest)
    return written


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Two-person labelling protocol tooling (eval/README.md)")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("sheets", help="write blind labelling sheets for one labeller")
    p.add_argument("suite"); p.add_argument("--labeller", required=True); p.add_argument("--out", required=True)
    p = sub.add_parser("check", help="check the shape of a filled sheet")
    p.add_argument("sheet")
    p = sub.add_parser("compare", help="agreement, disputes and a reconciled draft for two sheets")
    p.add_argument("sheet_a"); p.add_argument("sheet_b"); p.add_argument("--out", required=True)
    p = sub.add_parser("finalize", help="write reconciled labels into the suite")
    p.add_argument("compare"); p.add_argument("suite")
    p.add_argument("--status", choices=["reviewed", "final"], default="final")
    p.add_argument("--reviewed-by", help="comma-separated names (default: the two labellers)")
    args = parser.parse_args(argv)

    if args.command == "sheets":
        n = make_sheets(args.suite, args.labeller, args.out)
        print(f"Wrote {n} blind sheets for {args.labeller} to {args.out}")
        return 0
    if args.command == "check":
        problems, warnings = check_sheet(args.sheet)
        for w in warnings:
            print(f"warning: {w}")
        for p_ in problems:
            print(f"problem: {p_}")
        print(f"{len(problems)} problems, {len(warnings)} warnings")
        return 1 if problems else 0
    if args.command == "compare":
        agreement = compare_sheets(args.sheet_a, args.sheet_b, args.out)
        print(report(agreement))
        return 0
    written = finalize(args.compare, args.suite, args.status, args.reviewed_by.split(",") if args.reviewed_by else None)
    print(f"Finalized labels for {len(written)} briefs in {args.suite}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
