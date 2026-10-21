"""
Checks every repository named in a suite's labels against GitHub (eval/README.md, labelling protocol).

    python -m apps.worker.eval.verify_labels eval/suite-v1 [--fix]

- Every labelled repository must exist and be public.
- Renamed or transferred repositories resolve to their current owner/name; --fix rewrites the labels.
- The facts a reviewer needs are written to label-check.json: archived, last push, licence, stars.
- Solutions that are archived, and traps that look healthy, are flagged for the human reviewer: a trap
  must have a stated, checkable reason.
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import httpx

from ..config import config


def fetch(http: httpx.Client, full_name: str):
    resp = http.get(f"https://api.github.com/repos/{full_name}")
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    d = resp.json()
    return {
        "fullName": d["full_name"],
        "archived": d.get("archived", False),
        "pushedAt": d.get("pushed_at"),
        "license": (d.get("license") or {}).get("spdx_id"),
        "stars": d.get("stargazers_count", 0),
        "description": d.get("description"),
    }


def main(argv=None) -> int:
    args = argv if argv is not None else sys.argv[1:]
    suite_dir = Path(args[0])
    fix = "--fix" in args
    headers = {"Accept": "application/vnd.github+json", "User-Agent": "Open-Eye-Eval/1.0"}
    if config.GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {config.GITHUB_TOKEN}"
    http = httpx.Client(headers=headers, timeout=30.0, follow_redirects=True)
    manifest = json.loads((suite_dir / "suite.json").read_text())
    now = datetime.now(timezone.utc)

    report, problems, cache = {}, [], {}
    for brief_id in manifest["briefs"]:
        path = suite_dir / "briefs" / f"{brief_id}.json"
        brief = json.loads(path.read_text())
        labels = brief["labels"]
        entries = [("solution", s) for r in labels["requirements"] for s in r.get("solutions", [])]
        entries += [("product", s) for s in labels.get("products", [])] + [("trap", t) for t in labels.get("traps", [])]
        changed = False
        for role, item in entries:
            name = item["repo"]
            if name.lower() not in cache:
                cache[name.lower()] = fetch(http, name)
            facts = cache[name.lower()]
            if facts is None:
                problems.append(f"{brief_id}: {name} does not exist or is private")
                continue
            if facts["fullName"] != name:
                problems.append(f"{brief_id}: {name} is now {facts['fullName']}" + (" (fixed)" if fix else ""))
                if fix:
                    item["repo"] = facts["fullName"]
                    changed = True
            pushed = datetime.fromisoformat(facts["pushedAt"].replace("Z", "+00:00")) if facts["pushedAt"] else None
            stale = pushed is None or (now - pushed).days > 730
            if role != "trap" and facts["archived"]:
                problems.append(f"{brief_id}: solution {facts['fullName']} is archived")
            if role == "trap" and not (facts["archived"] or stale or not facts["license"] or item.get("reason")):
                problems.append(f"{brief_id}: trap {facts['fullName']} is active, licensed and has no stated reason")
            report[facts["fullName"]] = {**facts, "stale": stale}
        if changed:
            path.write_text(json.dumps(brief, indent=2) + "\n")

    (suite_dir / "label-check.json").write_text(json.dumps({"checkedAt": now.isoformat(), "repositories": report}, indent=2, sort_keys=True) + "\n")
    for p in problems:
        print(p)
    missing = [p for p in problems if "does not exist" in p]
    print(f"[verify_labels] {len(report)} repositories checked, {len(problems)} notes, {len(missing)} missing")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
