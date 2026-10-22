# Open Eye: Technology Decisions

**Status:** v1.0 draft, 2026-10-22. Derived from PRODUCT_DEFINITION.md v2.0.

This is artifact H. It records which technology serves each major component, the evidence behind the choice, what was rejected and why, and what would make a decision worth revisiting. No tool is adopted because it exists **[D§8 tool adoption, D§13]**. Each decision traces to a requirement, cited as **[D§n]**. How the research tools are used is in [RESEARCH_STRATEGY.md](RESEARCH_STRATEGY.md) (cited as **RS§n**).

Evidence is graded honestly. "Measured" means a number from this codebase or its evaluation runs (`eval/results/suite-v1/`). Facts about external products are stated only as far as the code, its documentation or widely known stable facts support them; anything else is marked *to verify*.

## 1. Decision format

Every decision has these fields.

| Field | Content |
|---|---|
| **Context** | The requirement it serves and the constraint that shapes it |
| **Options** | The candidates considered, each with its main strength and weakness |
| **Evidence** | What was measured or observed here, with file or run references |
| **Decision** | What was chosen |
| **Consequences** | What the choice costs or commits us to |
| **Status** | `accepted`, `rejected` or `pending` (a candidate not yet decided) |
| **Revisit when** | The observable trigger that reopens it. A decision without a trigger is not revisited on preference |

A decision changes only through a new entry that supersedes the old one, with its own evidence.

## 2. Summary

| ID | Component | Decision | Status |
|---|---|---|---|
| TD-01 | System of record | PostgreSQL with pgvector | accepted |
| TD-02 | Orchestration | Own run graph on PostgreSQL | accepted |
| TD-03 | Workers | Python | accepted |
| TD-04 | Web app | Next.js | accepted |
| TD-05 | LLM provider and routing | Provider-agnostic interface; Mistral `ministral-8b-latest` for now | accepted (interim); stronger-model routing pending |
| TD-06 | Embeddings | `mistral-embed`, 1024 dimensions | accepted |
| TD-07 | Web search | Tavily behind the connector contract | accepted |
| TD-08 | Single-page extraction | Firecrawl in the web app only; plain HTTP in the research path | accepted (web app); rejected (research path) |
| TD-09 | Browser rendering | Scrapling with Camoufox, the stealth browser, kept as a core tier | accepted: decision 14 |
| TD-10 | Site crawling | Scrapy not adopted; bounded crawl over the gateway first | pending |
| TD-11 | Package and vulnerability data | deps.dev and OSV.dev | accepted |
| TD-12 | Code host access | GitHub REST and git (shallow, sparse) | accepted; code and issue search pending |
| TD-13 | Sandbox | Docker locally, E2B hosted; Firecracker rejected for now | accepted; E2B unverified live |
| TD-14 | Authentication | Auth.js with GitHub sign-in | accepted |
| TD-15 | Hosting | Railway, upload deploys | accepted |
| TD-16 | Object storage | None yet | pending |
| TD-17 | Separate vector store | Not used | rejected |
| TD-18 | Connector gateway and record/replay | Own gateway and HTTP transport | accepted |

## 3. Decisions

### TD-01 System of record: PostgreSQL with pgvector
**Status:** accepted.
- **Context:** tasks, claims, evidence, decisions, memory, the ledger and configuration versions are one shared project state **[D§5.10]**. They must be joined, scoped by workspace, versioned and audited **[D§9.2, D§11]**, and memory needs both structured and semantic retrieval **[D§9.2 retrieval]**.
- **Options:** PostgreSQL with pgvector (one transactional store, relational and vector); PostgreSQL plus a vector database (TD-17); a document store (claims, evidence and decisions reference each other and need joins and foreign keys); SQLite (one writer; the workers are separate processes on separate hosts).
- **Evidence:** migrations `001`–`014` hold all of it in one database: tasks, claims, `connector_cache`, `provider_usage` (ledger), memory, evolution and build mode. HNSW indexes on `chunks` and `knowledge_objects` (`002`, `003`); full-text search through generated `tsvector` columns (`003`, `005`); task claiming with `FOR UPDATE SKIP LOCKED` (`orchestrator/store.py`).
- **Decision:** keep PostgreSQL with pgvector as the only system of record.
- **Consequences:** one store to back up and migrate; migrations run before every web deploy (`railway.json`). Cached response bodies also live here (`connector_cache`), so its size must be watched (TD-16).
- **Revisit when:** vector count or memory-recall latency exceeds what one instance serves, or `connector_cache` dominates the database size.

### TD-02 Orchestration: own run graph on PostgreSQL
**Status:** accepted.
- **Context:** missions run for minutes to hours, survive deploys, wait for a person, re-run only what a change affects, and stop on budget **[D§3.3 incremental, D§4, D§7, D§11 bounded]**.
- **Options:**

| Option | For | Against |
|---|---|---|
| Own run graph on PostgreSQL | No new service; dependency-precise invalidation; state is relational and auditable | We own the scheduler and its bugs |
| LangGraph | Checkpointed state graphs; human-in-the-loop interrupts | State is one checkpoint per run, so recomputation by dependency and relational evidence are still ours |
| Temporal | Strongest durable execution | A cluster (server and persistence) or a hosted plan to run; recomputation still ours |
| Celery | Mature retries and task chains | Needs a broker (Redis or RabbitMQ); no waiting-for-a-person state; no invalidation; state would still live in PostgreSQL |

- **Evidence:** `orchestrator/graph.py` defines 7 task types (`understand`, `recall`, `discover`, `verify`, `docs`, `execute`, `blueprint`) with input fingerprints and downstream invalidation; `orchestrator/store.py` claims tasks with `SKIP LOCKED` and heartbeats. The cost of owning it is real: long jobs lost their heartbeat until commit `2e3c6d1`.
- **Decision:** keep the run graph. Agent frameworks stay an option inside a single task, never at run level.
- **Consequences:** scheduler, retries and stale-lock recovery are our code and need tests.
- **Revisit when:** task wait time or lock contention becomes a measured bottleneck; workflows span several services; or a task's loop needs branching or sub-agents (then LangGraph inside that task first).

### TD-03 Workers: Python
**Status:** accepted.
- **Context:** discovery, inspection, verification and execution run as background tasks **[D§5.3–5.4]**.
- **Options:** Python for all pipeline work; TypeScript workers sharing code with the web app; the current split.
- **Evidence:** the analyser (tree-sitter grammars), evidence gate, discovery, connectors, scraper (Scrapling is a Python library), sandbox adapters and evaluation harness are Python. The tree-sitter set is pinned because `tree-sitter` 0.26.0 crashes with the TypeScript 0.23.2 grammar (`requirements.txt`). Web-page ingestion still runs in the web app in TypeScript (`apps/web/lib/adapters/web.ts`).
- **Decision:** Python for all pipeline work.
- **Consequences:** the remaining web-app ingestion moves to workers, so it goes through the gateway and survives deploys.
- **Revisit when:** no trigger planned.

### TD-04 Web app: Next.js
**Status:** accepted.
- **Context:** the six workspaces, approvals and live status **[D§3.2]**; the web app writes requests and reads state, and never runs pipeline work.
- **Options:** Next.js (in production); a separate single-page app plus an API server (more services, no gain).
- **Evidence:** `next` ^14.2.24; API routes for briefs, claims, memory, evolution, evaluation and feedback exist under `apps/web/app/api/`.
- **Decision:** keep Next.js.
- **Consequences:** none new.
- **Revisit when:** live status needs push updates the current routes cannot serve.

### TD-05 LLM provider and model routing
**Status:** accepted as an interim choice; routing to a stronger model is pending.
- **Context:** planning, README assessment, docs quote selection and blueprint writing need structured output; every call is metered and budgeted **[D§11]**; model choice is L2 configuration, decided by the benchmark **[D§10.1]**.
- **Options:** `ministral-8b-latest` everywhere (current); a stronger model for planning, assessment and blueprint; one strong model everywhere (highest cost).
- **Evidence:**
  - `providers/llm.py`: Mistral and OpenAI providers behind one interface; every call goes to the ledger; output cut off at the length limit is refused.
  - The free tier on the current key serves only `ministral-8b` and `ministral-3b`; `mistral-small` and `mistral-medium` return 429, `mistral-large` returns 403.
  - Measured on suite-v1 (15 briefs, `ministral-8b-latest`): about 60 calls, 206k input and 38k output tokens per run, 58–70 s per brief. Cost is "not priced" because `LLM_PRICES_JSON` is unset.
  - Failures traced to the small model: broken JSON on long answers (fixed with one compact retry), and look-alike traps accepted from READMEs (`EleutherAI/lm-evaluation-harness`, `OptimalBits/bull`).
  - Routing keys `models.discovery` and `models.blueprint` exist (`tuning.py`) with no value. SYSTEM_DESIGN §12 names Claude models as defaults, but no Anthropic provider exists in the code.
- **Decision:** keep the provider interface and run on `ministral-8b-latest` until a paid key exists. Then route a task to a stronger model only if it wins on the suite beyond noise, with at least five runs per side: the three-run gate once passed a change that did nothing (`DECISIONS.md`).
- **Consequences:** the cost guard works in calls and tokens, not money, until prices are configured. Output is prompt-only JSON plus validators; schema-constrained output is adopted where the chosen provider supports it.
- **Revisit when:** a paid key is available; or trap rejection stays below target after retrieval improves.

### TD-06 Embeddings: mistral-embed
**Status:** accepted.
- **Context:** semantic retrieval over repository chunks and memory **[D§9.2 retrieval]**.
- **Options:** `mistral-embed` (1024 dimensions, free tier); OpenAI `text-embedding-3-*` shortened to 1024 dimensions (supported in `providers/embeddings.py`).
- **Evidence:** web app and worker must use the same provider; `EMBEDDING_DIMENSIONS` must match the vector column created by the migrations (`.env.example`, `002`). Embedding retrieval over memory is not built yet (D Appendix A), so no retrieval measurement exists.
- **Decision:** keep `mistral-embed`.
- **Consequences:** changing the model means re-embedding every stored vector.
- **Revisit when:** a retrieval change wins on the suite, or a memory-retrieval evaluation shows embedding quality is the limit.

### TD-07 Web search: Tavily
**Status:** accepted.
- **Context:** finding pages on a project's own docs site, and comparisons and alternatives during discovery **[D§5.3; RS§6 S4]**.
- **Options:** Tavily (integrated); Exa, Brave Search, Serper (not evaluated, *to verify* capabilities and price); no web search.
- **Evidence:** `connectors/tavily.py` with domain restriction, used by `docs_evidence.py` for same-site docs search; key sent in a header, never in a cache key or snapshot. In the plain-search baseline, every essential hit came from the web-search half (`DECISIONS.md`). Web search is not used in discovery today.
- **Decision:** keep Tavily behind the connector contract, and add discovery strategy S4 through it.
- **Consequences:** paid per search (*to verify* price); without `TAVILY_API_KEY` only the linked docs homepage is read.
- **Revisit when:** S4 is measured and web-search recall or cost is the limiting factor; then compare an alternative on the recorded suite.

### TD-08 Single-page extraction: Firecrawl
**Status:** accepted for user-added web resources in the web app; rejected for the research path.
- **Context:** reading permitted pages as text, with headings kept so a quote can be located by section **[D§6.1 E3]**.
- **Options:** Firecrawl (hosted API, paid per page, *to verify* price; a self-hostable version exists, licence *to verify*); the gateway's docs fetcher (plain HTTP and HTML to text); the browser tier (TD-09).
- **Evidence:** Firecrawl is called only by the web app (`apps/web/lib/providers/firecrawl.ts`, first tier in `adapters/web.ts`), outside the worker gateway; `FIRECRAWL_API_KEY` is not in `.env.example`. The research path reads docs with `connectors/docs.py`, which honours robots.txt, checks every URL and redirect, and is cached and replayable.
- **Decision:** the research path uses the docs fetcher. Firecrawl stays for user-added web resources until that ingestion moves to the workers (TD-03).
- **Consequences:** one fetch path for evidence, with one set of cache, ledger, access and replay rules.
- **Revisit when:** measured E3 yield is lost because plain HTTP misses page content, and the browser tier cannot recover it within budget.

### TD-09 Browser rendering: Scrapling with Camoufox, the stealth browser
**Status:** accepted on 2026-10-21 by product decision; confirmed by the owner on 2026-10-22 as a core part of research (decision 14, [PRODUCT_DEFINITION.md](PRODUCT_DEFINITION.md) §14).
- **Context:** layer 4 renders pages that need JavaScript and reads public pages that turn away automated clients **[D§8 layered retrieval, D§14.14]**. It never gets past a login, a paywall, a CAPTCHA or a rate limit **[D§2.4, D§8 access, D§14.6]**.
- **Options:**

| Option | For | Against |
|---|---|---|
| Scrapling with Camoufox | Deployed; fast HTTP tier first, browser second, in one time budget; reads public pages that block standard browsers | Heavy image; some listed sites forbid automated access in their terms (risk the owner accepts) |
| Playwright with a stock browser | Widely used; also serves build-mode UI tests | Turned away by the sites the stealth tier exists for |
| Scrapling's non-stealth browser fetcher | Keeps one library | Same weakness as a stock browser |
| No browser tier | Least machinery | Pages that need JavaScript, and protected public pages, stay unread |

- **Evidence:** `scraper/engine.py`: Scrapling `Fetcher`, then `StealthyFetcher` (Camoufox) headless with images and media off; Scrapling's challenge solver is not enabled; SSRF checks on requested and final URLs; sign-in walls returned as `AUTH_REQUIRED`; service on loopback unless a shared secret is set; 2 concurrent sessions (`scraper/api.py`); `/crawl` honours robots.txt. The worker image adds browser libraries and `python -m camoufox fetch` (`apps/worker/Dockerfile`). The research path uses it only when `WORKER_SCRAPER_URL` is set; the web app uses it for user-added pages. `PROTECTED_DOMAINS` (LinkedIn, X, Bloomberg, WSJ, Medium) go straight to the browser; 403, 429, 999 and challenge pages escalate to it.
- **Decision:**
  1. Keep Camoufox as the browser tier, behind the scraper service, with its SSRF checks, `AUTH_REQUIRED` handling, loopback binding and session limit.
  2. Keep the listed-site routing and the escalation on 403, 999 and challenge pages. Make the site list configuration, not code, so an operator can change it or turn the stealth tier off.
  3. Stop escalating on 429: back off and retry within the mission's budget, then report the source as rate-limited.
  4. Check robots.txt on `/scrape` as `/crawl` already does.
  5. Never enable CAPTCHA solving, use a person's cookies or accounts, or return a sign-in wall or paywall as content.
  6. Record each stealth fetch with its reason (listed site or escalation), count it against the mission's source budget, and pace requests per domain.
- **Consequences:** the research path can turn on the browser tier (`WORKER_SCRAPER_URL`) once items 3, 4 and 6 land; until then it is on only for the web app's user-added pages. The worker image keeps the Camoufox download.
- **Revisit when:** a listed site's terms or a legal review rules its automated access out, or measured E3 yield from the stealth tier stays low enough that its image and upkeep cost more than the evidence it adds. Build-mode UI tests run Playwright inside the sandbox, never on application hosts.

### TD-10 Site crawling: Scrapy
**Status:** pending: a candidate, not adopted. SYSTEM_DESIGN v0.1 had chosen it; this record supersedes that.
- **Context:** layer 3, structured crawling of permitted docs sites when the first pages do not settle a requirement **[D§8; RS§4]**.
- **Options:** Scrapy (robots middleware, AutoThrottle, HTTP cache, sitemap spiders, per-domain limits, all widely known); a bounded crawl loop over the gateway's docs fetcher; Firecrawl crawl (per-page cost, outside the gateway).
- **Evidence:** no task needs a site crawl yet. The docs task reads at most 3 pages per candidate (homepage plus same-site search results, `docs_evidence.py`), and E3 yield against pages read has not been measured. Scrapy runs its own event loop and downloader, so the gateway's cache, ledger, budget refusal, SSRF checks, robots policy and record/replay would have to be duplicated or bridged.
- **Decision:** not adopted. Layer 3 is a bounded loop over the docs fetcher: sitemap first, same-site links, per-host pacing, a page cap from the budget.
- **Consequences:** sitemap parsing and link following are ours to write, small and inside existing rules.
- **Revisit when:** E3 coverage on the suite keeps rising with pages read, and routine crawls reach tens of pages per site, beyond what the bounded loop fetches within budget.

### TD-11 Package and vulnerability data: deps.dev and OSV.dev
**Status:** accepted.
- **Context:** every recommended component gets dependency, vulnerability and licence checks **[D§11 supply chain]**; these facts are graded **[D§6.1]**.
- **Options:** deps.dev and OSV.dev (official, free, cross-ecosystem); libraries.io (needs a key, rate limited); scraping registry websites (excluded by RS§7.5); the GitHub advisory database (overlaps OSV, *to verify* how much).
- **Evidence:** `connectors/depsdev.py` and `connectors/osv.py`: no key, open data under CC-BY 4.0; deps.dev systems npm, PyPI, Cargo, Go, Maven and NuGet map to OSV ecosystems; OSV responses cached only 6 hours. `docs_evidence.py` records licence, Scorecard and advisory claims, and a licence conflict when GitHub and deps.dev disagree.
- **Decision:** keep both.
- **Consequences:** package resolution for E1 still calls the PyPI and npm APIs directly (`execution.py`), outside the gateway; it moves behind it.
- **Revisit when:** an ecosystem the briefs need is missing from deps.dev, or either service changes its terms or API.

### TD-12 Code host access: GitHub REST and git
**Status:** accepted for repository search, metadata, README and shallow or sparse clone; code search, issue search, the contents API and a GitHub App for build mode are pending.
- **Context:** code hosts are the main source of implementations **[D§5.3, D§5.4]**; inspection happens in isolation **[D§11]**.
- **Options:** GitHub REST (in use); GitHub GraphQL (fewer requests for metadata, not needed yet); other code hosts (not supported).
- **Evidence:** repository search at 30 requests a minute with a token, 10 without (`discovery/runner.py`); clones with hooks disabled, symlinks as plain files and depth 1; repositories over 100 MB get a sparse, blob-less partial clone of up to 8 directories (`github/clone.py`).
- **Decision:** GitHub only, through REST and git. Add code and issue search for RS§6 S7 and known issues.
- **Consequences:** solutions hosted elsewhere are missed and the deliverable must say so; search quota limits concurrent users.
- **Revisit when:** labelled essential solutions live on other hosts; or search quota limits discovery (then GitHub App installation tokens).

### TD-13 Sandbox: Docker locally, E2B hosted
**Status:** Docker accepted for local development; E2B accepted for hosted execution but not yet run against the live service; self-hosted Firecracker rejected for now; Modal not evaluated (pending).
- **Context:** third-party and generated code runs only in isolation, with no secrets and network only where needed **[D§5.4, D§11]**.
- **Options:** Docker containers (local); E2B managed microVM sandboxes; Modal sandboxes (*to verify*); self-hosted Firecracker microVMs (strongest control, but needs hosts with KVM and our own images, networking and clean-up).
- **Evidence:** `sandbox/base.py` contract: only non-secret variables, CPU, memory, process and time caps, private working directory, destroyed after use. `sandbox/docker.py`: uid 1000, every capability dropped, no new privileges, read-only root, in-memory mounts, network removed after installation. `sandbox/e2b.py`: written against the SDK's documented interface and not yet run live; network is fixed at creation, so tests run with network and that is recorded. Railway offers no Docker daemon, so hosted execution needs an external service.
- **Decision:** keep the sandbox interface, Docker locally, E2B for the hosted deployment, behind the per-project opt-in.
- **Consequences:** hosted E1 checks run with network access, weaker than [D§11]; every run records it.
- **Revisit when:** a live E2B spike measures cold start, egress control and cost per check. If egress cannot be restricted, evaluate Modal or another provider. If volume makes managed cost exceed a dedicated microVM host, reconsider Firecracker.

### TD-14 Authentication: Auth.js with GitHub sign-in
**Status:** accepted.
- **Context:** team workspaces, roles and access control **[D§9.2, D§11, D§14.1]**.
- **Options:** Auth.js (integrated); Clerk or Supabase Auth (another vendor, no gain for developer users).
- **Evidence:** `next-auth` 5.0.0-beta.32 pinned exactly; `apps/web/lib/auth/context.ts` falls back to one default workspace when no OAuth app is configured, unless `REQUIRE_AUTH=true`. Sign-in is not enforced on the public deployment (D Appendix A).
- **Decision:** keep Auth.js with GitHub sign-in; set `REQUIRE_AUTH=true` in production.
- **Consequences:** a beta dependency; upgrades are tested, not floated.
- **Revisit when:** Auth.js v5 is released as stable; or an organisation needs SAML or OIDC single sign-on.

### TD-15 Hosting: Railway
**Status:** accepted.
- **Context:** smallest coherent deployment **[D§13]**.
- **Options:** Railway (in use); other platforms or a VM (not evaluated; nothing requires a move).
- **Evidence:** services web, worker and PostgreSQL; not connected to GitHub, so a push does not deploy, and deploys upload through `scripts/deploy-railway.sh`; migrations run as a pre-deploy command (`railway.json`, commit `cd7f4b7`); health check on `/api/health`.
- **Decision:** keep Railway.
- **Consequences:** no Docker daemon and no nested isolation, so the sandbox is external (TD-13); the worker image carries the browser (TD-09).
- **Revisit when:** cost, isolation or data-residency needs exceed it, or a component needs KVM or Docker on the host.

### TD-16 Object storage
**Status:** pending.
- **Context:** content-addressed recordings for replay and provenance **[D§10.2, D§11 reproducible]**.
- **Options:** an S3-compatible bucket (chosen in SYSTEM_DESIGN §12); PostgreSQL large objects; files.
- **Evidence:** there is no object store. Evaluation snapshots are files in the checkout (`eval/` is about 104 MB); response bodies are TEXT rows in `connector_cache`; raw pages are kept only until their TTL.
- **Decision:** none yet: nothing needs it today.
- **Revisit when:** snapshots must be shared between machines or CI (the five-brief replay on every pipeline pull request); provenance needs raw content beyond the cache TTL; or `connector_cache` dominates the database.

### TD-17 Separate vector store
**Status:** rejected.
- **Context:** semantic retrieval must respect workspace scope, freshness and grade in the same query as the structured records **[D§9.2]**.
- **Options:** pgvector in the system of record; a dedicated vector database.
- **Evidence:** the vectors are repository chunks and knowledge objects, served by HNSW in pgvector (`002`, `003`). A separate store would need synchronisation with claims and a second copy of access control.
- **Decision:** rejected.
- **Revisit when:** vector count or recall latency exceeds one PostgreSQL instance, measured on the memory evaluation.

### TD-18 Connector gateway and record/replay
**Status:** accepted.
- **Context:** budgets, caching, access rules and untrusted-content marking on every external call **[D§8 efficiency, D§11]**; reproducible comparison of configurations **[D§10.2]**.
- **Options:** our own gateway and HTTP transport; a recording library (covers HTTP only, not budgets, SSRF or robots); calling tools directly.
- **Evidence:** `connectors/gateway.py` (cache, ledger, SSRF, pacing, size cap, instruction flagging); `eval/recording.py` records, replays and fills responses, and never records 5xx or 429. 14 runs on suite-v1, in record, replay and fill modes, finished with no brief errors (`BASELINE.md`).
- **Decision:** keep both; every new tool enters through the gateway.
- **Consequences:** GitHub clients and package lookups that bypass it today move behind it (RS§10).
- **Revisit when:** no trigger planned.

## 4. Components we deliberately do not have

| Component | Why not | What would justify adding it |
|---|---|---|
| Separate vector database | TD-17 | pgvector measured as the limit on memory recall |
| Message broker (Redis, RabbitMQ) | PostgreSQL is the queue (TD-02) | Task throughput or latency that `SKIP LOCKED` polling cannot serve, measured |
| Workflow engine (Temporal) | TD-02 | Workflows across several services, or scheduler failures we cannot fix cheaply |
| Agent framework at run level | Few bounded loops; fewest roles **[D§5.10]** | A task loop that needs branching or sub-agents, shown on a benchmark task |
| Crawling framework (Scrapy) | TD-10 | Routine crawls of tens of pages per site with measured E3 gain |
| A second browser engine | One rendering path is enough **[D§13]**; TD-09 replaces the engine rather than adding one | A permitted page class that the chosen engine measurably cannot render |
| Proxy pools, CAPTCHA solvers, fingerprint rotation | Their only use is getting past access controls **[D§2.4, D§7]** | None. No requirement can justify them |
| Search cluster (Elasticsearch, OpenSearch) | `tsvector` and pgvector serve search | Hybrid search quality or scale measured as the limit |
| Graph database | Relationships **[D§9.2]** are foreign keys | Multi-hop memory queries that SQL cannot answer within a latency target |
| Hosted LLM observability | The ledger and call log record every call | Debugging prompt behaviour needs traces the call log cannot give |
| Container orchestration (Kubernetes) | Railway services suffice (TD-15) | Hosting needs beyond Railway |
| Self-hosted or fine-tuned models | No requirement | A hosted model cannot meet quality or cost on the benchmark |
| Object storage | TD-16 (pending) | The TD-16 triggers |

## 5. Changes from earlier choices

SYSTEM_DESIGN.md v0.1, derived from the product definition v1.0, listed technology choices in its §12. This record supersedes them on these points (SYSTEM_DESIGN.md v1.0 §12 now summarises this record):
- **Scrapy** was chosen for site crawling; here it is a candidate, not adopted (TD-10).
- **LLM defaults** were Claude models; the code runs Mistral `ministral-8b-latest`, and stronger-model routing is pending (TD-05).
- **Firecrawl** was kept for single-page extraction; here it stays in the web app only (TD-08).
- **Rendering:** Scrapling with Camoufox, adopted on 2026-10-21 for pages that "refuse plain HTTP clients", stays as the stealth browser tier, now with explicit limits: no escalation on 429, robots on every fetch, recorded use (TD-09).
- **Sandbox:** E2B is implemented without the planned spike; the spike is still owed (TD-13).
