"""
Deterministic summaries of a repository that the LLM passes rely on.

The LLM only sees what we give it, so this module decides what matters:
- readme_digest: the parts of a README that say what the project does (feature tables, supported
  platforms, usage), not the first N characters (often badges, banners and sponsor blurbs);
- file_doc_line: the one-line purpose of a file (module docstring or leading comment);
- detect_families: folders of sibling implementations (channels, providers, adapters, drivers),
  which should each become their own capability instead of one generic one;
- compact_outline: a per-file outline that fits every file of a subsystem in a fixed budget.
"""
import re
from pathlib import PurePosixPath
from typing import Dict, List, Any

_HTML_TAG = re.compile(r"<[^>]+>")
_MD_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_PROMO = re.compile(r"\b(sponsor(ed|s)?|free trial|try it free|credits upon registration|utm_|discount|coupon|referral|affiliate)\b", re.I)
# Whole sections that never describe what the software does
_SKIP_HEADINGS = re.compile(
    r"(sponsor|backer|赞助|广告|contributor|贡献者|star history|license|许可|contact|联系|acknowledg|致谢|changelog|更新日志)",
    re.I,
)
_SIGNAL_HEADINGS = re.compile(
    r"\b(feature|platform|support|capabilit|what (it|this) (does|can)|why|overview|usage|how (it|to)|quick ?start|"
    r"getting started|example|channel|integration|provider|backend|api|command|cli)\w*",
    re.I,
)


def _clean_line(line: str) -> str:
    line = _MD_IMAGE.sub("", line)
    line = _MD_LINK.sub(r"\1", line)
    line = _HTML_TAG.sub(" ", line)
    return re.sub(r"[ \t]+", " ", line).rstrip()


def readme_digest(text: str, limit: int = 6000) -> str:
    """Most informative README sections within `limit` characters, in original order."""
    if not text:
        return ""
    sections: List[Dict[str, Any]] = []
    current = {"heading": "", "lines": []}
    in_code = False
    for raw in text.splitlines():
        if raw.strip().startswith("```"):
            in_code = not in_code
            continue
        if in_code:
            continue  # code blocks rarely describe capabilities and eat the budget
        line = _clean_line(raw)
        if re.match(r"^#{1,6}\s", line):
            sections.append(current)
            current = {"heading": line.lstrip("#").strip(), "lines": [line]}
            continue
        if not line.strip() or _PROMO.search(line) or re.fullmatch(r"[\s|:\-]*", line):
            continue
        current["lines"].append(line)
    sections.append(current)

    def score(section: Dict[str, Any]) -> float:
        body = "\n".join(section["lines"])
        value = 0.0
        if _SIGNAL_HEADINGS.search(section["heading"]):
            value += 3
        value += min(3.0, body.count("|") / 20)              # tables (feature/platform matrices)
        value += min(2.0, len(re.findall(r"^\s*[-*] ", body, re.M)) / 5)  # bullet lists
        return value

    indexed = [(i, s) for i, s in enumerate(sections) if s["lines"] and not _SKIP_HEADINGS.search(s["heading"])]
    # The intro (first section) always goes in; the rest by score, then restored to document order
    chosen = {indexed[0][0]} if indexed else set()
    budget = limit - (len("\n".join(indexed[0][1]["lines"])) if indexed else 0)
    for i, s in sorted(indexed[1:], key=lambda item: -score(item[1])):
        size = len("\n".join(s["lines"])) + 1
        if score(s) > 0 and size <= budget:
            chosen.add(i)
            budget -= size
    out = "\n".join("\n".join(s["lines"]) for i, s in indexed if i in chosen)
    return out[:limit]


def file_doc_line(rel_path: str, content: str) -> str:
    """One-line purpose of a file: module docstring or leading comment."""
    head = content[:2000]
    if rel_path.endswith(".py"):
        m = re.match(r'\s*(?:#[^\n]*\n\s*)*(?:"""|\'\'\')\s*([^\n]+)', head)
        if m:
            return m.group(1).strip().strip('"\'').strip()[:160]
    m = re.match(r"\s*(?:/\*\*?|//+|#)\s*([^\n*][^\n]*)", head)
    if m and not m.group(1).lower().startswith(("!", "copyright", "license", "eslint", "@ts-", "use strict")):
        return m.group(1).strip().rstrip("*/").strip()[:160]
    return ""


def detect_families(file_infos: Dict[str, Dict[str, Any]], min_members: int = 4) -> List[Dict[str, Any]]:
    """
    Folders where at least `min_members` sibling code files each define a class: the classic shape of
    plugin families (channels/, providers/, adapters/, backends/, drivers/, integrations/).
    """
    by_dir: Dict[str, List[str]] = {}
    for path, info in file_infos.items():
        if info.get("classes"):
            stem = PurePosixPath(path).stem
            if stem.startswith("_") or stem in ("base", "index", "utils", "types", "__init__"):
                continue
            by_dir.setdefault(str(PurePosixPath(path).parent), []).append(path)
    families = []
    for directory, paths in by_dir.items():
        if len(paths) < min_members:
            continue
        members = [{
            "file": PurePosixPath(p).name,
            "path": p,
            "classes": file_infos[p]["classes"][:3],
            "doc": file_infos[p].get("doc", ""),
        } for p in sorted(paths)]
        families.append({"directory": directory, "members": members})
    families.sort(key=lambda f: -len(f["members"]))
    return families


def format_families(families: List[Dict[str, Any]], limit: int = 4000) -> str:
    lines: List[str] = []
    for fam in families:
        lines.append(f"{fam['directory']}/ ({len(fam['members'])} implementations)")
        for m in fam["members"]:
            doc = f" - {m['doc']}" if m["doc"] else ""
            lines.append(f"  - {m['file']}: {', '.join(m['classes'])}{doc}")
    return "\n".join(lines)[:limit]


def compact_outline(file_infos: Dict[str, Dict[str, Any]], paths: List[str], limit: int = 6000) -> str:
    """Outline of every file under `paths`, a few symbols each, so no file is cut off entirely."""
    selected = sorted(p for p in file_infos if any(p == sp or p.startswith(sp.rstrip("/") + "/") for sp in paths))
    if not selected:
        return ""
    per_file = max(160, limit // len(selected))
    blocks = []
    for p in selected:
        info = file_infos[p]
        header = f"File: {p}" + (f" - {info['doc']}" if info.get("doc") else "")
        symbols = ", ".join(info.get("classes", []) + info.get("functions", []))
        blocks.append(f"{header}\n  {symbols}"[:per_file])
    return "\n".join(blocks)[:limit]


def mostly_non_latin(text: str, threshold: float = 0.2) -> bool:
    """True when a large share of the letters are CJK (or other non-Latin) characters."""
    letters = [ch for ch in text[:20000] if ch.isalpha()]
    if not letters:
        return False
    non_latin = sum(1 for ch in letters if ord(ch) > 0x2E80)
    return non_latin / len(letters) > threshold


def is_english_readme_variant(rel_path: str) -> bool:
    """README_en.md, README.en.md, README-EN.md, docs/README_en.md ..."""
    name = PurePosixPath(rel_path).name.lower()
    return bool(re.fullmatch(r"readme[._-]?(en|english|en-us|en_us)\.(md|rst|txt|markdown)", name))
