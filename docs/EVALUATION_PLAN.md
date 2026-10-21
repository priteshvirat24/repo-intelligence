# Open Eye: Evaluation Plan

**Status:** v1.0 draft, 2026-10-22. Derived from PRODUCT_DEFINITION.md v2.0.

This plan says how Open Eye is measured: the metrics of [D§12], the benchmark they run on, the baselines they are compared with, the thresholds a release must meet, and how often each is checked. It is artifact G. The objective checklist that uses these thresholds is [ACCEPTANCE.md](ACCEPTANCE.md).

**Conventions.**
- **[D§n]** cites [PRODUCT_DEFINITION.md](PRODUCT_DEFINITION.md); **[SD§n]** cites [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md).
- Every threshold here is **proposed**. Decision 3 and [D§12] set thresholds from baselines, so each one is confirmed, or changed, once the baseline it depends on is measured on final labels.
- Every number quoted comes from a committed run file in `eval/results/suite-v1/` and is named by run or configuration. Those numbers rest on **draft labels** (section 3.2): they are provisional, and valid only relative to each other.

## 1. Principles

1. **Baseline before claim.** No improvement is claimed against a number that was not measured first, on the same suite version and labels [D§10.2].
2. **Noise before effect.** An effect counts only when it is larger than the measured run-to-run noise of an unchanged system (section 5).
3. **Every gameable metric has a guard.** Precision is guarded by shortlist recall, trap rejection by traps surfaced, quality by cost [D§10.2].
4. **Independent ground truth.** Labels come from people who have not seen Open Eye's output [D§12].
5. **Cases are never removed to improve the numbers** [D§12].
6. **No superiority claim without a comparative evaluation** [D§12]. Beating B0 shows lift over plain search, nothing more.

## 2. Metrics

Each metric of [D§12], with its definition, the data it needs, whether it is automatic (A) or needs human review (H), the current baseline, and a proposed threshold. "Not measured" means no run file contains it.

All suite-level values are **macro averages over briefs** (each brief weighs the same), as `apps/worker/eval/suite.py` computes them. The **essential set** of a brief is the union of the repositories labelled *essential* for any requirement, plus essential products.

### 2.1 Discovery

| ID | Metric | Definition and computation | Data | A/H | Baseline | Proposed threshold |
|---|---|---|---|---|---|---|
| M1 | Recall@10 | Essential repositories in the top 10 of the ranking, divided by the essential set | Ranked list; labels | A | B0 0.063 (`b0-replay-20261021-122637`); B1 `cfg-02b30c8854db` 0.111 (0.104–0.116); `cfg-d88eb2047d1a` 0.295 (0.258–0.343); `cfg-66b9cecdb37a` 0.341 (0.305–0.365) | Research release: ≥ 0.50 on final labels, held-out split |
| M2 | Recall (all kept) | As M1, over every candidate kept (up to 40). Diagnostic: separates "never retrieved" from "ranked too low" | As M1 | A | `cfg-66b9cecdb37a` 0.415 (0.400–0.429) | None (diagnostic) |
| M3 | Shortlist precision | Shortlisted repositories rated essential or acceptable, divided by shortlist size. For B0 the top 6 stand in for a shortlist | Shortlist; labels | A, then H | B0 0.033; `cfg-66b9cecdb37a` 0.255 (0.243–0.276) | ≥ 0.60 at research release; 0.80 end state [SD§10] |
| M4 | Shortlist recall (guard on M3) | Essential set members on the shortlist, divided by the essential set | Shortlist; labels | A | `cfg-d88eb2047d1a` 0.253; `cfg-66b9cecdb37a` 0.291 | ≥ 0.50 at release; must not fall in any paired run |
| M5 | Trap rejection, surfaced (guard) | 1 − traps shortlisted ÷ traps surfaced (in the ranking), pooled over briefs | Ranking; shortlist; trap labels | A | `cfg-d88eb2047d1a` 0.583 (0.500–0.750); `cfg-66b9cecdb37a` 0.533 (0.500–0.600) | ≥ 0.90 |
| M6 | Lift over plain search | M1 of Open Eye minus M1 of B0s, same suite, labels and snapshot | M1 of both | A | +0.278 (0.341 − 0.063), provisional | ≥ +0.20 [SD§10] |

**Notes.**
- M3 counts an unlabelled shortlisted repository as not relevant. Before a release, the labellers adjudicate every unlabelled shortlisted repository (stored per brief as `shortlistUnlabelled`), so precision measures Open Eye, not gaps in the labels. Adjudicated items are added to the next suite version, not edited in place.
- "Trap rejection (all traps)" is still reported but never gates: it rewards a system that finds nothing (B1 `cfg-02b30c8854db` scored 0.979 while surfacing about one trap per run).

### 2.2 Evidence

| ID | Metric | Definition and computation | Data | A/H | Baseline | Proposed threshold |
|---|---|---|---|---|---|---|
| M7 | Source attribution accuracy | Share of sampled E1–E3 claims whose cited location exists and supports the claim: the command and output for E1; file, lines and commit for E2; URL and quote for E3 | Claims with evidence; audit records | H | Not measured | ≥ 0.95; **zero** cited locations that do not exist |
| M8 | Unsupported or incorrect claim rate | Share of sampled factual claims in a deliverable that have no citation (automatic part) or whose citation does not support them (audit part) | Deliverable; sources; audit records | A + H | Not measured | 0 uncited factual claims; ≤ 0.05 unsupported |
| M9 | Grade honesty | Share of sampled claims shown above the grade an auditor assigns. Also: share of class 1–4 requirements resting on E4/E5 only (automatic, must be 0) [D§5.6] | Claims; audit records; classes | H + A | Not measured | ≤ 0.02 overgraded; 0 class rule breaches |

### 2.3 Decisions

| ID | Metric | Definition and computation | Data | A/H | Baseline | Proposed threshold |
|---|---|---|---|---|---|---|
| M10 | Requirements coverage | Share of the mission's requirements with exactly one class, a reason, and evidence that meets the class rule of [D§5.6] | Blueprint classifications | A | Not measured: the harness stops after discovery | 1.0 |
| M11 | Classification accuracy | Share of labelled requirements whose class matches the adjudicated label. System requirements are first mapped to labelled ones by a reviewer; unmapped ones are reported separately. Also report the 6×6 confusion matrix | Classes; v2 class labels; mapping | A after H mapping | Not measured; labels use the v1 taxonomy (section 3.2) | ≥ 0.75 [SD§10]; gates build mode (decision 2) |
| M12 | Integration plan quality | Two experts score each sampled blueprint 1–5 on completeness, interface correctness, ordering, and feasibility, blind to which system wrote it | Blueprints; rubric | H | Not measured | Mean ≥ 3.5 on each dimension; no plan rated infeasible by both reviewers |

### 2.4 Execution, efficiency, memory, evolution

| ID | Metric | Definition and computation | Data | A/H | Baseline | Proposed threshold |
|---|---|---|---|---|---|---|
| M13 | Build success rate | Build tasks whose **hidden** acceptance tests (held by the suite, never shown to Open Eye) pass on the delivered change set | Build tasks; sandbox run | A | Not measured: no build tasks exist | ≥ 0.60 at build release |
| M14 | Build status honesty | Share of builds whose reported status [D§4] equals the status recomputed from the hidden tests and the test report | Build status; hidden test results | A | Not measured | 1.0 (no overclaim) |
| M15 | Failure diagnosis accuracy | On seeded failures, share diagnosed as the seeded one of the five causes [D§5.8] | Seeded build tasks | A | Not measured; causes not classified | ≥ 0.70 |
| M16 | Cost per mission | AI calls, input and output tokens, source and GitHub requests, and cents when the model is priced, from the ledger (`provider_usage`) per brief and per stage | Ledger | A | Discovery stage only: 60 AI calls, about 206k input and 38k output tokens per 15-brief run (4 calls per brief), `cfg-66b9cecdb37a`. Full mission: not measured | No regression > 10% without a matching quality gain (gate `COST_TOLERANCE`) |
| M17 | End-to-end latency | Wall-clock time per brief, from submission to completion status | Run timings | A | 58.0 s mean per brief (54.9–60.2), decomposition plus discovery only | As M16 |
| M18 | Redundant retrieval and unnecessary tool use | (a) External requests repeating an earlier request key in the same mission and not served from cache; (b) tool calls whose output reached no cited source, candidate or decision | Ledger; request keys; citation graph | A | Not measured | Set from first baseline; (a) target 0 |
| M19 | Research avoided by memory | On paired related briefs (A, then B): share of B's planned queries and calls skipped because memory answered (`queriesSkipped`), with B's M1 and M7 no worse than B run cold beyond noise | Paired cases; ledger | A | Not measured | ≥ 0.20 of calls avoided, no quality loss |
| M20 | Stale-memory error rate | Share of reused findings that were past their revalidation rule, or wrong at the time of use, and fed a decision without revalidation | Reuse log; revalidation records | A + H | Not measured | ≤ 0.02 |
| M21 | Regression rate after changes | Share of promoted changes later rolled back, or found to regress a guard on the held-out split or the next periodic run | Evolution events; periodic runs | A | 1 gated promotion (`cfg-d88eb2047d1a`), 0 rollbacks | ≤ 0.10 |
| M22 | Improvement against a fixed baseline | M1 (and guards) of the current promoted version minus the frozen baseline version, same suite version | Runs of both | A | +0.184 to the promoted `cfg-d88eb2047d1a` (0.295 − 0.111), provisional; the later step to 0.341 is noise (section 5.3) | Reported every release; no threshold |
| M23 | Gate false acceptance | Share of A/A comparisons (two configurations with no effective difference) that the gate accepts | A/A run sets | A | 1 of 1: `cfg-66b9cecdb37a` against `cfg-d88eb2047d1a` passed the unpaired gate (+0.046 against a band of ±0.042) with no real change | ≤ 0.05 over at least 20 A/A comparisons |

M23 is not in [D§12], but [D§10.1] requires L1 changes to win "beyond noise", and only an A/A test shows whether the gate can tell.

### 2.5 The measure of value

[D§1] defines value as a team reaching a working system sooner, and with fewer wrong turns, than a team starting from its own research. No metric of [D§12] measures this directly. It is measured by the comparative study in section 4.3: time to pass the acceptance tests of a build task, and the number of components adopted and later abandoned.

## 3. The benchmark

### 3.1 Suite v1 as it stands

| Property | suite-v1 |
|---|---|
| Briefs | 15, three in each of five domains: geospatial and visualisation, developer tooling, data pipelines, LLM applications, web backends with authentication |
| Outside the team's expertise | 6 of 15 (40%); the design asks for at least 30% |
| Brief size | 30 to 74 words; all one paragraph |
| Labelled requirements | 68; 65 essential repositories in total (per-brief unions); 10 products |
| Traps | 10, in 8 briefs; 7 briefs have none |
| Use cases covered | UC1 only. No repository (UC2), comparison (UC3), build (UC4), revisit (UC5) or cross-project (UC6) case |
| Adversarial cases | Look-alike and abandoned traps only, as labels inside ordinary briefs |
| Labels | Draft by one AI labeller (`labelledBy: claude-draft`), checked against GitHub on 2026-10-21 (`label-check.json`); classes in the v1 taxonomy |

### 3.2 Labelling protocol

The protocol in [eval/README.md](../eval/README.md) stands, with these additions:
1. **Two independent human labellers** per case, with knowledge of the domain, who see the brief and nothing else. The AI draft is not one of the two labels. It may be shown after both labels exist, as a third list for missed items; anything it adds is recorded as such.
2. **Adjudication** by a third person when the two disagree on an essential solution, a trap or a class. Every disagreement and its resolution is recorded in the brief file.
3. **Agreement** reported per brief and per suite in `suite.json`:
   - essential-solution agreement: the share of essential solutions both found independently (brief rewritten below 0.5, as today);
   - class agreement: Cohen's kappa over the six classes (proposed: suite kappa ≥ 0.6, or the class labels are revised before M11 counts);
   - trap agreement: the share of traps both named.
4. **v2 classes (decision 8).** The labellers relabel every requirement in the six v2 classes of [D§5.6]. A mechanical mapping is not enough: v1 class 2 ("configuration or integration") splits into v2 classes 2 and 3.
5. **Freeze.** A suite version's labels become `final` only after steps 1–4. Numbers on draft labels stay labelled provisional.

### 3.3 Target composition (suite v2)

| Case type | Minimum | What it adds |
|---|---|---|
| UC1 research briefs | 40, in at least 8 domains, at least 30% outside the team's expertise | Short (one paragraph), medium (one page) and long (several pages) briefs, at least 10 of each |
| UC2 extend a repository | 6 | A repository at a fixed commit; labels include the existing components the blueprint must build on |
| UC3 decide between options | 6 | Named candidates and a labelled preferred choice with reasons |
| UC4 build tasks | 10 | Section 3.5 |
| UC5 revisit | 5 | The same brief re-run after a snapshot refresh in which a labelled fact changed |
| UC6 related pairs | 5 pairs | Two briefs sharing requirements, in different projects of one workspace; used for M19 |
| Adversarial | 12, at least 2 per type | Section 3.4 |
| Regression | Every observed failure | Section 3.6 |

A quarter of 15 briefs is under four, too few to detect any effect, so the held-out split (section 3.7) needs this larger suite before it means anything.

### 3.4 Adversarial cases

| Type [D§12] | Case contains | Pass |
|---|---|---|
| Missing documentation | An essential solution with little or no README | Found and assessed from code (E2), not dropped for lack of docs |
| Abandoned repository | The best-known match is archived, or has had no push for over two years, or points to a successor | Not shortlisted for reuse or adapt; the successor found where one exists |
| Conflicting sources | Docs, README and code disagree on a fact (version support, licence) | The conflict is listed under uncertainty; the code or official source wins with its grade; no silent choice |
| Incompatible dependencies | Two candidates that each fit but cannot be combined (peer or runtime versions) | Incompatibility found and graded; the combination not recommended, or flagged as class 6 |
| Misleading description | A repository whose description claims a capability its code lacks | Classed on code evidence; the claim stays E4; no class 1–4 for it |
| Look-alike trap | Adjacent tool (for example `EleutherAI/lm-evaluation-harness` for prompt regression tests) | Not shortlisted |
| Embedded instructions [D§11] | A README or issue with instructions addressed to the model | Ignored and logged; the mission's goal and output unchanged |
| Blocked source [D§8] | A source behind a sign-in wall or disallowed by robots | Reported as blocked; no workaround; stated in uncertainty |

### 3.5 Build-mode tasks

Ten small integration tasks [SD§10]. Each task holds:
- a starting repository at a fixed commit, and an approved blueprint scope;
- **hidden acceptance tests** kept in the suite, run by the harness after delivery, never shown to Open Eye;
- the expected build status.

At least three are seeded to fail, one for each of: an incompatible dependency, a wrong original assumption, an inadequate given test. The pass condition for these is the right diagnosis [D§5.8] and an honest status (Needs review, or work sent back to research), not success.

### 3.6 Regression cases

Every observed failure becomes a case. Product-level failures go into the suite; harness and gate failures become tests in `tests/worker/`. Known so far (from `DECISIONS.md`):

| Failure | Becomes |
|---|---|
| `Automattic/kue` (abandoned) shortlisted in every run of `category-queries` | Suite trap (exists in `web-job-queue`) |
| `EleutherAI/lm-evaluation-harness` recommended for prompt regression tests | Suite trap (exists in `llm-prompt-evals`) |
| `OptimalBits/bull` (maintenance mode, README points to BullMQ) recommended in some runs | Suite trap (exists in `web-job-queue`) |
| Decomposer fell back to keyword rules on long broken JSON; planner dropped reworded requirement names; planner misread nested query output | Harness and unit tests |
| GitHub requests counted as AI calls | Harness test |
| Tuner accepted a change that only shortened the shortlist | Gate test (shortlist recall guard) |
| Unpaired gate accepted a change that did nothing | A/A gate test (M23) |

### 3.7 Held-out split (decision 12)

- A quarter of the cases of each suite version, drawn at random, stratified by domain and case type, with the seed recorded.
- Their ids live in a separate manifest, with a hash in `suite.json`.
- They are **never** used to design, tune or mine weaknesses. The tuner and weakness mining must refuse them, enforced in code and tested.
- Every L2 and L3 promotion is confirmed on them [D§14 decision 12]. L1 promotions are confirmed on them too [D§10.2 step 5], because the tuner chooses among many candidates on the same cases.
- A held-out case that has been looked at to design a change moves to the design split in the next version, and is replaced.

### 3.8 Versioning

- A suite version is immutable once its labels are final. New cases and corrected labels make a new version.
- A case is retired only in a new version, with the reason recorded. Retired cases stay in the repository.
- Every result file names its suite version, label status, commit, configuration hash, model and snapshot counts (`run.py` records all of these today).
- When labels or metrics change, stored runs are rescored with `apps.worker.eval.rescore`, never re-run to replace history.

## 4. Baselines

### 4.1 B0 and B0s: plain search

`apps/worker/eval/baselines.py`: GitHub repository search on the brief title's keywords, plus a web search for the title and "github", interleaved, top 10; the top 6 stand in for a shortlist. B0s sorts the GitHub half by stars, and is the stricter baseline that lift (M6) is measured against. On suite-v1 both score 0.063 recall@10 and 0.033 precision, and every essential hit came from the web-search half.

### 4.2 B1: Open Eye, by configuration

| Configuration | Runs | Recall@10 | Shortlist precision | Status |
|---|---|---|---|---|
| `cfg-02b30c8854db` (initial default) | 3 | 0.111 (0.104–0.116) | 0.091 | Frozen baseline for M22 |
| `category-queries` | 3 | 0.322 (0.278–0.348) | 0.223 | Rejected: trap guard regressed |
| `cfg-d88eb2047d1a` (`category-queries-fresh`) | 3 | 0.295 (0.258–0.343) | 0.234 | Promoted |
| `cfg-66b9cecdb37a` (integrated, after P2–P6) | 3 | 0.341 (0.305–0.365) | 0.255 | Current default; no improvement claimed |

The harness measures understanding plus discovery only. Classification, blueprint, evidence and build are not yet in it; extending it is a precondition for M7–M15.

### 4.3 Manual-research baseline (BM)

Needed before any claim that Open Eye beats manual research [D§12]. A fair run:
1. **Participants:** engineers with experience in the case's domain who did not label that case. At least two per case, on at least 10 held-out cases.
2. **Same inputs and time:** the same brief and constraints, a fixed time box (proposed: 4 hours per brief), their usual tools (web search, code hosts, AI assistants allowed and recorded), no Open Eye.
3. **Same output form:** a shortlist with reasons, one class per requirement, and their sources, in the format the scorer reads.
4. **Blind scoring:** labellers score BM and Open Eye outputs with the same metrics, without knowing which is which.
5. **Report:** M1, M3–M5, M11 and time spent, per case and overall, with the spread between participants.

**Value study** (section 2.5): on build tasks, one group starts from an Open Eye blueprint and one from its own research. Record time to pass the hidden acceptance tests, and components adopted then abandoned. Other tools may be added as further baselines on the same protocol.

## 5. Reproducibility and noise

### 5.1 Record and replay

- **record** stores every GitHub and search-provider response in a content-addressed snapshot (hash of method, URL and body without credential fields; no headers). **replay** serves only the snapshot and fails a brief on a miss. **fill** serves the snapshot and records only missing requests.
- **LLM calls are never replayed.** They run live in every mode, so replay runs still differ by model nondeterminism.
- `--requirements-from` reuses one decomposition so discovery changes are not masked by decomposition noise.
- **Gap:** snapshots are not committed and live on the recording machine, so replay is reproducible only there. They move to object storage, and each result file records the snapshot's hash.

### 5.2 Configuration versions

A configuration is identified by a hash of its full content, prompts and models included (`apps/worker/tuning.py`). Every run records the hash, commit, model id, suite version and label status. A changed prompt, weight or model is always a new version.

### 5.3 Runs per configuration and noise

- **Observed noise:** three runs of one configuration span up to 0.085 recall@10 (`cfg-d88eb2047d1a`: 0.258–0.343). The integrated default rose by +0.046 over `cfg-d88eb2047d1a` with no effective change, because the new stop skipped none of 341 planned queries and registry search was off.
- **Rule (proposed):** at least **5 runs** per configuration for unpaired comparisons (the gate's `MIN_RUNS` is 3 today). Paired comparisons (same decomposition, same snapshot) are preferred.
- **Estimate (proposed):** pool the runs of all versions with no effective difference into one noise estimate, compute the per-brief paired difference, and bootstrap over briefs and runs. A change is an improvement when the 95% interval of the difference excludes zero and the mean exceeds the band.
- **Calibrate:** an A/A comparison at every release (M23).

## 6. Human audits

| Audit | Sample | Procedure | Feeds |
|---|---|---|---|
| Evidence correctness | 100 claims per release from the latest full-suite run: 20 E1, 50 E2, 30 E3, drawn at random with the seed recorded | The auditor opens the cited location and records: exists (yes or no); supports the claim (yes, partly, no); real grade | M7, M8 |
| Grade honesty | 100 random claims of any grade shown in deliverables, plus 20 statements labelled recommendation, assumption or estimate | The auditor assigns the real grade; a claim shown above it is overgraded; a recommendation or estimate shown as fact counts as overgraded | M9 |
| Integration plans | 10 blueprints per release, two experts each, blind to system | Rubric of M12 | M12 |
| Requirement mapping | Every requirement of every scored mission | A reviewer maps system requirements to labelled ones | M11 |
| Stale memory | 50 reused findings per release | Check the finding against its source at the time of use | M20 |

- **Precision of the sample:** 95 correct of 100 gives a 95% Wilson interval of about 0.89 to 0.98. A release passes on the point estimate, and fails at once on any cited location that does not exist.
- **Agreement:** 20% of each sample goes to a second auditor; agreement is reported with the result.
- **Audits are product features** [SD§10]: each verdict is stored against the claim (claim, evidence, verdict, auditor, date), not kept in a side script.

## 7. Release criteria

All thresholds are proposed and are measured on final labels, on the held-out split where one exists, with at least 5 runs.

| Release | Criteria (all must hold) |
|---|---|
| **Research mode** [D§14 decision 2] | Labels final with agreement reported; suite v2 composition met. M1 ≥ 0.50; M6 ≥ +0.20; M3 ≥ 0.60; M4 ≥ 0.50; M5 ≥ 0.90. M10 = 1.0. M7 ≥ 0.95 with no non-existent location; M8: 0 uncited, ≤ 0.05 unsupported; M9 ≤ 0.02 and 0 class rule breaches. Every adversarial case passes. Completion status honest on every case. M16 and M17 measured for the full mission, and the default budget set from them (decision 3) |
| **Build mode** [D§14 decision 2] | Research release met. M11 ≥ 0.75 and M7 ≥ 0.95 in two consecutive release audits. M13 ≥ 0.60; M14 = 1.0; M15 ≥ 0.70. No change delivered to a default branch. Sandbox tests pass: no secrets inside, no network during tests |
| **L0 memory** [D§10.1] | M20 ≤ 0.02; M19 ≥ 0.20 with no quality loss; a procedure becomes active only after recorded success (test); a correction reaches every dependent project (test) |
| **L1 configuration** | M23 ≤ 0.05; every guard in the gate; promotions confirmed on the held-out split; each promotion logged and its rollback demonstrated |
| **L2 prompts and strategies** | L1 criteria; a win on the design split and on the held-out split with ≥ 5 runs per side; maintainer approval recorded; rejected proposals kept with their evidence |
| **L3 workflow** | L2 criteria; staged rollout to a share of missions with monitoring and automatic rollback (`monitor.py`: rollback when feedback worsens by more than 0.10 and the difference is significant) |
| **L4 software and security** | No code path lets Open Eye change its own code, permissions or security boundaries (inspection plus test); such changes appear only as reviewable proposals |

## 8. Cadence

| When | What runs |
|---|---|
| Every change to the pipeline | Unit tests; a five-brief replay subset; the gate for any tuning or prompt change |
| Every release | Full suite in replay, 5 runs, design and held-out splits; adversarial and build tasks; A/A test; human audits (section 6); report regenerated with `apps.worker.eval.report` |
| Weekly | Full suite in replay; weakness mining on the design split |
| Monthly | Full suite live, to measure drift; the refreshed snapshot becomes a new suite version |
| Quarterly | Label review and regression-case intake; manual-baseline refresh when a superiority claim is planned |

## 9. Current state against this plan

| Plan element | State, 2026-10-22 |
|---|---|
| Harness (record, replay, fill, report, rescore) | Built; used for 14 runs |
| Discovery metrics M1–M6 | Computed automatically; provisional on draft labels |
| Evidence metrics M7–M9 | Not measured; no audit view |
| Decision metrics M10–M12 | Not measured; the harness does not run the blueprint; labels use v1 classes |
| Execution M13–M15 | Not measured; no build tasks |
| Efficiency M16–M17 | Discovery stage only; cost not priced (free-tier model); M18 not measured |
| Memory M19–M20 | Not measured; no paired cases |
| Evolution M21–M23 | One gated promotion, no rollback; one observed false acceptance |
| Labels | One AI labeller; checked against GitHub; not independent |
| Suite composition | 15 UC1 briefs; no UC2–UC6, build or dedicated adversarial cases |
| Held-out split | None |
| Runs per configuration | 3; gate `MIN_RUNS` = 3 |
| Manual baseline | None; no superiority claim may be made |
| Snapshots | Local only; replay reproducible on the recording machine |
| Per-change replay in CI | Not set up; no CI workflow in the repository |
| Model | All runs on `ministral-8b-latest` (free tier) |
