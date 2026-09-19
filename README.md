# Repo Intelligence

An open-world AI engineering knowledge and cross-repository reasoning platform. Index arbitrary GitHub repositories across any technical domain—without fixed taxonomies—back every claim with strictly verified source code evidence, compute cross-repository architectures with data-flow matching, and interact via an interactive engineering chat studio.

---

## Key Features

- **Open-World Capability Discovery:** Dynamically discovers capabilities, input/output data contracts, and techniques across any engineering domain (satellite systems, computer vision, robotics, biology, distributed systems, etc.) without rigid category constraints.
- **Strict Evidence Verification Gate:** Eliminates LLM hallucinations by programmatically validating every claim against actual repository AST symbols, exact file paths, line ranges, and source quotes (`[repo:owner/name#file:lines]`).
- **Cross-Repository Reasoning & Composition:** Decomposes complex engineering queries into requirement contracts (`MUST` vs `SHOULD`), retrieves across repositories with anti-clustering diversity, matches producer-consumer data flows, and automatically synthesizes optimal, non-redundant multi-repo architectures.
- **Interactive Engineering Chat Studio:** Next.js 14 streaming studio with live architecture flow graphs, verified evidence inspectors, repository management, and domain explorer.
- **Single Operational Store:** Clean PostgreSQL + `pgvector` architecture with zero unnecessary external services (no Redis, Kafka, Neo4j, or Celery).

---

## Architecture Overview

- **Web Application & APIs:** Next.js 14 App Router (TypeScript, REST APIs, Streaming SSE, Interactive Visualizations).
- **Ingestion & Analysis Worker:** Python 3.11+ service featuring Tree-sitter AST parsing, Git shallow cloning, and strict evidence verification.
- **Database:** PostgreSQL 16/18 with `pgvector` extension and GIN inverted index (`tsvector`).
- **Queue Engine:** PostgreSQL-native transactional task queue (`SELECT ... FOR UPDATE SKIP LOCKED`).
- **AI Models:** Decoupled LLM and Embedding abstraction layers with native support for **Mistral AI** (`mistral-small-latest`, `mistral-embed` 1024-dim), OpenAI, and deterministic Mock providers.

---

## Project Structure

```text
repo-intelligence/
├── apps/
│   ├── web/                        # Next.js 14 Web Application & REST APIs
│   │   ├── app/
│   │   │   └── api/repositories/   # Repository Management & Status APIs
│   │   ├── lib/
│   │   │   ├── github/client.ts    # GitHub Pre-flight verification
│   │   │   └── validation/url.ts   # Strict GitHub URL validation
│   │   └── components/             # Dashboard, Modal & Navigation
│   │
│   └── worker/                     # Python Ingestion & Analysis Engine
│       ├── analyzer/
│       │   ├── ast_parser.py       # Tree-sitter multi-language parser
│       │   ├── capability.py       # Canonical capability extractor
│       │   ├── chunker.py          # Semantic chunker & secret sanitizer
│       │   ├── doc_parser.py       # Markdown & documentation parser
│       │   ├── evidence.py         # Strict Evidence Verification Gate
│       │   ├── file_filter.py      # Configurable file & size filtering
│       │   └── metadata.py         # Manifest analyzer (npm, pip, go, cargo)
│       ├── providers/
│       │   ├── llm.py              # Mistral / OpenAI / Mock LLM
│       │   └── embeddings.py       # Mistral / OpenAI / Mock Embeddings
│       ├── github/
│       │   ├── client.py           # GitHub REST API client
│       │   └── clone.py            # Secure shallow cloner
│       ├── db/
│       │   └── repository.py       # PostgreSQL SKIP LOCKED queue & atomic persistence
│       ├── config.py               # Worker environment configuration
│       └── worker.py               # Long-running polling worker loop
│
├── packages/
│   ├── database/                   # Migrations, seeds & database client
│   │   ├── migrations/             # Configurable vector dimension DDL
│   │   └── seed/                   # 28 canonical capabilities dictionary
│   └── shared/                     # Shared TypeScript types, taxonomy & benchmark
│
├── tests/
│   ├── fixtures/                   # Representative test repos (Python, TS, Go, Rust)
│   └── worker/                     # Automated unit and integration tests
│
├── docker-compose.yml              # Local PostgreSQL with pgvector
├── .env.example
└── turbo.json
```

---

## Getting Started

### 1. Prerequisites
- **Node.js**: `v20+` or `v22+`
- **pnpm**: `v9+`
- **Python**: `3.11+`
- **PostgreSQL**: `16+` with `pgvector` extension (or Docker)

### 2. Environment Setup
Copy the example environment file:
```bash
cp .env.example .env
```

Configure your PostgreSQL connection and AI keys:
```env
DATABASE_URL=postgresql://postgres:postgrespassword@localhost:5432/repo_intelligence
LLM_PROVIDER=mistral
LLM_API_KEY=your_mistral_api_key
EMBEDDING_PROVIDER=mistral
EMBEDDING_MODEL=mistral-embed
EMBEDDING_DIMENSIONS=1024
```

### 3. Database Migration & Seed
Start PostgreSQL (or run `docker compose up -d`) and apply migrations:
```bash
pnpm install
pnpm run db:migrate
pnpm run db:seed
```

### 4. Setup Python Worker Environment
```bash
cd apps/worker
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ../..
```

### 5. Running the System
Run the Next.js web application and Python worker:

**Terminal 1 (Web Application & APIs):**
```bash
pnpm --filter @repo/web dev
```

**Terminal 2 (Python Ingestion Worker):**
```bash
PYTHONPATH=. apps/worker/venv/bin/python -m apps.worker.worker
```

---

## Running Automated Tests

Run the complete test suite against local fixtures:
```bash
PYTHONPATH=. apps/worker/venv/bin/pytest tests/worker
```

Test coverage includes:
- Strict GitHub URL validation (rejection of non-https, subpaths, injection).
- PostgreSQL `FOR UPDATE SKIP LOCKED` concurrent worker claiming and stale job recovery.
- Configurable file and extension filtering and safety size limits.
- Tree-sitter AST parsing across Python, TypeScript, Go, and Rust.
- Strict Evidence Verification Gate (line calculation, quote confirmation, path traversal defense).
- Secret masking (`[REDACTED_SECRET]`) and deterministic embedding generation.

---

## REST API Specification

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/repositories` | Ingest new public GitHub repo (202 Accepted). |
| `GET` | `/api/repositories` | List indexed repositories with capability counts. |
| `GET` | `/api/repositories/:id` | Fetch structured repository intelligence profile. |
| `GET` | `/api/repositories/:id/status` | Poll real-time progress (`QUEUED`, `CLONING`, `ANALYZING`, `INDEXING`, `READY`). |
| `POST` | `/api/repositories/:id/reindex` | Trigger idempotent re-index based on remote commit SHA. |
| `DELETE` | `/api/repositories/:id` | Cascade delete repository and all associated records (204). |
