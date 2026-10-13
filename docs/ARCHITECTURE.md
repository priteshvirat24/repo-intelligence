# Open Eye — Architecture

Open Eye indexes public GitHub repositories, works out what each one can do, and answers questions about them. Every capability it stores is tied to a real definition in the code (file + line); anything it cannot verify is labelled *inferred*, never presented as fact.

This document covers:

1. [High-level design (HLD)](#1-high-level-design-hld)
2. [How Open Eye reaches the web](#2-how-open-eye-reaches-the-web)
3. [Deployment on Railway](#3-deployment-on-railway)
4. [Low-level design (LLD)](#4-low-level-design-lld)
   - 4.1 Adding a repository
   - 4.2 The indexing pipeline (worker)
   - 4.3 The evidence gate
   - 4.4 The job queue
   - 4.5 Answering a question (Studio chat)
5. [Data model](#5-data-model)
6. [Repository layout](#6-repository-layout)
7. [Safety guarantees](#7-safety-guarantees)
8. [Configuration](#8-configuration)
9. [Build, test, deploy](#9-build-test-deploy)

> Diagrams are written in Mermaid. They render on GitHub, in VS Code (with a Mermaid extension) and most Markdown viewers.

---

## 1. High-level design (HLD)

Three running parts, one database:

| Part | Tech | Job |
|---|---|---|
| **Web app** | Next.js 14 (React UI + API routes), TypeScript | UI, accepts repositories, answers questions, live web search |
| **Worker** | Python 3.11, tree-sitter, psycopg2 | Clones and analyses repositories in the background |
| **Database** | PostgreSQL 18 + pgvector | Everything: resources, jobs (the queue), code chunks, embeddings, knowledge, evidence |

The web app and the worker never call each other. **The database is the only contract between them**: the web app writes a job row, the worker claims it, and both read/write the same tables.

```mermaid
flowchart LR
    U(["User's browser"])

    subgraph Railway["Railway project: open-eye"]
        WEB["Web app<br/>Next.js UI + API routes"]
        WK["Worker<br/>Python ingestion pipeline"]
        DB[("PostgreSQL + pgvector")]
    end

    subgraph Ext["External services"]
        GHAPI["GitHub REST API"]
        GHGIT["GitHub git (HTTPS clone)"]
        MIS["Mistral AI<br/>LLM + embeddings"]
        TAV["Tavily<br/>web search"]
        FC["Firecrawl<br/>page scraping"]
        SITES["Public websites"]
    end

    U -- "HTTPS pages + /api/*" --> WEB
    WEB -- "SQL (private network)" --> DB
    WK -- "SQL: claim jobs, persist results" --> DB

    WEB -- "repo metadata, size check" --> GHAPI
    WEB -- "query embeddings, answers" --> MIS
    WEB -- "live search" --> TAV
    WEB -- "scrape top results" --> FC
    WEB -. "fallback fetch, SSRF-checked" .-> SITES

    WK -- "shallow clone" --> GHGIT
    WK -- "analysis + embeddings" --> MIS
```

**Two flows drive everything:**

- **Indexing (write path):** user adds a repo → web validates it and queues a job → worker clones, parses, asks the LLM to describe it, verifies every claim against the code, embeds text, and saves it all in one transaction.
- **Asking (read path):** user asks a question → web turns it into requirements → hybrid search (vectors + full-text) over indexed knowledge → optional live web search → LLM writes the answer, streamed back with verified citations.

---

## 2. How Open Eye reaches the web

Open Eye does **not** browse freely. Every outbound connection is listed here; there are no others.

| From | Destination | When | What it fetches | Safeguards |
|---|---|---|---|---|
| Web | `api.github.com/repos/{o}/{r}` | Adding / re-indexing a repo | Name, default branch, stars, licence, private flag | Authenticated with `GITHUB_TOKEN` (5,000 req/h); fails clearly if GitHub is down — never invents metadata |
| Web | `api.github.com/.../commits/{branch}` | Same | Latest commit SHA (skip re-index if unchanged) | — |
| Web | `api.github.com/.../git/trees/{branch}?recursive=1` | Same | Size of the files at the latest commit | Enforces `MAX_REPOSITORY_SIZE_MB` on what is actually downloaded, not git history |
| Worker | `github.com/{o}/{r}.git` (git over HTTPS) | Indexing | The latest snapshot only (`--depth 1`) | Hooks disabled, symlinks checked out as plain files, 120 s timeout, post-clone size check, deleted after the job |
| Web + Worker | `api.mistral.ai/v1/chat/completions` | Indexing (4 passes) and answering | LLM analysis / answers | JSON mode; truncated or empty output is rejected and retried; no mock fallback |
| Web + Worker | `api.mistral.ai/v1/embeddings` | Indexing and every question | 1024-d vectors (`mistral-embed`) | Same provider on both sides so vectors are comparable |
| Web | `api.tavily.com/search` | Chat in *Web* or *Both* mode when the library can't cover the question | Top 4 web results | Results cached in `web_search_cache`; 20 s timeout |
| Web | `api.firecrawl.dev/v1/scrape` | Top 1–2 web results with thin snippets | Clean Markdown of the page | Page status checked (404/500 pages are not used) |
| Web | Any public URL (native `fetch`) | Firecrawl unavailable, or adding a web/PDF resource | Raw HTML / PDF | **SSRF guard** before every request and every redirect hop: http(s) only, no localhost/private/link-local/metadata IPs (DNS-resolved), 20 MB streamed cap for PDFs |
| Web | `youtube.com` (oEmbed, captions) | Adding a YouTube video (de-emphasised) | Title, channel, public transcript | Missing/private video → fails; no transcript → not analysed |

The user's browser only ever talks to the web app. External API keys live in Railway variables, never in the browser.

```mermaid
flowchart TD
    Q["Outbound request needed"] --> K{"Which kind?"}
    K -- "GitHub metadata" --> GH["api.github.com with token"]
    K -- "Repository code" --> CL["git clone --depth 1<br/>hooks off, symlinks off"]
    K -- "AI" --> MI["api.mistral.ai"]
    K -- "Web search" --> TV["api.tavily.com (cached)"]
    K -- "Arbitrary URL" --> S{"SSRF check:<br/>scheme, host, resolved IPs"}
    S -- "private / loopback / metadata" --> X["Blocked"]
    S -- "public" --> F["fetch with manual redirects"]
    F -- "each redirect" --> S
```

---

## 3. Deployment on Railway

```mermaid
flowchart LR
    subgraph RW["Railway project open-eye, environment production, region sfo"]
        direction LR
        W["service: web<br/>Railpack build of the monorepo<br/>start: next start on PORT<br/>healthcheck: /api/health"]
        K["service: worker<br/>Dockerfile.worker (python:3.11-slim + git)<br/>CMD python -m apps.worker.worker"]
        P[("service: Postgres<br/>postgres-ssl:18 + volume")]
        W -- "postgres.railway.internal" --> P
        K -- "postgres.railway.internal" --> P
    end
    DEV["Developer machine"] -- "pnpm deploy:railway<br/>(railway up)" --> W
    DEV -- "staging dir: Dockerfile.worker + apps/worker" --> K
    PUB(["Public: web-production-478ae.up.railway.app"]) --> W
```

- **Deploys are uploads, not git-triggered.** `scripts/deploy-railway.sh` (`pnpm deploy:railway [web|worker|all]`) uploads code. The worker is uploaded from a staging folder so the web build config never applies to it.
- **Health check:** Railway routes traffic to a new web deploy only after `GET /api/health` returns 200 (it returns 503 if the database is unreachable). Defined as code in `.railway/railway.ts` (`railway config plan` / `apply`).
- **Database is private:** reachable only on Railway's internal network.
- **Variables** (API keys, `DATABASE_URL`) are managed in Railway, not in code. The web service's `GITHUB_TOKEN` is a reference to the worker's.

---

## 4. Low-level design (LLD)

### 4.1 Adding a repository

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Add Resource modal
    participant API as POST /api/resources
    participant ING as UniversalIngestionService
    participant GHA as GitHubResourceAdapter
    participant GH as GitHub API
    participant DB as Postgres

    User->>UI: paste URL (https, http, owner/repo, git@github.com:...)
    UI->>API: GET /api/resources/preview (live, debounced)
    UI->>API: POST { url }
    API->>API: normalize URL (lowercase owner/repo, strip .git, tracking params)
    API->>API: SSRF check on normalized URL
    API->>ING: ingestResource(url)
    ING->>DB: already indexed or in progress? (case-insensitive for GitHub)
    alt already READY
        ING-->>UI: alreadyExists (offer re-index)
    else new or forced
        ING->>GHA: ingest(url)
        GHA->>GH: repo metadata, latest commit, file tree size
        alt not found / private / too large / GitHub down
            GHA-->>UI: FAILED with a clear reason (nothing queued)
        else ok
            GHA->>DB: upsert resource + repository rows
            GHA->>DB: BEGIN, lock repository row, supersede active job, INSERT job QUEUED, COMMIT
            GHA-->>UI: PENDING + resourceId
        end
    end
    loop every 1.5 s until terminal
        UI->>API: GET /api/resources/{id}/status
    end
```

### 4.2 The indexing pipeline (worker)

The worker polls the `ingestion_jobs` table every 2 s. Each stage updates the job's `step` (shown live in the UI) and refreshes its lock.

```mermaid
flowchart TD
    A["Claim job<br/>FOR UPDATE SKIP LOCKED"] --> B["CLONING<br/>git clone --depth 1, hooks off, symlinks off<br/>abort if checkout > size limit"]
    B --> C["FILE_FILTERING<br/>code: py ts tsx js jsx mjs cjs go rs c h cc cpp hpp java + patch<br/>docs, manifests; skip binaries, vendor, symlinks<br/>budgets: 2000 files, 500 KB/file, 20 MB text"]
    C --> D["MANIFEST_ANALYSIS<br/>requirements.txt, pyproject (tomllib), setup.py,<br/>package.json, go.mod, Cargo.toml, Dockerfile"]
    D --> E["AST_ANALYSIS<br/>tree-sitter: Python, JS/TS/TSX, Go, Rust, C, C++, Java<br/>symbol outlines + chunking (512-token chunks, secrets redacted)"]
    E --> F["CAPABILITY_EXTRACTION: 3 LLM passes<br/>1. Cartography: purpose, domains, subsystems<br/>2. Module analysis: up to 6 subsystems<br/>3. Synthesis: capabilities, features, concepts,<br/>techniques, use cases, components, interfaces, limitations"]
    F --> G{"Synthesis empty?"}
    G -- yes --> R["Retryable error<br/>(existing data untouched)"]
    G -- no --> H["Evidence gate (4.3)<br/>keep only capabilities with verified evidence"]
    H --> I["INDEXING<br/>embed knowledge objects + up to 250 chunks<br/>spread across files, README first"]
    I --> J["Persist in ONE transaction<br/>re-check ownership + not cancelled<br/>replace documents, chunks, capabilities, evidence,<br/>knowledge objects, dependencies, limitations<br/>mark job COMPLETED, resource READY"]
```

**Completeness** is recorded honestly: `full`, `partial` (with the reason: file budget hit, N of M excerpts indexed, N of M subsystems studied) or `limited` (fewer than 5 analysable files).

### 4.3 The evidence gate

The LLM proposes evidence for each capability; the gate accepts it only if it can be proven from the code. The stored snippet is always the **real source line**, never the model's text.

```mermaid
flowchart TD
    E["Claim: file_path, quote, symbol_name"] --> P{"Path inside repo?"}
    P -- no --> REJ["Rejected"]
    P -- yes --> Q{"Whole quote found in that file?<br/>(whitespace/case-insensitive, at least 8 chars)"}
    Q -- yes --> OK["Verified: real lines from the file"]
    Q -- no --> S{"Symbol DEFINED in that file?<br/>(parser: def/class/function/method/struct/...)"}
    S -- yes --> OK
    S -- no --> R{"Symbol defined anywhere in the repo?<br/>(definition index: all parsed languages + added lines in .patch files)"}
    R -- yes --> OK2["Verified at the real file:line<br/>(model named the wrong file)"]
    R -- no --> REJ
```

Rules that prevent fabricated evidence:

- a mention is not a definition (`import os` never proves anything);
- filenames (`policies.json`) and hyphenated phrases (`font-hijacker`) are not symbols;
- macros (`NS_SUCCEEDED(...)`) and calls are not definitions;
- capabilities with **no** verified evidence are dropped, not stored with placeholders.

### 4.4 The job queue

A plain Postgres table (`ingestion_jobs`) is the queue — no Redis or broker.

```mermaid
stateDiagram-v2
    [*] --> QUEUED: web inserts job (repository row locked)
    QUEUED --> RUNNING: worker claims (FOR UPDATE SKIP LOCKED, attempts + 1)
    RUNNING --> COMPLETED: persisted atomically
    RUNNING --> QUEUED: transient error (network, rate limit, LLM, DB)<br/>retry after 1, 2, 4 min
    RUNNING --> FAILED: permanent error (too large, not found, ...)<br/>or attempts exhausted
    RUNNING --> RUNNING: lock refreshed at every stage
    RUNNING --> QUEUED: lock stale > 10 min (worker died), reclaimed
    QUEUED --> FAILED: superseded by a newer job / cancelled by user
    RUNNING --> FAILED: superseded / cancelled (worker notices, abandons, writes nothing)
    COMPLETED --> [*]
    FAILED --> [*]
```

Ownership is checked on every write (`locked_by = this worker AND status = 'RUNNING'`), so a cancelled or superseded job can never overwrite newer state. Web/PDF/YouTube jobs (no `repository_id`) are processed inside the web app and are never claimed by the worker.

### 4.5 Answering a question (Studio chat)

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as Studio (React)
    participant API as POST /api/chat (SSE)
    participant DEC as Problem decomposer
    participant RET as Hybrid retrieval
    participant DB as Postgres + pgvector
    participant WEBS as Tavily + Firecrawl
    participant LLM as Mistral

    User->>UI: question + source mode (Library / Web / Both)
    UI->>API: message, history
    API->>DEC: decompose
    DEC->>LLM: requirements, domains, expansions (JSON)
    API->>RET: retrieve(requirements)
    RET->>LLM: embed query
    RET->>DB: vector similarity (cosine) + full-text rank<br/>over knowledge objects and code chunks
    RET-->>API: ranked repositories, chunks, objects
    API->>API: compose: which repo covers which requirement
    opt Web/Both mode and library can't cover it
        API->>WEBS: search, scrape top results
    end
    API->>DB: evidence for top candidates<br/>(verified first, max 3 per repo, rank order)
    API-->>UI: event: metadata (citations, composition, web sources)
    API->>LLM: grounded prompt (untrusted data fenced)
    LLM-->>API: tokens (stream)
    API-->>UI: event: message ... event: done
    UI->>UI: render Markdown, citation chips open the evidence drawer
```

---

## 5. Data model

Core tables (see `packages/database/migrations/*.sql`):

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

    resources {
        uuid id
        text resource_type
        text source_url
        text status
        text_array problems_solved
        timestamptz indexed_at
    }
    repositories {
        uuid id
        uuid resource_id
        text owner
        text name
        text latest_commit_hash
        jsonb analysis_completeness
    }
    ingestion_jobs {
        uuid id
        text status
        text step
        int attempts
        timestamptz locked_at
        text locked_by
    }
    chunks {
        uuid id
        text content
        vector embedding
        tsvector tsv_content
    }
    knowledge_objects {
        uuid id
        text object_type
        text name
        text description
        vector embedding
    }
    evidence {
        uuid id
        text file_path
        int start_line
        text quote_snippet
        bool is_verified
        text evidence_strength
    }
```

Other tables: `worker_heartbeats` (worker liveness for `/api/health`), `web_search_cache`, `provider_usage`, `resource_versions`, `chat_sessions`, `chat_messages`.

---

## 6. Repository layout

```
open-eye/
├── apps/
│   ├── web/                         Next.js app (UI + API)
│   │   ├── app/                     pages: / (Studio), /resources (Library), /capabilities, /repositories/[id]
│   │   │   └── api/                 resources, repositories, chat (SSE), capabilities, health, search/live
│   │   ├── components/              Navbar, AddResourceModal, EvidenceDrawer, ArchitectureGraph, Primitives
│   │   ├── lib/
│   │   │   ├── adapters/            URL detection + per-source adapters (github, web, pdf, youtube), error mapping
│   │   │   ├── ai/                  chat orchestrator, decomposition, hybrid retrieval, composition, providers, web ingestion
│   │   │   ├── github/              GitHub API client (size check), transactional job queue
│   │   │   ├── providers/           Tavily, Firecrawl (+ SSRF-safe native fetch)
│   │   │   ├── security/            SSRF guard, rate limiting
│   │   │   └── validation/          GitHub URL validation
│   │   └── styles/globals.css       design tokens (colour, type, spacing), light + dark
│   └── worker/                      Python ingestion worker
│       ├── worker.py                job loop, pipeline orchestration, retries
│       ├── db/repository.py         queue SQL, ownership checks, atomic persistence
│       ├── github/clone.py          hardened shallow clone, path safety
│       ├── analyzer/                file_filter, metadata (manifests), ast_parser (tree-sitter),
│       │                            chunker (+ secret redaction), cartography, module_analyzer,
│       │                            synthesis, evidence (verification gate), capability (slugs)
│       └── providers/               Mistral/OpenAI LLM + embeddings (no mock fallback)
├── packages/
│   ├── database/                    pg pool + query helper, migrations (001–005), migrate/seed scripts
│   └── shared/                      shared TypeScript types and taxonomy
├── tests/
│   ├── worker/                      pytest: parsers, evidence gate, queue, hardening regressions
│   ├── integration/                 API-level scripts
│   └── fixtures/                    small sample repositories used by tests
├── .railway/railway.ts              Railway infrastructure as code (health check)
├── scripts/deploy-railway.sh        deploy web and/or worker
├── Dockerfile.worker                worker image
└── docs/ARCHITECTURE.md             this document
```

**Monorepo tooling:** pnpm workspaces + Turborepo. The web app consumes `@repo/database` and `@repo/shared` as TypeScript source (no compiled output is committed).

---

## 7. Safety guarantees

| Concern | How it is handled |
|---|---|
| Fabricated knowledge | No mock providers; empty/truncated AI output is retried, never saved; capabilities need verified evidence; UI marks inferred items amber |
| Overwriting good data | One transaction per index; ownership re-checked inside it; empty analyses rejected before persistence |
| SSRF (fetching internal addresses) | Scheme/host/IP checks with DNS resolution on every request and redirect; size-capped streaming |
| Malicious repositories | Git hooks disabled, symlinks not followed, path traversal blocked, clone deleted after use, prompt-injection fenced as untrusted data |
| Secrets in repos | API keys, tokens and private keys redacted before chunks are embedded or evidence is stored |
| Duplicate / racing jobs | Repository row lock when queuing; `SKIP LOCKED` claiming; stale-lock recovery; attempt limits |
| Abuse / cost | Per-IP token-bucket rate limits on write and AI endpoints; debug endpoint disabled in production |
| Broken deploys | Railway health check on `/api/health` |

**Known limitations:** DNS rebinding is not fully closed (the safety check and the fetch resolve DNS separately); very large repositories are analysed partially (budgets above).

---

## 8. Configuration

Set as Railway variables (and `.env` locally):

| Variable | Used by | Purpose |
|---|---|---|
| `DATABASE_URL` | both | Postgres connection |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` | both | Mistral (default) or OpenAI |
| `EMBEDDING_PROVIDER`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | both | Must match on both sides and the DB vector column (1024) |
| `GITHUB_TOKEN` | both | GitHub API rate limit |
| `TAVILY_API_KEY`, `FIRECRAWL_API_KEY` | web | Live web search / scraping (optional) |
| `MAX_REPOSITORY_SIZE_MB`, `MAX_FILE_SIZE_KB`, `MAX_TOTAL_TEXT_MB`, `MAX_FILES` | web + worker | Size budgets |
| `MAX_CHUNKS`, `MAX_SUBSYSTEMS` | worker | Analysis depth (defaults 250, 6) |
| `MAX_JOB_ATTEMPTS`, `JOB_LOCK_TIMEOUT_MINUTES`, `WORKER_POLL_INTERVAL_SECONDS` | worker | Queue behaviour |

---

## 9. Build, test, deploy

```bash
pnpm install                     # workspace dependencies
pnpm build                       # turbo: typecheck packages, build web
apps/worker/venv/bin/python -m pytest tests/worker -q   # worker tests (queue tests need Postgres)
pnpm db:migrate                  # apply SQL migrations
pnpm deploy:railway web          # or: worker | all
railway config plan              # preview infrastructure changes in .railway/railway.ts
```
