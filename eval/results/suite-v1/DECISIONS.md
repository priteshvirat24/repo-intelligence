# suite-v1: evolution record

Measurements behind each change to Open Eye's default tuning (PRODUCT_DEFINITION §9). The numbers come from the run files in this directory; [BASELINE.md](BASELINE.md) is generated from them with `python -m apps.worker.eval.report`.

**Read with care:** the suite-v1 labels are a draft. One labeller drafted them and they were checked against GitHub, but they have not been labelled independently (see [eval/README.md](../../README.md)). The comparisons between systems and tunings below are made on the same labels and the same recorded responses, so they are meaningful *relative* to each other. The absolute values are provisional.

## 2026-10-21: baselines

| System | Recall@10 | Shortlist precision | Notes |
|---|---|---|---|
| B0: GitHub title search plus web search | 0.063 | 0.033 | Every essential hit came from the web-search half |
| B0s: the same, GitHub sorted by stars | 0.063 | 0.033 | Stricter baseline; same result on this suite |
| B1 default (`cfg-02b30c8854db`), 3 runs | 0.111 (0.104–0.116) | 0.091 | Shared decomposition `b1-fill-20261021-124327` |

**Fixed before recording B1.** Three bugs were found while recording B1. Partial runs before the fixes are not kept as result files.
1. The decomposer fell back to keyword rules when the model broke the JSON of a long answer (2 of 15 briefs). Fix: one compact retry.
2. The planner dropped queries whose requirement name the model reworded.
3. The planner misread `[{"queries": [...]}]` output, so half the briefs ran on keyword queries.

**Why B1 was low.** On most briefs the essential tools were never retrieved at all. The planner searched implementation details ("exponential backoff retry mechanism", "dark mode static documentation"), which match small repositories whose READMEs mention those words, not the established tools.

## 2026-10-21: candidate `category-queries` (not promoted)

What it changed: a planner prompt that asks for the kind of tool plus the ecosystem ("job queue node", "documentation generator typescript"), with the brief's constraints shown to the planner so it can name that ecosystem.

| Metric | B1 default | category-queries (3 runs) |
|---|---|---|
| Recall@10 | 0.111 | **0.322** (0.278–0.348) |
| Recall (all kept) | 0.227 | **0.413** |
| Shortlist precision | 0.091 | **0.223** |
| Trap rejection (traps it found) | 0.667 (1 trap per run) | 0.450 |
| LLM calls, tokens, time | 60, 202k in, 70 s/brief | 60, 207k in, 69 s/brief |

**Decision: not promoted.** The guard metric regressed. Now that the right category of tools was found, the traps were too, and an abandoned one (`Automattic/kue`, last push 2024-02) was shortlisted in every run.

**Metric fix.** "Trap rejection (all traps)" rewards a system that finds nothing: B1 default scored 0.98 mostly because it surfaced at most one trap. "Trap rejection (traps it found)" was added, and every stored run was re-scored with `apps.worker.eval.rescore`.

## 2026-10-21: candidate `category-queries-fresh`, promoted (`cfg-d88eb2047d1a`)

What it changed: `category-queries` plus `discovery.shortlist_max_stale_days = 730`. A repository with no push in two years stays among the candidates but is not recommended as a starting point.

| Metric | B1 default | category-queries-fresh (3 runs) |
|---|---|---|
| Recall@10 | 0.111 (0.104–0.116) | **0.295** (0.258–0.343) |
| Recall (all kept) | 0.227 | **0.385** |
| Shortlist precision | 0.091 | **0.234** (0.221–0.256) |
| Trap rejection (traps it found) | 0.667 (0.000–1.000, 1 trap per run) | 0.583 (0.500–0.750, 4 traps per run) |
| LLM calls, tokens, time | 60, 202k in, 70 s/brief | 61, 207k in, 63 s/brief |

**Decision: promoted to the default.** The primary metrics improve far outside the run-to-run range, and cost and latency are unchanged. On the trap guard, the default's 0.667 rests on one trap per run, so it is not a comparable rate. The candidate surfaces four traps and recommends fewer than `category-queries` did. `kue` is now always kept off the shortlist.

The promoted default hashes to exactly the measured configuration; `test_promoted_default_is_exactly_the_measured_candidate` enforces this.

`category-queries` and `category-queries-fresh` differ only in the shortlist rule, which does not change the ranking. Their recall@10 difference (0.322 against 0.295) is therefore LLM run-to-run variation, not an effect of the rule.

## 2026-10-21: integrated default after Phases 2 to 6 (`cfg-66b9cecdb37a`)

Phase 2 added tuning keys (diminishing-returns stop, registry search limits, docs evidence), so the default hashes to a new version. Three runs on the shared decomposition, which also store the ranking features the Phase 5 tuner needs.

| Metric | `cfg-d88eb2047d1a` (3 runs) | `cfg-66b9cecdb37a` (3 runs) |
|---|---|---|
| Recall@10 | 0.295 (0.258–0.343) | 0.341 (0.305–0.365) |
| Shortlist precision | 0.234 (0.221–0.256) | 0.255 (0.243–0.276) |
| Shortlist recall (essential solutions recommended) | 0.253 | 0.291 |
| Trap rejection (traps it found) | 0.583 | 0.533 |
| LLM calls, tokens, time | 61, 207k in, 63 s/brief | 60, 206k in, 58 s/brief |

**Decision: no improvement is claimed.** On this suite the two versions behave the same. The diminishing-returns stop skipped none of the 341 planned queries, and registry search is off in the harness unless `--registries` is passed. The +0.046 recall@10 is therefore LLM run-to-run variation. Yet it passes the unpaired gate (band ±0.042). With three runs per side, the gate can accept a change that does nothing, so L2 proposals should get more runs before approval (next step: raise the unpaired minimum to five runs, or pool the runs of unchanged versions to estimate noise).

**Counting fix.** Since Phase 1, GitHub requests are metered in the same ledger, and the harness counted them as LLM calls (354 per run). The harness now counts AI providers only, and these three run files were recomputed from the ledger (60 calls each).

## 2026-10-21: first L1 auto-tuning on stored features

The tuner (`python -m apps.worker.evolution.tune --suite eval/suite-v1 --dry-run`) re-ranked the three runs above under 298 candidate rankings.

- **First pass: wrongly accepted.** It accepted a change that raised shortlist precision by +0.08 in every run. Most of the gain came from cutting the shortlist from 6 to 4 (precision 0.243 → 0.286 from that alone) and dropping essential solutions from it. Precision rewards a shorter list, and nothing guarded what the shortlist recommends.
- **Fix:** a new metric, shortlist recall (the share of essential solutions on the shortlist), is now a gate guard that must not fall in any run.
- **Second pass: every candidate rejected.** The best remaining candidate gains +0.004 recall@10 and +0.009 precision, both inside the noise band. Its shortlist recall drops by 0.046 and its trap rejection by 0.23.

**Decision: nothing promoted.** As far as this suite can measure, the ranking weights are not the bottleneck: essential solutions are missed because the searches never retrieve them (see "Known weaknesses").

## Known weaknesses (next candidates)

- **Look-alike traps:** `EleutherAI/lm-evaluation-harness` is recommended for "regression tests for LLM prompts" in every run, and `OptimalBits/bull` (maintenance mode, its README points to BullMQ) in some. The small model's README assessment accepts them.
- **Model:** all runs use `ministral-8b-latest` (free tier). The design routes planning and assessment to a stronger model; that is the next experiment once a paid key is available.
- **Briefs still at zero recall@10:** see the per-brief table in [BASELINE.md](BASELINE.md).
