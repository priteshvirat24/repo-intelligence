<div align="center">

# Open Eye

### Before you build it, find out what already exists.

Give Open Eye a project brief. It finds the open-source code that already solves each requirement,<br>
**checks every claim against the code itself**, and tells you, requirement by requirement,<br>
what to **reuse**, what to **adapt** and what you still have to **build**, with a citation behind every decision.

[Quick start](#quick-start) ·
[How it works](#how-it-works) ·
[Results](#measured-not-claimed) ·
[Architecture](#architecture) ·
[User guide](docs/USER_GUIDE.md) ·
[Documentation](#documentation)

![Next.js 14](https://img.shields.io/badge/Next.js-14-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)
![Python 3.11](https://img.shields.io/badge/Python-3.11-3776AB?logo=python&logoColor=white)
![PostgreSQL + pgvector](https://img.shields.io/badge/PostgreSQL-pgvector-4169E1?logo=postgresql&logoColor=white)
![Status](https://img.shields.io/badge/status-pre--release-orange)

</div>

---

## Why Open Eye

Engineering teams lose weeks building things that already exist, and lose more adopting projects whose READMEs promise features the code does not have. Searching GitHub by stars does not tell you either.

Open Eye does the research a senior engineer would do before a build starts:

- **It reads the brief, not just keywords.** Requirements come out with a priority (MUST, SHOULD, NICE TO HAVE), testable acceptance criteria, stated assumptions and at most three questions back to you.
- **It searches the way an expert would.** It plans queries by kind of tool, across GitHub, npm, crates.io, deps.dev, OSV, Stack Exchange and the web, and stops when new queries stop finding anything.
- **It does not trust READMEs.** The strongest candidates are cloned and parsed. A capability counts as verified only when it is found in the code, at a file, a line range and a commit.
- **It says what it does not know.** Every claim carries an evidence grade. Unverified claims are labelled as such, never presented as facts.
- **It remembers.** Verified findings, past runs and research tactics that worked are kept and reused, so the next brief starts from what is already known.

## What you get

| | |
|---|---|
| **Briefs** | Paste or upload a project brief. Get ranked starting points and a staged engineering blueprint: recommendation, build-versus-reuse decision per requirement, architecture, integration guide, roadmap, risks and sources. |
| **Challenge and deepen** | Disagree with a decision and say why; the blueprint answers from the evidence and says whether the decision changed. Or send Open Eye back to dig deeper into one requirement. |
| **Build mode** | Pick roadmap items and authorise a build. Open Eye writes the code and its tests, runs them in an isolated sandbox, and hands you a diff or opens a draft pull request. Nothing is pushed without your approval. |
| **Studio** | Ask questions about any indexed repository. Answers stream with numbered citations to the exact file and lines; each citation opens the code it rests on. |
| **Library and Capabilities** | Everything Open Eye has read: GitHub repositories, docs sites, articles, papers, PDFs and videos, with what each solves and the capabilities found in its code. |
| **Memory** | Graded facts, past runs and learned procedures. Refute a wrong fact and every blueprint that cited it is rewritten. |
| **Evaluation and Evolution** | A labelled benchmark measures every change. Ranking only changes when a new configuration beats the current one beyond the noise between runs, and every change can be rolled back. |

## How it works

```mermaid
flowchart LR
    U["understand<br>specification, questions"] --> R["recall<br>memory before research"]
    U --> D["discover<br>search, rank, shortlist"]
    R --> D
    D --> V["verify<br>index shortlist, E2"]
    D --> DOC["docs<br>registry, advisories, docs, E3"]
    V --> X["execute<br>opt-in sandbox checks, E1"]
    V --> B["blueprint<br>classify to executive summary"]
    DOC --> B
    X --> B
    R -.-> P["plan, planned<br>research plan by information gain"]
    P -.-> D
    B -.-> EV["evaluate, planned<br>completion status and learning"]
```

<sub>Solid boxes are built; dashed ones are on the <a href="docs/ROADMAP.md">roadmap</a>.</sub>

Each step is a task in a run graph. Steps run as soon as their inputs are ready, results appear while the rest of the run continues, and changing a constraint or answering a question re-runs only the steps it affects. Every run has a budget (AI calls, tokens, GitHub requests, source requests); when it runs out, the run stops cleanly and can be resumed.

### Evidence grades

Every claim in a blueprint, an answer or memory carries one of five grades.

| Grade | Meaning |
|:---:|---|
| **E1** | Executed: observed by running the code in a sandbox |
| **E2** | Verified in code at a file, a line range and a commit |
| **E3** | Officially documented or reported by the platform |
| **E4** | Claimed by a README or article, not yet checked |
| **E5** | Inferred by Open Eye |

### Build versus reuse

Each requirement gets exactly one class. Classes 1 to 3 need E1 to E3 evidence.

| Class | Decision |
|:---:|---|
| **1** | Available and verified |
| **2** | Available, needs configuration |
| **3** | Available, needs modification |
| **4** | Partially solved |
| **5** | Missing, must be built |
| **6** | Unresolved: verify before relying on it |

## Measured, not claimed

Open Eye is scored on a benchmark of real briefs whose expected solutions were labelled in advance, and compared with plain GitHub search.

| | Plain GitHub search | Open Eye |
|---|:---:|:---:|
| **Recall@10**: share of the expected essential solutions in the top 10 | 0.063 | **0.341** (0.305–0.365) |
| **Shortlist precision**: share of recommended starting points that are essential or acceptable | 0.033 | **0.255** (0.243–0.276) |
| Time per brief | 1 s | 58 s |
| AI calls per brief | 0 | 60 |

<sub>Mean over three runs, with the range across runs in brackets; differences inside the range are noise. Measured with `ministral-8b` on suite-v1. The suite's labels are still a draft (one labeller, checked against GitHub, not yet independently reviewed), so treat these numbers as provisional. Full report: <a href="eval/results/suite-v1/BASELINE.md">eval/results/suite-v1/BASELINE.md</a>.</sub>

## Quick start

**You need:** Node.js 20+, pnpm 9, Python 3.11+, PostgreSQL 16+ with [pgvector](https://github.com/pgvector/pgvector) (or Docker), and a [Mistral](https://console.mistral.ai) API key.

```bash
# 1. Get the code and the JavaScript dependencies
git clone https://github.com/priteshvirat24/repo-intelligence.git open-eye
cd open-eye
pnpm install

# 2. Start PostgreSQL with pgvector (or point DATABASE_URL at your own)
docker compose up -d postgres

# 3. Configure: set DATABASE_URL, DATABASE_POOLED_URL, LLM_API_KEY and EMBEDDING_API_KEY
cp .env.example .env

# 4. Create the schema
pnpm db:migrate

# 5. Set up and start the worker (keep it running)
python3.11 -m venv apps/worker/venv
apps/worker/venv/bin/pip install -r apps/worker/requirements.txt
apps/worker/venv/bin/python -m apps.worker.worker

# 6. In a second terminal, start the web app
pnpm dev
```

Open **http://localhost:3000**, click **Add repository** and paste a public GitHub URL. Then go to **Briefs** and describe something you want to build.

Check that everything is connected at **http://localhost:3000/api/health**: it reports the database, the worker's heartbeat and each provider.

### Configuration

The keys below are the ones that change what Open Eye can do. [`.env.example`](.env.example) lists the rest with defaults.

| Variable | What it enables |
|---|---|
| `DATABASE_URL`, `DATABASE_POOLED_URL` | The database. Both are required; the pooled URL is preferred when set. |
| `LLM_API_KEY`, `EMBEDDING_API_KEY` | Reasoning and embeddings (Mistral by default; OpenAI is supported). Open Eye fails loudly without them; there is no mock mode. |
| `GITHUB_TOKEN` | Higher GitHub rate limits during discovery. |
| `TAVILY_API_KEY` | Live web search: the Studio's Web and Both modes, and docs discovery. |
| `STACKEXCHANGE_KEY` | Higher Stack Exchange limits for the docs step. |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_SECRET` | GitHub sign-in and separate workspaces. Set `REQUIRE_AUTH=true` on any public deployment. |
| `SANDBOX_PROVIDER` | `docker` or `e2b` (`e2b` also needs `E2B_API_KEY`). Enables build mode and E1 sandbox checks. |
| `GITHUB_BUILD_TOKEN` | Lets build mode open draft pull requests. |
| `MAX_REPOSITORY_SIZE_MB`, `MAX_CHUNKS`, `MAX_SUBSYSTEMS` | How much of a repository is analysed. Raise them for deeper analysis of large repositories, at the cost of time and AI calls. |

## Architecture

Three parts share one database, and the database is the only contract between them. The web app never calls the worker: it writes jobs and tasks, and the worker claims them with `FOR UPDATE SKIP LOCKED`, so you can run as many workers as you need.

### High-level design (HLD)

```mermaid
flowchart LR
    U(["User browser"])

    subgraph Railway["Railway project: open-eye"]
        WEB["Web app<br>Next.js UI and API"]
        WK["Worker<br>Python: indexing, research,<br>blueprints, builds"]
        DB[("PostgreSQL and pgvector<br>data, jobs and tasks")]
    end

    subgraph Ext["External services"]
        GH["GitHub<br>REST API and git clone"]
        REG["Registries and advisories<br>npm, crates.io, deps.dev, OSV"]
        QA["Stack Exchange"]
        TAV["Tavily<br>web search"]
        FC["Firecrawl<br>page scraping"]
        MIS["Mistral<br>LLM and embeddings"]
        SBX["Sandbox<br>Docker or E2B"]
    end

    U -->|"HTTPS pages and API"| WEB
    WEB -->|"SQL"| DB
    WK -->|"SQL: claim jobs and tasks, write results"| DB

    WEB -->|"repository metadata, size check"| GH
    WEB -->|"Studio answers, query embeddings"| MIS
    WEB -->|"Studio web search"| TAV
    WEB -->|"user-added pages"| FC

    WK -->|"search and shallow clone"| GH
    WK -->|"packages and advisories"| REG
    WK -->|"forum evidence"| QA
    WK -->|"docs discovery"| TAV
    WK -->|"analysis, blueprints, embeddings"| MIS
    WK -->|"E1 checks and builds"| SBX
```

### System design: components

```mermaid
flowchart LR
    U["User"]
    subgraph RW["Railway"]
        WEB["Web app<br>Next.js: UI, API, sign-in, approvals"]
        DB["PostgreSQL and pgvector<br>system of record and queues"]
        subgraph WK["Worker service, Python"]
            IDX["Indexer<br>clone, analysis, evidence gate"]
            RG["Run graph<br>claims and runs mission tasks"]
            BLD["Build runner<br>bounded coding loop"]
            IDLE["Idle jobs<br>revalidation, distillation, monitor"]
            GW["Connector gateway<br>cache, budget, SSRF, untrusted tag"]
            SCR["Scraper service<br>page rendering, loopback only"]
        end
    end
    subgraph EXT["External"]
        LLM["LLM providers"]
        SRC["Sources<br>GitHub, deps.dev, OSV, npm, crates.io,<br>Stack Exchange, Tavily, arXiv, docs sites"]
        SBX["Sandbox<br>E2B hosted, Docker local"]
        GH["GitHub<br>branch and pull request after approval"]
    end
    U --> WEB
    WEB -->|"write requests, read state"| DB
    RG -->|"claim tasks, write outputs and claims"| DB
    IDX --> DB
    BLD --> DB
    IDLE --> DB
    RG --> GW
    GW --> SRC
    GW --> SCR
    RG -->|"metered calls"| LLM
    RG -->|"E1 checks"| SBX
    BLD -->|"install and test"| SBX
    WEB -->|"deliver after approval"| GH
```

### Deployment

```mermaid
flowchart LR
    subgraph RW["Railway project open-eye, environment production"]
        direction LR
        W["service: web<br>Railpack build of the monorepo<br>pre-deploy: database migrations<br>healthcheck: /api/health"]
        K["service: worker<br>Dockerfile.worker, python:3.11-slim<br>CMD python -m apps.worker.worker"]
        P[("service: Postgres<br>pgvector and a volume")]
        W -->|"private network"| P
        K -->|"private network"| P
    end
    DEV["Developer machine"] -->|"pnpm deploy:railway"| W
    DEV -->|"worker staging directory"| K
    PUB(["Public HTTPS"]) --> W
```

### Adding a repository

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Add-repository dialog
    participant API as POST /api/resources
    participant GH as GitHub API
    participant DB as Postgres

    User->>UI: paste a public URL
    UI->>API: preview while typing, then submit
    API->>API: normalise the URL and run the SSRF check
    API->>DB: already indexed or in progress?
    alt already READY
        API-->>UI: already in the library, offer re-index
    else new or forced
        API->>GH: metadata, latest commit, size
        alt not found, private or too large
            API-->>UI: FAILED with a clear reason, nothing queued
        else ok
            API->>DB: upsert the resource and queue one job atomically
            API-->>UI: PENDING
        end
    end
    loop until finished
        UI->>API: poll the status
    end
```

### The indexing pipeline

```mermaid
flowchart TD
    A["Claim job<br>FOR UPDATE SKIP LOCKED"] --> B["CLONING<br>shallow clone, hooks off, symlinks off<br>abort if the checkout exceeds the size limit"]
    B --> C["FILE_FILTERING<br>code, docs and manifests; skip binaries, vendor, symlinks<br>budgets: MAX_FILES, MAX_FILE_SIZE_KB, MAX_TOTAL_TEXT_MB"]
    C --> D["MANIFEST_ANALYSIS<br>requirements.txt, pyproject, setup.py,<br>package.json, go.mod, Cargo.toml, Dockerfile"]
    D --> E["AST_ANALYSIS<br>tree-sitter: Python, JS and TS, Go, Rust, C, C++, Java<br>symbol outlines and chunking, secrets redacted"]
    E --> F["CAPABILITY_EXTRACTION, three LLM passes<br>1. cartography: purpose, domains, subsystems<br>2. module analysis: up to MAX_SUBSYSTEMS subsystems<br>3. synthesis: capabilities, components, interfaces, limitations"]
    F --> G{"Synthesis empty?"}
    G -->|yes| R["Retryable error<br>existing data untouched"]
    G -->|no| H["Evidence gate<br>keep only capabilities with verified evidence"]
    H --> I["INDEXING<br>embed knowledge objects and up to MAX_CHUNKS chunks<br>spread across files, README first"]
    I --> J["Persist in one transaction<br>mark the job COMPLETED and the resource READY"]
```

### The evidence gate

A capability is kept only if the model's claim can be found in the code.

```mermaid
flowchart TD
    E["Claim: file path, quote, symbol name"] --> P{"Path inside the repository?"}
    P -->|no| REJ["Rejected"]
    P -->|yes| Q{"Whole quote found in that file?<br>whitespace and case-insensitive, at least 16 characters"}
    Q -->|yes| OK["Verified: real lines from the file"]
    Q -->|no| S{"Symbol defined in that file?"}
    S -->|yes| OK
    S -->|no| R{"Symbol defined anywhere in the repository?"}
    R -->|yes| OK2["Verified at the real file and line<br>the model named the wrong file"]
    R -->|no| REJ
```

### The job queue

```mermaid
stateDiagram-v2
    [*] --> QUEUED: web inserts a job
    QUEUED --> RUNNING: worker claims it, attempts + 1
    RUNNING --> COMPLETED: persisted atomically
    RUNNING --> QUEUED: transient error, retried after 1, 2, 4 min
    RUNNING --> FAILED: permanent error or attempts exhausted
    RUNNING --> RUNNING: lock refreshed at every stage
    RUNNING --> QUEUED: lock stale for 10 min, reclaimed
    QUEUED --> FAILED: superseded or cancelled
    RUNNING --> FAILED: superseded or cancelled, writes nothing
    COMPLETED --> [*]
    FAILED --> [*]
```

### Retrieval in one picture

```mermaid
flowchart LR
    subgraph Offline["Indexing: worker, once per repository"]
        R["GitHub repository"] --> C["Clone and parse<br>tree-sitter"]
        C --> K["Chunks<br>code and docs excerpts"]
        C --> A["LLM analysis<br>capabilities, concepts"]
        A --> V["Evidence gate<br>verify against code"]
        K --> E1["Embed<br>mistral-embed, 1024 dimensions"]
        V --> E1
        E1 --> DB[("PostgreSQL<br>pgvector and full-text")]
    end

    subgraph Online["Answering: web app, per question"]
        Q["Question"] --> D["Understand<br>LLM decomposition"]
        D --> H["Hybrid search<br>vector and keyword"]
        H --> S["Numbered sources<br>1, 2, W1"]
        S --> G["LLM answer<br>cites its sources"]
        G --> UI["Streamed to the browser"]
    end

    DB --> H
```

### How a file becomes chunks

```mermaid
flowchart TD
    F["File text"] --> R["Redact secrets"]
    R --> L["Split into lines<br>long lines split at 2048 characters"]
    L --> X{"Next line"}
    X --> T{"Would it pass 512 tokens,<br>or start a heading, class or function<br>while the chunk is half full?"}
    T -->|no| ADD["Append the line"]
    T -->|yes| FL["Emit the chunk with its line range"]
    FL --> OV["Start the next chunk with<br>up to 64 tokens of overlap"]
    OV --> ADD
    ADD --> X
    X -->|end of file| LAST["Emit the last chunk"]
```

### Answering a question in the Studio

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Studio
    participant API as /api/chat
    participant DEC as Decomposer
    participant RET as Hybrid retrieval
    participant DB as Postgres
    participant WEB as Tavily
    participant LLM as Answer model

    User->>UI: question and earlier turns
    UI->>API: message, history, mode
    API-->>UI: status: understanding the question
    API->>DEC: question
    DEC-->>API: summary, requirements, expansions
    API-->>UI: status: searching your repositories
    API->>RET: requirements
    RET->>DB: vector and full-text search over knowledge and chunks
    RET-->>API: ranked repositories, chunks, knowledge
    opt Web mode, or Both when the library cannot answer
        API-->>UI: status: searching the web
        API->>WEB: search
    end
    API->>DB: evidence for what the search matched
    API-->>UI: numbered sources
    API->>LLM: system prompt, sources and history
    LLM-->>UI: answer tokens that cite the sources
```

### Ranking repositories for an answer

```mermaid
flowchart LR
    Q["Query vector and keywords"] --> KO["Knowledge-object matches"]
    Q --> CH["Chunk matches"]
    KO --> AG["Aggregate per repository<br>best similarity, best text rank,<br>matched capabilities and concepts"]
    CH --> AG
    AG --> SC["Score<br>0.30 vector + 0.20 text<br>+ 0.30 coverage + 0.10 maturity + boost"]
    SC --> TOP["Top repositories"]
    TOP --> COMP["Requirement coverage map"]
```

### How Open Eye reaches the web

```mermaid
flowchart TD
    Q["Outbound request needed"] --> K{"Which kind?"}
    K -->|"GitHub metadata"| GH["api.github.com with a token"]
    K -->|"Repository code"| CL["git clone, depth 1<br>hooks off, symlinks off"]
    K -->|"AI"| MI["api.mistral.ai"]
    K -->|"Web search"| TV["api.tavily.com, cached"]
    K -->|"Any other URL"| S{"SSRF check:<br>scheme, host, resolved IPs"}
    S -->|"private, loopback or metadata"| X["Blocked"]
    S -->|"public"| F["Fetch with manual redirects"]
    F -->|"each redirect"| S
```

### Data model: research

```mermaid
erDiagram
    WORKSPACE ||--o{ WORKSPACE_MEMBER : "has"
    USERS ||--o{ WORKSPACE_MEMBER : "joins"
    WORKSPACE ||--o{ BRIEF : "owns"
    BRIEF ||--o{ TASK : "runs as"
    BRIEF ||--o{ BRIEF_CANDIDATE : "finds"
    BRIEF ||--o| BRIEF_BLUEPRINT : "delivers"
    BRIEF ||--o{ BUILD : "authorises"
    BRIEF_CANDIDATE }o--o| REPOSITORY : "indexed as"
    REPOSITORY ||--o{ CLAIM : "is subject of"
    BRIEF ||--o{ EPISODE : "remembered as"
    WORKSPACE ||--o{ PROCEDURE : "learns"
    CONFIG_VERSION ||--o{ BRIEF : "tunes"
    CONFIG_VERSION ||--o{ EVOLUTION_EVENT : "records"
    BRIEF ||--o{ FEEDBACK : "receives"
    BRIEF ||--o{ PROVIDER_USAGE : "spends"
```

### Data model: the index

```mermaid
erDiagram
    resources ||--o| repositories : "GitHub resource"
    resources ||--o{ ingestion_jobs : "tracked by"
    repositories ||--o{ ingestion_jobs : "queued for"
    repositories ||--o{ documents : contains
    documents ||--o{ chunks : "split into"
    repositories ||--o{ repository_capabilities : has
    capabilities ||--o{ repository_capabilities : "vocabulary"
    repository_capabilities ||--o{ evidence : "proven by"
    repositories ||--o{ knowledge_objects : describes
    knowledge_objects ||--o{ evidence : "proven by"
    knowledge_objects ||--o{ knowledge_relationships : relates
    repositories ||--o{ repository_dependencies : declares
    repositories ||--o{ repository_limitations : notes
```

### Memory

What Open Eye remembers, and how a fact stays tied to its evidence and to the decisions that rely on it.

```mermaid
flowchart LR
    W["Workspace"] --> P["Project"]
    P --> R["Requirement"]
    P --> RUN["Run"]
    RUN --> EP["Episode"]
    R --> D["Decision"]
    D -- "relies on" --> C["Claim"]
    C -- "about" --> SV["Subject version"]
    C -- "supported by" --> E["Evidence"]
    E --> S["Source"]
    D -- "chooses" --> CO["Component"]
    CO -- "is" --> SV
    EP -- "outcome of" --> O["Outcome and feedback"]
    O -- "corroborates or refutes" --> C
    EP -- "distilled into" --> PR["Procedure"]
```

### Evolution

```mermaid
flowchart LR
    B["1. Baseline"] --> O["2. Observe"]
    O --> D["3. Diagnose"]
    D --> H["4. Hypothesise"]
    H --> E["5. Evaluate"]
    E --> P["6. Promote or reject"]
    P --> M["7. Monitor"]
    M -- "rollback or new case" --> B
    M --> O
```

### When something fails

```mermaid
flowchart LR
    A["Failure detected"] --> B["Retry if transient<br>and within the retry limit"]
    B --> C["Fall back to an equivalent<br>permitted source or tool"]
    C --> D["Re-plan the affected work<br>within budget"]
    D --> E["Escalate: gate or Blocked"]
    D --> F["Report: class 6 or<br>uncertainty section"]
```

### Stack

| Layer | Built with |
|---|---|
| Web | Next.js 14 App Router, React 18, a token-based CSS design system with light and dark themes, server-sent events for streaming answers |
| Worker | Python 3.11, tree-sitter parsing for Python, JavaScript and TypeScript, Go, Rust, C and C++ and Java, a connector gateway with budget, cache and SSRF checks |
| Data | PostgreSQL with pgvector (1024-dimension embeddings) and full-text search; one transaction per indexed repository |
| AI | Mistral (`ministral-8b` for reasoning, `mistral-embed` for embeddings); OpenAI supported |
| Hosting | Railway (web, worker and database), with migrations run before each deploy |

### Repository layout

```text
apps/
  web/          Next.js app: pages, API routes, UI components
  worker/       Python worker: indexing, discovery, verification, memory, evolution, builds
packages/
  database/     SQL migrations and the database client
  shared/       Types shared by the web app and the worker
eval/           Benchmark suite, labels and committed results
docs/           Product definition, system design and specifications
tests/          Worker, web and integration tests
```

## Trust and safety

- **Fetched content is data, never instructions.** Every page, README and transcript is wrapped as untrusted input; instruction-like text inside it is logged, not followed.
- **No way around access controls.** Open Eye never signs in, solves CAPTCHAs or passes paywalls. A sign-in wall is reported as blocked, and every outbound fetch passes an SSRF check. A stealth browser reads public pages that turn away automated clients, within the limits set in [decision 14](docs/PRODUCT_DEFINITION.md).
- **Third-party code runs only in a sandbox**, only after you opt in, with no secrets and no network while tests run.
- **It never changes itself.** Ranking weights change only on benchmark evidence; prompts and strategies need a maintainer's approval; code and security changes always go through a reviewed pull request.

## Testing and evaluation

```bash
# Worker tests
apps/worker/venv/bin/python -m pytest tests/worker -q

# Web tests and type checks
cd apps/web && npx tsx --test ../../tests/web/*.ts && npx tsc --noEmit && cd ../..

# Run the benchmark (see eval/README.md for the protocol)
apps/worker/venv/bin/python -m apps.worker.eval.run --suite eval/suite-v1 --system b1 --mode record
```

## Documentation

| Start here | |
|---|---|
| [User guide](docs/USER_GUIDE.md) | Every screen and control, and how to run Open Eye |
| [Product definition](docs/PRODUCT_DEFINITION.md) | What the finished product is, who it is for and how it behaves |
| [System design](docs/SYSTEM_DESIGN.md) | Components, data flows and where the build stands |

| Specifications | |
|---|---|
| [Autonomy](docs/AUTONOMY_SPEC.md) · [Memory](docs/MEMORY_SPEC.md) · [Evolution](docs/EVOLUTION_SPEC.md) | How Open Eye runs on its own, what it remembers, how it improves |
| [Research strategy](docs/RESEARCH_STRATEGY.md) | Sources, retrieval layers and access rules |
| [Evaluation plan](docs/EVALUATION_PLAN.md) · [Acceptance](docs/ACCEPTANCE.md) | How quality is measured, and the checklist for done |
| [Technology decisions](docs/TECHNOLOGY_DECISIONS.md) · [Roadmap](docs/ROADMAP.md) | What was chosen and why, and what comes next |
| [Architecture](docs/ARCHITECTURE.md) · [Retrieval](docs/RAG.md) | Diagrams, the data model, chunking, retrieval and answer generation |

## Status

Open Eye is pre-release. The full research pipeline, blueprint, memory, evolution and build mode are implemented and tested; the [roadmap](docs/ROADMAP.md) and the [acceptance checklist](docs/ACCEPTANCE.md) list what is left, including enforced sign-in for public deployments, pause and resume for missions, and an independently reviewed benchmark.

## Contributing

Issues and pull requests are welcome. Before opening a pull request:

1. Run the worker tests, the web tests and the type check (see [Testing and evaluation](#testing-and-evaluation)).
2. If the change can affect ranking or research quality, run the benchmark and include the before-and-after numbers.
3. Keep claims honest: a feature that is not verified in the product does not go in the docs as done.
