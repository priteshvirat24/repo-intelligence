"""
The blueprint's design stages (SYSTEM_DESIGN 7): classify, inventory, architecture, integration guide and
roadmap. Each stage is one LLM call whose output is validated against the evidence; when the output is
unusable the stage falls back to a deterministic result built from the data alone. Validators never add a
capability, licence, version or test result the sources do not contain; anything else is labelled as an
estimate, a design recommendation or an inference.
"""
import re
from typing import Any, Dict, List, Optional, Tuple

from ..claims import statement_key
from .blueprint_evidence import (
    CLASS_LABELS, CODE_GRADES, LEGACY_DECISION_CLASS, STALE_DAYS, BlueprintContext, is_about, licence_check, parse_time,
    source_grade, source_ids, text, text_list,
)

MAX_STEPS = 12
MAX_TASKS = 16
MAX_ARCH_COMPONENTS = 14

INVENTORY_ACTIONS = ("reuse", "adapt", "investigate", "reject")
ORIGINS = ("reused", "adapted", "new")
GUIDE_PHASES = ("prerequisites", "install", "configuration", "integration", "verification")
COMPLEXITY = ("S", "M", "L")
UNCERTAINTY = ("low", "medium", "high")
CRITICALITY_PRIORITY = {"MUST": 1, "SHOULD": 2, "NICE_TO_HAVE": 3}
ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
# NAME=value in prose or code: the value is removed, only the name survives (PRODUCT_DEFINITION 5.6)
ENV_ASSIGNMENT = re.compile(r"\b([A-Z][A-Z0-9_]{2,63})\s*=\s*(\"[^\"\n]*\"|'[^'\n]*'|[^\s\"'`]+)")


# Shared prompt context -------------------------------------------------------------------------------

def requirement_lines(ctx: BlueprintContext) -> str:
    return "\n".join(
        f"- [{r.get('criticality', 'SHOULD')}{' constraint' if ctx.is_constraint(r) else ''}] {r['name']}: {r.get('description', '')}"
        for r in ctx.reqs
    )


def candidate_lines(ctx: BlueprintContext) -> str:
    lines = []
    for c in ctx.inputs.get("candidates") or []:
        v = ctx.verification.get(c["full_name"].lower())
        repo = (v or {}).get("repository") or {}
        if repo.get("status") == "READY":
            status = "code verified"
        elif v and v.get("state") == "skipped":
            status = "not verified (could not be indexed)"
        elif repo.get("status") == "FAILED":
            status = "not verified (indexing failed)"
        else:
            status = "README only"
        extra = ""
        if repo.get("purpose"):
            extra += f" Purpose: {repo['purpose'][:300]}"
        deps = [d["package_name"] for d in (v or {}).get("dependencies", [])][:12]
        if deps:
            extra += f" Runtime deps: {', '.join(deps)}."
        lines.append(f"- {c['full_name']} ({c.get('primary_language') or '?'}, {c.get('stars', 0)} stars, licence {c.get('license') or 'none'}, {status}).{extra}")
    return "\n".join(lines) or "- none found"


def source_lines(ctx: BlueprintContext, repos: Optional[set] = None) -> str:
    lines = []
    for s in ctx.sources:
        if repos is not None and s["repo"].lower() not in repos:
            continue
        location = f" {s['filePath']}" + (f":{s['startLine']}" if s.get("startLine") else "") if s.get("filePath") else ""
        quote = f" | code: {s['quote']}" if s.get("quote") else ""
        lines.append(f"[{s['id']}] {s['repo']}{location} | {s['title']}: {s['text'][:300]}{quote}")
    return "\n".join(lines) or "(no sources)"


def _untrusted(body: str) -> str:
    return f"<untrusted_repository_content>\nSources:\n{body}\n</untrusted_repository_content>"


def _head(ctx: BlueprintContext) -> str:
    return f"Project: {ctx.inputs.get('title', '')}\nSummary: {(ctx.inputs.get('requirements') or {}).get('problemSummary', '')}"


def _constraint_text(ctx: BlueprintContext) -> str:
    c = ctx.inputs.get("constraints") or {}
    parts = [f"{k}: {c[k]}" for k in ("languages", "infrastructure", "prefer", "avoid", "notes") if c.get(k)]
    parts.append(f"licence policy: {ctx.licence_policy}")
    return "; ".join(parts)


def _classification_lines(components: List[Dict[str, Any]]) -> str:
    return "\n".join(
        f"- {c['requirement']}: class {c['class']} ({CLASS_LABELS[c['class']]}){' via ' + c['repo'] if c.get('repo') else ''}. {c['reason'][:200]}"
        for c in components
    )


def _inventory_lines(inventory: List[Dict[str, Any]]) -> str:
    return "\n".join(f"- {e['repo']}: {e['action']} ({e['licence']['status']} licence). {e['reason'][:160]}" for e in inventory) or "- none"


# 1. Classify ------------------------------------------------------------------------------------------

def classify_prompt(ctx: BlueprintContext) -> str:
    names = ", ".join(f'"{r["name"]}"' for r in ctx.reqs)
    challenge_block = ""
    if ctx.challenges:
        lines = []
        for ch in ctx.challenges:
            name = (ctx.requirement(ch["requirement"]) or {}).get("name") or text(ch["requirement"], 300)
            previous = _previous_component(ctx, name)
            was = f" (currently class {previous.get('class') or LEGACY_DECISION_CLASS.get(previous.get('decision'), '?')}{' via ' + previous['repo'] if previous.get('repo') else ''})" if previous else ""
            lines.append(f"- [{ch['ref']}] {name}{was}{': why not ' + ch['repo'] + '?' if ch.get('repo') else ''} {text(ch.get('note'), 500)}")
        challenge_block = (
            "\nThe user challenged these decisions. Reconsider each one explicitly against the sources and answer it in"
            " challengeResponses; change the class only if the evidence supports the change:\n" + "\n".join(lines) + "\n"
        )
    return f"""{_head(ctx)}

Requirements:
{requirement_lines(ctx)}

Candidate repositories:
{candidate_lines(ctx)}

{_untrusted(source_lines(ctx))}
{challenge_block}
Classify every requirement into exactly one build-versus-reuse class:
1 available and verified: a repository meets it as it is.
2 available, needs configuration or integration: name the setup or glue work in "setup".
3 available, needs modification: a repository does most of it; name the change in "change".
4 partially solved: repositories cover parts; name the uncovered part in "uncovered".
5 missing, must be built: nothing found does it.
6 unresolved: evidence is insufficient or conflicting; say in "resolveBy" what evidence would resolve it.
Classes 1-3 must name the repository and cite [C..] sources from it that are about this requirement. README
assessments [R..] alone are not enough: use class 6.

Return JSON:
{{
  "classifications": [{{"requirement": one of {names}, "class": 1, "repo": "owner/name or null", "reason": "1-2 sentences", "sources": ["C1"], "setup": "", "change": "", "uncovered": "", "resolveBy": ""}}],
  "challengeResponses": [{{"id": "CH1", "response": "1-3 sentences answering the challenge from the sources"}}]
}}"""


def _previous_component(ctx: BlueprintContext, requirement: str) -> Optional[Dict[str, Any]]:
    for c in ctx.previous.get("components") or []:
        if str(c.get("requirement", "")).strip().lower() == requirement.strip().lower():
            return c
    return None


def _decision_for(cls: int, strong: bool) -> str:
    if cls in (1, 2):
        return "reuse"
    if cls == 3:
        return "adapt"
    if cls == 4:
        return "adapt" if strong else "investigate"
    if cls == 5:
        return "build"
    return "investigate"


def _component(ctx: BlueprintContext, req: Dict[str, Any], cls: int, repo: Optional[str], reason: str, cited: List[str],
               evidence: str, strong: List[str], details: Dict[str, str], generated: bool = False) -> Dict[str, Any]:
    entry = {
        "requirement": req["name"],
        "criticality": req.get("criticality", "SHOULD"),
        "isConstraint": ctx.is_constraint(req),
        "class": cls,
        "classLabel": CLASS_LABELS[cls],
        "decision": _decision_for(cls, bool(strong)),
        "repo": repo,
        "reason": reason,
        "how": reason,
        "sources": cited,
        "evidence": evidence,
        "evidenceGrades": sorted({source_grade(ctx.known[s]) for s in cited}),
    }
    for key in ("setup", "change", "uncovered", "resolveBy"):
        if details.get(key):
            entry[key] = details[key]
    if cls == 5:
        entry["searched"] = ctx.queries_for(req)
    if generated:
        entry["generated"] = True
    return entry


def validate_classification(raw: Any, ctx: BlueprintContext) -> Dict[str, Dict[str, Any]]:
    """Exactly one class per requirement (PRODUCT_DEFINITION 5.4). Accepts the staged shape ("class") and the
    single-call shape ("decision"). Rules enforced from the evidence:
      - classes 1-3 need cited code or documentation (E1-E3) from the named repository about the requirement;
        with only README claims, or code about something else, the requirement becomes class 6;
      - with no cited source from the named repository at all, it becomes class 5 (build);
      - class 1 needs E1/E2; documentation-only support (E3) is class 2;
      - class 3 without the change, or 4 without the uncovered part, is unresolved (6);
      - class 5 while a README claims coverage is unresolved (6): the claim has to be checked first."""
    items = raw if isinstance(raw, list) else []
    components: Dict[str, Dict[str, Any]] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        req = ctx.requirement(item.get("requirement"))
        if not req or req["name"] in components:
            continue
        try:
            cls = int(item.get("class"))
        except (TypeError, ValueError):
            cls = 0
        legacy = cls not in CLASS_LABELS
        if legacy:
            cls = LEGACY_DECISION_CLASS.get(text(item.get("decision"), 12).lower(), 5)
        named = text(item.get("repo"), 300)
        repo = ctx.repo(named) if cls != 5 else None
        cited = source_ids(item.get("sources"), ctx.known)
        from_repo = [sid for sid in cited if repo and ctx.known[sid]["repo"].lower() == repo.lower()]
        strong = ctx.strong(cited, repo, req)
        evidence = "verified" if strong else "unconfirmed" if from_repo else "none"
        reason = text(item.get("reason") or item.get("how"), 600)
        details = {k: text(item.get(k), 400) for k in ("setup", "change", "uncovered", "resolveBy")}
        if legacy and cls == 3:
            # A single-call "adapt" says what changes in "how"
            details["change"] = details["change"] or text(item.get("how"), 400)

        if cls in (1, 2, 3, 4) and not from_repo:
            if repo or named:
                reason = f"No cited evidence that {repo or named} does this. " + reason
            cls, repo = 5, None
        elif cls in (1, 2, 3) and not strong:
            reason = f"Not confirmed in {repo}'s code; verify before relying on it. " + reason
            details["resolveBy"] = details["resolveBy"] or f"Code evidence (E2) in {repo} that it implements {req['name']}"
            cls = 6
        elif cls == 1 and not any(source_grade(ctx.known[s]) in CODE_GRADES for s in strong):
            cls = 2
        elif cls == 2 and not details["setup"] and any(source_grade(ctx.known[s]) in CODE_GRADES for s in strong):
            cls = 1
        if cls == 3 and not details["change"]:
            reason = "The needed modification was not identified. " + reason
            details["resolveBy"] = details["resolveBy"] or f"Identify the change {repo} needs for {req['name']}"
            cls = 6
        elif cls == 4 and not details["uncovered"]:
            reason = "The part left uncovered was not named. " + reason
            details["resolveBy"] = details["resolveBy"] or f"Name which part of {req['name']} {repo} does not cover"
            cls = 6
        if cls == 5:
            claimed = ctx.readme_coverage(req)
            if claimed:
                reason = f"The README of {claimed[0]} claims it covers this; that was not checked against the code. " + reason
                details["resolveBy"] = details["resolveBy"] or f"Code evidence in {claimed[0]} for {req['name']}, or confirmation that it is missing"
                cls, repo = 6, claimed[0]
                evidence = "unconfirmed"
        if cls == 6 and not details["resolveBy"]:
            details["resolveBy"] = f"Code-level evidence (E2) that a candidate implements {req['name']}" if not repo else f"Code-level evidence (E2) in {repo} for {req['name']}"
        components[req["name"]] = _component(ctx, req, cls, repo, reason, cited, evidence, strong, details)

    for req in ctx.reqs:
        if req["name"] not in components:
            components[req["name"]] = fallback_classification(ctx, req)
    return components


def fallback_classification(ctx: BlueprintContext, req: Dict[str, Any]) -> Dict[str, Any]:
    """A requirement the model did not classify: decided from the evidence alone, never above class 6 because
    no one judged whether the related code actually meets it."""
    related = [s["id"] for s in ctx.sources if s.get("kind") in ("code", "doc") and is_about(s, req)]
    if related:
        repo = ctx.known[related[0]]["repo"]
        cited = [sid for sid in related if ctx.known[sid]["repo"] == repo]
        return _component(ctx, req, 6, repo, f"Code in {repo} looks related, but the blueprint did not assess whether it meets this requirement.",
                          cited, "unconfirmed", [], {"resolveBy": f"An assessment of whether {repo} meets {req['name']}"}, generated=True)
    claimed = ctx.readme_coverage(req, ("yes", "partial"))
    if claimed:
        cited = [s["id"] for s in ctx.sources if s["repo"] == claimed[0] and s.get("kind") == "readme"]
        return _component(ctx, req, 6, claimed[0], f"The README of {claimed[0]} claims coverage; it was not checked against the code.",
                          cited, "unconfirmed", [], {"resolveBy": f"Code evidence in {claimed[0]} for {req['name']}"}, generated=True)
    return _component(ctx, req, 5, None, "The blueprint did not map this requirement to any discovered repository.", [], "none", [], {}, generated=True)


def validate_challenge_responses(raw: Any, ctx: BlueprintContext, components: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """One answer per open challenge. Whether the decision changed is computed from the data (previous versus
    new class and repository), not taken from the model; what the evidence says about the challenger's
    repository is stated from the sources."""
    answers = {}
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, dict) and text(item.get("id"), 10).upper():
            answers.setdefault(text(item.get("id"), 10).upper(), text(item.get("response"), 800))
    out = []
    for ch in ctx.challenges:
        req = ctx.requirement(ch["requirement"])
        if not req:
            continue
        now = components[req["name"]]
        before = _previous_component(ctx, req["name"])
        before_class = (before or {}).get("class") or LEGACY_DECISION_CLASS.get((before or {}).get("decision"))
        changed = bool(before) and (before_class != now["class"] or (before or {}).get("repo") != now["repo"])
        entry = {
            "id": ch.get("id"), "ref": ch["ref"], "requirement": req["name"], "repo": ch.get("repo"), "note": text(ch.get("note"), 500),
            "outcome": "changed" if changed else "upheld",
            "previousClass": before_class, "newClass": now["class"],
            "response": answers.get(ch["ref"]) or now["reason"],
        }
        if ch.get("repo"):
            repo = ctx.repo(ch["repo"])
            if not repo:
                entry["repoEvidence"] = "not-a-candidate"
                entry["evidenceNote"] = f"{ch['repo']} was not among the candidates examined. Investigate deeper on this requirement to search for it."
            else:
                strong = ctx.strong(ctx.repo_sources(repo), repo, req)
                readme = [s for s in ctx.repo_sources(repo, ("readme",))]
                entry["repoEvidence"] = "verified" if strong else "readme-only" if readme else "none"
                entry["evidenceNote"] = (
                    f"{repo} has code evidence about this requirement ({', '.join(strong[:4])})." if strong else
                    f"Only README claims about {repo} were found; its code was not shown to implement this." if readme else
                    f"No evidence about {repo} for this requirement was found."
                )
                entry["sources"] = strong[:4] or readme[:1]
        out.append(entry)
    return out


# 2. Inventory -----------------------------------------------------------------------------------------

def inventory_prompt(ctx: BlueprintContext, components: Dict[str, Dict[str, Any]]) -> str:
    licences = "\n".join(
        f"- {c['full_name']}: {licence_check(c.get('license'), ctx.licence_policy)['note']} Last push {str(c.get('pushed_at') or 'unknown')[:10]}."
        for c in ctx.inputs.get("candidates") or []
    )
    return f"""{_head(ctx)}

Build-versus-reuse classification:
{_classification_lines(list(components.values()))}

Candidate repositories:
{candidate_lines(ctx)}

Licence and maintenance (from the GitHub API; licence policy: {ctx.licence_policy}):
{licences or '- none'}

{_untrusted(source_lines(ctx))}

Write the existing-solutions inventory: one entry per candidate repository, including the ones not worth using.
action: "reuse" (use as it is), "adapt" (use with changes), "investigate" (promising, not yet shown in code) or
"reject" (say why). capabilities: the [C..] sources showing what it does that matters for this project.
limitations: what it is missing for this project, in one sentence.

Return JSON:
{{"inventory": [{{"repo": "owner/name", "capabilities": ["C1"], "limitations": "1 sentence", "action": "reuse", "reason": "1-2 sentences"}}]}}"""


def _maintenance(ctx: BlueprintContext, c: Dict[str, Any]) -> Dict[str, Any]:
    pushed = parse_time(c.get("pushed_at"))
    deps = [d["package_name"] for d in (ctx.verification.get(c["full_name"].lower()) or {}).get("dependencies", [])]
    if pushed is None:
        risk, detail = "unknown", "Last push date unknown."
    else:
        days = (ctx.now - pushed).days
        risk = "high" if days > STALE_DAYS else "medium" if days > 365 else "low"
        detail = f"Last push {pushed.date().isoformat()} ({days} days ago)."
    if deps:
        detail += f" {len(deps)} runtime dependencies."
    return {"lastPush": pushed.date().isoformat() if pushed else None, "risk": risk, "detail": detail, "grade": "E3",
            "dependencies": deps[:20], "basis": "GitHub API push date and the indexed dependency manifest"}


def _claim(ctx: BlueprintContext, repo: str, kind: str, statement: str) -> Optional[Dict[str, Any]]:
    return (ctx.inputs.get("claimIds") or {}).get((f"github:{repo.lower()}", kind, statement_key(statement)))


def validate_inventory(raw: Any, ctx: BlueprintContext, components: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """One entry per candidate, rejected ones included (PRODUCT_DEFINITION 5.3). Capabilities are cited code
    sources of that repository only; reusable modules are the file paths of those sources; the licence is
    checked against the brief's policy from the API fact, not the model. Actions follow the evidence:
      - reuse/adapt need E1-E3 capability evidence from the repository; otherwise investigate;
      - a licence conflict forces reject, a missing or unrecognised licence (under permissive-only) investigate;
      - a repository the classification relies on is at least adapt, unless its licence forbids it."""
    by_repo: Dict[str, Dict[str, Any]] = {}
    for item in raw if isinstance(raw, list) else []:
        if isinstance(item, dict):
            repo = ctx.repo(item.get("repo"))
            if repo and repo not in by_repo:
                by_repo[repo] = item

    entries = []
    for c in ctx.inputs.get("candidates") or []:
        repo = c["full_name"]
        item = by_repo.get(repo, {})
        relied = [comp for comp in components.values() if comp.get("repo") == repo and comp["decision"] in ("reuse", "adapt")]
        cited = [sid for sid in source_ids(item.get("capabilities"), ctx.known)
                 if ctx.known[sid]["repo"] == repo and ctx.known[sid].get("kind") in ("code", "doc")]
        for comp in components.values():
            if comp.get("repo") == repo:
                cited += [sid for sid in comp["sources"] if ctx.known[sid]["repo"] == repo and ctx.known[sid].get("kind") in ("code", "doc") and sid not in cited]
        if not cited:
            cited = [sid for sid in ctx.repo_sources(repo, ("code", "doc")) if any(is_about(ctx.known[sid], r) for r in ctx.reqs)]
        strong = [sid for sid in cited if source_grade(ctx.known[sid]) in ("E1", "E2", "E3")]
        modules = []
        for sid in cited:
            s = ctx.known[sid]
            if s.get("filePath") and not any(m["filePath"] == s["filePath"] for m in modules):
                modules.append({"filePath": s["filePath"], "symbol": s.get("symbol"), "source": sid, "url": s.get("url")})

        licence = licence_check(c.get("license"), ctx.licence_policy)
        claim = _claim(ctx, repo, "licence", f"Licensed under {c.get('license')}") if licence["licence"] else None
        if claim:
            licence = {**licence, "grade": claim["grade"], "claimId": claim["id"]}
        elif licence["licence"]:
            licence = {**licence, "grade": "E3"}

        action = text(item.get("action"), 12).lower()
        reason = text(item.get("reason"), 600)
        if action not in INVENTORY_ACTIONS:
            if relied:
                action = "reuse" if any(comp["class"] in (1, 2) for comp in relied) else "adapt"
                reason = reason or "Used by the build-versus-reuse analysis."
            elif any(repo in ctx.readme_coverage(r, ("yes", "partial")) for r in ctx.reqs):
                action, reason = "investigate", reason or "Its README claims coverage of some requirements; not yet shown in code."
            else:
                action, reason = "reject", reason or "None of the evidence collected shows it covering a requirement."
        if action in ("reuse", "adapt") and not strong:
            reason = "No code or documentation evidence yet. " + reason
            action = "investigate"
        elif action in ("investigate", "reject") and relied and strong:
            reason = f"Set from the build-versus-reuse analysis, which relies on it for {', '.join(comp['requirement'] for comp in relied[:3])}. " + reason
            action = "reuse" if any(comp["class"] in (1, 2) for comp in relied) else "adapt"
        if licence["status"] == "conflict" and action != "reject":
            reason, action = f"Licence conflict: {licence['note']} " + reason, "reject"
        elif action in ("reuse", "adapt") and (licence["status"] == "missing" or (licence["status"] == "unknown" and ctx.licence_policy == "permissive-only")):
            reason, action = f"Licence: {licence['note']} " + reason, "investigate"

        v = ctx.verification.get(repo.lower()) or {}
        repository = v.get("repository") or {}
        examined = repository.get("latest_commit_hash") if repository.get("status") == "READY" else None
        readme_missing = [r["name"] for r in ctx.reqs
                          if ((c.get("assessment_json") or {}).get("coverage") or {}).get(r["name"]) == "no"]
        entries.append({
            "repo": repo,
            "url": c.get("source_url"),
            "kind": c.get("candidate_kind"),
            "version": {"commit": examined, "basis": "indexed commit" if examined else "README and GitHub metadata only; no commit examined"},
            "verification": "verified" if repository.get("status") == "READY" else "failed" if repository.get("status") == "FAILED" else "skipped" if v.get("state") == "skipped" else "not-verified",
            "capabilities": cited[:10],
            "modules": modules[:10],
            "licence": licence,
            "maintenance": _maintenance(ctx, c),
            "limitations": ctx.repo_sources(repo, ("limitation",))[:8],
            "limitationsNote": text(item.get("limitations"), 400),
            "missing": readme_missing[:8],
            "action": action,
            "reason": reason,
            "requirements": [comp["requirement"] for comp in components.values() if comp.get("repo") == repo],
            **({"generated": True} if not item else {}),
        })
    return entries


def apply_licence_policy(components: Dict[str, Dict[str, Any]], inventory: List[Dict[str, Any]]) -> None:
    """A requirement cannot rest on a repository whose licence the policy forbids or that has no licence:
    it becomes unresolved, saying what would resolve it."""
    blocked = {e["repo"]: e for e in inventory if e["licence"]["status"] in ("conflict", "missing")}
    for comp in components.values():
        entry = blocked.get(comp.get("repo") or "")
        if entry and comp["class"] in (1, 2, 3, 4):
            comp["reason"] = comp["how"] = f"Licence: {entry['licence']['note']} " + comp["reason"]
            comp["resolveBy"] = "A licence the policy allows (ask the authors), a policy exception, or an alternative repository"
            comp["class"], comp["classLabel"], comp["decision"] = 6, CLASS_LABELS[6], "investigate"


# 3. Architecture --------------------------------------------------------------------------------------

def architecture_prompt(ctx: BlueprintContext, components: Dict[str, Dict[str, Any]], inventory: List[Dict[str, Any]]) -> str:
    used = {e["repo"].lower() for e in inventory if e["action"] in ("reuse", "adapt")}
    return f"""{_head(ctx)}

Constraints: {_constraint_text(ctx)}

Requirements:
{requirement_lines(ctx)}

Build-versus-reuse classification:
{_classification_lines(list(components.values()))}

Inventory:
{_inventory_lines(inventory)}

{_untrusted(source_lines(ctx, used))}

Design the system at component level. origin: "reused" or "adapted" only for repositories whose inventory action
is reuse or adapt; everything else is "new". Map every requirement to a component. Name concrete interfaces and
data contracts where the sources show them. State trade-offs and rejected alternatives with the reason.

Return JSON:
{{
  "components": [{{"name": "short", "responsibility": "1 sentence", "origin": "reused" | "adapted" | "new", "repo": "owner/name or null", "requirements": ["requirement name"], "sources": ["C1"]}}],
  "dataFlows": [{{"from": "component name", "to": "component name", "data": "what moves", "contract": "format or interface"}}],
  "interfaces": [{{"name": "short", "provider": "component name", "consumer": "component name", "contract": "1 sentence", "sources": ["C1"]}}],
  "storage": [{{"name": "short", "purpose": "1 sentence", "technology": "short"}}],
  "externalDependencies": [{{"name": "short", "purpose": "1 sentence", "sources": []}}],
  "auth": "1-2 sentences", "failureHandling": "1-2 sentences", "observability": "1-2 sentences",
  "deployment": "1-2 sentences", "scaling": "1-2 sentences",
  "tradeoffs": [{{"decision": "short", "reason": "1 sentence", "alternatives": ["short"]}}],
  "rejectedAlternatives": [{{"option": "short", "reason": "1 sentence"}}],
  "risks": [{{"title": "short", "detail": "1 sentence", "sources": ["L1"]}}]
}}"""


def _named_items(raw: Any, keys: Tuple[str, ...], ctx: BlueprintContext, limit: int, cite: bool = False) -> List[Dict[str, Any]]:
    out = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict) or not text(item.get(keys[0]), 160):
            continue
        entry = {k: text(item.get(k), 400) for k in keys}
        if cite:
            entry["sources"] = source_ids(item.get("sources"), ctx.known)
        out.append(entry)
        if len(out) >= limit:
            break
    return out


def validate_architecture(raw: Any, ctx: BlueprintContext, components: Dict[str, Dict[str, Any]], inventory: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Every reused or adapted component maps to an inventory entry with action reuse or adapt (otherwise it is
    new); every requirement maps to at least one component; flows and interfaces only connect named components.
    Narrative fields are design recommendations, not graded facts."""
    raw = raw if isinstance(raw, dict) else {}
    actions = {e["repo"]: e["action"] for e in inventory}
    arch_components: List[Dict[str, Any]] = []
    for item in raw.get("components") if isinstance(raw.get("components"), list) else []:
        if not isinstance(item, dict):
            continue
        name = text(item.get("name"), 120)
        if not name or any(a["name"].lower() == name.lower() for a in arch_components):
            continue
        origin = text(item.get("origin"), 10).lower()
        origin = origin if origin in ORIGINS else "new"
        repo = ctx.repo(item.get("repo"))
        responsibility = text(item.get("responsibility"), 400)
        if origin in ("reused", "adapted"):
            action = actions.get(repo or "")
            if action not in ("reuse", "adapt"):
                responsibility = (f"Built new: {repo} is marked {action} in the inventory. " if repo else "Built new: no inventory entry backs reuse. ") + responsibility
                origin, repo = "new", None
            elif action == "adapt":
                origin = "adapted"
        else:
            repo = None
        arch_components.append({
            "name": name, "responsibility": responsibility, "origin": origin, "repo": repo,
            "requirements": [ctx.requirement(n)["name"] for n in item.get("requirements") or [] if ctx.requirement(n)],
            "sources": [sid for sid in source_ids(item.get("sources"), ctx.known) if not repo or ctx.known[sid]["repo"] == repo],
        })
        if len(arch_components) >= MAX_ARCH_COMPONENTS:
            break

    mapped = {n for a in arch_components for n in a["requirements"]}
    for comp in components.values():
        if comp["requirement"] in mapped:
            continue
        repo = comp.get("repo") if actions.get(comp.get("repo") or "") in ("reuse", "adapt") and comp["decision"] in ("reuse", "adapt") else None
        if repo:
            existing = next((a for a in arch_components if a.get("repo") == repo), None)
            if existing:
                existing["requirements"].append(comp["requirement"])
                continue
            arch_components.append({"name": repo.split("/")[-1], "responsibility": f"Provides {comp['requirement']}.",
                                    "origin": "reused" if actions[repo] == "reuse" else "adapted", "repo": repo,
                                    "requirements": [comp["requirement"]], "sources": comp["sources"][:4], "generated": True})
        else:
            arch_components.append({"name": comp["requirement"][:120], "responsibility": f"New code for {comp['requirement']}.",
                                    "origin": "new", "repo": None, "requirements": [comp["requirement"]], "sources": [], "generated": True})

    names = {a["name"].lower() for a in arch_components}
    flows = [f for f in _named_items(raw.get("dataFlows"), ("from", "to", "data", "contract"), ctx, 16)
             if f["from"].lower() in names and f["to"].lower() in names]
    interfaces = [i for i in _named_items(raw.get("interfaces"), ("name", "provider", "consumer", "contract"), ctx, 12, cite=True)
                  if not i["provider"] or i["provider"].lower() in names]
    rejected = _named_items(raw.get("rejectedAlternatives"), ("option", "reason"), ctx, 10)
    for e in inventory:
        if e["action"] == "reject" and not any(r["option"].lower() == e["repo"].lower() for r in rejected):
            rejected.append({"option": e["repo"], "reason": e["reason"], "generated": True})
    tradeoffs = []
    for item in raw.get("tradeoffs") if isinstance(raw.get("tradeoffs"), list) else []:
        if isinstance(item, dict) and text(item.get("decision"), 160):
            tradeoffs.append({"decision": text(item.get("decision"), 160), "reason": text(item.get("reason"), 400),
                              "alternatives": text_list(item.get("alternatives"), 4, 120)})
        if len(tradeoffs) >= 8:
            break
    return {
        "components": arch_components,
        "dataFlows": flows,
        "interfaces": interfaces,
        "storage": _named_items(raw.get("storage"), ("name", "purpose", "technology"), ctx, 8),
        "externalDependencies": _named_items(raw.get("externalDependencies"), ("name", "purpose"), ctx, 10, cite=True),
        **{k: text(raw.get(k), 600) for k in ("auth", "failureHandling", "observability", "deployment", "scaling")},
        "tradeoffs": tradeoffs,
        "rejectedAlternatives": rejected,
        "basis": "design recommendation",
    }


def architecture_risks(raw: Any, ctx: BlueprintContext) -> List[Dict[str, Any]]:
    raw = raw if isinstance(raw, dict) else {}
    return [{"title": r["title"], "detail": r["detail"], "sources": r["sources"]}
            for r in _named_items(raw.get("risks"), ("title", "detail"), ctx, 8, cite=True)]


# 4. Integration guide ---------------------------------------------------------------------------------

def guide_prompt(ctx: BlueprintContext, architecture: Dict[str, Any], inventory: List[Dict[str, Any]]) -> str:
    used = {e["repo"].lower() for e in inventory if e["action"] in ("reuse", "adapt")}
    comps = "\n".join(f"- {a['name']} ({a['origin']}{', ' + a['repo'] if a.get('repo') else ''}): {a['responsibility'][:200]}" for a in architecture["components"])
    deps = "\n".join(f"- {e['repo']}: {', '.join(e['maintenance']['dependencies'][:12]) or 'none indexed'}" for e in inventory if e["repo"].lower() in used)
    return f"""{_head(ctx)}

Constraints: {_constraint_text(ctx)}

Architecture components:
{comps or '- none'}

Runtime dependencies of the reused repositories:
{deps or '- none'}

{_untrusted(source_lines(ctx, used))}

Write the integration guide: ordered steps from prerequisites to a working integration. phase is one of
"prerequisites", "install", "configuration", "integration", "verification". Cite the sources each step rests on.
Environment variables: names only, never values. Give a version only when a source states it. A short code
example only where it helps and only with interfaces the sources show.

Return JSON:
{{"steps": [{{"phase": "install", "title": "short", "detail": "1-2 sentences", "sources": ["C1"], "envVars": ["NAME"], "version": null, "code": null}}]}}"""


def _scrub_values(value: str) -> str:
    return ENV_ASSIGNMENT.sub(lambda m: f"{m.group(1)}=<set in the environment>", value)


def validate_guide(raw: Any, ctx: BlueprintContext, inventory: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Ordered steps (PRODUCT_DEFINITION 5.6). Unknown citations are dropped; nothing has been executed yet, so
    every step is marked unexecuted, and a step without a citation is marked as inferred. Environment variables
    keep their names only (values are stripped from prose and code); a version survives only when one of the
    step's cited sources states it."""
    steps = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict) or not text(item.get("title"), 160):
            continue
        phase = text(item.get("phase"), 20).lower()
        cited = source_ids(item.get("sources"), ctx.known)
        version = text(item.get("version"), 40)
        if version and not any(version in (ctx.known[s].get("text", "") + " " + (ctx.known[s].get("quote") or "")) for s in cited):
            version = ""
        code = _scrub_values(str(item.get("code") or "")[:1200]).strip()
        env = list(dict.fromkeys(n for n in (text(x, 64) for x in item.get("envVars") or []) if ENV_NAME.match(n)))[:10]
        cited_text = " ".join(ctx.known[s].get("text", "") + " " + (ctx.known[s].get("quote") or "") for s in cited)
        proposed = [n for n in env if n not in cited_text]
        steps.append({
            "phase": phase if phase in GUIDE_PHASES else "integration",
            "title": _scrub_values(text(item.get("title"), 160)),
            "detail": _scrub_values(text(item.get("detail"), 600)),
            "sources": cited,
            "envVars": env,
            # Names no cited source mentions are the model's proposal, not a documented setting
            **({"envVarsProposed": proposed} if proposed else {}),
            **({"version": version} if version else {}),
            **({"code": code} if code else {}),
            "executed": False,
            "basis": "cited" if cited else "inferred",
        })
        if len(steps) >= MAX_STEPS:
            break
    if not steps:
        steps = fallback_guide(ctx, inventory)
    order = {p: i for i, p in enumerate(GUIDE_PHASES)}
    return sorted(steps, key=lambda s: order[s["phase"]])


def fallback_guide(ctx: BlueprintContext, inventory: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Steps that follow from the inventory alone: add each reused repository at the commit examined."""
    steps = []
    for e in inventory:
        if e["action"] not in ("reuse", "adapt"):
            continue
        commit = e["version"].get("commit")
        steps.append({
            "phase": "install", "title": f"Add {e['repo']}",
            "detail": f"Pin it to the examined commit {commit[:12]}." if commit else "No commit was examined; pin the version you verify.",
            "sources": e["capabilities"][:3], "envVars": [], "executed": False, "basis": "cited" if e["capabilities"] else "inferred", "generated": True,
        })
        if e["modules"]:
            steps.append({
                "phase": "integration", "title": f"Call {e['repo']} from the new code",
                "detail": "Entry points located in its code: " + ", ".join(m["filePath"] + (f" ({m['symbol']})" if m.get("symbol") else "") for m in e["modules"][:4]) + ".",
                "sources": [m["source"] for m in e["modules"][:4]], "envVars": [], "executed": False, "basis": "cited", "generated": True,
            })
    return steps


# 5. Roadmap -------------------------------------------------------------------------------------------

def roadmap_prompt(ctx: BlueprintContext, components: Dict[str, Dict[str, Any]], architecture: Dict[str, Any]) -> str:
    detail = []
    for c in components.values():
        extra = c.get("change") or c.get("uncovered") or c.get("setup") or c.get("resolveBy") or ""
        detail.append(f"- {c['requirement']} [{c['criticality']}]: class {c['class']} ({c['classLabel']}){' via ' + c['repo'] if c.get('repo') else ''}. {extra[:200]}")
    criteria = "\n".join(f"- {a}" for a in (ctx.inputs.get("acceptanceCriteria") or [])[:10])
    comps = "\n".join(f"- {a['name']} ({a['origin']})" for a in architecture["components"])
    return f"""{_head(ctx)}

Requirements and their classification:
{chr(10).join(detail)}

Architecture components:
{comps or '- none'}

Acceptance criteria for the finished product:
{criteria or '- none stated'}

Write the implementation roadmap: prioritised tasks. Every requirement not in class 1 or 2 needs at least one
task (class 6: a task that resolves the open question). complexity S/M/L and uncertainty low/medium/high are
estimates. Each task needs acceptance criteria and test requirements. dependsOn lists titles of earlier tasks.

Return JSON:
{{"tasks": [{{"title": "short", "description": "1-2 sentences", "requirements": ["requirement name"], "dependsOn": ["title"], "output": "what exists when done", "complexity": "M", "uncertainty": "medium", "risks": [{{"risk": "short", "mitigation": "short"}}], "acceptanceCriteria": ["testable statement"], "tests": ["test to write"]}}]}}"""


_TEMPLATE = {
    3: ("Adapt {repo} for {req}", "Make the identified change: {change}", "M", "medium"),
    4: ("Build the missing part of {req}", "Build what the candidates do not cover: {uncovered}", "M", "medium"),
    5: ("Build {req}", "No discovered repository does this; build it.", "L", "high"),
    6: ("Resolve {req}", "Find the evidence that settles it: {resolveBy}", "S", "high"),
}


def _generated_task(comp: Dict[str, Any], req: Dict[str, Any]) -> Dict[str, Any]:
    title, description, complexity, uncertainty = _TEMPLATE.get(comp["class"], _TEMPLATE[5])
    values = {"repo": comp.get("repo") or "the candidate", "req": comp["requirement"], "change": comp.get("change", ""),
              "uncovered": comp.get("uncovered", ""), "resolveBy": comp.get("resolveBy", "")}
    acceptance = (
        [f"{comp['requirement']} is reclassified with E1-E3 evidence, or confirmed missing"] if comp["class"] == 6
        else [f"{comp['requirement']}: {req.get('description') or 'works as specified in the brief'}"]
    )
    return {
        "title": title.format(**values)[:160], "description": description.format(**values)[:600],
        "requirements": [comp["requirement"]], "dependsOn": [], "output": "",
        "complexity": complexity, "uncertainty": uncertainty, "estimateBasis": f"default for class {comp['class']}",
        "risks": [], "acceptanceCriteria": acceptance,
        "tests": [f"An automated test that exercises {comp['requirement']}"] if comp["class"] != 6 else [],
        "generated": True,
    }


def validate_roadmap(raw: Any, ctx: BlueprintContext, components: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Tasks with ids, dependencies on other tasks only (cycles are cut), priority from the requirements'
    criticality, and estimates labelled as estimates. Every requirement whose decision is not reuse (classes
    3-6) gets at least one task; a task missing acceptance criteria or tests gets ones derived from its
    requirement, marked as generated."""
    tasks = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict) or not text(item.get("title"), 160):
            continue
        reqs = [ctx.requirement(n)["name"] for n in item.get("requirements") or [] if ctx.requirement(n)]
        complexity = text(item.get("complexity"), 2).upper()
        uncertainty = text(item.get("uncertainty"), 8).lower()
        task = {
            "title": text(item.get("title"), 160), "description": text(item.get("description") or item.get("detail"), 600),
            "requirements": list(dict.fromkeys(reqs)), "dependsOn": text_list(item.get("dependsOn"), 6, 160),
            "output": text(item.get("output"), 300),
            "complexity": complexity if complexity in COMPLEXITY else "M",
            "uncertainty": uncertainty if uncertainty in UNCERTAINTY else "medium",
            "estimateBasis": "model estimate" if complexity in COMPLEXITY and uncertainty in UNCERTAINTY else "default where the model gave none",
            "risks": [{"risk": text(r.get("risk"), 200), "mitigation": text(r.get("mitigation"), 300)}
                      for r in (item.get("risks") or []) if isinstance(r, dict) and text(r.get("risk"), 200)][:4],
            "acceptanceCriteria": text_list(item.get("acceptanceCriteria"), 6),
            "tests": text_list(item.get("tests"), 6),
        }
        for req_name in task["requirements"][:1]:
            req = ctx.requirement(req_name)
            if not task["acceptanceCriteria"]:
                task["acceptanceCriteria"] = [f"{req['name']}: {req.get('description') or 'works as specified in the brief'}"]
                task["acceptanceGenerated"] = True
            if not task["tests"]:
                task["tests"] = [f"An automated test that exercises {req['name']}"]
                task["testsGenerated"] = True
        tasks.append(task)
        if len(tasks) >= MAX_TASKS:
            break

    covered = {n for t in tasks for n in t["requirements"]}
    for comp in components.values():
        if comp["decision"] != "reuse" and comp["requirement"] not in covered:
            tasks.append(_generated_task(comp, ctx.requirement(comp["requirement"])))

    for i, t in enumerate(tasks):
        t["id"] = f"T{i + 1}"
        crit = [ctx.requirement(n).get("criticality", "SHOULD") for n in t["requirements"]]
        t["priority"] = min((CRITICALITY_PRIORITY.get(c, 2) for c in crit), default=2)
        t["estimate"] = True
    by_key = {t["title"].lower(): t["id"] for t in tasks}
    by_key.update({t["id"].lower(): t["id"] for t in tasks})
    for t in tasks:
        t["dependsOn"] = [d for d in dict.fromkeys(by_key.get(x.lower()) for x in t["dependsOn"]) if d and d != t["id"]]
    return _topological(tasks)


def _topological(tasks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Dependencies first, then priority, then the model's order. Edges that would close a cycle are dropped."""
    by_id = {t["id"]: t for t in tasks}
    placed: List[str] = []
    remaining = list(tasks)
    while remaining:
        ready = [t for t in remaining if all(d in placed for d in t["dependsOn"])]
        if not ready:
            # A cycle: cut the dependencies of the highest-priority waiting task on tasks not yet placed
            stuck = min(remaining, key=lambda t: (t["priority"], int(t["id"][1:])))
            stuck["dependsOn"] = [d for d in stuck["dependsOn"] if d in placed]
            continue
        nxt = min(ready, key=lambda t: (t["priority"], int(t["id"][1:])))
        placed.append(nxt["id"])
        remaining.remove(nxt)
    for order, tid in enumerate(placed):
        by_id[tid]["order"] = order + 1
    return [by_id[tid] for tid in placed]
