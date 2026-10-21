"""Phase 5: offline re-ranking, the gate, the L1 auto-tuner, promotion and rollback, proposals, feedback,
monitoring and weakness mining."""
import json
import random
from datetime import datetime, timedelta, timezone

import pytest

from apps.worker.discovery.runner import DiscoveryRunner
from apps.worker.evolution import gate as gate_rules
from apps.worker.evolution import monitor, offline, registry, tune, weakness
from apps.worker.tuning import default_tuning, load_active
from tests.worker.test_discovery import FakeGitHub, ScriptedLLM, repo

REQS = {
    "problemSummary": "Show live satellite positions on a 3D globe",
    "requirements": [
        {"name": "Orbit propagation", "description": "Propagate TLE orbital elements with SGP4", "criticality": "MUST"},
        {"name": "Map rendering", "description": "Render positions on a 3D globe", "criticality": "SHOULD"},
        {"name": "Backend in Python", "description": "Python service", "criticality": "MUST", "type": "deployment"},
    ],
    "queryExpansions": ["sgp4", "webgl globe"],
}
QUERIES = [("sgp4 propagation", "Orbit propagation"), ("tle parser", "Orbit propagation"), ("webgl globe", "Map rendering"),
           ("3d globe", "Map rendering"), ("satellite tracker", "(overall)"), ("orbit visualisation", "(overall)")]


def random_world(seed: int):
    """A discovery world with popular and obscure, fresh and stale, licensed and unlicensed repositories,
    a mirror and a curated list, and a README assessment for every repository."""
    rng = random.Random(seed)
    repos = []
    for i in range(70):
        words = rng.sample(["sgp4", "orbit", "globe", "webgl", "tle", "satellite", "map", "render", "python", "tracker", "space"], 3)
        repos.append(repo(f"owner{i}/proj-{words[0]}-{i}", stars=rng.choice([3, 12, 40, 150, 900, 4000, 25000]),
                          description=" ".join(words) + " toolkit for things", pushed_days_ago=rng.choice([5, 90, 300, 500, 800, 1500]),
                          license=rng.choice(["MIT", "Apache-2.0", None, "NOASSERTION"]), topics=words[:2]))
    repos.append({**repos[3], "full_name": "copycat/" + repos[3]["full_name"].split("/")[1], "stars": 2})
    repos.append(repo("someone/awesome-space", stars=6000, description="A curated list of space software"))
    results = {q: rng.sample(repos, 15) for q, _ in QUERIES}
    assessments = {
        r["full_name"]: {
            "kind": rng.choice(["library", "implementation", "framework", "tutorial", "unknown"]),
            "summary": "s", "reason": "r",
            "coverage": {"Orbit propagation": rng.choice(["yes", "partial", "no", "unknown"]), "Map rendering": rng.choice(["yes", "partial", "no"])},
        }
        for r in repos
    }
    readmes = {r["full_name"]: "readme text" for r in repos}
    llm = ScriptedLLM(queries=[{"query": q, "requirement": req} for q, req in QUERIES], assessments=assessments)
    return llm, FakeGitHub(results, readmes)


def live_run(seed: int, tuning):
    llm, github = random_world(seed)
    return DiscoveryRunner(llm, github, sleep=lambda s: None, tuning=tuning).run(REQS)


# Offline re-ranking

@pytest.mark.parametrize("seed", [1, 2, 3, 4])
def test_offline_reranking_reproduces_the_stored_ranking_for_the_same_tuning(seed):
    base = default_tuning()
    result = live_run(seed, base)
    features = offline.capture(REQS, result)
    assert features["complete"] and features["rankedAt"]
    assert len(features["candidates"]) > len(result["candidates"])  # the whole pool, not only the kept 40
    entry = {"ranked": [c["full_name"] for c in result["candidates"]],
             "shortlisted": [c["full_name"] for c in result["candidates"] if c["shortlisted"]], "features": features}
    out = offline.rerank(json.loads(json.dumps(features)), base)  # survives the result file's JSON round trip
    assert out["ranked"] == entry["ranked"]
    assert out["shortlisted"] == entry["shortlisted"]
    assert [c["final_score"] for c in out["candidates"]] == [c["final_score"] for c in result["candidates"]]
    assert offline.reproduces(entry, base)


@pytest.mark.parametrize("overrides", [
    {"ranking.final_weights": {"coverage": 0.7, "relevance": 0.15, "health": 0.15}},
    {"ranking.final_weights": {"coverage": 0.25, "relevance": 0.4, "health": 0.35}, "ranking.unassessed_factor": 0.8},
    {"ranking.coverage_value": {"partial": 0.75}, "discovery.shortlist_size": 3},
    {"discovery.shortlist_max_stale_days": 365, "ranking.unassessed_factor": 0.4},
    {"ranking.non_implementation_factor": 0.9, "ranking.duplicate_factor": 1.0, "discovery.max_stored_candidates": 25},
])
def test_offline_reranking_equals_a_live_run_for_offline_keys(overrides):
    base = default_tuning()
    candidate = base.with_overrides(overrides)
    for seed in (1, 2, 3):
        features = offline.capture(REQS, live_run(seed, base))
        live = live_run(seed, candidate)
        out = offline.rerank(features, candidate)
        assert out["ranked"] == [c["full_name"] for c in live["candidates"]]
        assert out["shortlisted"] == [c["full_name"] for c in live["candidates"] if c["shortlisted"]]


def test_run_tuning_round_trips_and_prepared_runs_refuse_other_keys():
    base = default_tuning()
    tuned = base.with_overrides({"discovery.shortlist_size": 4})
    assert offline.run_tuning({"tuningValues": offline.l1_values(tuned)}).version == tuned.version
    assert offline.run_tuning({}) is None
    run = {"runId": "r", "briefs": []}
    with pytest.raises(ValueError, match="discovery.min_stars"):
        offline.PreparedRun(run, {}, base).score(base.with_overrides({"discovery.min_stars": 50}))


# The gate

def agg(recall, precision, traps=0.5, shortlisted=1, surfaced=2, **extra):
    return {"recallAt10": recall, "shortlistPrecision": precision, "trapRejectionSurfaced": traps, "recallAll": recall,
            "trapsShortlisted": shortlisted, "trapsSurfaced": surfaced, **extra}


BASE_RUNS = [agg(0.30, 0.25), agg(0.28, 0.24), agg(0.32, 0.26)]  # recall band ±0.02, precision band ±0.01
KEYS = ["ranking.final_weights"]


def test_gate_accepts_a_gain_beyond_the_noise_band_in_every_run():
    result = gate_rules.gate(BASE_RUNS, [agg(0.36, 0.25), agg(0.33, 0.24), agg(0.37, 0.26)], KEYS, offline.OFFLINE_EXACT_KEYS)
    assert result["accepted"] and result["target"] == "recallAt10"
    assert result["metrics"]["recallAt10"]["band"] == 0.02


def test_gate_rejects_a_gain_inside_the_noise_band():
    result = gate_rules.gate(BASE_RUNS, [agg(0.31, 0.25), agg(0.30, 0.24), agg(0.33, 0.26)], KEYS, offline.OFFLINE_EXACT_KEYS)
    assert not result["accepted"] and "noise band" in result["reasons"][0]


def test_gate_rejects_a_gain_that_does_not_hold_in_every_run():
    result = gate_rules.gate(BASE_RUNS, [agg(0.45, 0.25), agg(0.27, 0.24), agg(0.45, 0.26)], KEYS, offline.OFFLINE_EXACT_KEYS)
    assert not result["accepted"]


def test_gate_rejects_guard_regressions():
    precision_drop = gate_rules.gate(BASE_RUNS, [agg(0.36, 0.20), agg(0.33, 0.20), agg(0.37, 0.20)], KEYS, offline.OFFLINE_EXACT_KEYS)
    assert not precision_drop["accepted"] and "shortlist precision" in precision_drop["reasons"][0]
    trap = gate_rules.gate(BASE_RUNS, [agg(0.36, 0.25, traps=0.0, shortlisted=2), agg(0.33, 0.24), agg(0.37, 0.26)], KEYS, offline.OFFLINE_EXACT_KEYS)
    assert not trap["accepted"] and any("trap" in r for r in trap["reasons"])


def test_gate_uses_precision_when_recall_does_not_move():
    result = gate_rules.gate(BASE_RUNS, [agg(0.30, 0.29), agg(0.28, 0.28), agg(0.32, 0.30)], KEYS, offline.OFFLINE_EXACT_KEYS)
    assert result["accepted"] and result["target"] == "shortlistPrecision"


def test_gate_rejects_precision_bought_with_a_shorter_shortlist():
    # Dropping one of two essential solutions from the shortlist raises precision; it is not an improvement
    base = [agg(0.30, 0.25, shortlistRecall=0.5), agg(0.28, 0.24, shortlistRecall=0.48), agg(0.32, 0.26, shortlistRecall=0.52)]
    shorter = [agg(0.30, 0.30, shortlistRecall=0.4), agg(0.28, 0.29, shortlistRecall=0.44), agg(0.32, 0.31, shortlistRecall=0.5)]
    result = gate_rules.gate(base, shorter, KEYS, offline.OFFLINE_EXACT_KEYS)
    assert not result["accepted"] and any("essential solutions on the shortlist" in r for r in result["reasons"])
    kept = [agg(0.30, 0.30, shortlistRecall=0.5), agg(0.28, 0.29, shortlistRecall=0.48), agg(0.32, 0.31, shortlistRecall=0.53)]
    assert gate_rules.gate(base, kept, KEYS, offline.OFFLINE_EXACT_KEYS)["accepted"]


def test_gate_refuses_what_it_cannot_decide():
    gain = [agg(0.5, 0.3)] * 3
    assert "replay" in gate_rules.gate(BASE_RUNS, gain, ["discovery.min_stars"], offline.OFFLINE_EXACT_KEYS)["reasons"][0]
    assert "at least 3" in gate_rules.gate(BASE_RUNS[:2], gain[:2], KEYS, offline.OFFLINE_EXACT_KEYS)["reasons"][0]
    assert "identical" in gate_rules.gate(BASE_RUNS, gain, [], offline.OFFLINE_EXACT_KEYS)["reasons"][0]


def test_unpaired_gate_checks_cost_and_pools_traps():
    base = [agg(0.30, 0.25, llmCalls=60, inputTokens=200000, outputTokens=40000, meanDurationMs=60000)] * 3
    cheap = [agg(0.40, 0.25, llmCalls=61, inputTokens=205000, outputTokens=40000, meanDurationMs=61000)] * 3
    costly = [agg(0.40, 0.25, llmCalls=90, inputTokens=205000, outputTokens=40000, meanDurationMs=61000)] * 3
    assert gate_rules.gate(base, cheap, ["prompts.discovery_planner"], paired=False)["accepted"]
    refused = gate_rules.gate(base, costly, ["prompts.discovery_planner"], paired=False)
    assert not refused["accepted"] and "llmCalls" in refused["reasons"][0]
    traps = [agg(0.40, 0.25, shortlisted=9, surfaced=10, llmCalls=60)] * 3
    base_traps = [agg(0.30, 0.25, shortlisted=0, surfaced=10, llmCalls=60)] * 3
    assert gate_rules.gate(base_traps, traps, ["prompts.discovery_planner"], paired=False)["trapRejectionPooled"]["regressed"]


# The L1 auto-tuner on fixture runs

NOW = datetime(2026, 10, 1, tzinfo=timezone.utc)


def feature(name, stars, days, coverage, matched=(), queries=1, position=10, license="MIT", description="a toolkit"):
    return {"full_name": name, "description": description, "topics": [], "stars": stars, "forks": 0, "license": license,
            "pushed_at": (NOW - timedelta(days=days)).isoformat(), "matched_queries": [f"q{i}" for i in range(queries)],
            "matched_requirements": list(matched), "best_position": position, "candidate_kind": "library", "duplicate_of": None,
            "assessment": {"kind": "library", "coverage": coverage} if coverage else None}


def fixture_suite(tmp_path, n_briefs=4):
    """Briefs where the essential solutions cover every requirement but are small and quiet, while popular
    repositories that cover little outrank them, and a stale trap covers everything."""
    briefs_dir = tmp_path / "suite" / "briefs"
    briefs_dir.mkdir(parents=True)
    ids = [f"b{i}" for i in range(n_briefs)]
    (tmp_path / "suite" / "suite.json").write_text(json.dumps({"version": "suite-test", "briefs": ids}))
    for bid in ids:
        (briefs_dir / f"{bid}.json").write_text(json.dumps({
            "id": bid, "domain": "geo" if bid in ("b0", "b1") else "dev", "title": bid, "brief": "text",
            "labels": {"requirements": [{"id": "orbit", "name": "Orbit propagation", "type": "functional", "solutions": [
                {"repo": f"{bid}/essential-{k}", "rating": "essential"} for k in range(3)]}],
                "traps": [{"repo": f"{bid}/old-trap", "reason": "No push since 2023 (over two years)."}]},
        }))
    return tmp_path / "suite", ids


def fixture_runs(tmp_path, ids, base, n_runs=3):
    """Run files with features, as eval/run.py writes them; the stored ranking is the base tuning's."""
    results = tmp_path / "results"
    results.mkdir()
    full = {"Orbit propagation": "yes", "Map rendering": "yes"}
    for run_i in range(n_runs):
        briefs = []
        for bid in ids:
            cands = [feature(f"{bid}/essential-{k}", stars=15 + 10 * run_i * k, days=400, coverage=full, license=None, position=14)
                     for k in range(3)]
            cands += [feature(f"{bid}/popular-{k}", stars=20000, days=30, coverage={"Orbit propagation": "partial", "Map rendering": "no"},
                              matched=("Orbit propagation", "Map rendering"), queries=3, position=0, description="orbit globe")
                      for k in range(9 - run_i)]
            cands.append(feature(f"{bid}/old-trap", stars=5000, days=1000, coverage=full, position=2))
            cands += [feature(f"{bid}/unread-{k}", stars=50, days=60, coverage=None, position=8) for k in range(5)]
            features = {"version": offline.FEATURES_VERSION, "rankedAt": NOW.isoformat(), "queryCount": 6, "complete": True,
                        "requirements": {"requirements": REQS["requirements"], "queryExpansions": []},
                        "candidates": [{**f, "order": i} for i, f in enumerate(cands)]}
            out = offline.rerank(features, base)
            briefs.append({"briefId": bid, "ranked": out["ranked"], "shortlisted": out["shortlisted"], "features": features})
        run = {"runId": f"b1-fill-test-{run_i}", "system": "b1", "tuningVersion": base.version, "tuningValues": offline.l1_values(base),
               "finishedAt": f"2026-10-21T1{run_i}:00:00", "aggregate": {}, "briefs": briefs}
        (results / f"{run['runId']}.json").write_text(json.dumps(run))
    return results


def test_tuner_finds_and_gates_a_better_ranking_offline(tmp_path):
    base = default_tuning()
    suite_dir, ids = fixture_suite(tmp_path)
    results = fixture_runs(tmp_path, ids, base)
    report = tune.tune(str(suite_dir), results, base, samples=40, seed=1)
    assert report["evidenceRuns"] == ["b1-fill-test-0", "b1-fill-test-1", "b1-fill-test-2"]
    decision = report["decision"]
    assert decision["accepted"], decision["reasons"]
    assert decision["gate"]["metrics"]["recallAt10"]["delta"] > decision["gate"]["metrics"]["recallAt10"]["band"]
    # The stale trap must stay off the shortlist: a looser freshness rule is never the winner
    assert decision["overrides"].get("discovery.shortlist_max_stale_days", 730) <= 730
    assert decision["gate"]["trapsShortlisted"]["candidate"] == 0


def test_tuner_rejects_a_candidate_inside_noise_or_with_a_guard_regression(tmp_path):
    base = default_tuning()
    suite_dir, ids = fixture_suite(tmp_path)
    results = fixture_runs(tmp_path, ids, base)
    no_effect = tune.tune(str(suite_dir), results, base, {"discovery.shortlist_size": 7})
    assert not no_effect["decision"]["accepted"] and "noise band" in no_effect["decision"]["reasons"][0]
    trap = tune.tune(str(suite_dir), results, base, {"ranking.final_weights": {"coverage": 0.7, "relevance": 0.15, "health": 0.15},
                                                     "discovery.shortlist_max_stale_days": 1460})
    assert not trap["decision"]["accepted"] and any("trap" in r for r in trap["decision"]["reasons"])


def test_tuner_needs_runs_with_features(tmp_path):
    base = default_tuning()
    suite_dir, ids = fixture_suite(tmp_path)
    results = fixture_runs(tmp_path, ids, base, n_runs=2)
    old = json.loads((results / "b1-fill-test-0.json").read_text())
    for b in old["briefs"]:
        del b["features"]
    old["runId"] = "b1-old"
    (results / "b1-old.json").write_text(json.dumps(old))
    report = tune.tune(str(suite_dir), results, base)
    assert not report["decision"]["accepted"] and "needs 3" in report["decision"]["reasons"][0]
    assert any("no stored ranking features" in n for n in report["notes"])


def test_tuner_ignores_runs_of_another_configuration(tmp_path):
    base = default_tuning()
    suite_dir, ids = fixture_suite(tmp_path)
    results = fixture_runs(tmp_path, ids, base.with_overrides({"discovery.min_stars": 50}))
    report = tune.tune(str(suite_dir), results, base)
    assert report["evidenceRuns"] == [] and all("beyond the offline keys" in n for n in report["notes"])


# Registry: promotion, rejection, rollback and proposals (database)

def sql(db, query, params=()):
    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall() if cur.description else None
            conn.commit()
            return rows
    finally:
        conn.close()


@pytest.fixture
def evo_db():
    """A database where the built-in defaults are active; everything the test adds is removed afterwards and
    the registry is restored."""
    from apps.worker.db.repository import DatabaseRepository
    db = DatabaseRepository()
    saved = sql(db, "SELECT id, status, promoted_at FROM config_versions")
    [(last_event,)] = sql(db, "SELECT COALESCE(MAX(id), 0) FROM evolution_events")
    [(started,)] = sql(db, "SELECT NOW()")
    sql(db, "UPDATE config_versions SET status = 'retired' WHERE status = 'promoted'")
    yield db
    sql(db, "DELETE FROM evolution_events WHERE id > %s", (last_event,))
    sql(db, "DELETE FROM evolution_proposals WHERE created_at >= %s", (started,))
    sql(db, "DELETE FROM briefs WHERE content_hash = 'evolution-test'")
    sql(db, "DELETE FROM config_versions WHERE NOT (id = ANY(%s))", ([r[0] for r in saved],))
    for vid, status, promoted_at in saved:
        sql(db, "UPDATE config_versions SET status = %s, promoted_at = %s WHERE id = %s", (status, promoted_at, vid))


EVIDENCE = {"runs": ["b1-fill-test-0", "b1-fill-test-1", "b1-fill-test-2"], "gate": {"accepted": True}}


def test_promotion_needs_evidence_and_rollback_restores_the_predecessor(evo_db):
    db = evo_db
    base = registry.ensure_baseline(db)
    assert registry.promoted_version(db) == base.version
    better = base.with_overrides({"ranking.unassessed_factor": 0.55})
    with pytest.raises(registry.EvolutionRefused, match="EVOLUTION_NO_EVIDENCE"):
        registry.promote(db, better, {"runs": []}, "no evidence", actor="test")
    assert registry.promote(db, better, EVIDENCE, "evidence", actor="auto-tuner", parent=base.version) == base.version
    assert load_active(db).version == better.version
    assert registry.version_status(db, base.version) == "retired"
    [(kind, before, after, evidence)] = sql(db, "SELECT kind, active_before, active_after, evidence_json FROM evolution_events WHERE version = %s", (better.version,))
    assert (kind, before, after) == ("promoted", base.version, better.version) and evidence["runs"] == EVIDENCE["runs"]

    with pytest.raises(registry.EvolutionRefused, match="EVOLUTION_VERSION_CHANGED"):
        registry.rollback(db, "test", "stale view", expected=base.version)
    assert registry.rollback(db, "maintainer", "manual", expected=better.version) == base.version
    assert load_active(db).version == base.version
    assert registry.version_status(db, better.version) == "rolled_back"
    # A rolled-back version is never promoted again automatically
    with pytest.raises(registry.EvolutionRefused, match="EVOLUTION_VERSION_REFUSED"):
        registry.promote(db, better, EVIDENCE, "again", actor="auto-tuner")


def test_rejected_candidates_are_recorded_and_never_promoted(evo_db):
    db = evo_db
    base = registry.ensure_baseline(db)
    worse = base.with_overrides({"discovery.shortlist_size": 9})
    registry.record_rejection(db, worse, EVIDENCE, "inside the noise band", actor="auto-tuner", parent=base.version)
    assert registry.version_status(db, worse.version) == "rejected"
    [(kind, before)] = sql(db, "SELECT kind, active_before FROM evolution_events WHERE version = %s", (worse.version,))
    assert (kind, before) == ("rejected", base.version)
    with pytest.raises(registry.EvolutionRefused, match="EVOLUTION_VERSION_REFUSED"):
        registry.promote(db, worse, EVIDENCE, "", actor="auto-tuner")
    assert load_active(db).version == base.version


def test_tuner_cli_promotes_an_accepted_change(evo_db, tmp_path):
    db = evo_db
    base = default_tuning()
    suite_dir, ids = fixture_suite(tmp_path)
    results = fixture_runs(tmp_path, ids, base)
    assert tune.main(["--suite", str(suite_dir), "--results", str(results), "--samples", "20", "--report-dir", str(tmp_path / "reports")]) == 0
    active = load_active(db)
    assert active.version != base.version
    [(status, evidence, notes)] = sql(db, "SELECT status, evidence_json, notes FROM config_versions WHERE id = %s", (active.version,))
    assert status == "promoted" and evidence["runs"] == ["b1-fill-test-0", "b1-fill-test-1", "b1-fill-test-2"]
    assert notes.startswith("Auto-tuner: promoted")
    assert list((tmp_path / "reports").glob("tune-*.json"))
    # Gating a candidate that changes nothing measurable records a rejection
    path = tmp_path / "noop.json"
    path.write_text(json.dumps({"discovery.shortlist_size": 7}))
    tune.main(["--suite", str(suite_dir), "--results", str(results), "--candidate", str(path), "--report-dir", str(tmp_path / "reports")])
    assert load_active(db).version == active.version


def test_proposals_need_a_benchmark_win_and_l4_is_never_applied(evo_db):
    db = evo_db
    base = registry.ensure_baseline(db)
    prompt = base.with_overrides({"prompts.blueprint": base.get("prompts.blueprint") + "\nBe brief."})
    no_win = registry.create_proposal(db, "L2", "Shorter blueprint", "why", prompt, {"prompts.blueprint": "..."}, EVIDENCE, False, "test")
    assert registry.version_status(db, prompt.version) == "pending"
    with pytest.raises(registry.EvolutionRefused, match="EVOLUTION_NO_BENCHMARK_WIN"):
        registry.decide_proposal(db, no_win, True, "user:1")
    assert registry.decide_proposal(db, no_win, False, "user:1", "not convincing") == "rejected"
    assert registry.version_status(db, prompt.version) == "rejected"
    with pytest.raises(registry.EvolutionRefused, match="EVOLUTION_ALREADY_DECIDED"):
        registry.decide_proposal(db, no_win, True, "user:1")

    other = base.with_overrides({"prompts.blueprint": base.get("prompts.blueprint") + "\nCite sources."})
    win = registry.create_proposal(db, "L2", "Cite sources", "why", other, {}, EVIDENCE, True, "test")
    assert load_active(db).version == base.version  # nothing changes before approval
    assert registry.decide_proposal(db, win, True, "user:1", "ok") == "approved"
    assert load_active(db).version == other.version
    [(actor, proposal)] = sql(db, "SELECT actor, proposal_id::text FROM evolution_events WHERE kind = 'promoted' AND version = %s", (other.version,))
    assert (actor, proposal) == ("user:1", win)

    code = registry.create_proposal(db, "L4", "Rewrite the gateway", "why", None, {}, {}, True, "test")
    with pytest.raises(registry.EvolutionRefused, match="EVOLUTION_L4_NEVER_APPLIED"):
        registry.decide_proposal(db, code, True, "user:1")


# Feedback and monitoring (database)

def make_brief(db) -> str:
    [(brief_id,)] = sql(db, """
        INSERT INTO briefs (title, brief_text, content_hash, workspace_id)
        VALUES ('Evolution test', 'text', 'evolution-test', '00000000-0000-0000-0000-000000000001') RETURNING id
    """)
    return str(brief_id)


def add_feedback(db, brief_id, version, total, negative, prefix):
    for i in range(total):
        sql(db, """
            INSERT INTO feedback (brief_id, workspace_id, target_kind, target_id, verdict, tuning_version)
            VALUES (%s, '00000000-0000-0000-0000-000000000001', 'candidate', %s, %s, %s)
        """, (brief_id, f"{prefix}/repo-{i}", "not_useful" if i < negative else "useful", version))


def test_feedback_rejects_unknown_kinds_and_verdicts(evo_db):
    db = evo_db
    brief_id = make_brief(db)
    for kind, verdict in (("candidate", "maybe"), ("tweet", "useful")):
        with pytest.raises(Exception, match="check constraint"):
            sql(db, """INSERT INTO feedback (brief_id, workspace_id, target_kind, target_id, verdict)
                       VALUES (%s, '00000000-0000-0000-0000-000000000001', %s, 'a/b', %s)""", (brief_id, kind, verdict))
    add_feedback(db, brief_id, "cfg-x", 1, 0, "dup")
    with pytest.raises(Exception, match="duplicate key"):
        add_feedback(db, brief_id, "cfg-x", 1, 0, "dup")


def test_simulated_live_regression_triggers_rollback(evo_db):
    db = evo_db
    base = registry.ensure_baseline(db)
    promoted = base.with_overrides({"ranking.unassessed_factor": 0.65})
    registry.promote(db, promoted, EVIDENCE, "test", actor="auto-tuner", parent=base.version)
    brief_id = make_brief(db)

    add_feedback(db, brief_id, base.version, 40, 6, "before")
    add_feedback(db, brief_id, promoted.version, 10, 8, "after")
    assert monitor.check(db)["action"] == "none"  # too little feedback on the new version yet
    assert load_active(db).version == promoted.version

    add_feedback(db, brief_id, promoted.version, 40, 22, "later")
    outcome = monitor.check(db)
    assert outcome["action"] == "rolled_back" and outcome["restored"] == base.version
    assert load_active(db).version == base.version
    [(actor, notes)] = sql(db, "SELECT actor, notes FROM evolution_events WHERE kind = 'rolled_back' AND version = %s", (promoted.version,))
    assert actor == "monitor" and "Live regression" in notes


def test_monitor_keeps_a_version_within_bounds(evo_db):
    db = evo_db
    base = registry.ensure_baseline(db)
    promoted = base.with_overrides({"ranking.unassessed_factor": 0.7})
    registry.promote(db, promoted, EVIDENCE, "test", actor="auto-tuner", parent=base.version)
    brief_id = make_brief(db)
    add_feedback(db, brief_id, base.version, 40, 10, "before")
    add_feedback(db, brief_id, promoted.version, 40, 12, "after")
    assert monitor.check(db)["action"] == "none"
    assert load_active(db).version == promoted.version


# Weakness mining

def mining_fixture(tmp_path):
    suite_dir, ids = fixture_suite(tmp_path, n_briefs=3)
    runs = []
    for i in range(3):
        briefs = [
            # b0: one essential found, one ranked 15th, one never retrieved
            {"briefId": "b0", "ranked": ["b0/essential-0"] + [f"x/{k}" for k in range(13)] + ["b0/essential-1"], "shortlisted": ["b0/essential-0"]},
            # b1: the stale trap shortlisted in two runs
            {"briefId": "b1", "ranked": ["b1/essential-0", "b1/old-trap"], "shortlisted": ["b1/essential-0"] + (["b1/old-trap"] if i < 2 else [])},
            # b2: nothing relevant, ever
            {"briefId": "b2", "ranked": ["y/1", "y/2"], "shortlisted": []},
        ]
        runs.append({"runId": f"r{i}", "briefs": briefs})
    from apps.worker.eval.suite import load_suite
    return load_suite(str(suite_dir)), runs


def test_weakness_mining_reports_recurring_failures(tmp_path):
    suite, runs = mining_fixture(tmp_path)
    report = weakness.mine(suite, runs)
    by_kind = {}
    for f in report["findings"]:
        by_kind.setdefault(f["kind"], []).append(f)
    assert {(f["briefId"], f["repo"]) for f in by_kind["essential_ranked_low"]} == {("b0", "b0/essential-1")}
    assert by_kind["essential_ranked_low"][0]["bestRank"] == 15
    assert ("b0", "b0/essential-2") in {(f["briefId"], f["repo"]) for f in by_kind["essential_not_retrieved"]}
    [trap] = by_kind["trap_shortlisted"]
    assert (trap["repo"], trap["runs"], trap["level"]) == ("b1/old-trap", 2, "L1")
    assert [f["briefId"] for f in by_kind["zero_recall_brief"]] == ["b2"]
    assert report["summary"]["missedEssentialByDomain"]["dev"] == 3  # b2's three essentials
    assert report["summary"]["missedEssentialByRequirementType"]["functional"] >= 5


def test_weakness_drafts_are_proposals_not_changes(tmp_path):
    suite, runs = mining_fixture(tmp_path)
    before = default_tuning().version
    drafts = {d["name"]: d for d in weakness.drafts(weakness.mine(suite, runs))}
    assert drafts["fresher-shortlist"]["overrides"] == {"discovery.shortlist_max_stale_days": 548}
    assert drafts["ranking-search"]["level"] == "L1"
    planner = drafts["planner-generic-category"]["overrides"]["prompts.discovery_planner"]
    assert weakness.PLANNER_RULE in planner and planner.rstrip().endswith("8. Output strictly valid JSON.")
    # Every draft is a valid candidate tuning, and nothing was applied
    for d in drafts.values():
        if d["overrides"]:
            default_tuning().with_overrides(d["overrides"])
    assert default_tuning().version == before
