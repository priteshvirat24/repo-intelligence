"""Two-person labelling protocol tooling (apps/worker/eval/labelling.py), on a two-brief copy of suite-v1."""
import json
import shutil
from pathlib import Path

import pytest

from apps.worker.eval import labelling
from apps.worker.eval.suite import load_suite

ROOT = Path(__file__).resolve().parents[2]
BRIEFS = ["geo-satellite-tracker", "web-job-queue"]


@pytest.fixture
def suite(tmp_path):
    src = ROOT / "eval" / "suite-v1"
    dst = tmp_path / "suite"
    (dst / "briefs").mkdir(parents=True)
    for b in BRIEFS:
        shutil.copy(src / "briefs" / f"{b}.json", dst / "briefs" / f"{b}.json")
    manifest = json.loads((src / "suite.json").read_text())
    (dst / "suite.json").write_text(json.dumps({**manifest, "briefs": BRIEFS}))
    return dst


def fill(sheet_dir: Path, brief_id: str, requirements, products=(), traps=()):
    path = sheet_dir / "briefs" / f"{brief_id}.json"
    sheet = json.loads(path.read_text())
    sheet["labels"].update({"requirements": requirements, "products": list(products), "traps": list(traps)})
    path.write_text(json.dumps(sheet))


def req(rid, name, cls, solutions, criticality="MUST"):
    return {"id": rid, "name": name, "criticality": criticality, "type": "functional", "expectedClass": cls,
            "solutions": [{"repo": r, "rating": rating, "foundAt": "GitHub search"} for r, rating in solutions]}


def test_sheets_are_blind_and_never_overwrite(suite, tmp_path):
    out = tmp_path / "alice"
    assert labelling.make_sheets(str(suite), "alice", str(out)) == 2
    sheet = json.loads((out / "briefs" / "geo-satellite-tracker.json").read_text())
    original = json.loads((suite / "briefs" / "geo-satellite-tracker.json").read_text())
    assert sheet["brief"] == original["brief"] and sheet["title"] == original["title"]
    assert sheet["labels"] == {"status": "draft", "labelledBy": ["alice"], "reviewedBy": [], "requirements": [], "products": [], "traps": []}
    assert "satellite-js" not in json.dumps(sheet)  # nothing from the draft labels
    load_suite(str(out))  # a sheet has the suite layout, so verify_labels and load_suite work on it
    with pytest.raises(SystemExit, match="refusing to overwrite"):
        labelling.make_sheets(str(suite), "alice", str(out))


def test_check_flags_shape_problems_and_missing_sources(suite, tmp_path):
    out = tmp_path / "alice"
    labelling.make_sheets(str(suite), "alice", str(out))
    problems, _ = labelling.check_sheet(str(out))
    assert any("no requirements" in p for p in problems)
    bad = req("prop", "Orbit propagation", 9, [("not a repo", "essential")], criticality="HIGH")
    bad["solutions"].append({"repo": "a/b", "rating": "great"})
    fill(out, "geo-satellite-tracker", [bad, {**bad}], traps=[{"repo": "a/b", "reason": ""}])
    problems, warnings = labelling.check_sheet(str(out))
    text = "\n".join(problems)
    for expected in ("duplicate id", "criticality must be", "expectedClass must be 1-6", "must be owner/name",
                     "rating must be essential or acceptable", "needs a reason", "also listed as a solution"):
        assert expected in text, expected
    assert any("no foundAt" in w for w in warnings)


def labelled_pair(suite, tmp_path):
    a, b = tmp_path / "alice", tmp_path / "bob"
    labelling.make_sheets(str(suite), "alice", str(a))
    labelling.make_sheets(str(suite), "bob", str(b))
    fill(a, "geo-satellite-tracker", [
        req("propagation", "Orbit propagation with SGP4", 2, [("shashwatak/satellite-js", "essential"), ("brandon-rhodes/python-sgp4", "essential")]),
        req("globe", "3D globe rendering", 2, [("CesiumGS/cesium", "essential")]),
    ], traps=[{"repo": "old/orbits", "reason": "archived in 2019"}])
    fill(b, "geo-satellite-tracker", [
        req("sgp4", "SGP4 orbit propagation", 2, [("shashwatak/satellite-js", "essential"), ("brandon-rhodes/python-sgp4", "acceptable")]),
        req("globe", "Globe rendering in 3D", 3, [("CesiumGS/cesium", "essential")]),
    ])
    for side in (a, b):
        fill(side, "web-job-queue", [req("queue", "Durable job queue", 2, [("taskforcesh/bullmq", "essential")])])
    return a, b


def test_compare_reports_agreement_disputes_and_a_draft(suite, tmp_path):
    a, b = labelled_pair(suite, tmp_path)
    agreement = labelling.compare_sheets(str(a), str(b), str(tmp_path / "compare"))
    sat = next(r for r in agreement["briefs"] if r["briefId"] == "geo-satellite-tracker")
    assert sat["essentialAgreement"] == pytest.approx(2 / 3, abs=1e-4)  # both: satellite-js, cesium; alice only: python-sgp4
    assert sat["classAgreement"] == 0.5 and sat["requirementsMatched"] == 2 and not sat["rewrite"]
    draft = json.loads((tmp_path / "compare" / "draft" / "briefs" / "geo-satellite-tracker.json").read_text())
    kinds = sorted(d["kind"] for d in draft["labels"]["disputes"])
    assert kinds == ["essential_by_one", "expected_class", "trap_by_one"]
    ratings = {s["repo"]: s["rating"] for r in draft["labels"]["requirements"] for s in r["solutions"]}
    assert ratings == {"shashwatak/satellite-js": "essential", "brandon-rhodes/python-sgp4": "acceptable", "CesiumGS/cesium": "essential"}
    assert agreement["briefsToRewrite"] == [] and "Label agreement: alice and bob" in (tmp_path / "compare" / "report.md").read_text()


def test_low_agreement_marks_a_brief_for_rewriting(suite, tmp_path):
    a, b = labelled_pair(suite, tmp_path)
    fill(b, "web-job-queue", [req("queue", "Durable job queue", 2, [("OptimalBits/bee-queue", "essential")])])
    agreement = labelling.compare_sheets(str(a), str(b), str(tmp_path / "compare"))
    assert agreement["briefsToRewrite"] == ["web-job-queue"]


def test_compare_needs_two_different_labellers(suite, tmp_path):
    a, _ = labelled_pair(suite, tmp_path)
    with pytest.raises(SystemExit, match="two people"):
        labelling.compare_sheets(str(a), str(a), str(tmp_path / "compare"))


def test_finalize_waits_for_resolved_disputes_then_freezes(suite, tmp_path):
    a, b = labelled_pair(suite, tmp_path)
    compare = tmp_path / "compare"
    labelling.compare_sheets(str(a), str(b), str(compare))
    with pytest.raises(SystemExit, match="disputes still open"):
        labelling.finalize(str(compare), str(suite))
    for path in (compare / "draft" / "briefs").glob("*.json"):  # the reviewers resolved every dispute
        brief = json.loads(path.read_text())
        brief["labels"]["disputes"] = []
        path.write_text(json.dumps(brief))
    assert sorted(labelling.finalize(str(compare), str(suite))) == sorted(BRIEFS)
    final = json.loads((suite / "briefs" / "geo-satellite-tracker.json").read_text())["labels"]
    assert final["status"] == "final" and final["labelledBy"] == ["alice", "bob"] and "disputes" not in final
    manifest = json.loads((suite / "suite.json").read_text())
    assert manifest["labelsStatus"].startswith("final: labelled independently by alice and bob")
    assert manifest["agreement"]["labellers"] == ["alice", "bob"]
    load_suite(str(suite))  # still a valid suite
    with pytest.raises(SystemExit, match="already final"):
        labelling.finalize(str(compare), str(suite))
