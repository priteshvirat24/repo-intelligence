"""
The blueprint's closing artifacts (SYSTEM_DESIGN 7): the evidence and uncertainty report, generated from the
data rather than written by a model; what changed since the previous blueprint; and the executive
recommendation, written last and allowed to summarise only the artifacts before it.
"""
from typing import Any, Dict, List

from .blueprint_evidence import CLASS_LABELS, LEGACY_DECISION_CLASS, BlueprintContext, is_about, source_grade, text, text_list

MAX_HUMAN_DECISIONS = 12


def uncertainty_report(ctx: BlueprintContext, components: Dict[str, Dict[str, Any]], inventory: List[Dict[str, Any]],
                       architecture: Dict[str, Any], guide: List[Dict[str, Any]], challenges: List[Dict[str, Any]],
                       stages: Dict[str, str]) -> Dict[str, Any]:
    """PRODUCT_DEFINITION 5.9, from the data alone: traceability of each recommendation, conflicting evidence,
    claims needing revalidation, recommendations resting on E4/E5 evidence, missing verification, incomplete
    research and the decisions a person has to make."""
    inv = {e["repo"]: e for e in inventory}
    traceability = []
    for c in components.values():
        if c["decision"] in ("reuse", "adapt"):
            traceability.append({"recommendation": f"{c['decision'].capitalize()} {c['repo']} for {c['requirement']}", "requirement": c["requirement"],
                                 "sources": c["sources"], "grades": c["evidenceGrades"]})
    for a in architecture.get("components") or []:
        if a["origin"] != "new":
            traceability.append({"recommendation": f"Component {a['name']}: {a['origin']} from {a['repo']}", "sources": a["sources"],
                                 "grades": sorted({source_grade(ctx.known[s]) for s in a["sources"]})})

    conflicts = []
    for r in ctx.reqs:
        for repo in ctx.readme_coverage(r):
            if ctx.code_verified(repo) and not any(is_about(ctx.known[s], r) for s in ctx.repo_sources(repo, ("code", "doc"))):
                conflicts.append({"title": f"README versus code: {repo}", "requirement": r["name"],
                                  "detail": f"Its README claims it covers {r['name']} (E4); the analysis of its code found no capability about it.",
                                  "sources": ctx.repo_sources(repo, ("readme",))[:1]})
    for c in components.values():
        if c["decision"] in ("reuse", "adapt") and c.get("repo"):
            req = ctx.requirement(c["requirement"])
            limits = [s for s in ctx.repo_sources(c["repo"], ("limitation",)) if is_about(ctx.known[s], req) or is_about({"title": ctx.known[s].get("text", "")}, req)]
            if limits:
                conflicts.append({"title": f"Known limitation: {c['repo']}", "requirement": c["requirement"],
                                  "detail": f"Relied on for {c['requirement']}, but a located limitation concerns it.", "sources": limits[:3]})

    stale = [{"title": f"{s['repo']}: {s['title']}", "detail": "The source changed since this was verified; revalidate it." if s["claimStatus"] == "needs_revalidation" else "This claim was refuted.",
              "sources": [s["id"]]} for s in ctx.sources if s.get("claimStatus") in ("needs_revalidation", "refuted")]

    weak = []
    for c in components.values():
        grades = c["evidenceGrades"]
        if c["decision"] in ("investigate", "adapt") and c["sources"] and all(g in ("E4", "E5") for g in grades):
            weak.append({"requirement": c["requirement"], "detail": f"Rests on {', '.join(grades)} evidence only.", "sources": c["sources"], "grades": grades})
    inferred_steps = [s["title"] for s in guide if s.get("basis") == "inferred"]
    if inferred_steps:
        weak.append({"requirement": None, "detail": f"{len(inferred_steps)} integration step(s) cite no source: {'; '.join(inferred_steps[:4])}.", "sources": [], "grades": ["E5"]})

    missing_verification = []
    for e in inventory:
        if e["action"] in ("reuse", "adapt", "investigate") and e["verification"] != "verified":
            reason = (ctx.verification.get(e["repo"].lower()) or {}).get("reason")
            missing_verification.append({"repo": e["repo"], "detail": {
                "skipped": f"Could not be indexed{': ' + str(reason)[:200] if reason else ''}.",
                "failed": "Indexing failed; its code was not checked.",
            }.get(e["verification"], "Not among the repositories verified against their code.")})
    missing_verification.append({"repo": None, "detail": "Nothing was executed: no claim is E1, and the integration guide is unexecuted."})

    incomplete = []
    for c in components.values():
        if c["class"] == 5:
            req = ctx.requirement(c["requirement"])
            queries = c.get("searched") or []
            incomplete.append({"title": f"Missing: {c['requirement']}", "requirement": c["requirement"], "detail": (
                f"Searched for with: {', '.join(queries[:6])}." if queries else
                "Constraints are not searched for on their own; only ecosystem words were taken from them." if ctx.is_constraint(req) else
                "No search query was attributed to it; it was covered only by the overall searches."
            )})
    for v in ctx.inputs.get("verification") or []:
        if v.get("state") == "skipped":
            incomplete.append({"title": f"Not indexable: {v['fullName']}", "detail": str(v.get("reason") or "skipped")[:300]})
    for stage, mode in stages.items():
        if mode == "fallback":
            incomplete.append({"title": f"{stage.capitalize()} built from data only", "detail": f"The {stage} step's model output was unusable; this section was built from the evidence alone."})

    decisions: List[Dict[str, Any]] = []

    def decide(title: str, detail: str, **extra):
        if len(decisions) < MAX_HUMAN_DECISIONS and not any(d["title"] == title for d in decisions):
            decisions.append({"id": f"H{len(decisions) + 1}", "title": title, "detail": detail, **extra})

    for c in components.values():
        if c["class"] == 6:
            decide(f"Resolve {c['requirement']}", c.get("resolveBy") or "More evidence is needed.", requirement=c["requirement"])
    for e in inventory:
        if e["action"] != "reject" and e["licence"]["status"] in ("flagged", "unknown", "missing"):
            decide(f"Licence of {e['repo']}", e["licence"]["note"], repo=e["repo"])
    for c in components.values():
        if c["class"] == 5 and c["criticality"] == "MUST" and not c["isConstraint"]:
            decide(f"Build {c['requirement']}", "A MUST requirement has no existing solution: confirm it is in scope to build.", requirement=c["requirement"])
    for ch in challenges:
        if ch["outcome"] == "upheld":
            decide(f"Challenge on {ch['requirement']}", "The evidence did not change the decision; accept it, or add evidence (investigate deeper).", requirement=ch["requirement"])

    return {"traceability": traceability, "conflicts": conflicts, "stale": stale, "weakDependencies": weak,
            "missingVerification": missing_verification, "incompleteResearch": incomplete, "humanDecisions": decisions,
            "basis": "generated from the evidence"}


def changes_since(ctx: BlueprintContext, components: Dict[str, Dict[str, Any]], challenges: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Requirements whose class, decision or repository differs from the previous blueprint, with the reason."""
    previous = {str(c.get("requirement", "")).lower(): c for c in ctx.previous.get("components") or []}
    if not previous:
        return []
    noted = {ch["requirement"]: ch for ch in challenges}
    out = []
    for c in components.values():
        before = previous.get(c["requirement"].lower())
        if not before:
            out.append({"requirement": c["requirement"], "from": None, "to": {"class": c["class"], "decision": c["decision"], "repo": c["repo"]},
                        "reason": "New requirement."})
            continue
        before_class = before.get("class") or LEGACY_DECISION_CLASS.get(before.get("decision"))
        if before_class != c["class"] or before.get("decision") != c["decision"] or before.get("repo") != c["repo"]:
            ch = noted.get(c["requirement"])
            out.append({"requirement": c["requirement"],
                        "from": {"class": before_class, "decision": before.get("decision"), "repo": before.get("repo")},
                        "to": {"class": c["class"], "decision": c["decision"], "repo": c["repo"]},
                        "reason": (f"Challenged: {ch['note']} " if ch and ch.get("note") else "") + c["reason"][:300]})
    return out


def risk_list(risks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [{**r, "id": f"K{i + 1}"} for i, r in enumerate(risks)]


def executive_prompt(ctx: BlueprintContext, components: Dict[str, Dict[str, Any]], inventory: List[Dict[str, Any]],
                     roadmap: List[Dict[str, Any]], risks: List[Dict[str, Any]], report: Dict[str, Any]) -> str:
    classes = "\n".join(f"- {c['requirement']} [{c['criticality']}]: class {c['class']} ({c['classLabel']}){' via ' + c['repo'] if c.get('repo') else ''}" for c in components.values())
    inv = "\n".join(f"- {e['repo']}: {e['action']}" for e in inventory) or "- none"
    tasks = "\n".join(f"- {t['id']} {t['title']} (complexity {t['complexity']}, uncertainty {t['uncertainty']}, estimates)" for t in roadmap) or "- none"
    risk_lines = "\n".join(f"- [{r['id']}] {r['title']}: {r.get('detail', '')[:160]}" for r in risks) or "- none"
    decisions = "\n".join(f"- [{d['id']}] {d['title']}: {d['detail'][:160]}" for d in report["humanDecisions"]) or "- none"
    return f"""Project: {ctx.inputs.get('title', '')}

You are writing the executive recommendation. Summarise ONLY the artifacts below; add no new facts, repositories
or capabilities.

Build-versus-reuse classification:
{classes}

Inventory actions:
{inv}

Roadmap tasks:
{tasks}

Risks:
{risk_lines}

Decisions needing a human:
{decisions}

Return JSON:
{{"strategy": "2-3 sentences: the recommended strategy", "buildingBlocks": ["owner/name"], "challenges": ["main technical challenge"], "remainingWork": "1 sentence estimate of the remaining work", "topRisks": ["K1"], "humanDecisions": ["H1"]}}"""


def validate_executive(raw: Any, ctx: BlueprintContext, components: Dict[str, Dict[str, Any]], inventory: List[Dict[str, Any]],
                       roadmap: List[Dict[str, Any]], risks: List[Dict[str, Any]], report: Dict[str, Any]) -> Dict[str, Any]:
    """Building blocks must be inventory entries with action reuse or adapt; top risks and decisions are picked
    by id from the lists above (at most three risks); the remaining-work estimate is labelled as an estimate and
    carries the roadmap's own task counts."""
    raw = raw if isinstance(raw, dict) else {}
    usable = [e["repo"] for e in inventory if e["action"] in ("reuse", "adapt")]
    blocks = [r for r in (ctx.repo(x) for x in raw.get("buildingBlocks") or []) if r in usable]
    risk_ids = {r["id"]: r for r in risks}
    top = [risk_ids[i] for i in dict.fromkeys(text(x, 8).upper() for x in raw.get("topRisks") or []) if i in risk_ids][:3]
    decision_ids = {d["id"]: d for d in report["humanDecisions"]}
    picked = [decision_ids[i] for i in dict.fromkeys(text(x, 8).upper() for x in raw.get("humanDecisions") or []) if i in decision_ids]
    counts = {size: sum(1 for t in roadmap if t["complexity"] == size) for size in ("S", "M", "L")}
    reused = sum(1 for c in components.values() if c["decision"] in ("reuse", "adapt"))
    strategy = text(raw.get("strategy"), 1200)
    mode = "llm" if strategy else "fallback"
    if not strategy:
        built = sum(1 for c in components.values() if c["class"] == 5)
        open_ = sum(1 for c in components.values() if c["class"] == 6)
        strategy = (f"Build on {', '.join(usable[:3])}. " if usable else "No discovered repository can be reused with code evidence. ") + \
                   f"{reused} of {len(components)} requirements are covered by existing code, {built} must be built and {open_} are unresolved."
    return {
        "strategy": strategy,
        "buildingBlocks": list(dict.fromkeys(blocks or usable[:3])),
        "challenges": text_list(raw.get("challenges"), 5) or [f"{c['requirement']}: {c['classLabel'].lower()}" for c in components.values() if c["class"] in (4, 5, 6)][:5],
        "remainingWork": {"estimate": text(raw.get("remainingWork"), 400) or f"{len(roadmap)} roadmap tasks ({counts['S']} small, {counts['M']} medium, {counts['L']} large).",
                          "taskCounts": counts, "label": "estimate"},
        "topRisks": top or risks[:3],
        "humanDecisions": picked or report["humanDecisions"][:5],
        "mode": mode,
    }


def class_counts(components: Dict[str, Dict[str, Any]]) -> Dict[str, int]:
    return {str(k): sum(1 for c in components.values() if c["class"] == k) for k in CLASS_LABELS}
