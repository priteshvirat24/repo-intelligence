"""
The promotion gate (PRODUCT_DEFINITION 9.2 steps 5 to 7, SYSTEM_DESIGN 9).

A candidate is compared with the promoted baseline on at least MIN_RUNS benchmark runs each. It is
accepted only if

- its primary metric improves by more than the baseline's run-to-run noise: recall@10 first, shortlist
  precision when recall@10 does not move;
- no guard metric regresses beyond tolerance: shortlist precision (when recall@10 is the target), recall@10
  (when precision is), and trap rejection among the traps it surfaced;
- cost and latency do not regress beyond COST_TOLERANCE.

Two kinds of evidence:

- paired (offline L1 tuning): candidate and baseline are the same stored runs re-ranked under two tunings,
  so they saw the same searches and the same README assessments. The gain must hold in every run, and any
  guard regression or extra shortlisted trap is real, not noise. Only keys downstream of every search and
  LLM call may differ, so cost and latency are unchanged by construction.
- unpaired (L2/L3 proposals): separate replay runs of each configuration. The candidate's mean must beat the
  baseline's by more than the band and its worst run must beat the baseline mean; guards are allowed the
  baseline's own band on top of their tolerance, because both sides carry LLM noise.
"""
import math
from typing import Any, Dict, List, Optional, Sequence

# At least three runs per configuration (SYSTEM_DESIGN 9)
MIN_RUNS = 3
# Even identical baseline runs leave a band: a gain must be worth a version
MIN_BAND = 0.005
# Allowed regression of a guard metric (absolute, macro average over briefs)
TOLERANCE = {"shortlistPrecision": 0.01, "recallAt10": 0.0, "trapRejectionSurfaced": 0.0}
# Cost and latency must not regress beyond 10% (SYSTEM_DESIGN 10.4)
COST_TOLERANCE = 0.10
COST_KEYS = ("llmCalls", "inputTokens", "outputTokens", "meanDurationMs")


def _mean(values: Sequence[Optional[float]]) -> Optional[float]:
    v = [x for x in values if x is not None]
    return round(sum(v) / len(v), 4) if v else None


def noise_band(values: Sequence[Optional[float]]) -> float:
    """Half the range of the baseline runs: how far one run of an unchanged system lands from their mean."""
    v = [x for x in values if x is not None]
    if len(v) < 2:
        return MIN_BAND
    return round(max(MIN_BAND, (max(v) - min(v)) / 2), 4)


def _compare(baseline: List[Dict[str, Any]], candidate: List[Dict[str, Any]], key: str, paired: bool) -> Dict[str, Any]:
    base = [b.get(key) for b in baseline]
    cand = [c.get(key) for c in candidate]
    m_base, m_cand = _mean(base), _mean(cand)
    out = {"baseline": m_base, "candidate": m_cand, "band": noise_band(base), "baselineRuns": base, "candidateRuns": cand}
    if paired:
        deltas = [round(c - b, 4) for b, c in zip(base, cand) if b is not None and c is not None]
        out["perRunDelta"] = deltas
        out["delta"] = _mean(deltas)
    else:
        out["delta"] = round(m_cand - m_base, 4) if m_base is not None and m_cand is not None else None
    return out


def gate(baseline: List[Dict[str, Any]], candidate: List[Dict[str, Any]], changed_keys: List[str],
         allowed_keys: Optional[Sequence[str]] = None, paired: bool = True) -> Dict[str, Any]:
    """baseline and candidate: run aggregates (eval/suite.aggregate plus, for unpaired runs, the harness's
    cost fields). allowed_keys: the keys a paired comparison can decide (offline.OFFLINE_EXACT_KEYS)."""
    if paired and len(baseline) != len(candidate):
        raise ValueError("A paired comparison scores both configurations on the same runs")
    reasons: List[str] = []
    metrics = {key: _compare(baseline, candidate, key, paired)
               for key in ("recallAt10", "shortlistPrecision", "trapRejectionSurfaced", "recallAll")}
    traps_base = sum(b.get("trapsShortlisted", 0) for b in baseline)
    traps_cand = sum(c.get("trapsShortlisted", 0) for c in candidate)
    result: Dict[str, Any] = {
        "accepted": False, "target": None, "reasons": reasons, "paired": paired,
        "runs": {"baseline": len(baseline), "candidate": len(candidate)}, "metrics": metrics,
        "trapsShortlisted": {"baseline": traps_base, "candidate": traps_cand}, "changedKeys": changed_keys,
    }

    if not changed_keys:
        reasons.append("The candidate is identical to the baseline.")
        return result
    if allowed_keys is not None:
        outside = [k for k in changed_keys if k not in allowed_keys]
        if outside:
            reasons.append(f"Not decidable from stored features (needs a replay benchmark): {', '.join(outside)}.")
            return result
    if min(len(baseline), len(candidate)) < MIN_RUNS:
        reasons.append(f"{min(len(baseline), len(candidate))} benchmark run(s); the gate needs at least {MIN_RUNS} per configuration.")
        return result

    recall, precision = metrics["recallAt10"], metrics["shortlistPrecision"]

    def beats(m: Dict[str, Any]) -> bool:
        if m["delta"] is None or m["delta"] <= m["band"]:
            return False
        if paired:
            return all(d > 0 for d in m["perRunDelta"])
        return min(x for x in m["candidateRuns"] if x is not None) > m["baseline"]

    def holds(m: Dict[str, Any], key: str) -> bool:
        allowance = TOLERANCE[key] + (0 if paired else m["band"])
        return m["delta"] is None or m["delta"] >= -allowance

    def no_run_loses(m: Dict[str, Any]) -> bool:
        return not paired or all(d >= 0 for d in m["perRunDelta"])

    if beats(recall):
        result["target"] = "recallAt10"
        if not holds(precision, "shortlistPrecision"):
            reasons.append(f"Guard regressed: shortlist precision {fmt(precision['delta'])} (tolerance {TOLERANCE['shortlistPrecision']}).")
    elif beats(precision) and holds(recall, "recallAt10") and no_run_loses(recall):
        result["target"] = "shortlistPrecision"
    else:
        reasons.append(
            f"No primary gain beyond the noise band: recall@10 {fmt(recall['delta'])} (band ±{recall['band']}), "
            f"shortlist precision {fmt(precision['delta'])} (band ±{precision['band']})"
            + (", each required in every run." if paired else ".")
        )
        return result

    if paired:
        traps = metrics["trapRejectionSurfaced"]
        if not holds(traps, "trapRejectionSurfaced"):
            reasons.append(f"Guard regressed: trap rejection among surfaced traps {fmt(traps['delta'])}.")
        if traps_cand > traps_base:
            reasons.append(f"Guard regressed: {traps_cand} traps shortlisted across the runs against {traps_base}.")
    else:
        pooled = pooled_trap_guard(baseline, candidate)
        result["trapRejectionPooled"] = pooled
        if pooled.get("regressed"):
            reasons.append(f"Guard regressed: trap rejection among surfaced traps {pooled['candidate']} against {pooled['baseline']} "
                           f"(allowance {pooled['allowance']}).")

    if paired:
        result["cost"] = "unchanged by construction: only ranking keys after every search and LLM call differ"
    else:
        cost = {}
        for key in COST_KEYS:
            b, c = _mean([r.get(key) for r in baseline]), _mean([r.get(key) for r in candidate])
            cost[key] = {"baseline": b, "candidate": c}
            if b and c is not None and c > b * (1 + COST_TOLERANCE):
                reasons.append(f"Guard regressed: {key} {c:.0f} against {b:.0f} (over {int(COST_TOLERANCE * 100)}% more).")
        result["cost"] = cost

    result["accepted"] = not reasons
    if result["accepted"]:
        m = metrics[result["target"]]
        reasons.append(f"{result['target']} {fmt(m['delta'])} beats the noise band ±{m['band']}"
                       + (f" in all {len(baseline)} runs" if paired else "") + "; no guard regressed.")
    return result


def pooled_trap_guard(baseline: List[Dict[str, Any]], candidate: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Trap rejection among surfaced traps, pooled over the runs of each side (a run surfaces only a few traps,
    so per-run rates are too coarse to average). A regression counts when it is beyond the tolerance plus
    one-sided 95% sampling noise of the two proportions."""
    b_sh, b_su = sum(r.get("trapsShortlisted", 0) for r in baseline), sum(r.get("trapsSurfaced", 0) for r in baseline)
    c_sh, c_su = sum(r.get("trapsShortlisted", 0) for r in candidate), sum(r.get("trapsSurfaced", 0) for r in candidate)
    if not b_su or not c_su:
        return {"baseline": None if not b_su else round(1 - b_sh / b_su, 4), "candidate": None if not c_su else round(1 - c_sh / c_su, 4), "regressed": False}
    b, c = 1 - b_sh / b_su, 1 - c_sh / c_su
    p = 1 - (b_sh + c_sh) / (b_su + c_su)
    allowance = TOLERANCE["trapRejectionSurfaced"] + 1.64 * math.sqrt(p * (1 - p) * (1 / b_su + 1 / c_su))
    return {"baseline": round(b, 4), "candidate": round(c, 4), "surfaced": {"baseline": b_su, "candidate": c_su},
            "allowance": round(allowance, 4), "regressed": c < b - allowance}


def fmt(value: Optional[float]) -> str:
    return "n/a" if value is None else f"{value:+.4f}"
