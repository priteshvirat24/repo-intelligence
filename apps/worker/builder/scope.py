"""
What a build is asked to implement: the selected roadmap tasks and requirements, with the blueprint's
integration guide and decisions for them (PRODUCT_DEFINITION 5.6-5.8).

The blueprint is read defensively. A roadmap ("roadmap" as a list, or {"tasks": [...]}) and an integration
guide ("integrationGuide" as a list, or {"steps": [...]}) are used when present; otherwise the older shape's
"toBuild" items and "integrationSteps" stand in for them. Keep roadmap_items in step with
apps/web/lib/builds/scope.ts, which offers the same items, under the same ids, for selection.
"""
import re
from typing import Any, Dict, List

_ENV_NAME = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")


def _strings(value: Any, limit: int = 12, size: int = 400) -> List[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    out = []
    for v in value:
        if isinstance(v, dict):
            v = v.get("text") or v.get("description") or v.get("name") or v.get("title")
        if isinstance(v, str) and v.strip():
            out.append(v.strip()[:size])
    return out[:limit]


def _items(container: Any, keys=("tasks", "items", "steps")) -> List[Any]:
    if isinstance(container, list):
        return container
    if isinstance(container, dict):
        for k in keys:
            if isinstance(container.get(k), list):
                return container[k]
    return []


def roadmap_items(blueprint: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Selectable work items: roadmap tasks when the blueprint has a roadmap, else its to-build items."""
    blueprint = blueprint or {}
    out: List[Dict[str, Any]] = []
    for i, t in enumerate(_items(blueprint.get("roadmap"))):
        if not isinstance(t, dict):
            continue
        title = t.get("title") or t.get("name") or t.get("task")
        if not isinstance(title, str) or not title.strip():
            continue
        out.append({
            "id": str(t.get("id") or f"roadmap-{i + 1}")[:80],
            "title": title.strip()[:200],
            "detail": str(t.get("description") or t.get("detail") or "")[:1200],
            "acceptanceCriteria": _strings(t.get("acceptanceCriteria") or t.get("acceptance_criteria") or t.get("acceptance")),
            "tests": _strings(t.get("testRequirements") or t.get("tests") or t.get("test_requirements")),
            "requirements": _strings(t.get("requirements") or t.get("requirement"), 10, 200),
            "source": "roadmap",
        })
    if out:
        return out
    for i, t in enumerate(blueprint.get("toBuild") or []):
        if isinstance(t, dict) and isinstance(t.get("title"), str) and t["title"].strip():
            out.append({"id": f"build-{i + 1}", "title": t["title"].strip()[:200], "detail": str(t.get("detail") or "")[:1200],
                        "acceptanceCriteria": [], "tests": [], "requirements": _strings(t.get("requirements"), 10, 200), "source": "toBuild"})
    return out


def integration_steps(blueprint: Dict[str, Any]) -> List[Dict[str, Any]]:
    blueprint = blueprint or {}
    raw = _items(blueprint.get("integrationGuide")) or blueprint.get("integrationSteps") or []
    steps = []
    for s in raw[:20]:
        if isinstance(s, dict) and (s.get("title") or s.get("detail")):
            steps.append({"title": str(s.get("title") or "")[:200], "detail": str(s.get("detail") or s.get("description") or "")[:800],
                          "executed": bool(s.get("executed")) if "executed" in s else None})
    return steps


def env_var_names(blueprint: Dict[str, Any]) -> List[str]:
    """Environment variable NAMES the integration guide mentions (never values, PRODUCT_DEFINITION 5.6)."""
    guide = (blueprint or {}).get("integrationGuide")
    sources = []
    if isinstance(guide, dict):
        sources += [guide.get("environmentVariables"), guide.get("envVars"), guide.get("environment")]
    for s in _items(guide):
        if isinstance(s, dict):
            sources += [s.get("environmentVariables"), s.get("envVars")]
    names = []
    for src in sources:
        for v in src if isinstance(src, list) else []:
            name = v.get("name") if isinstance(v, dict) else v
            if isinstance(name, str) and _ENV_NAME.match(name.strip()) and name.strip() not in names:
                names.append(name.strip())
    return names[:30]


def build_spec(brief: Dict[str, Any], blueprint: Dict[str, Any], scope: Dict[str, Any]) -> Dict[str, Any]:
    """The coding brief for one build. Raises ValueError when the scope selects nothing in this blueprint."""
    items = {i["id"]: i for i in roadmap_items(blueprint)}
    wanted_tasks = [items[t] for t in (scope.get("roadmapTaskIds") or []) if t in items]
    requirements = (brief.get("requirements_json") or {}).get("requirements") or []
    by_name = {r.get("name"): r for r in requirements if isinstance(r, dict)}
    wanted_names = [n for n in (scope.get("requirements") or []) if n in by_name]
    for t in wanted_tasks:
        wanted_names += [n for n in t["requirements"] if n in by_name and n not in wanted_names]
    if not wanted_tasks and not wanted_names:
        raise ValueError("The build scope selects no roadmap task or requirement of this blueprint")

    components = [c for c in (blueprint.get("components") or []) if isinstance(c, dict) and c.get("requirement") in wanted_names]
    criteria = [c for t in wanted_tasks for c in t["acceptanceCriteria"]]
    if not criteria:
        criteria = _strings(((brief.get("understanding_json") or {}).get("acceptanceCriteria")), 8)
    return {
        "title": brief.get("title") or "Build",
        "summary": str(blueprint.get("summary") or "")[:1200],
        "tasks": wanted_tasks,
        "requirements": [{"name": n, "description": str(by_name[n].get("description") or "")[:600],
                          "criticality": by_name[n].get("criticality")} for n in wanted_names],
        "components": [{"requirement": c.get("requirement"), "decision": c.get("decision"), "repo": c.get("repo"),
                        "how": str(c.get("how") or "")[:600]} for c in components],
        "integrationSteps": integration_steps(blueprint),
        "acceptanceCriteria": list(dict.fromkeys(criteria))[:20],
        "testRequirements": list(dict.fromkeys(t for task in wanted_tasks for t in task["tests"]))[:20],
        "languages": str((brief.get("constraints_json") or {}).get("languages") or "")[:200],
        "envVarNames": env_var_names(blueprint),
    }
