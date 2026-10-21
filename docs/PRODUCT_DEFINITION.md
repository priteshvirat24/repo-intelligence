# Open Eye: Product Definition

**Status:** v2.0 draft, 2026-10-22. It replaces v1.0, which was approved on 2026-10-21. Appendix B lists what changed and why.

This document defines the finished product: what it must do, how it behaves on its own, and what evidence proves it works. It makes no technology choices. Every design, tool or component must trace back to a requirement here, written **[D§n]** in the other documents. Anything that cannot do so does not belong in the product (section 13). Decisions are cited as **[D§14.n]**, meaning decision n of section 14.

**The document set** (the planning artifacts A–J):

| Artifact | Document | Answers |
|---|---|---|
| A. Product definition | this document | What is the finished product, who is it for, how does it behave? |
| B. End-state architecture | [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md) | Which components, data flows and integrations meet these requirements? |
| C. Autonomy specification | [AUTONOMY_SPEC.md](AUTONOMY_SPEC.md) | What does it decide alone, when does it ask, how does it handle uncertainty and failure? |
| D. Memory specification | [MEMORY_SPEC.md](MEMORY_SPEC.md) | What is remembered, how is it retrieved, validated, shared and corrected? |
| E. Evolution specification | [EVOLUTION_SPEC.md](EVOLUTION_SPEC.md) | How does it measure itself, propose changes, test them and prevent regressions? |
| F. Research infrastructure strategy | [RESEARCH_STRATEGY.md](RESEARCH_STRATEGY.md) | How are sources found and fetched, which tool serves which source, how is evidence verified? |
| G. Evaluation plan | [EVALUATION_PLAN.md](EVALUATION_PLAN.md) | Benchmarks, baselines, thresholds, adversarial cases, release criteria |
| H. Technology decision record | [TECHNOLOGY_DECISIONS.md](TECHNOLOGY_DECISIONS.md) | Which technologies, on what evidence, and why the others were rejected |
| I. Delivery roadmap | [ROADMAP.md](ROADMAP.md) | Phases, dependencies, milestones and completion conditions from today to the end state |
| J. Final acceptance specification | [ACCEPTANCE.md](ACCEPTANCE.md) | The objective checklist that must be demonstrated before the product is complete |

---

## 1. The product

Open Eye is an **engineering intelligence system**. You give it one brief: what you want to build. It then does the rest.
- It works out what the product requires.
- It investigates what already exists across the relevant parts of the internet.
- It inspects and, where authorised, runs the most promising implementations.
- It decides what to reuse, adapt, replace or build.
- It designs how the pieces fit together.
- It delivers an evidence-backed engineering blueprint.
- When authorised, it builds and tests the implementation in isolation.

Every mission leaves validated knowledge and measured outcomes behind, and later missions use them to do better.

**It continuously answers five questions:**
1. What are we trying to achieve?
2. What already exists that can help us achieve it?
3. What is the strongest way to combine existing solutions?
4. What must we build or verify ourselves?
5. What can we learn from this mission to do better next time?

**Principles, in priority order:** research before building; verify before recommending; reuse before reinventing; test before claiming success; learn only from measured outcomes.

**Measure of value:** a team that starts from an Open Eye blueprint reaches a working system sooner, and with fewer wrong turns, than a team that starts from its own research. This must be shown by comparison, never asserted (section 12).

**Where its long-term advantage comes from:** accumulated, validated knowledge; high-quality retrieval; evidence-based decisions; reliable execution; and improvement that is controlled and measured. None of these comes from the number of agents, pages or tools.

## 2. Users and use cases

### 2.1 Personas

| Persona | Situation | What they need from Open Eye |
|---|---|---|
| **Builder** (primary): an engineer or tech lead starting a project | Has a brief, from one paragraph to a few pages, and little time to research | "Show me the best starting point, what I can reuse, how it fits, and what I still have to build, with proof." |
| **Returning team**: the same team on later projects | Has used Open Eye before | "Don't redo research we already did. Tell me what still holds and what has changed." |
| **Reviewer**: an architect, manager or client | Receives the deliverable | "Can I trust this? Show me what was verified, what was assumed and what was estimated." |
| **Maintainer**: whoever operates Open Eye for a team | Governs its configuration and evolution | "Show me what it proposes to change about itself, with the evidence. Let me approve, reject or roll back." |

### 2.2 Core use cases

| # | Use case | Starts from | Ends with |
|---|---|---|---|
| UC1 | Research a new product | A brief | A blueprint with a completion status |
| UC2 | Extend an existing system | A brief plus the user's repository | A blueprint that builds on the existing code, which Open Eye inspected first |
| UC3 | Decide between options | A brief naming candidates, or "X or Y?" | An evidence-backed comparison and a recommendation |
| UC4 | Build an authorised slice | An approved blueprint and a chosen scope | A reviewable change set with a test report |
| UC5 | Revisit a project | An earlier mission | What still holds, what has changed, and what was revalidated |
| UC6 | Reuse team knowledge | Any brief in a team workspace | Findings reused from other projects, where permitted, and revalidated |

### 2.3 System boundary

Open Eye owns the research and engineering process: understanding, investigation, inspection, verification, comparison, design, authorised implementation, testing and learning.

The user owns the goal, the constraints, approvals for consequential actions, credentials, and the decision to adopt or ship anything.

External systems (code hosts, registries, documentation sites, search providers, AI models, sandboxes) are sources and tools. They are never authorities: whatever they return is untrusted data (section 11).

### 2.4 What it is not

- **Not a crawler.** Pages fetched, repositories cloned and agents run are costs, not results. A long report or a large crawl is not success.
- **Not a chatbot over search results.** Its answers are decisions backed by graded evidence, not summaries of whatever it found.
- **Not a RAG application.** Retrieval is one internal capability. The products are the blueprint and the verified build.
- **Not a generic multi-agent workflow.** Roles exist only where they produce a checked output (section 5.10).
- **Not a way around access controls.** It never bypasses logins, paywalls, CAPTCHAs, rate limits or site restrictions, including by fingerprint evasion.
- **Not self-modifying.** It never changes its own code, permissions or security boundaries on its own judgement (section 10).

## 3. The end-state experience

### 3.1 One question

The product opens on one question: **What do you want to build?**

The user writes a brief in plain language, or uploads one. They may add any of these:
- an existing repository;
- reference links;
- a technology stack, or technologies to prefer or avoid;
- a budget and a deadline;
- deployment and infrastructure requirements;
- performance targets;
- a licence policy;
- other restrictions.

The user never chooses a search engine, crawler, agent, repository API, browser tool or memory mechanism. The workflow is Open Eye's job (section 5).

### 3.2 Workspaces

Each workspace exists to answer specific questions. Nothing appears in one without answering a question.

| Workspace | Questions it answers | Must show |
|---|---|---|
| **A. Mission** | What did I ask for, and what did Open Eye understand? Where is it, what has it decided, and what will it cost? | The structured specification; objectives; constraints; acceptance criteria; the active plan; stage and status; remaining work; budget used against each limit; major decisions with their reasons. Controls to change requirements, pause, resume, stop, or request deeper investigation. |
| **B. Live research** | What is running now, what has been found, what is still open? | Running and finished tasks; sources discovered; evidence collected; open questions. Each event is labelled **actual** (it happened), **planned** (scheduled) or **example** (illustrative). Planned and example items are never shown as done. |
| **C. Solution comparison** | Which candidates are strongest, and why this one over that one? | Candidates with graded capabilities, limitations, compatibility, maintenance, licence, security, cost and integration effort; the criteria and weights used for this brief; the trade-offs in words, not only a score; rejected candidates with the reason. |
| **D. Architecture** | How do the chosen parts fit? | Components and their responsibilities; reuse, adapt or new for each; dependencies; data flows; interfaces; integration order; the rationale and evidence behind every major choice, one click away. |
| **E. Deliverable** | What do I do now? | The engineering report (section 6); the roadmap; reusable components; code changes and test results when authorised; unresolved risks; the completion status; next actions. |
| **F. Memory and evolution** | What did Open Eye learn and reuse? What became stale? What did it change about itself, and did that help? | Findings reused, with their verification dates; findings that failed revalidation; lessons recorded; proposed improvements and their evaluation results; promotions, rejections and rollbacks. |

### 3.3 Interaction principles

- **Inspectable:** every recommendation opens to its evidence in one click, and every piece of evidence to its source location.
- **Honest about grade:** a README claim, an inference or an estimate is never shown with the weight of a verified fact.
- **Incremental:** changing a constraint, challenging a decision or excluding a source re-runs only what depends on it. The deliverable shows what changed and why.
- **Interruptible:** the user can pause, resume, redirect, narrow or stop a mission at any time. Partial results are kept and labelled partial.
- **Quiet:** the default view is results and decisions. Agent activity is available on request, never as decoration.

## 4. Mission lifecycle and completion status

A **mission** is one brief and everything done for it. A mission can be revised (section 3.3) and revisited later (UC5).

Every mission ends with exactly one **completion status**. The status is stated at the top of the deliverable, together with the stopping condition that produced it.

| Status | Meaning |
|---|---|
| **Complete** | The deliverable meets its own acceptance criteria: for a research mission, the report standard of section 6; for a build, its acceptance tests. Every requirement is classified with its evidence (section 5.6). A research mission is never Complete because of tests it did not run. |
| **Complete with gaps** | The deliverable is finished. Some requirements are unresolved (class 6), and each one states what evidence would resolve it. |
| **Partial** | A budget or time limit, or the user, stopped the mission. The deliverable covers what was reached and lists what was not. |
| **Blocked** | A decision only the user can make, or an unavailable external dependency, stops further progress. The deliverable says what is needed. |
| **Failed** | The mission could not produce a usable deliverable. It states why, and keeps whatever was learned. |

A build (UC4) has its own status inside the mission:
- **Succeeded:** all acceptance tests pass.
- **Needs review:** a change set exists, but some tests fail or are untested.
- **Failed:** nothing usable was produced.
- **Delivered:** the change set was handed over after approval.

Open Eye never reports a status better than the evidence supports.

## 5. The autonomous workflow

The workflow is adaptive. It is not a fixed pipeline. For each brief Open Eye selects **the simplest workflow that can satisfy it**. A narrow library question does not get the treatment of a new distributed system.

Any stage can send work back to an earlier stage when new evidence invalidates an earlier decision, and the deliverable records each reversal. Examples:
- a verified licence conflict;
- a failing integration test;
- a changed constraint;
- a finding that failed revalidation.

Each stage below states its purpose, what it must produce, and when it is finished. The autonomy rules for every stage are in [AUTONOMY_SPEC.md](AUTONOMY_SPEC.md).

### 5.1 Stage 1: Understand the brief

**Produces** a structured specification:
- desired outcomes;
- functional requirements, each marked MUST, SHOULD or NICE-TO-HAVE, and as stated or inferred;
- non-functional requirements;
- constraints and assumptions;
- existing assets and infrastructure;
- acceptance criteria for the finished product;
- unknowns to investigate;
- explicit exclusions and scope boundaries.

**Asks the user** only when a consequential ambiguity cannot reasonably be settled by research or by a clearly stated assumption: at most three questions, each saying why it matters. Only a question marked blocking holds research back. Otherwise research proceeds on the stated assumptions, and the user can correct any line later.

**Finished when** every requirement has acceptance criteria, and every assumption is either stated or confirmed.

### 5.2 Stage 2: Plan the investigation

**Produces** a research plan:
- the technical questions to answer;
- the candidate solution categories (library, framework, service, API, pattern, or a build from scratch);
- the source types to use;
- the evidence each decision needs;
- an expected cost.

Questions are ordered by four things:
- expected information gain;
- implementation impact;
- uncertainty reduced;
- cost.

The plan starts from memory (section 9): what is already known and still current is not researched again.

**Adaptive:** new findings re-plan the remaining work when that is justified. Examples: a category turns out to be dominated by one project; a candidate is abandoned; a requirement proves harder than expected. The plan in the Mission workspace always shows the current plan, and what changed in it and why.

**Finished when** every MUST requirement has at least one planned line of investigation within the budget. A plan that would exceed the mission budget needs approval.

### 5.3 Stage 3: Discover existing solutions

**Searches** the source types the plan selected:
- code hosts (repositories, code, issues, pull requests, releases);
- official documentation and API references;
- package registries with their dependency, licence and vulnerability data;
- technical Q&A and discussions;
- engineering articles and tutorials;
- research papers and benchmarks;
- other public implementations;
- commercial services and APIs where they fit the constraints.

**Rules:**
- Authoritative sources and direct implementation evidence come before repeated secondary descriptions.
- When the first strategy finds too little, Open Eye uses several independent strategies: different query formulations, category searches, registry search, and following dependents and alternatives.
- Popularity, search rank and recency are signals, never conclusions. The first popular result is not presumed best.

**Produces** candidates, each with the source links that found it, its retrieval time, and why it is relevant.

**Finished when** further discovery is unlikely to change a decision: recent searches added nothing that ranks among the candidates worth inspecting.

### 5.4 Stage 4: Inspect candidate implementations

For promising candidates, Open Eye inspects the implementation itself, not only its description:
- relevant source files and architecture;
- public interfaces;
- dependencies and installation requirements;
- tests and documentation;
- release history;
- licence;
- known issues.

**For each candidate it determines** whether the candidate:
- implements the required capability, or only describes it;
- offers reusable components, or is only a reference;
- fits the proposed architecture;
- has acceptable maintenance and security;
- duplicates or forks another candidate;
- brings unnecessary dependencies or operating costs;
- needs modification or extra infrastructure.

**When the project authorises execution,** critical claims are checked by running tests or a bounded example in an isolated environment.

Source inspection (E2) and successful execution (E1) are always distinguished (section 6.1).

**Finished when** every candidate on the shortlist has its capabilities graded against the requirements it is meant to cover.

### 5.5 Stage 5: Compare

Open Eye compares candidates against the brief's own requirements and constraints:
- functional coverage;
- correctness evidence;
- integration feasibility;
- maintainability and compatibility;
- licence;
- security;
- performance;
- operating cost;
- complexity.

**Criteria and weights fit the brief.** Each comparison states the criteria and weights it used.

**Trade-offs are written out,** not hidden behind a single number.

**The output is the strongest viable combination.** That can be a single project, several complementary ones, a commercial API, a hybrid, or a fully custom build when the evidence supports it.

### 5.6 Stage 6: Gap analysis

This is the decision point between research and engineering. Every requirement gets exactly one class, with its evidence and reasoning:

| Class | Meaning | Evidence it needs |
|---|---|---|
| 1. Available and verified | A candidate meets it as it is | E1 or E2 about that requirement, from that candidate |
| 2. Available, needs configuration | It is met once configured | E1–E3, with the configuration identified |
| 3. Available, needs integration | It is met once connected to other components | E1–E3, with the glue work identified |
| 4. Partly available, needs modification | A candidate covers most of it | E1–E3 for the covered part; the change or the uncovered part is named |
| 5. Not covered, must be built | Nothing adequate exists | The searches that were done are recorded |
| 6. Unresolved | The evidence is insufficient or conflicting, or an external dependency is pending | States what evidence would resolve it |

Classes 1 to 4 can never rest on E4 or E5 evidence alone. A claim-only match is class 6, or goes back for more investigation.

### 5.7 Stage 7: Design

**Produces** a concrete architecture:
- component boundaries and responsibilities;
- what is reused, adapted or new;
- data flows, APIs and data contracts;
- dependencies with verified versions;
- storage;
- execution environments;
- authentication and permissions;
- failure handling and observability;
- deployment;
- the testing strategy.

**Also produces** an ordered implementation roadmap. Each task has:
- dependencies;
- acceptance criteria and test requirements;
- risks and mitigations;
- complexity and uncertainty, labelled as estimates.

Every requirement in class 2 or higher has at least one task.

### 5.8 Stage 8: Execute (build mode, only when authorised)

**Uses** the approved plan to create or modify software in an isolated environment, following these rules:
- Inspect the existing code before changing it.
- Keep changes reviewable.
- Test the integration points.
- Never replace a working component without a stated reason.

**When a test fails,** Open Eye diagnoses which of five causes applies before acting:
1. the implementation is wrong;
2. a dependency is incompatible;
3. the environment is at fault;
4. the test is inadequate;
5. an original assumption was wrong.

A wrong assumption sends work back to research or design. The other causes are fixed within the iteration budget where they can be. When they cannot be fixed there (no compatible version exists, the sandbox itself is broken), the cause is reported. If it changes the plan, the work goes back to design.

**Never claims completion** while required behaviour is untested or broken.

### 5.9 Stage 9: Evaluate and learn

**Compares** the result against the acceptance criteria and sets the completion status (section 4).

**Records** in memory, according to the admission rules in section 9:
- which decisions were right or wrong;
- how each tool performed;
- integration results;
- source reliability;
- resources spent;
- unresolved issues.

**Feeds** the evolution loop (section 10).

**Ends** with an auditable deliverable.

### 5.10 Roles and task contracts

These are logical responsibilities. They are not a commitment to one model, agent or service per role:
- mission planner;
- research strategist;
- discovery;
- crawling and extraction;
- repository analysis;
- dependency and compatibility analysis;
- technical evaluation;
- architecture;
- integration planning;
- implementation;
- testing and verification;
- memory curation;
- evolution evaluation.

The orchestrator uses **the fewest roles a task needs**. It runs independent investigations in parallel and dependent decisions in sequence.

**Every task has a contract,** set out in full in [AUTONOMY_SPEC.md](AUTONOMY_SPEC.md):
- an objective;
- its inputs;
- an output schema;
- the evidence required;
- a bounded budget;
- a completion condition;
- a failure and escalation policy.

**Shared state, not private copies:**
- Roles read and write one shared project state.
- A role checks shared state and memory before doing work that may already exist.
- A role never accepts another role's claim above its stated grade.
- Conflicting results are reconciled through evidence, or reported as uncertainty.
- Delegation depth, retries and parallelism are bounded. Re-delegating without new information is not allowed.

## 6. Deliverable standard

### 6.1 Evidence grades

Every factual claim carries one grade: the highest it actually achieved, never the one hoped for.

| Grade | Meaning |
|---|---|
| **E1: Executed** | Observed by running code in an isolated environment; the command, output and environment are attached |
| **E2: Verified in code** | Found in the source at a specific file, lines and commit |
| **E3: Officially documented** | Stated in the project's own docs, API reference or release notes, with the quote and URL; or recorded by an authoritative source for that kind of fact, such as a package registry for licence and versions, or a vulnerability database for advisories |
| **E4: Claimed** | A README, article, forum answer or marketing claim not yet checked |
| **E5: Inferred** | Open Eye's own reasoning from other evidence |

Licence, maintenance activity, vulnerabilities and version compatibility are facts and are graded like any other claim.

Four kinds of statement are labelled as what they are and never graded as facts:
- recommendations;
- assumptions;
- estimates;
- unverified statements.

### 6.2 The engineering report

Every research mission delivers a report with these sixteen sections, whatever its completion status. A Partial, Blocked or Failed mission fills the sections it reached. A section with nothing to report says so, and says why.

1. **Executive recommendation:** the strategy, the strongest building blocks, the main challenges, the top three risks, and the decisions needing a human.
2. **Requirements and assumptions:** the specification from stage 1, with any corrections the user made.
3. **Existing solutions and source inventory:** every candidate considered, each with:
   - the version or commit examined;
   - graded capabilities;
   - reusable modules, with their locations;
   - an action: reuse, adapt, investigate or reject, with the reason.

   Rejected candidates stay listed.
4. **Comparison of the strongest candidates:** the criteria, the weights and the written trade-offs (stage 5).
5. **Build-versus-reuse analysis:** the six classes, one per requirement, with evidence (stage 6).
6. **Recommended architecture:** components, responsibilities, data flows, interfaces, storage, auth, failure handling, deployment. Rejected alternatives are listed with the reason.
7. **Component integration map:** which component connects to which, through what interface, in what order.
8. **Dependencies, versions and compatibility:** verified findings only. Anything unverified is labelled.
9. **Installation and configuration guidance:**
   - prerequisites, install steps and configuration;
   - environment variable *names*, never values;
   - each step cites its evidence and is marked executed or not.
10. **Implementation roadmap:** ordered tasks with dependencies, risks and estimates (stage 7).
11. **Acceptance criteria and test plan:** for the product, and for each roadmap task.
12. **Security, licensing and operational risks:** vulnerabilities with advisory ids, licence conflicts with the policy, maintenance and operating risks, each with a mitigation.
13. **Evidence and source citations:** every factual claim resolves to a numbered source with its grade.
14. **Unresolved questions and uncertainty:**
   - conflicting evidence;
   - stale findings;
   - incomplete research, with what was not searched and why;
   - unverified claims the plan depends on.
15. **Expected costs and complexity:** estimates, with their assumptions.
16. **Completion status and next actions:** the status (section 4), the stopping condition, and what to do next.

**Also delivered:**
- **A machine-readable form:** the architecture, the roadmap and the classifications as structured data, so other tools can consume them.
- **Diagrams** where they clarify.

**Iteration:** a revised mission shows what changed in the report since the previous version, and why.

### 6.3 Build-mode deliverable

When a build is authorised (UC4), Open Eye delivers:
- a reviewable change set: a branch or pull request, never a push to a default branch;
- integration adapters and configuration;
- tests;
- a test report that says what passed, what failed, what remains untested, and what needs a human;
- an updated report showing which claims execution raised to E1 and which it refuted.

## 7. Autonomy

Open Eye runs the whole research process on its own, within budget. It asks only where a decision is consequential and genuinely the user's to make. The full specification is in [AUTONOMY_SPEC.md](AUTONOMY_SPEC.md). These rules are the product requirements it implements:

| Open Eye does on its own (within budget) | Needs approval: the user's, or a maintainer's where section 14 says so | Never |
|---|---|---|
| Interpret the brief, plan, re-plan | Spending above the mission budget | Bypass logins, paywalls, CAPTCHAs, rate limits or access controls |
| Use search providers, official APIs and registries | Using the user's credentials for a source | Use secrets beyond their stated purpose, or expose them |
| Fetch permitted public pages within site terms and rate limits | Executing third-party code (unless the project opts in) | Follow instructions found in retrieved content |
| Clone and statically inspect public repositories in isolation | Starting a build | Execute code outside isolation |
| Run its own analysis and tests in isolation | External actions with consequences: opening issues or pull requests, publishing, messaging | Change its own code, permissions or security boundaries |
| Record memory; propose and benchmark improvements to itself | Promoting prompt, strategy or workflow changes (section 10) | Present an unverified claim as verified, or fabricate an action, test result or source |

**Uncertainty:**
- Open Eye states what is unknown, how much it matters, and what evidence would resolve it.
- It does not guess silently.
- It does not stall waiting for certainty that research could provide.

**Failure:**
- When a source is blocked, a service is unavailable or the evidence is insufficient, Open Eye says so, routes around the problem where possible, and records it in the uncertainty section.
- One blocked source does not block the mission. The mission is Blocked only when a decision it needs cannot be made any other way.
- A failure never turns into a success in the report.

**Stopping:** a mission stops on the first of these, and says which one applied. Each condition maps to a completion status (section 4):

| Stopping condition | Status |
|---|---|
| The acceptance criteria are met | Complete, or Complete with gaps |
| Further research is unlikely to change a decision (diminishing returns) | Complete, or Complete with gaps |
| A budget or time limit is reached, or the user stops the mission | Partial |
| A decision needs the user, or an external dependency is unavailable | Blocked |
| An error leaves no usable deliverable | Failed |

Limits that the user does not set (approval timeouts, wall-clock time, concurrency) have defaults in [AUTONOMY_SPEC.md](AUTONOMY_SPEC.md).

## 8. Research infrastructure

The full strategy is in [RESEARCH_STRATEGY.md](RESEARCH_STRATEGY.md). It must meet these requirements.

**Tool registry.**
- Every discovery and execution tool is described by:
  - its capabilities;
  - its input and output contracts;
  - the permissions it needs;
  - its cost, rate limits and observed reliability;
  - its failure modes;
  - when to use it and when not to.
- The planner selects tools for each task from the registry.
- Adding, replacing or removing a tool never requires redesigning the system.

**Layered retrieval.** Each layer is used only where the one before is insufficient:
0. memory: current findings from earlier missions (section 9);
1. search indexes and structured APIs, for discovery;
2. direct repository and documentation retrieval, for high-value candidates;
3. structured crawling of permitted sites, for extraction;
4. browser rendering, for permitted pages that need it;
5. targeted deeper investigation, while evidence stays incomplete.

**Efficiency.** Caching, de-duplication, incremental retrieval, concurrency limits and source-aware scheduling are required. The aim is enough reliable evidence for the right decision, not the most pages.

**Access.**
- Site terms, robots directives, rate limits, authentication boundaries, copyright and software licences are respected.
- Browser technology renders pages; it never grants permission.
- A sign-in wall is reported as blocked, not worked around.

**Tool adoption.** No tool is adopted because it exists. Each candidate tool is evaluated for capability, limitations, licence, operating cost, integration effort and maintenance burden, and the decision is recorded in [TECHNOLOGY_DECISIONS.md](TECHNOLOGY_DECISIONS.md).

## 9. Memory

Memory is a core capability, not conversation history. The full specification is in [MEMORY_SPEC.md](MEMORY_SPEC.md).

### 9.1 Layers

| Layer | One record is | Shared with |
|---|---|---|
| **Project** | A brief, requirements, decisions with reasons, architecture, progress, open problems | The project's members |
| **Technical knowledge** (semantic) | A graded finding about a repository, library, framework, API, pattern or integration, at a version or commit | Everyone, when it concerns public resources; the workspace, when it concerns private ones |
| **Episodic** | What was attempted in a mission, which tools were used, what failed, and how it was resolved | The project's members. Lessons distilled from episodes, with no project content, are shared with the workspace. |
| **Procedural** | A validated workflow, implementation recipe, debugging procedure or research strategy, with the evidence that it works | The workspace, or everyone when it was learned from public evaluations |
| **Source and evidence** | Provenance, timestamps, versions, confidence, source reliability and freshness rules for every finding | Follows the finding it describes |
| **Team** | Validated knowledge reusable across a workspace's projects, without exposing private project details | The workspace's members. Across workspaces, only findings about public resources are shared (decision 11). |
| **Evolution** | Proposed changes to Open Eye, their evaluations, approvals, deployments, regressions and rollbacks | Maintainers; visible to users |

### 9.2 Rules

- **Admission by utility:** a record is kept only when its reliability, provenance and likely future relevance justify it. Not every page or model response is stored.
- **Required metadata:** every record carries:
  - provenance;
  - a timestamp;
  - a grade or confidence;
  - its scope;
  - a revalidation rule.
- **Retrieval:** memory supports both structured queries and semantic retrieval. It also keeps the relationships between projects, requirements, components, decisions, evidence and outcomes.
- **Merging and versioning:** duplicates merge into one record with all their provenances. Superseded records are versioned, never silently overwritten.
- **Freshness:** a finding past its rule is shown as "last verified on …", and is revalidated before a decision depends on it.
- **Applicability:** a remembered lesson carries the context it was learned in: language, framework version, environment. Before reuse, Open Eye checks that the context still matches. A lesson is never generalised beyond the context it was learned in.
- **Explicit reuse:** the report says which findings came from memory, when they were verified, and whether this mission revalidated them.
- **Correction:** users can see why something is in memory, and correct or delete it. A correction reaches every project that relied on the record.
- **Access control and audit:** private project information never leaves its scope. Every read and write that affects a decision is auditable.

## 10. Self-evolution

Self-evolution means **measured improvement** in Open Eye's ability to research, decide, plan and verify. It does not mean unbounded self-modification. The full specification is in [EVOLUTION_SPEC.md](EVOLUTION_SPEC.md).

### 10.1 Kinds of adaptation

Each kind has its own bar for adoption.

| Level | What changes | Adopted when |
|---|---|---|
| **L0: Memory** | Facts, episodes, procedures | Facts and episodes automatically, under the admission and validation rules of section 9. A procedure becomes active only after measured success **and** a maintainer's approval, because it changes how later missions behave. |
| **L1: Adaptive configuration** | Ranking weights, thresholds, source priors, learned preferences | Automatically, if it beats the baseline beyond noise with no guard regression. Logged and reversible. |
| **L2: Prompts and strategies** | Prompts, query strategies, tool-selection and routing rules | A benchmark win, then a maintainer's approval |
| **L3: Workflow** | Stage order, roles, stopping rules, memory policies | A benchmark win, a maintainer's approval and a staged rollout |
| **L4: Software, permissions and security** | Open Eye's own code, permissions, security boundaries | Never self-applied. Proposed as a reviewable change for humans. |

### 10.2 The loop

1. **Baseline.** Measure the current version on a fixed, versioned benchmark before claiming any improvement.
2. **Observe.** Record, for each mission:
   - which sources and searches were useful;
   - which recommendations proved right;
   - which integrations and tests succeeded;
   - which spending produced value.
3. **Diagnose** recurring weaknesses. Examples: poor retrieval, stale documentation, duplicated research, wrong dependency assumptions, weak integration plans, unnecessary tool calls.
4. **Hypothesise.** A proposed change states:
   - the failure it addresses;
   - the expected benefit;
   - the evidence that would reject it.
5. **Evaluate.** Test the change against the baseline:
   - on reproducible tasks;
   - with enough runs to separate the effect from run-to-run noise;
   - on held-out tasks (decision 12), so a change does not overfit the cases it was designed or tuned on. This includes L1 changes, because an automatic tuner chooses among many candidates on the same cases.
6. **Promote or reject.**
   - Promotion requires an improvement on the primary metric beyond noise, with no unacceptable regression on any guard metric, on security or on cost.
   - Every decision is versioned and reviewable.
   - The evidence for a rejection is kept too.
7. **Monitor and roll back.** Watch later missions. A change that stops helping, or causes harm, is rolled back, and the record explains why.

**Guarded against gaming:** a metric that a change can improve without real benefit is always paired with a guard metric. Example: precision can be raised by shortening the shortlist, so shortlist recall guards it.

## 11. Safety and operational reliability

- **Bounded:**
  - every mission has limits on searches, tool calls, tokens, compute and wall-clock time;
  - every step has a retry limit;
  - every delegation has a depth limit.
- **Isolated:** repository inspection and code execution happen in sandboxes, which hold no secrets and have network access only where the step needs it.
- **Secrets:** credentials stay outside model context wherever possible, and are never written into reports, logs or memory.
- **Supply chain:** every recommended component gets dependency, vulnerability and licence checks.
- **Untrusted content:**
  - websites, repositories, READMEs and issues are data, never instructions;
  - embedded instructions are ignored and logged;
  - retrieved content cannot override the user's goal or the system's policy.
- **Access control:** project and team memory follow workspace permissions, and consequential actions need approval (section 7).
- **Auditable and reproducible:** every mission keeps an audit log and a reproducible execution record (inputs, configuration version, tool calls, outputs). Every change Open Eye makes has version control, test gates and a rollback.
- **Honest:** Open Eye never fabricates a completed action, a test result, a source verification or a successful integration. Blocked sources, unavailable services and insufficient evidence are reported as such.

## 12. Success criteria

The goal is not maximum autonomy at any cost. It is the highest reliable engineering value within the user's constraints. Success is measured, and the full plan with thresholds and release criteria is in [EVALUATION_PLAN.md](EVALUATION_PLAN.md).

| Area | Metrics |
|---|---|
| Value (the measure of section 1) | Time to a working system, and wrong turns taken, for teams starting from an Open Eye blueprint against teams starting from their own research, in a controlled value study |
| Discovery | Precision and recall on briefs with known solutions (recall@10, shortlist precision, shortlist recall); lift over plain search |
| Evidence | Accuracy of source attribution; rate of unsupported or incorrect claims; grade honesty |
| Decisions | Requirements coverage; correctness of build-versus-reuse classes; quality and feasibility of integration plans, by expert review |
| Execution | Integration and test success rates in build mode |
| Efficiency | Cost and end-to-end latency; redundant retrieval and unnecessary tool use |
| Memory | Usefulness of retrieved memory (research avoided); stale-memory error rate |
| Evolution | Regression rate after changes; measured improvement against a fixed baseline |

**The benchmark** contains:
- representative real briefs across domains, with known solutions labelled independently;
- adversarial cases: missing documentation, abandoned repositories, conflicting sources, incompatible dependencies, misleading project descriptions, and look-alike traps;
- build tasks with acceptance tests;
- every observed failure, kept as a regression case.

Cases are added over time but never removed to improve the numbers.

**No superiority claim without evidence.** Open Eye is never described as better than manual research or other tools unless a comparative evaluation shows it.

## 13. Scope and decision discipline

- **Every component justifies itself.** No agent, database, vector store, framework, browser, crawler, model or service is added because it is available. Each must serve a requirement in this document.
- **Smallest coherent architecture.** Prefer the least machinery that meets the end-state requirements and still allows extension.
- **Essential before optional.** The planner separates essential requirements from optional enhancements. Scope growth never displaces the original objective.
- **Honest limits.** When a capability cannot be delivered reliably, Open Eye says so and proposes the strongest feasible alternative.

## 14. Decisions

**Carried over from v1.0** (approved 2026-10-21):
1. **Setting:** team workspaces with shared technical memory and per-project privacy.
2. **Release order:** research first; build mode once evidence correctness and classification accuracy meet their targets.
3. **Default budget:** set from measured cost on the benchmark.
4. **Third-party code execution:** per-project opt-in.
5. **Licence policy default:** copyleft allowed and flagged, overridable per project.
6. **Browser research:** for rendering permitted pages only, never for getting past restrictions.
7. **L2–L3 approval:** a maintainer, with results visible to users.

**New in v2.0** (proposed defaults in *italics*):

8. **Requirement classes:** adopt the six classes of section 5.6. They split "configuration" from "integration" and merge "modification" with "partly available". *Default: adopt; migrate existing blueprints; have people relabel the benchmark's class labels, because the old class 2 splits into two classes and cannot be mapped automatically.*
9. **Who governs Open Eye's configuration:** *Default: maintainers of the operator workspace. Personal workspaces never govern global configuration.*
10. **Who may opt a project into execution:** *Default: project maintainers only.*
11. **Sharing across a team:** *Default: findings about public resources are shared; private project content, episodes and procedures stay in the workspace unless a maintainer shares them.*
12. **Held-out evaluation:** *Default: a held-out set, never used to design or tune changes, confirms every promotion from L1 to L3. It holds at least 5 briefs now, growing to a quarter of the benchmark as the suite grows. Until it is large enough to show a gain, it can only veto a change, never prove one.*
13. **Commercial services in recommendations:** *Default: allowed when they fit the constraints, always alongside the best open alternative and its cost.*
14. **Stealth browser in the scraper (conflict to resolve):** the scraper engine sends a fixed list of domains straight to the Camoufox stealth browser (linkedin.com, twitter.com, x.com, bloomberg.com, wsj.com, medium.com). It also switches any page to it when the site answers 403, 429 or a bot challenge. That uses fingerprint evasion to get past a site's bot protection and rate limits, which section 2.4 and decision 6 exclude. *Default: remove the named-site routing and the escalation on 403, 429 and challenge pages now. Treat those responses as blocked (section 7). Replace Camoufox with a standard headless browser that identifies itself, used only for rendering ([TECHNOLOGY_DECISIONS.md](TECHNOLOGY_DECISIONS.md) TD-09).*

## Appendix A: Where the built system stands (2026-10-22)

For orientation only; this definition does not depend on it. The objective checklist is in [ACCEPTANCE.md](ACCEPTANCE.md).

| Area | Built and measured | Main gaps to the end state |
|---|---|---|
| Experience (3) | Briefs page, brief workspace with run timeline, understanding, budget, candidates and blueprint; `/memory`, `/evolution`, `/evaluation`; the repository Studio at `/` (questions over indexed repositories) | No single mission workspace with pause and resume; actual, planned and example events are not labelled; excluding a source is not built; the Studio sits outside the six workspaces |
| Brief understanding (5.1) | Structured specification, acceptance criteria, at most 3 questions with a blocking flag, research proceeds on assumptions | Existing-asset (repository) intake for UC2; exclusions as a field |
| Planning (5.2) | Query planning by kind of tool; memory read before research; diminishing-returns stop | No explicit research plan with expected information gain; no re-planning on findings |
| Discovery (5.3) | GitHub, npm, crates.io, deps.dev, OSV, Stack Exchange and Tavily through a gateway with budget and cache; an arXiv connector exists but no task calls it yet; the scraper escalates to a stealth browser (decision 14) | No GitHub code or issue search, no commercial-service discovery; dependents and alternatives are not followed |
| Inspection (5.4) | Clone, analysis passes, evidence gate (E2); partial analysis of large repositories; docs evidence (E3); opt-in sandbox E1 checks | E1 only for npm and PyPI packages; duplicate and fork detection is basic |
| Comparison (5.5) | Ranking with health, relevance and coverage; inventory actions | No brief-specific criteria and weights shown; no written comparison section |
| Gap analysis (5.6) | Six classes enforced against evidence (v1 taxonomy) | Migrate to the v2 classes (decision 8) |
| Design and report (5.7, 6.2) | Architecture, integration guide, roadmap, uncertainty report, executive recommendation | No integration map, test plan or cost section; no machine-readable export; 16-section structure not yet complete |
| Build mode (5.8, 6.3) | Sandboxed bounded coding loop, test report, diff, pull request after approval | Failure diagnosis is not classified into the five causes; not run end to end on a real build |
| Completion status (4) | Run statuses (completed, stopped, failed, awaiting input) | The five mission statuses and their rules |
| Memory (9) | Semantic claims with revalidation; episodes; procedures with activation; source reliability; audit and correction UI | Applicability checks by context; admission policy; team sharing controls; embedding retrieval; deleting single records; one workspace's refutation changes a global claim for everyone |
| Evolution (10) | Feedback; stored ranking features; gated L1 tuner (with a shortlist-recall guard); L2 proposals; rollback; history UI | No held-out set; the 3-run unpaired gate passed a change that did nothing (needs more runs); labels are a draft by one labeller |
| Evaluation (12) | Suite of 15 briefs with draft labels; record and replay; baselines B0 and B1; current recall@10 0.30–0.34 | Independent labels; adversarial and build cases; evidence-correctness audit; the gate still accepts 3 runs per side; the measured cost covers only understanding and discovery (about 4 AI calls per brief), so no full mission is costed yet (decision 3); no value study |
| Safety (11) | Budgets enforced; untrusted-content tagging; sandbox with no secrets; approvals for builds and delivery | Sign-in not enforced on the public deployment; any member can switch on execution or raise a budget (no role check on the brief update route, against decision 10); no wall-clock or compute limit per mission; no full audit log view |

## Appendix B: Changes from v1.0

- **The planning artifacts:** the ten artifacts A–J and their documents; autonomy, memory, evolution, research, evaluation, technology, roadmap and acceptance now each have their own specification.
- **Personas and boundary:** a maintainer persona; use cases UC1–UC6; an explicit system boundary.
- **Workspaces:** six workspaces, replacing ten surfaces, with actual, planned and example events always told apart.
- **Mission statuses:** a mission lifecycle with five completion statuses, plus build statuses.
- **Workflow:** written as nine stages, each with an output and a finish condition. It adds an adaptive research plan ordered by information gain, the simplest-workflow rule, the five causes of a failed test, and task contracts.
- **Requirement classes:** revised as decision 8.
- **Deliverable:** the report standard grows to sixteen sections, plus a machine-readable form.
- **Memory:** now seven layers (adding episodic, procedural and team), with admission by utility, applicability checks and access control.
- **Evolution:** each hypothesis must state what would reject it; held-out evaluation; metrics guarded against gaming (learned from the first tuning pass).
- **Discipline and claims:** scope and decision discipline is its own section, and no superiority claim may be made without comparative evidence.
