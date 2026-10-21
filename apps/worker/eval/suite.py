"""Loading an evaluation suite and matching system output against its labels (eval/README.md)."""
import json
from pathlib import Path
from typing import Any, Dict, List, Set

RATINGS = ("essential", "acceptable")


def load_suite(suite_dir: str) -> Dict[str, Any]:
    root = Path(suite_dir)
    manifest = json.loads((root / "suite.json").read_text())
    briefs = [json.loads((root / "briefs" / f"{brief_id}.json").read_text()) for brief_id in manifest["briefs"]]
    for b in briefs:
        validate_brief(b)
    return {**manifest, "briefs": briefs}


def validate_brief(brief: Dict[str, Any]):
    for key in ("id", "domain", "title", "brief", "labels"):
        if key not in brief:
            raise ValueError(f"Brief {brief.get('id', '?')} is missing {key!r}")
    for req in brief["labels"]["requirements"]:
        for s in req.get("solutions", []):
            if s["rating"] not in RATINGS:
                raise ValueError(f"{brief['id']}: unknown rating {s['rating']!r} for {s['repo']}")


def norm(full_name: str) -> str:
    return full_name.strip().lower()


def labelled(brief: Dict[str, Any], rating: str) -> Set[str]:
    """Repositories labelled with `rating` for any requirement (plus whole-product solutions)."""
    repos = set()
    for req in brief["labels"]["requirements"]:
        repos |= {norm(s["repo"]) for s in req.get("solutions", []) if s["rating"] == rating}
    repos |= {norm(s["repo"]) for s in brief["labels"].get("products", []) if s["rating"] == rating}
    return repos


def traps(brief: Dict[str, Any]) -> Set[str]:
    return {norm(t["repo"]) for t in brief["labels"].get("traps", [])}


def score_brief(brief: Dict[str, Any], ranked: List[str], shortlisted: List[str]) -> Dict[str, Any]:
    """Outcome metrics for one brief (SYSTEM_DESIGN 10.4) from a ranked list of repository names and the
    subset the system recommends as starting points."""
    ranked_n = [norm(r) for r in ranked]
    top10 = set(ranked_n[:10])
    essential, acceptable, trap_set = labelled(brief, "essential"), labelled(brief, "acceptable"), traps(brief)
    relevant = essential | acceptable
    short = [norm(r) for r in shortlisted]
    found_essential = sorted(essential & top10)
    return {
        "essentialTotal": len(essential),
        "recallAt10": round(len(found_essential) / len(essential), 4) if essential else None,
        "recallAll": round(len(essential & set(ranked_n)) / len(essential), 4) if essential else None,
        "foundEssential": found_essential,
        "missedEssential": sorted(essential - top10),
        "shortlistSize": len(short),
        "shortlistPrecision": round(sum(1 for r in short if r in relevant) / len(short), 4) if short else None,
        # Share of the essential solutions the system recommends. Guards precision, which a shorter
        # shortlist raises without recommending anything better
        "shortlistRecall": round(len(essential & set(short)) / len(essential), 4) if essential else None,
        "shortlistUnlabelled": [r for r in short if r not in relevant and r not in trap_set],
        "trapsTotal": len(trap_set),
        "trapRejection": round(sum(1 for t in trap_set if t not in short) / len(trap_set), 4) if trap_set else None,
        # Of the traps the system actually surfaced, the share it did not recommend. trapRejection alone
        # rewards a system that finds nothing (it cannot recommend a trap it never saw)
        "trapsSurfaced": len(trap_set & set(ranked_n)),
        "trapRejectionSurfaced": (round(sum(1 for t in trap_set & set(ranked_n) if t not in short) / len(trap_set & set(ranked_n)), 4)
                                  if trap_set & set(ranked_n) else None),
        "trapsShortlisted": sorted(t for t in trap_set if t in short),
        "trapsInTop10": sorted(trap_set & top10),
    }


def aggregate(per_brief: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Macro averages over briefs where the metric is defined."""
    def mean(key):
        values = [b[key] for b in per_brief if b.get(key) is not None]
        return round(sum(values) / len(values), 4) if values else None
    return {
        "briefs": len(per_brief),
        "recallAt10": mean("recallAt10"),
        "recallAll": mean("recallAll"),
        "shortlistPrecision": mean("shortlistPrecision"),
        "shortlistRecall": mean("shortlistRecall"),
        "trapRejection": mean("trapRejection"),
        "trapsSurfaced": sum(b.get("trapsSurfaced", 0) for b in per_brief),
        "trapsShortlisted": sum(len(b.get("trapsShortlisted", [])) for b in per_brief),
        "trapRejectionSurfaced": (
            round(1 - sum(len(b.get("trapsShortlisted", [])) for b in per_brief) / sum(b.get("trapsSurfaced", 0) for b in per_brief), 4)
            if sum(b.get("trapsSurfaced", 0) for b in per_brief) else None
        ),
    }
