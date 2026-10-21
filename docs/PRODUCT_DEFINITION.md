# Open Eye: Product Definition

**Status:** v1.0, approved 2026-10-21 with the proposed defaults in section 12. System design derived from it: [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md). This document defines what the finished system must accomplish and how success is demonstrated. It deliberately makes no technology choices; architecture, tools, the evaluation harness and implementation phases are derived from it afterwards and must trace back to a requirement here.

Product decisions are recorded in [section 12](#12-decisions).

---

## 1. The product in one paragraph

Open Eye is an engineering intelligence system. A user describes what they want to build. Open Eye works out what the product requires, investigates what already exists, verifies which existing pieces actually do what is needed, decides what to reuse, adapt or build, and delivers an evidence-backed engineering blueprint. When authorised, it then builds and tests the implementation in isolation. Every completed run leaves measured evidence that makes later runs better.

**Governing principle:** do not reinvent what already exists. Discover what is available, decide what is worth reusing, understand how to integrate it, identify what is missing, and build only what is necessary.

**Measure of value:** a team starting from an Open Eye blueprint reaches a working system faster and with fewer wrong turns than a team starting from their own search. Everything in this document serves that outcome.

## 2. Users and the job they hire it for

| User | Situation | Job to be done |
|---|---|---|
| **Primary: engineer or tech lead starting a project** | Has a brief (a paragraph to a few pages) and limited time to research | "Tell me the best-known starting point, what I can reuse, how it fits together, and what I still have to build, with proof." |
| **Secondary: the same team on later projects** | Has run Open Eye before | "Don't make me redo research we already did; tell me what still holds and what changed." |
| **Reviewer: manager, client, architect** | Receives the blueprint | "Can I trust this recommendation? Show me what was verified and what is assumed." |

The user never has to choose which sites to search, which repositories to inspect, which agents or tools to run, or which research strategy to follow.

## 3. What it is not (non-goals)

- **Not a crawler.** Pages fetched, repositories cloned and agents run are costs, not results. A long report or a large crawl is not success.
- **Not a chatbot over search results.** Answers are not summaries of whatever was found. They are decisions backed by graded evidence.
- **Not a RAG demo.** Retrieval is one internal capability. The product is the blueprint and the verified build.
- **Not a tool for getting around access controls.** It does not bypass logins, paywalls, CAPTCHAs, rate limits or site restrictions, including by browser fingerprint evasion.
- **Not a self-modifying system.** It never changes its own production code or security policies on its own judgement (see section 9).
- **No feature that does not improve the core outcome.** Anything proposed later must show how it improves discovery, verification, blueprint quality, build success or measured learning.

## 4. The end-state user experience

### 4.1 A run, from the user's side

1. **Brief.** The user pastes or uploads a brief. Optionally they add constraints: budget, languages, infrastructure, technologies to prefer or avoid, licence policy, deadline.
2. **Understanding check (seconds).** Open Eye shows its reading of the brief:
   - the objective;
   - requirements, each marked MUST, SHOULD or NICE-TO-HAVE and as stated or inferred;
   - constraints and assumptions;
   - acceptance criteria for the finished product.

   It asks **at most three** clarifying questions, and only where the answer would change the outcome. The user can correct any line. Research does not wait for answers to non-blocking questions; it proceeds on stated assumptions.
3. **Research plan (seconds).** A short plan: which questions it will answer, which kinds of sources it expects to use, and the budget it will spend. Within the default budget this runs without approval. Above it, the plan needs approval.
4. **Live investigation (minutes).** A status view shows what each part of the system is doing right now. Candidates appear as they are found and move through three states: *found*, then *assessed*, then *verified* or *rejected*. Each change comes with the reason.
5. **Blueprint (end of run).** The engineering blueprint (section 5), with every recommendation linked to its evidence.
6. **Iterate without restarting.** The user can:
   - change a constraint ("must be Python", "no GPL");
   - challenge a decision ("why not X?");
   - ask for deeper investigation of one requirement or candidate;
   - exclude a source.

   Only the affected parts of the run are redone, and the blueprint shows what changed and why.
7. **Build (optional, explicit authorisation).** The user approves the blueprint, or a subset of its roadmap, for implementation. Open Eye builds in an isolated environment and returns reviewable changes with test results (section 5.8).
8. **Afterwards.** The project stays in history. Its findings, and its outcome when built, feed memory and evaluation.

### 4.2 Workspace surfaces

Each surface exists to answer one question for the user.

| Surface | The question it answers |
|---|---|
| Brief and constraints | What did I ask for, and what did Open Eye understand? |
| Live status | What is it doing now, how much budget has it used, is it stuck? |
| Discovered resources | What exists out there: repositories, packages, APIs, docs, articles? |
| Evidence panel | Why should I believe this claim? Source, location, retrieval time, evidence grade, verified by what? |
| Build vs reuse | For each requirement: is it available, needing integration, needing modification, partly solved, missing, or unresolved? |
| Architecture and integration | How do the chosen parts fit, and what must I configure? |
| Roadmap | What do I do, in what order, and how do I know each step is done? |
| Uncertainty report | What is unverified, conflicting, stale, or waiting on a human decision? |
| Project history | What did we decide before, and what changed since? |
| Learning record | How well does Open Eye perform, and what has it changed about itself, with what measured effect? |

### 4.3 Interaction principles

- **Inspectable:** every recommendation opens to its evidence in one click.
- **Honest about grade:** the interface never shows a README claim, an inference or an estimate with the same weight as a verified fact.
- **Incremental:** revising a constraint re-runs only what depends on it.
- **Interruptible:** the user can stop, redirect or narrow a run at any point. Partial results are kept and labelled partial.

## 5. Deliverables

### 5.1 Evidence grades (used by every deliverable)

Every factual claim carries one grade. The grade shown is the highest one actually achieved, never the one hoped for.

| Grade | Meaning | Example |
|---|---|---|
| **E1: Executed** | Observed by running code in a sandbox | "satellite.js propagates the ISS TLE to within 1 km of the reference" (test output attached) |
| **E2: Verified in code** | Located in the source at a specific file and lines at a specific commit | "`sgp4()` in `src/propagation/sgp4.js` L10–40" |
| **E3: Officially documented** | Stated in the project's own docs, API reference or release notes | "Supports TypeScript types (docs, v5.0)" |
| **E4: Claimed** | README, blog, forum answer or marketing; not yet checked | "README says it handles 10,000 satellites" |
| **E5: Inferred** | Open Eye's own reasoning from other evidence | "Likely fast enough, given it runs in a web worker" |

Licence status, maintenance activity and version compatibility are facts and are graded like any other claim. Recommendations and estimates are labelled as such and are never graded as facts.

### 5.2 Executive recommendation

One page covering:
- the recommended strategy;
- the strongest existing building blocks;
- the main technical challenges;
- an estimate of remaining work, labelled as an estimate;
- the top three risks;
- the decisions that need a human.

### 5.3 Existing-solutions inventory

One entry per relevant candidate: repository, package, API, service or framework. Each entry has:

- name, source URL, and the version or commit examined;
- relevant capabilities, each graded;
- the specific modules, functions or features worth reusing, with locations;
- licence and compatibility with the project's licence policy;
- maintenance and dependency risk (last release or commit, open critical issues, dependency health);
- limitations and missing functionality;
- recommended action: **reuse**, **adapt**, **investigate further** or **reject**, with the reason.

Rejected candidates stay visible with the reason, so the user can see the alternatives were considered.

### 5.4 Build-versus-reuse analysis

Every requirement gets exactly one classification and the reason for it:

| Class | Rule for using it |
|---|---|
| 1. Available and verified | A candidate meets it with E1 or E2 evidence |
| 2. Available, needs configuration or integration | Meets it with E1–E3 evidence, plus identified setup or glue work |
| 3. Available, needs modification | A candidate does most of it; the needed change is identified |
| 4. Partially solved | Candidates cover parts; the uncovered part is named |
| 5. Missing, must be built | The research found nothing adequate, and the search done is recorded |
| 6. Unresolved | Evidence is insufficient or conflicting; says what evidence would resolve it |

Classes 1–3 cannot rest on E4 or E5 evidence alone. A claim-only match goes to class 6, or to "investigate further".

### 5.5 Recommended architecture

A component-level design covering:
- each component's responsibility, and whether it is reused, adapted or new;
- data flows, interfaces and data contracts;
- storage and retrieval;
- external dependencies;
- authentication and permissions;
- failure handling and observability;
- deployment and scaling.

Trade-offs and rejected alternatives are stated with the reason.

### 5.6 Integration guide

How the chosen parts fit together:
- prerequisites;
- installation;
- configuration;
- environment variable **names** (never values);
- API integration details, with versions where verified;
- code examples where they help.

Every step cites its evidence, and steps not yet executed are marked as unexecuted.

### 5.7 Implementation roadmap

Prioritised tasks. Each task has:
- a description;
- dependencies and order;
- the expected output;
- estimated complexity and uncertainty, labelled as estimates;
- risks and mitigations;
- **acceptance criteria**;
- **test requirements**.

### 5.8 Build-mode deliverable

When authorised, Open Eye produces:
- a reviewable change set (branch or pull request) built in isolation;
- integration adapters and configuration;
- tests, plus a test report saying what passed, failed, remains untested, or needs a human;
- an updated blueprint that marks which claims were raised to E1 by execution and which turned out wrong.

### 5.9 Evidence and uncertainty report

Lists:
- the traceability of every significant recommendation;
- conflicting evidence;
- stale sources;
- incomplete research, with what was not searched and why;
- unverified claims the plan still depends on;
- decisions needing human review.

## 6. System behaviour

### 6.1 The loop

Receive brief → interpret requirements → plan research → discover → inspect implementations → verify evidence → compare alternatives → design architecture → identify gaps → produce blueprint → *(authorised)* implement → test → evaluate → save lessons → improve future runs.

**Revisiting earlier steps:** any step can send work back to an earlier one when new evidence invalidates an earlier decision. Examples: a verified licence conflict, a failing integration test, a user constraint change, or a stale finding that failed revalidation. The blueprint records each reversal.

### 6.2 Responsibilities and their contracts

These are responsibilities with measurable outputs. They are not a commitment to a particular number of agents or to any framework. Whether one component or several fulfils a role is an architecture decision.

| Role | Must output | Checked by |
|---|---|---|
| Mission planning | Requirements with acceptance criteria, research questions, a dependency-aware plan, scope decisions | User (understanding check) and evaluation |
| Web discovery | Candidates with source links, retrieval time and why each is relevant | Technical evaluation |
| Crawling and extraction | Normalised content with provenance and timestamps; cached, de-duplicated, retried within limits | Spot checks against the source |
| Repository intelligence | For each repository: architecture, modules, interfaces, dependencies, tests, licence, activity; capabilities graded E2 with locations | Evidence gate (claims must resolve to real code) |
| Technical evaluation | A comparison against explicit criteria, separating facts, inferences and recommendations | Architecture and evaluation |
| Architecture | The component design, with reuse decisions, trade-offs and rejected alternatives | User review |
| Integration planning | Ordered integration tasks; licence, version and interface conflicts flagged | Testing (build mode) |
| Implementation *(authorised)* | Reviewable changes made in isolation, after inspecting the existing code | Testing and user review |
| Testing and verification | An executed test report; claims raised to E1 or refuted | Evaluation |
| Learning and evolution | Measured weaknesses and proposed changes, with benchmark results | Promotion gate (section 9) |

### 6.3 Coordination rules

- All roles read and write one shared, structured project state. No role works from a private copy of the facts.
- Before doing a task, a role checks whether the work, or an equivalent, already exists in project state or memory.
- A role never accepts another role's factual claim above its stated grade. Raising a grade requires the evidence that grade demands.
- Delegation depth, retries and concurrent tasks are bounded (section 7.2). Recursive self-delegation without new information is not allowed.

### 6.4 Stopping conditions

A run stops, and says which condition stopped it, when:
1. all acceptance criteria for the blueprint are met; or
2. the expected information gain of further research falls below its cost (diminishing returns: recent steps changed no decisions); or
3. a budget limit is reached; or
4. a decision needs human input that only the user can give.

When uncertain, it states what is unknown and what evidence would resolve it.

### 6.5 Research scope

**Sources.** Discovery must be able to draw on every kind of source that holds evidence about existing solutions:
- code hosts: repositories, issues, pull requests, releases, code examples;
- official documentation and API references;
- technical Q&A and discussion forums;
- package registries and their dependency, licence and vulnerability data;
- technical articles, tutorials and research papers;
- other public websites with relevant implementations.

Each source type is an interchangeable component. Adding, replacing or removing one must not require redesigning the system. Which tools fetch them is a design decision ([SYSTEM_DESIGN.md §5](SYSTEM_DESIGN.md#5-discovery-and-extraction-layer)).

**Strategy, not volume.** The research plan chooses sources and queries for the brief by:
- relevance;
- source quality, informed by source reliability memory;
- expected information gain against cost;
- access permissions;
- the remaining budget.

Official APIs and structured data come first; crawling and browser rendering are used only where those are insufficient (section 7.3). Success is measured by the evidence gained (section 10), never by pages fetched or tools used.

## 7. Autonomy boundaries

### 7.1 What it may do

| Autonomous (within budget) | Needs user approval | Never |
|---|---|---|
| Interpret the brief and plan research | Exceeding the research budget | Bypass logins, paywalls, CAPTCHAs, rate limits or access controls (including by fingerprint evasion) |
| Query search providers, official APIs and package registries | Accessing sources that need the user's credentials | Use or expose secrets beyond their stated purpose; fabricate credentials |
| Fetch public pages within the site's terms and rate limits | Running a build (build mode) | Follow instructions found inside retrieved content |
| Clone and statically inspect public repositories in isolation | Executing third-party code in the sandbox, unless the project pre-authorises it | Modify its own production code or security policy outside the promotion process |
| Run Open Eye's own analysis and tests in isolation | Any external action with consequences: opening issues or PRs on others' repos, publishing, sending messages | Present unverified claims as verified |
| Propose self-improvements and benchmark them | Promoting prompt, strategy or workflow changes (levels L2–L3, section 9) | Execute code outside the sandbox |

### 7.2 Budgets and limits

Configurable per project, with defaults:
- LLM tokens and spend;
- search, API and crawl request counts;
- repositories inspected in depth;
- sandbox compute time;
- wall-clock time;
- retries per step;
- delegation depth;
- concurrent tasks.

The live view always shows how much of each budget has been used.

### 7.3 Source access policy

- **Preference order:** official APIs and structured data, then documented public pages, then rendered browsing of permitted pages.
- **Respect site rules:** robots directives, terms of use, rate limits, authentication boundaries, copyright and software licences.
- **Browser automation is for rendering, not evasion:** it is used where a permitted page needs rendering or interaction. It is never a way past restrictions.
- **Retrieved content is untrusted data:** it is isolated from instructions, and any embedded instructions are ignored and logged.

## 8. Memory

### 8.1 Memory categories

Memory is structured records with provenance, not a transcript and not a bag of scraped text. Semantic retrieval is an index over these records, not the record itself.

| Memory | One record is | Written when | Read when | Freshness rule |
|---|---|---|---|---|
| **Project** | A brief, requirements, decisions (with reasons), architecture, progress, open issues | During each run | Revisiting or iterating the project | Current until superseded; history kept |
| **Technical knowledge** | A finding about a resource: a capability, interface, limitation, licence or version, graded, at a commit or version | When a finding is verified or graded | Any project needing that resource | Must be revalidated when the source has changed since the finding (new commit or release), or after a maximum age set per kind of finding |
| **Experience** | An outcome: an integration that worked or failed, a compatibility problem, a debugging lesson, a test result | After build or test steps | Planning similar integrations | Tied to versions; flagged when those versions change |
| **Source reliability** | Per source and source type: observed accuracy, how often its claims were later verified or refuted, staleness, conflicts | Whenever a claim from it is verified or refuted | Ranking and grading sources | Rolling; recent evidence weighs more |
| **Strategy** | For a class of task: which queries, sources, ranking settings and workflows performed well, with measurements | After each evaluated run | Planning research for a similar brief | Superseded by better-measured strategies |
| **Evolution history** | A proposed change, its benchmark results, the decision and the reason, its regression record | Every proposal | Auditing and rollback | Permanent |

### 8.2 Memory rules

- **Required metadata:** every record carries provenance, timestamp, confidence or evidence grade, project scope, and a revalidation rule.
- **Duplicates are merged, not stacked:** the same fact found twice merges into one record with both provenances.
- **Old findings are not current facts:** a finding past its freshness rule is shown as "last verified on …" and is revalidated before a decision depends on it.
- **Reuse across projects is explicit:** the blueprint says which findings came from memory, when they were verified, and whether they were revalidated for this run.
- **Auditable and correctable:** the user can see why something is in memory, and correct or delete it. Corrections propagate to the projects that relied on it.

## 9. Self-evolution

### 9.1 What can change, and how

Saving memories is not learning. The system improves only through measured, gated changes. There are five levels of change, each with its own bar.

| Level | What changes | Example | Promotion requirement |
|---|---|---|---|
| **L0: Memory** | Facts and experience | "satellite.js v5 needs ES modules" | Automatic, with provenance |
| **L1: Adaptive configuration** | Weights, thresholds, source priors, learned retrieval preferences | Ranking weights, the stars floor | Automatic **if** it beats the baseline on the benchmark with no guard-metric regression; logged and reversible |
| **L2: Prompts and strategies** | Prompts, query strategies, tool selection rules | A new query-planning prompt | Benchmark win **and** user or maintainer approval |
| **L3: Workflow** | Stage order, roles, stopping rules | Verify before ranking | Benchmark win, approval, and a staged rollout |
| **L4: Software and security policy** | Open Eye's own code or permissions | Anything | Never self-applied. Proposed as a reviewable change and treated like any other code change |

### 9.2 The learning loop

1. Record the brief, acceptance criteria, decisions, sources, tool calls and outputs of every run.
2. Measure the run (section 10) when ground truth exists: user feedback, build results, later verification.
3. Find recurring weaknesses. Example: "misses established libraries whose descriptions lack the query terms" (a real failure observed and fixed in the current prototype).
4. Propose a change at the lowest level that addresses the weakness.
5. Evaluate it on the fixed benchmark plus representative historical runs.
6. Compare it with the current baseline on the primary metric and on every guard metric.
7. Reject it if it does not improve, or if it regresses anything beyond tolerance.
8. Promote it through a versioned, reviewable record (evolution history).
9. Monitor later runs, and roll back automatically if live metrics degrade.

## 10. Success criteria and measurement

### 10.1 Metrics

Baselines are measured **before** any improvement is claimed. Target values are proposals, to be set once baselines exist.

| Metric | Definition | Measured by |
|---|---|---|
| Discovery recall@10 | Share of expert-labelled relevant solutions that appear in the top 10 | Benchmark briefs with labelled solutions |
| Shortlist precision | Share of shortlisted candidates that an expert agrees are genuine starting points | Expert review of benchmark runs |
| Lift over plain search | Recall@10 minus that of a fixed baseline (plain GitHub plus web search for the brief's main terms) | Same benchmark, same budget |
| Evidence correctness | Share of claims shown as E1 or E2 that are actually correct | Sampled human audit |
| Grade honesty | Share of sampled claims shown at a grade they do not meet (target near zero) | Sampled human audit |
| Classification accuracy | Agreement of build-vs-reuse classes with expert labels | Benchmark briefs |
| Requirement coverage | Share of requirements with a classification and a justification (target 100%) | Automatic |
| Integration success (build mode) | Share of integration tasks whose acceptance tests pass in the sandbox | Build-mode benchmark tasks |
| Test pass rate and regression rate | Of build outputs, and of Open Eye's own changes | Automatic |
| Memory effectiveness | Research avoided by reusing memory, and how often reused findings failed revalidation | Paired related briefs |
| Cost and latency | Spend and wall-clock time per brief, per stage | Automatic |
| Measured improvement | Change in the primary metrics across promoted versions | Evolution history |

### 10.2 The evaluation suite

- **Representative briefs:** real-world briefs across domains, including the satellite-tracker brief already in use and briefs in domains outside the team's expertise. Each has expert-labelled known solutions and build-vs-reuse labels.
- **Verified integration tasks:** small builds with acceptance tests, for build mode.
- **Historical failure cases:** every observed failure, kept as a regression test.
- **Fixed and versioned:** the suite is fixed per version. New cases are added, but none are removed to make numbers look better.

### 10.3 How success is demonstrated

Success is shown in a single reproducible review:
1. Run the evaluation suite on the current version and on the recorded baseline, and show the metric table side by side.
2. Pick three recommendations at random and trace each from blueprint to evidence to source location.
3. Run two related briefs in sequence and show reuse of memory, including a revalidated finding.
4. Show one promoted change and one rejected change from the evolution history, with their benchmark results.
5. *(Build mode)* Build one benchmark task in the sandbox and show the test report and the reviewable change set.

## 11. Quality and safety requirements (cross-cutting)

- Sandboxed repository inspection and code execution; no execution outside isolation.
- Dependency vulnerability checks and licence compatibility analysis for every recommended component.
- Defence against instructions embedded in retrieved pages and repositories.
- Secrets held outside model context wherever possible; never written into blueprints, logs or memory.
- Human approval for consequential external actions.
- Version control, audit trail, test gates and rollback for every change Open Eye makes, to user code or to itself.

## 12. Decisions

Approved 2026-10-21: every decision below takes its proposed default (in *italics*).

1. **First user and setting:** individual engineers, or teams sharing project and technical memory? *Default: a team workspace with shared technical memory and per-project privacy.*
2. **Build mode in the first release,** or research mode first? *Default: research mode first; build mode once evidence correctness and classification accuracy meet their targets.*
3. **Default budget per brief** (spend and time). *Default: to be set from measured cost on the benchmark.*
4. **Executing third-party code** to reach E1: allowed by default in the sandbox, or per project? *Default: per-project opt-in.*
5. **Licence policy default:** permissive only, or copyleft allowed and flagged? *Default: allowed and flagged, overridable per project.*
6. **Browser-based research:** *Scrapling with Camoufox renders pages that need a browser or refuse plain HTTP clients (decided 2026-10-21).* The limits in section 7.1 still hold: it never gets past logins, paywalls or CAPTCHAs; a sign-in wall is reported as blocked and not indexed.
7. **Who approves L2–L3 self-improvements:** each user, or a maintainer? *Default: a maintainer, with results visible to users.*

## Appendix A: Where the current prototype stands against this definition

This is for orientation only; the definition above does not depend on it.

| Definition area | Exists today | Gap |
|---|---|---|
| Brief understanding (4.1 steps 1–2) | Brief upload (text, Markdown, PDF, DOCX); LLM requirement breakdown with MUST/SHOULD and stated/inferred markers | No clarifying questions, acceptance criteria or understanding check before research |
| Discovery (Web discovery role) | GitHub search with query planning, adaptive relaxation, de-duplication and ranking | GitHub only: no docs, package registries, Stack Overflow or articles |
| Repository intelligence and E2 grade | Clone, analysis passes, evidence gate binding claims to real files and lines | No tests or vulnerability analysis; licence not checked for compatibility |
| Grades E3–E5 | README assessments (E4) are labelled separately from verified code (E2) | No E1 (execution), no E3 (official docs) |
| Blueprint (5.2–5.4, 5.6) | In testing: reuse/adapt/build per requirement with cited sources; unsupported decisions downgraded; licence, maintenance and verification risks | Six-class taxonomy, full architecture, roadmap with acceptance criteria, uncertainty report |
| Memory (8) | Briefs, candidates, indexed repositories and evidence persist | No memory categories, freshness rules, cross-project reuse, or source reliability |
| Self-evolution (9) | — | No benchmark, feedback, metrics or promotion gate. Ranking weights are hand-tuned constants (the L1 candidates) |
| Autonomy and budgets (7) | Rate limits and job attempt limits | No per-project budgets, approval flow or build sandbox |
