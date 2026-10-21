# Open Eye: Research Strategy

**Status:** v1.0 draft, 2026-10-22. Derived from PRODUCT_DEFINITION.md v2.0.

This is artifact F. It says how sources are found and fetched, which tool serves which source type, how crawling is kept under control, and how evidence is verified. It implements the requirements of **[D§8]** and serves stages 2 to 4 **[D§5.2–5.4]**. The technologies named here are chosen, with their evidence, in [TECHNOLOGY_DECISIONS.md](TECHNOLOGY_DECISIONS.md) (cited as **TD-n**).

It describes the end state. Where the built system differs, section 10 says so and cites the files. Facts about external services are stated only as far as the code, its documentation or widely known stable facts support them; anything else is marked *to verify*.

Contents:
1. [Principles](#1-principles)
2. [Tool registry](#2-tool-registry)
3. [Source types and tools](#3-source-types-and-tools)
4. [Layered retrieval](#4-layered-retrieval)
5. [Planning by information gain](#5-planning-by-information-gain)
6. [Discovery strategies](#6-discovery-strategies)
7. [Crawl control](#7-crawl-control)
8. [Evidence verification](#8-evidence-verification)
9. [Known weakness: retrieval misses](#9-known-weakness-retrieval-misses)
10. [Current state against this strategy](#10-current-state-against-this-strategy)

---

## 1. Principles

- **Evidence, not volume.** Pages fetched and repositories cloned are costs **[D§2.4]**. Every retrieval step must be able to change a decision, or it is not run **[D§8 efficiency]**.
- **Cheapest sufficient layer first.** Structured APIs before pages, pages before browsers, browsers only where a permitted page needs rendering **[D§8 layered retrieval]**.
- **Authoritative before secondary.** The project's own code, docs and registry entries come before articles and forum posts that describe it **[D§5.3]**.
- **Several independent strategies.** When one strategy finds too little, others are tried, each with its own trigger (section 6) **[D§5.3]**.
- **Signals are not conclusions.** Stars, downloads, search rank and recency rank candidates; they never grade a capability **[D§5.3]**.
- **Access is never forced.** Robots directives, site terms, rate limits and sign-in walls are respected. A blocked source is reported as blocked **[D§2.4, D§7, D§8 access]**.
- **Retrieved content is data.** It never instructs the system **[D§11]**.

## 2. Tool registry

### 2.1 The record

Every discovery and execution tool has one registry record **[D§8 tool registry]**. The planner selects tools by what the record says (source type, grade it can produce, cost, reliability), never by name. Adding, replacing or removing a tool is a new record, a connector behind the gateway contract, a decision in TECHNOLOGY_DECISIONS and one benchmark run. Nothing else changes.

| Field | Meaning |
|---|---|
| `id`, `status` | Stable name; `in use`, `registered, unused`, `planned`, `candidate` or `rejected` |
| `source_types` | Which source types of [D§5.3] it serves (section 3) |
| `capabilities` | `search`, `fetch`, `metadata`, `verify`, `execute` |
| `input` | The request it accepts: query and filters, a resource reference (`github:owner/repo`, `npm:name`), or a URL |
| `output` | `Candidate` (reference, title, URL, snippet, signals, provenance), `Document` (content, hash, retrieval time, access basis, flagged instructions), or claim specs with evidence |
| `max_grade` | The highest evidence grade its output can support on its own (section 8) |
| `access_basis` | `official_api`, `public_page` or `rendered_public_page` |
| `permissions` | Keys it needs, whether user credentials are ever involved (never by default), network egress, and the execution opt-in |
| `cost` | Unit (request, search credit, page, token, sandbox second) and where the price comes from |
| `rate_limit`, `pacing` | The source's published limit, and the minimum interval the gateway enforces |
| `cache_ttl` | How long a response stays valid (section 7.1) |
| `reliability` | Measured: success rate, blocked rate, cache-hit rate, and **yield** (share of results that became a shortlisted candidate or a kept claim). Taken from the ledger and source reliability memory **[D§9.1]** |
| `failure_modes` | How it fails and how that surfaces: unavailable, rate limited, blocked by policy, sign-in wall, invalid output |
| `use_when`, `do_not_use_when` | Selection rules the planner applies |
| `decision` | The TD record that adopted, kept or rejected it |

**Observed reliability** is not measured per tool yet (section 10). Until it is, the planner uses the priors in section 5 and the record shows "not measured", never a guessed figure.

### 2.2 Capabilities and contracts

| Tool | Status | Capabilities | Input → output | Max grade |
|---|---|---|---|---|
| GitHub REST: repository search | in use | search | 2–4 keywords, stars floor → repositories with stars, licence, push date, topics | signals only |
| GitHub REST: repository, README | in use | metadata, fetch | `owner/repo` → metadata; README text | E3 (platform metadata), E4 (README) |
| GitHub REST: contents | planned | fetch | `owner/repo`, path, ref → one file at a commit | E2 |
| GitHub code search | planned | search | identifier or API name, language → files in repositories | signals; E2 after location check |
| GitHub issue and PR search | planned | search | repository, terms → issues and pull requests | E4 (known issues, maintainer statements) |
| git clone, shallow | in use | fetch | repository URL → working tree at one commit | E2 (via the evidence gate) |
| git clone, sparse partial | in use | fetch | repository URL, focus terms → selected directories at one commit | E2, marked partial |
| git clone, full history | planned | fetch | repository URL → full history | E2 for history questions (release cadence, blame) |
| deps.dev | in use | metadata | `github:owner/repo` or package → licence, Scorecard, packages, versions, advisories | E3 (see 8.5) |
| OSV.dev | in use | verify | ecosystem, package, version → advisories | E3 (see 8.5) |
| npm registry | in use | search, metadata | keywords → packages with repository link | signals; E3 for package metadata |
| crates.io | in use | search, metadata | keywords → crates with repository link | signals; E3 for crate metadata |
| PyPI JSON API | in use (resolution only) | metadata | package name → metadata, version, project URLs | E3 for package metadata |
| Stack Exchange | in use | search | package term → questions with score and answers | E4 |
| Tavily | in use | search | query, optional domain list → URLs with snippets | signals; nominates pages |
| arXiv | registered, unused | search | keywords → papers with abstract | E4 (a paper's claim) |
| Semantic Scholar | planned | search, metadata | keywords or paper id → papers, citations | E4 |
| Docs fetcher (plain HTTP) | in use | fetch | public URL → page text with headings | E3 (via quote check) |
| Firecrawl | in use (web app only) | fetch | URL → Markdown | E3 (via quote check) |
| Browser tier: Scrapling with Camoufox | in use (optional); to be replaced (TD-09) | fetch | URL → rendered Markdown, links | E3 (via quote check) |
| Scrapy | candidate | crawl | start URL, allowed domain → many pages | E3 (via quote check) |
| Playwright with a stock browser | candidate replacement for the browser tier (TD-09) | fetch | URL → rendered page | E3 (via quote check) |
| Docker sandbox | in use (local) | execute | files, commands, limits → exit code, output | E1 |
| E2B sandbox | in use (hosted, not yet run live) | execute | files, commands, limits → exit code, output | E1 |

### 2.3 Operations

| Tool | Permissions | Cost | Rate limit and pacing | Failure modes |
|---|---|---|---|---|
| GitHub REST and search | `GITHUB_TOKEN` (optional, raises limits) | Free | Search: 30/min with token, 10/min without; the runner waits 2.1 s or 6.5 s. Core REST 5,000/h with token *to verify per token type* | 403 with zero remaining or 429 → rate limited, retried later; 422 → query rejected, others continue |
| GitHub code search | Token required | Free | Lower than repository search (*to verify*: 10/min) | Same as above |
| git clone | Network egress to the code host | Bandwidth, disk | Size cap `MAX_REPOSITORY_SIZE_MB` (100); larger repositories get a sparse partial clone | Not found, private, too large, timeout |
| deps.dev, OSV | None | Free, open data (CC-BY 4.0) | No published limit; no pacing | Project unknown (404); unavailable |
| npm | None | Free | Unpublished (*to verify*); no pacing | Unavailable |
| crates.io | None | Free | 1 request/s with an identifying User-Agent (crawler policy); paced at 1 s | Unavailable |
| PyPI JSON API | None | Free | Unpublished (*to verify*) | Not found |
| Stack Exchange | `STACKEXCHANGE_KEY` (optional) | Free | 300 requests/day per IP without a key, 10,000 with; honour `backoff` | Quota exhausted (error 502) |
| Tavily | `TAVILY_API_KEY` | Paid per search (price *to verify*) | Per plan (*to verify*) | Not configured; unavailable |
| arXiv | None | Free | 1 request per 3 s (API terms); paced at 3 s | Unreadable feed |
| Semantic Scholar | Optional key | Free | Shared public limit without a key (*to verify*) | — |
| Docs fetcher | None | Free | Paced at 1 s per connector (should be per host, section 7.4); robots.txt checked | Blocked by SSRF guard or robots; not a text page; 404 |
| Firecrawl | `FIRECRAWL_API_KEY` | Paid per page (credits, *to verify*) | Per plan | Not configured; unavailable |
| Browser tier | `WORKER_SCRAPER_URL`, `SCRAPER_SECRET` beyond loopback | Compute: a browser per page | 2 concurrent sessions (`SCRAPER_MAX_CONCURRENCY`); crawl ≤ 10 pages, same site | `AUTH_REQUIRED`; blocked address; timeout; render failure |
| Docker sandbox | Docker daemon on the host; per-project execution opt-in | Local compute | CPU, memory, process and time caps | Daemon unreachable → execution unavailable |
| E2B sandbox | `E2B_API_KEY`; per-project opt-in | Paid per sandbox time (*to verify*) | Per plan | Not configured; network cannot be switched off after creation (recorded) |

### 2.4 When to use each tool

| Tool | Use when | Do not use when |
|---|---|---|
| GitHub repository search | Finding implementations by kind of tool | Searching for features inside a tool (implementation details match small repositories, see section 9) |
| GitHub code search | A requirement names a specific identifier, format or protocol (SGP4, PMTiles, an API symbol) | General capability questions |
| GitHub issue search | Checking known problems, maintenance state or a claim a maintainer made | As evidence that a feature works |
| Shallow clone | Inspecting a shortlisted candidate (E2) | Before the candidate is shortlisted; for single-file checks (use contents) |
| Sparse partial clone | Shortlisted repository over the size limit | When the relevant directories cannot be identified (record it as partial, untested) |
| deps.dev, OSV | Licence, packages, versions, Scorecard, advisories of a candidate | Discovery by keyword (they do not search by capability) |
| npm, crates.io | The brief or query names their ecosystem | Python, Go, Java briefs (no fit) |
| PyPI JSON API | Resolving a Python package to its repository and version | Discovery: PyPI has no search API |
| Stack Exchange | Integration problems and gotchas for a shortlisted package | Ranking candidates, or grading capabilities |
| Tavily | Pages on a project's own docs site; comparisons and alternatives (S4) | Fetching page content for evidence (fetch the page itself) |
| arXiv, Semantic Scholar | The brief needs an algorithm or a benchmark | Ordinary library and tool selection |
| Docs fetcher | Any permitted public docs page | Pages behind sign-in; pages disallowed by robots.txt |
| Browser tier | A permitted page that answered but has no content without JavaScript | A page that refused access (401, 403, 429, challenge page): that is blocked, not a rendering problem |
| Docker, E2B | Raising a critical E2 or E3 claim to E1 in an opted-in project | Any project without the opt-in; any code that needs secrets |

## 3. Source types and tools

Preference order within each row: the first tool that can answer is used; later ones only when it cannot.

| Source type [D§5.3] | Tools, in preference order | Grades they can yield |
|---|---|---|
| Code hosts: repositories, code, issues, pull requests, releases | 1. GitHub repository search; 2. GitHub code search; 3. GitHub REST metadata and contents; 4. shallow or sparse clone; 5. GitHub issue and PR search | E2 (code), E3 (platform metadata, release notes), E4 (issues) |
| Official documentation and API references | 1. the docs site linked by the project's own metadata; 2. Tavily restricted to that site; 3. docs fetcher; 4. browser rendering where needed | E3 |
| Package registries with dependency, licence and vulnerability data | 1. deps.dev; 2. OSV; 3. npm, crates.io, PyPI for search and resolution | E3 |
| Technical Q&A and discussions | 1. Stack Exchange; 2. GitHub issues and discussions | E4 |
| Engineering articles and tutorials | 1. Tavily; 2. docs fetcher | E4; they nominate candidates (S4) |
| Research papers and benchmarks | 1. arXiv; 2. Semantic Scholar (planned) | E4 |
| Other public implementations | 1. GitHub code search; 2. curated lists and links from strong candidates (S6) | Candidates; E2 after inspection |
| Commercial services and APIs | 1. Tavily for the vendor's own docs and pricing pages; 2. docs fetcher | E3 for documented features and prices; E4 for marketing claims |

## 4. Layered retrieval

Each layer is used only where the one before is insufficient **[D§8]**. Layer 0 is memory, because the plan starts from it **[D§5.2]**.

| Layer | Used for | Enter when | Leave when |
|---|---|---|---|
| 0. Memory | Known candidates and current findings | Always first | Findings are current and cover the question: the question is answered without research (recorded as research avoided). Otherwise go to layer 1 for what is missing |
| 1. Search indexes and structured APIs | Discovery; registry, licence and advisory facts | A question has no current answer in memory | Further searches add no candidate that ranks among those worth inspecting (section 5.4); the candidates go to layer 2 |
| 2. Direct repository and documentation retrieval | Shortlisted candidates: clone, README, docs homepage, registry entries | A candidate is shortlisted, or a decision depends on it | Every requirement the candidate is meant to cover has a graded claim, or the source is blocked or unavailable (recorded) |
| 3. Structured crawling of permitted sites | More pages of the same docs site when the first pages do not settle a requirement | Layer 2 read the docs homepage and searched pages, a MUST requirement is still E4 or unresolved for a shortlisted candidate, and robots.txt permits it | A quote settles it, the page cap is reached, or the site has no more relevant pages |
| 4. Browser rendering | A permitted page that returned no content without JavaScript | A page answered (2xx) but its text is empty or only a script shell | The page is rendered, or it turns out to need sign-in (`AUTH_REQUIRED`, blocked) |
| 5. Targeted deeper investigation | A decision that is still open: code search, issue search, execution (E1), or the user's "investigate deeper" | A MUST requirement is class 6, evidence conflicts, or a critical claim needs E1 | The decision is settled, the evidence is shown to be unavailable, or the budget for the question is spent |

A refusal (401, 403, 429, a challenge page, a sign-in wall) never moves a request to a higher layer. It ends that source for this request and is reported (section 7.5).

## 5. Planning by information gain

### 5.1 The research plan

Stage 2 produces a plan of **questions**, each linked to the requirements it bears on, the decision it informs (a requirement's class, the choice between candidates, a risk) and the evidence grade that decision needs **[D§5.2, D§5.6]**. Each question has candidate **steps**: one tool call or one task (a query, a fetch, an inspection, an execution check). The plan shows its expected cost against the budget, and changes to it are recorded with a reason **[D§5.2 adaptive]**.

### 5.2 Scoring

Each step *s* for question *q* gets a score; steps run in descending score order, and independent steps run in parallel within the concurrency limits.

**score(s) = I(q) × U(q) × G(s, q) / C(s)**

| Factor [D§5.2] | Definition | Source of the number |
|---|---|---|
| **I**: implementation impact | Criticality weight of the requirements *q* bears on (MUST 1.0, SHOULD 0.6, NICE-TO-HAVE 0.3), times 1.0 when the answer can change a class or the chosen candidate, 0.5 when it changes only a risk or an estimate | Specification and plan |
| **U**: uncertainty reduced | How open the decision is now: 1.0 with no candidate; 0.8 with only E4 or E5 evidence, or with conflicting evidence; 0.4 with E3; 0.1 with E1 or E2 for that requirement | Claims in shared state |
| **G**: expected information gain | Probability that step *s* yields evidence at or above the grade *q* needs | Measured yield per tool and question kind (section 2.1), from source reliability and strategy records **[D§9.1]**; fixed priors until measured |
| **C**: cost | Expected calls, tokens and seconds for the step, from ledger means for that tool and operation, divided by the remaining mission budget | Ledger |

The weights and priors are L1 configuration; the formula and the question kinds are L2 **[D§10.1]**. Both change only through the evaluation gate.

### 5.3 Re-planning

Scores are recomputed after every completed task. A finding re-plans the remaining work when it changes I, U or G for open questions. Examples **[D§5.2]**:
- a category is dominated by one project: alternatives in it lose G;
- a candidate is abandoned (no push in two years) or archived: questions about it lose I;
- a requirement proves harder: its unanswered questions gain U and may enter layer 5;
- a source is blocked: its steps lose G, and steps on other sources for the same question are added.

### 5.4 Diminishing returns

- **Per requirement:** further discovery for a requirement stops when its last *k* steps (default 3) added no candidate that entered the inspection set and raised no claim's grade. A requirement not yet searched always gets its first query.
- **Per mission:** the mission stops on diminishing returns when the best remaining step score is below a threshold θ, or the last *k* research tasks changed no decision and raised no grade **[D§7 stopping]**. The deliverable states this as the stopping condition, with the open questions it left.
- **Measured:** the current per-query rule (3 consecutive queries with no new candidate of health ≥ 0.5) skipped none of 341 planned queries on suite-v1 (`eval/results/suite-v1/DECISIONS.md`, `cfg-66b9cecdb37a`). It has not yet shown either a saving or a loss. θ and *k* are tuned under the gate with shortlist recall as the guard.

## 6. Discovery strategies

Strategies are independent ways to reach candidates **[D§5.3]**. Each has a trigger; none runs because it exists. Every candidate records the strategies and queries that found it, so evaluation can measure each strategy's yield.

| # | Strategy | What it does | Triggered when | Guard |
|---|---|---|---|---|
| S0 | Memory and procedures | Remembered candidates; active learned query procedures shown to the planner | Always, first | Revalidate before a decision depends on them **[D§9.2]** |
| S1 | Kind-of-tool queries | 2–3 words naming the kind of tool plus the ecosystem ("job queue node") | Always, for every MUST capability and the product as a whole | Trap rejection; the 730-day staleness rule keeps abandoned repositories off the shortlist |
| S2 | Reformulation | Synonyms, a broader or neighbouring category, without the ecosystem word, or the product-level name | A query returns fewer than 5 distinct repositories, or none with health ≥ 0.5, or assessment finds no candidate covering the requirement | Counts toward the per-requirement stop |
| S3 | Category search | GitHub topic search and stars order within the category; registry keyword search | Results for a requirement are dominated by low-adoption repositories, or no candidate is above the adoption floor | Stars order is used only inside a correct category: stars order on title terms alone (B0s) gained nothing on suite-v1 |
| S4 | Web search for comparisons and alternatives | "open source *kind of tool* *ecosystem*", "*candidate* alternatives"; repository and package links in the results are resolved through GitHub and deps.dev | S1 to S3 leave a MUST requirement with no candidate in the inspection set; and always once for the product as a whole | Pages nominate candidates only; they are E4 and never grade a capability |
| S5 | Registry search | npm and crates.io by ecosystem; packages resolved to their source repository | The brief or query names an ecosystem with a searchable registry | New repositories fetched from registries are capped (12 per run) |
| S6 | Dependents, successors and alternatives | From a strong candidate: successor or deprecation pointers in its README or registry entry; "alternatives" and comparison pages in its docs; links in curated lists that matched; same-organisation packages; dependents (deps.dev, *to verify which endpoints exist*) | A candidate is shortlisted (successor pointers always); a category has fewer than 3 viable candidates (alternatives) | Followed links are candidates, not evidence |
| S7 | Code search | Files that implement a named identifier, format or protocol | A requirement names one, and S1 found no implementation of it | Location check before any E2 claim |

**Order:** S0, then S1 with S5, then S2 to S4 and S6 by score (section 5.2), then S7. A strategy is promoted to run earlier only through the evaluation gate **[D§10.1 L2]**.

## 7. Crawl control

### 7.1 Caching

Every external response is cached by a hash of tool, method, URL, sorted parameters and body, with credentials removed. A cached response keeps its original retrieval time, so provenance shows when the world was observed, not when the cache was read.

| Tool | TTL | Why |
|---|---|---|
| OSV | 6 hours | Advisories are published continuously; "no known vulnerabilities" must stay honest |
| deps.dev, npm, crates.io | 24 hours | Package metadata changes with releases |
| Tavily, Stack Exchange, docs pages | 3 days | Slow-changing; search results are nominations |
| arXiv | 7 days | Paper metadata rarely changes |
| GitHub search and metadata | 1 hour (to set; not cached today) | Rankings and push dates change daily |
| Clones | Not cached; keyed by commit | A commit is immutable: the analysis is reused by commit, not by time |

Cache TTLs govern responses. Freshness of *findings* is separate and follows the revalidation rules of memory **[D§9.2]**.

### 7.2 De-duplication

- **Requests:** identical requests within a TTL are served from the cache.
- **Candidates:** one candidate per canonical repository (lower-case full name, renamed repositories under their current name), with every query, strategy and registry that found it. Mirrors, forks and profile repositories are marked and not inspected separately.
- **Packages:** a package counts for a repository only when its registry metadata points back to that repository.
- **Claims:** one claim per subject, kind and normalised statement; a repeat finding adds evidence to it **[D§9.2 merging]**.

### 7.3 Incremental retrieval

- A task re-runs only when its input fingerprint changes (run graph).
- Revalidation compares the stored commit or release with the current one first. An unchanged source keeps its claims; a changed one marks its E2 and E3 claims for re-check.
- A requirement the workspace researched recently, with enough remembered candidates, is not searched again (current rule: 7 days, at least 3 candidates).

### 7.4 Concurrency and pacing

- **Per host, not per tool:** pacing applies to the host being contacted, at the source's published limit, or 1 request per second for pages without one.
- **Concurrency:** at most one request in flight per host; bounded browser sessions (2 by default); bounded parallel tasks per mission **[D§11 bounded]**.
- **Rate-limit responses:** a 429, a `Retry-After` header or a Stack Exchange `backoff` field pauses that source for at least the stated time. The request is never retried through another tool or a browser to get round the limit.
- **Size and time caps:** responses over 8 MB, more than 5 redirects, and fetches past their deadline are refused.

### 7.5 Robots, terms and access

- **Official APIs first.** A registry or code host is used through its API, never by scraping its website.
- **robots.txt** is checked for every page under the agent name `OpenEyeBot`. 404 means no rules; 401 or 403 means the site is closed to crawlers; a 5xx or 429 on robots.txt postpones the site (treated as disallowed until it answers).
- **Identification:** requests carry an identifying User-Agent with a contact URL. The browser tier must do the same (*to verify* what it sends today).
- **Terms notes** in each registry record (crates.io crawler policy, arXiv terms, Stack Exchange attribution) are applied as pacing and attribution rules.
- **Blocked, not bypassed.** A sign-in wall, paywall, CAPTCHA, challenge page or 401, 403 or 429 is reported as `blocked` with its reason, never indexed, and never escalated to the browser tier. Browser technology renders pages; it never grants permission **[D§8 access, D§14.6]**.
- **Reporting:** blocked and unavailable sources appear in the report's uncertainty section (section 14) **[D§6.2, D§7 failure]**.
- **Copyright and licences:** only the passages needed as evidence are kept as quotes; whole pages live only in the cache until their TTL. Inspected code is analysed, never copied into deliverables beyond evidence quotes.

## 8. Evidence verification

### 8.1 How each grade is established

| Grade [D§6.1] | Established by | Checked by | Rejected when |
|---|---|---|---|
| **E1** Executed | A bounded check run in a sandbox (8.4) | Exit code, output and environment attached; command and pinned version recorded | The check could not run (inconclusive) or failed (refuting evidence) |
| **E2** Verified in code | The evidence gate on a cloned repository (8.2) | File, lines and commit resolve to the quote or symbol | The quote is not in the file, or the symbol has no definition |
| **E3** Officially documented | A quote from the project's own docs (8.3), or a fact from an official registry (8.5) | Quote located in the fetched page, on the project's own site | The quote is not in the page, or the page is not the project's own |
| **E4** Claimed | README, article, forum post, paper | Source URL and retrieval time recorded | — (recorded as claimed, never shown as verified) |
| **E5** Inferred | Open Eye's reasoning | The claims it was inferred from are linked | It cites no claims |

A claim's grade is the highest its evidence supports. Raising a grade needs new evidence from that grade's mechanism. A model's answer never raises a grade on its own: every grade above E4 rests on a mechanical check.

### 8.2 E2: code location

- The model proposes evidence (file, quote or symbol) for a capability. The gate then requires the **whole quote** to occur in the file, ignoring only case and whitespace, with at least 16 non-whitespace characters. Short quotes prove nothing.
- When the quote is not found, a named **symbol definition** is resolved in the repository instead (qualified names must match).
- Otherwise the evidence is rejected. A capability with no verified evidence is not stored **[D§11 honest]**.
- The locator is file, start and end line, and the commit of the clone. A partial (sparse) analysis is labelled partial.

### 8.3 E3: quote verification and the own-domain rule

- **Own domain:** the docs site must be linked by the project's own metadata: its GitHub homepage field, then its deps.dev homepage. Code hosts, registries, social, Q&A and package CDN hosts are never "the project's docs". On shared docs hosts (docs.rs) the site is the project's path; a `*.github.io` site is its exact host.
- **Same site after redirects:** the final URL of every fetched page must still be on that site.
- **Quote check:** the model may only point at a passage and copy a span. The span must occur in that passage of the fetched page (case and whitespace ignored), with at least 20 characters and 4 words.
- **Locator:** URL, section heading and the page's content hash.
- **Not E3:** roadmap items, third-party plugins and mere mentions of a topic (the prompt says so; the quote check cannot, so a sample is audited **[D§12 evidence]**).

### 8.4 E1: sandbox evidence

- Only in projects that opted in **[D§14.4, D§14.10]**.
- Only for a package whose registry metadata points back to the same repository, installed at a pinned version.
- A generated check uses only the public API named in the claim. It is untrusted code and runs only in the sandbox: no secrets, network only while installing, then off where the provider allows; when it cannot be switched off (E2B), that is recorded with the result.
- Exit 0 raises the claim to E1 with the run attached. A failure adds refuting evidence; an install failure or timeout adds inconclusive evidence. Neither lowers or hides the claim.

### 8.5 Registry and advisory facts

Licence, maintenance (Scorecard) and vulnerability facts come from deps.dev and OSV and are graded E3, with the advisory ids and source URL. A licence also has a stronger source: the licence file at the inspected commit, which is E2 and is preferred when present. These databases are authoritative third-party data, not the project's own documentation, and [D§6.1] does not say how such facts are graded. E3 is used until the product definition settles it.

### 8.6 Reconciling conflicts

Conflicts are never settled silently **[D§5.10 shared state]**. The rules, in order:
1. **Different versions** are not a conflict: each claim holds for its version, and the decision uses the version it recommends.
2. **A mechanical check beats a statement** about the same version: a failing E1 check on an E2 or E3 behaviour claim marks it refuted, and it cannot support classes 1 to 4.
3. **Same grade, opposite content** (GitHub and deps.dev disagree on a licence): a conflicting-evidence item. The requirement or risk stays class 6, or in the uncertainty section, until a higher-grade source settles it.
4. **Official beats secondary:** E3 docs beat an E4 forum answer; the forum answer is kept as a possible known issue.
5. **Fresh beats remembered:** a revalidated finding supersedes the memory record, which is versioned, not overwritten **[D§9.2]**.

### 8.7 Untrusted content and prompt injection

- **Marking:** everything a tool returns is marked untrusted. Prompts carry it only inside named untrusted blocks, and every prompt says that text there is data.
- **Detection:** instruction-like text (requests to ignore instructions, role changes, fake system tags) is flagged and logged with its source **[D§11]**. Flagged docs passages are never shown to the model.
- **Schema validation:** model output is accepted only in the expected schema, naming only known requirements, candidates and passages. Anything else is dropped.
- **Grounding:** every grade above E4 rests on a mechanical check against the source (8.2–8.4). Injected text cannot create a verified claim, because the claim must be found in code or quoted from the project's own site.
- **No authority:** retrieved content cannot add tools, change budgets or permissions, fetch a URL outside the SSRF guard, or change the user's goal. Agent loops have a fixed tool list.
- **No secrets in context:** keys travel in headers, never in prompts, cache keys, recorded snapshots or logs.

## 9. Known weakness: retrieval misses

**What was measured** (`eval/results/suite-v1/DECISIONS.md`, `BASELINE.md`; draft labels, one labeller):
- Recall@10 rose from 0.111 to 0.341 when the planner switched to kind-of-tool queries. But recall over *all kept* candidates is only 0.415: most essential solutions never enter the candidate pool at all.
- The L1 tuner re-ranked stored runs under 298 rankings and found no gain beyond noise. **Ranking is not the bottleneck; retrieval is.**
- Many misses are the established projects of their category: Cesium, LangChain, Grafana and Loki, Airflow, Celery, Docusaurus, Debezium. One brief (PR review bot) is at zero in every system.
- In the plain-search baseline, every essential hit came from the web-search half, not from GitHub search.

**Likely cause (E5, a hypothesis to test):** repository search matches query words against names, descriptions, topics and READMEs. Established projects describe themselves in their own terms ("observability platform", not "log pipeline"), so 15 best-match results fill with small repositories that use the query's words.

**What the strategy does about it:**
1. **Measure retrieval apart from ranking.** Report pool recall per brief and per strategy, and which strategy found each essential solution (section 6).
2. **Add the strategies the measurement points to:** web search for comparisons and alternatives (S4), category search (S3), and successors and alternatives from strong candidates (S6). Each is an L2 candidate, evaluated with at least five runs per side, because the three-run gate accepted a change that did nothing.
3. **Turn on registry search in the harness**, so its contribution is measured (it is off unless `--registries` is passed).
4. **Guard the trade-off.** Finding the right category also finds its traps (`category-queries` shortlisted an abandoned queue in every run). Trap rejection and shortlist recall stay guard metrics for every retrieval change.

## 10. Current state against this strategy

| Area | Built (files) | Gap to this strategy |
|---|---|---|
| Tool registry | `connectors/registry.py` declares id, provider, source type, access basis, official hosts, TTL, interval and terms | No input/output contract, permissions, cost, reliability or use rules in the record; GitHub, clone, sandboxes and the web app's Firecrawl are outside it; the planner does not select tools from it |
| Gateway | `connectors/gateway.py`: cache, ledger, SSRF check on non-official hosts and redirects, pacing, size cap, instruction flagging | GitHub clients (`discovery/github_search.py`, `github/client.py`) and the PyPI and npm lookups in `execution.py` bypass it: no cache, and `github/client.py` is not metered |
| Research plan | `discovery/planner.py` plans up to 8 kind-of-tool queries (plus focus extras) | No questions, no information-gain scores, no re-planning on findings |
| Diminishing returns | `discovery/runner.py` per-query rule | Not per question or per mission; skipped nothing on suite-v1 |
| Strategies | S0 (`memory/`), S1, S5 (`discovery/registry_search.py`); S2 only as relaxation (two words, then no stars floor) | S3, S4, S6, S7 missing; curated lists are down-ranked but their links are not followed |
| Docs evidence | `docs_evidence.py`: own-domain rule, Tavily site search, at most 3 pages, quote check, deps.dev, OSV, Stack Exchange | No layer 3 crawl beyond 3 pages |
| Papers | `connectors/arxiv.py` registered | Not called by any task; Semantic Scholar absent |
| Pacing | Per connector id | Docs pacing is per connector, not per host |
| robots.txt | `connectors/docs.py`, `scraper/api.py` | A 5xx or 429 on robots.txt is treated as "no rules" instead of postponing |
| Browser tier | `scraper/engine.py`: SSRF checks, `AUTH_REQUIRED` detection, same-site robots-aware crawl, 2 sessions | **Escalates to the stealth browser on 403, 429, 999 and challenge pages, and sends listed sites (LinkedIn, X, Bloomberg, WSJ, Medium) straight to it.** That conflicts with section 7.5 and [D§2.4, D§14.6]; TD-09 replaces the engine with a standard headless browser |
| E2 | `analyzer/evidence.py` evidence gate; `github/clone.py` shallow and sparse | — |
| E1 | `execution.py`, `sandbox/docker.py`, `sandbox/e2b.py` | npm and PyPI packages only; E2B not yet run against the live service |
| Conflicts | Licence conflict claim in `docs_evidence.py` | Rules 1, 2, 4, 5 of 8.6 are not applied; refuting E1 evidence does not yet block classes 1–4 |
| Licence E2 | — | The licence file at the commit is not read as evidence |
| Reliability | `Gateway.stats` per process; `source_stats` (90-day half-life) | Not persisted per tool; yield not computed; not used by planning |
| Web app ingestion | `apps/web/lib/adapters/web.ts`: Firecrawl, then Scrapling | Runs in the web app, outside the worker gateway and its ledger |
