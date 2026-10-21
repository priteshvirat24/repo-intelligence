"""
Evidence rules shared by the blueprint stages (PRODUCT_DEFINITION 5.1, 5.3, 5.4; SYSTEM_DESIGN 7).

Every stage validator decides from these, never from the model's say-so:
  - which numbered sources exist and what grade each carries;
  - whether a source is about a requirement (is_about, deliberately strict);
  - how a candidate's licence compares with the brief's licence policy.
"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
import re
from typing import Any, Dict, List, Optional

from .planner import CONSTRAINT_TYPES, sorted_requirements

# Words too common in requirement names to show that a cited capability is about that requirement
_GENERIC_REQUIREMENT_WORDS = {
    "real", "time", "realtime", "interactive", "performance", "optimization", "optimisation", "handling",
    "error", "graceful", "degradation", "user", "users", "data", "system", "support", "management",
    "integration", "pipeline", "visualization", "visualisation", "display", "layer", "service", "based",
    "features", "feature", "capability", "high", "fast", "scalable", "efficient", "robust", "simple",
    "and", "the", "for", "with", "from", "into", "via", "using", "over", "onto", "its", "their",
}
STRONG_GRADES = ("E1", "E2", "E3")
CODE_GRADES = ("E1", "E2")
# Source kinds that can show a capability. Limitations and README assessments cannot verify one.
CAPABILITY_KINDS = ("code", "doc")
STALE_DAYS = 730

# The six build-versus-reuse classes (PRODUCT_DEFINITION 5.4) and the legacy decision each maps onto
CLASS_LABELS = {
    1: "Available and verified",
    2: "Available, needs configuration or integration",
    3: "Available, needs modification",
    4: "Partially solved",
    5: "Missing, must be built",
    6: "Unresolved",
}
LEGACY_DECISION_CLASS = {"reuse": 1, "adapt": 3, "build": 5, "investigate": 6}

# Licence families (SPDX ids as GitHub reports them). Anything else is "unknown" and needs a person.
PERMISSIVE_LICENCES = {
    "MIT", "MIT-0", "APACHE-2.0", "BSD-2-CLAUSE", "BSD-3-CLAUSE", "BSD-3-CLAUSE-CLEAR", "ISC", "0BSD",
    "UNLICENSE", "ZLIB", "BSL-1.0", "CC0-1.0", "PSF-2.0", "PYTHON-2.0", "WTFPL", "UPL-1.0", "NCSA",
}
COPYLEFT_PREFIXES = ("GPL-", "AGPL-", "LGPL-", "MPL-", "EPL-", "CDDL-", "EUPL-", "OSL-", "SSPL-", "CC-BY-SA-")
LICENCE_POLICIES = ("copyleft-flagged", "permissive-only", "any")
DEFAULT_LICENCE_POLICY = "copyleft-flagged"


def text(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def text_list(value: Any, limit: int, item_limit: int = 300) -> List[str]:
    out = []
    for item in value if isinstance(value, list) else []:
        t = text(item, item_limit)
        if t and t not in out:
            out.append(t)
        if len(out) >= limit:
            break
    return out


def distinctive_words(value: str) -> set:
    words = re.findall(r"[a-z0-9][a-z0-9+#]*", value.lower())
    return {w for w in words if len(w) > 2 and w not in _GENERIC_REQUIREMENT_WORDS}


def same_word(a: str, b: str) -> bool:
    """transformation ~ transformations, propagate ~ propagation: equal, or a shared 5-letter stem."""
    return a == b or (len(a) >= 5 and len(b) >= 5 and a[:5] == b[:5])


def is_about(source: Dict[str, Any], requirement: Dict[str, Any]) -> bool:
    """Deterministic and deliberately strict: the cited capability's title must share a distinctive word with
    the requirement's name. Without it, code evidence from the right repository may still be about another
    capability (citing "3D globe rendering" for "ground tracks"), and must not count as verifying it."""
    title_words = distinctive_words(source.get("title") or "")
    return any(same_word(a, b) for a in distinctive_words(requirement["name"]) for b in title_words)


def source_grade(source: Dict[str, Any]) -> str:
    """The grade of the claim behind a source, or the grade its kind implies when no claim was matched."""
    if source.get("grade") in ("E1", "E2", "E3", "E4", "E5"):
        return source["grade"]
    if source.get("kind") == "code":
        return "E2"
    if source.get("kind") == "doc":
        return "E3"
    if source.get("kind") == "limitation":
        return "E2" if source.get("filePath") else "E5"
    return "E4"


def source_ids(value: Any, known: Dict[str, Dict[str, Any]]) -> List[str]:
    ids = []
    for item in value if isinstance(value, list) else []:
        sid = str(item).strip().strip("[]").upper()
        if sid in known and sid not in ids:
            ids.append(sid)
    return ids


def parse_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00").replace(" ", "T"))
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def licence_family(licence: Optional[str]) -> str:
    """permissive | copyleft | none | unknown"""
    if not licence or str(licence).upper() in ("NOASSERTION", "NONE"):
        return "none"
    key = str(licence).upper()
    if key in PERMISSIVE_LICENCES:
        return "permissive"
    if key.startswith(COPYLEFT_PREFIXES) or key in ("GPL", "AGPL", "LGPL"):
        return "copyleft"
    return "unknown"


def licence_check(licence: Optional[str], policy: str) -> Dict[str, Any]:
    """The candidate's licence against the brief's licence policy (constraints_json.licencePolicy).
    status: compatible | flagged (allowed, a person should confirm) | conflict (not allowed) | missing (no
    licence: not legally reusable) | unknown (not a recognised licence: a person must read it)."""
    family = licence_family(licence)
    if family == "none":
        status, note = "missing", "No licence: the code cannot legally be reused. Ask the authors, or treat it as reference only."
    elif family == "permissive":
        status, note = "compatible", f"{licence} is permissive."
    elif family == "copyleft":
        if policy == "permissive-only":
            status, note = "conflict", f"{licence} is copyleft; the brief allows permissive licences only."
        elif policy == "any":
            status, note = "compatible", f"{licence} is copyleft; the brief accepts any licence."
        else:
            status, note = "flagged", f"{licence} is copyleft: its obligations apply to what is distributed with it. Confirm this is acceptable."
    else:
        status, note = "unknown", f"{licence} is not a recognised open-source licence identifier; read it before reuse."
    return {"licence": licence if family != "none" else None, "family": family, "policy": policy, "status": status, "note": note}


@dataclass
class BlueprintContext:
    """Everything the stage validators read, derived once from the blueprint inputs."""
    inputs: Dict[str, Any]
    sources: List[Dict[str, Any]]
    now: datetime
    reqs: List[Dict[str, Any]] = field(default_factory=list)
    req_names: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    repos: Dict[str, str] = field(default_factory=dict)
    known: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    candidates: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    verification: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    licence_policy: str = DEFAULT_LICENCE_POLICY
    challenges: List[Dict[str, Any]] = field(default_factory=list)
    previous: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def build(cls, inputs: Dict[str, Any], sources: List[Dict[str, Any]], now: datetime) -> "BlueprintContext":
        reqs = sorted_requirements(inputs.get("requirements") or {})
        constraints = inputs.get("constraints") or {}
        policy = constraints.get("licencePolicy") if constraints.get("licencePolicy") in LICENCE_POLICIES else DEFAULT_LICENCE_POLICY
        challenges = []
        for i, ch in enumerate((inputs.get("challenges") or [])[-5:]):
            if isinstance(ch, dict) and ch.get("requirement"):
                challenges.append({**ch, "ref": f"CH{i + 1}"})
        return cls(
            inputs=inputs, sources=sources, now=now, reqs=reqs,
            req_names={r["name"].strip().lower(): r for r in reqs},
            repos={c["full_name"].lower(): c["full_name"] for c in inputs.get("candidates") or []},
            known={s["id"]: s for s in sources},
            candidates={c["full_name"].lower(): c for c in inputs.get("candidates") or []},
            verification={v["fullName"].lower(): v for v in inputs.get("verification") or []},
            licence_policy=policy,
            challenges=challenges,
            previous=inputs.get("previous") or {},
        )

    def requirement(self, name: Any) -> Optional[Dict[str, Any]]:
        return self.req_names.get(text(name, 300).lower())

    def repo(self, name: Any) -> Optional[str]:
        return self.repos.get(text(name, 300).lower())

    def is_constraint(self, req: Dict[str, Any]) -> bool:
        return req.get("type") in CONSTRAINT_TYPES

    def code_verified(self, repo: str) -> bool:
        v = self.verification.get(repo.lower()) or {}
        return ((v.get("repository") or {}).get("status")) == "READY"

    def strong(self, ids: List[str], repo: Optional[str], req: Dict[str, Any]) -> List[str]:
        """Cited sources from `repo` that can carry classes 1-3: code or documentation, graded E1-E3, about req."""
        return [sid for sid in ids if repo and self.known[sid]["repo"].lower() == repo.lower()
                and self.known[sid].get("kind") in CAPABILITY_KINDS
                and source_grade(self.known[sid]) in STRONG_GRADES and is_about(self.known[sid], req)]

    def repo_sources(self, repo: str, kinds=None) -> List[str]:
        return [s["id"] for s in self.sources if s["repo"].lower() == repo.lower() and (kinds is None or s.get("kind") in kinds)]

    def readme_coverage(self, req: Dict[str, Any], values=("yes",)) -> List[str]:
        """Candidates whose README assessment (E4) says they cover the requirement."""
        out = []
        for c in self.inputs.get("candidates") or []:
            coverage = (c.get("assessment_json") or {}).get("coverage") or {}
            if any(k.strip().lower() == req["name"].strip().lower() and v in values for k, v in coverage.items()):
                out.append(c["full_name"])
        return out

    def queries_for(self, req: Dict[str, Any]) -> List[str]:
        return [q["query"] for q in self.inputs.get("discoveryQueries") or []
                if isinstance(q, dict) and q.get("query") and str(q.get("requirement", "")).strip().lower() == req["name"].strip().lower()]
