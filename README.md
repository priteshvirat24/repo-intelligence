# Open Eye

**Universal Resource Intelligence & Architectural Reasoning Platform**

> **Open Eye is an AI-powered intelligence layer for the resources your team learns from and builds with. It understands repositories, websites, videos, documents, and other sources, then connects their capabilities, knowledge, and evidence to solve engineering and research problems.**

A repository is only ONE type of resource. Open Eye generalizes across an expansive source ecosystem—including GitHub repositories, technical articles, documentation portals, YouTube videos, LinkedIn posts, and PDF research papers—grounding cross-resource architectural synthesis in source-aware evidence and live web discovery.

---

## The Open Eye Model

```text
                    OPEN EYE
                       │
             ┌─────────┴──────────┐
             │                    │
      Resource Library     Live Web Research
             │                    │
             ▼                    ▼
     Indexed Resources         Tavily
             │                    │
             ▼                    ▼
     Resource Knowledge     Web Discovery
             │                    │
             └─────────┬──────────┘
                       ▼
                 AI Reasoning
                       │
                       ▼
                  User Problem
                       │
                       ▼
              Solution / Synthesis
```

---

## Core Capabilities

1. **Universal Resource Ingestion**:
   - **GitHub Repositories**: Source code AST parsing, package manifests, and verification gate.
   - **Web Pages & Documentation**: Crawled and cleanly converted to Markdown via Firecrawl with native fallback.
   - **YouTube Videos**: Video metadata and timed transcript caption segmentation (`12:32 - 13:18`).
   - **PDFs & Research Papers**: Page-aware textual segmentation (`Page 17`) with zero code execution.
   - **LinkedIn Posts**: Public technical articles and commentary.
2. **First-Class External Web Providers**:
   - **Firecrawl**: Structured web extraction, documentation crawling, and markdown scraping.
   - **Tavily**: Live web discovery and current technical research.
3. **Dual Knowledge Modes in Studio**:
   - **Internal Mode**: Query only verified, indexed Open Eye resources.
   - **Live Web Mode**: Discover external tools and documentation on the fly.
   - **Combined / Hybrid Mode**: Combine internal indexed resources with live web research, citing both with distinct badges.
4. **Save Web Result to Open Eye**:
   - Discovered web resources can be persisted into permanent indexed resources with one click (`[Save to Open Eye]`).
5. **Grounded Source-Aware Citations**:
   - `[GitHub:owner/repo#path:L10-L20]`
   - `[YouTube:VideoTitle@12:32]`
   - `[PDF:DocumentName#page=17]`
   - `[Web:Domain/Path#section-heading]`
   - `[LinkedIn:Author/Post]`
6. **Dedicated Resource Library (`/resources`)**:
   - What knowledge has Open Eye collected?
   - First-class fields: **What problem does it solve?** (`problemsSolved`), **How can we use this?** (`practicalUses`), **Useful for**, and **Why useful**.
7. **Strict Security Isolation**:
   - All external web and document text is treated as untrusted data inside `<untrusted_resource_data>`.
   - Never obeys prompt injection inside external pages or transcripts.
   - Never bypasses authentication, paywalls, or access controls; reports `BLOCKED` or `UNAVAILABLE` honestly.

---

## Supported Resource Ecosystem

| Resource Type | Identifier | Default Role | Extraction Mechanism |
| :--- | :--- | :--- | :--- |
| **GitHub Repository** | `github_repository` | `software_component` | Tree-sitter AST, Git shallow clone, manifest analysis |
| **Web Page** | `web_page` | `reference` | Firecrawl API v1 / Native HTTP fallback |
| **Documentation** | `documentation_site` | `documentation` | Firecrawl multi-page crawl & section mapping |
| **Blog Article** | `article` | `article` | Firecrawl markdown scraper |
| **YouTube Video** | `youtube_video` | `tutorial` | YouTube oEmbed & public timed caption track |
| **PDF Document** | `pdf` | `reference` | Safe page-level PDF parser |
| **Research Paper** | `research_paper` | `research` | ArXiv / PDF parser with page locator |
| **LinkedIn Post** | `linkedin_post` | `opinion` | Public post reader (honest auth-wall detection) |

---

## Architectural Stack

- **Frontend**: Next.js 14 App Router, Vanilla CSS design system, Glassmorphism, Streaming SSE.
- **Database**: PostgreSQL 16/18 with `pgvector` and Full-Text Search (`tsvector`).
- **Web Providers**:
  - `TavilyProvider`: Web discovery, external search, and research caching.
  - `FirecrawlProvider`: High-fidelity markdown extraction and documentation crawling.
- **AI Models**: Mistral AI (`mistral-small-latest`, `mistral-embed` 1024-dim) with offline fallback.
- **Worker**: Python 3.11+ AST worker with PostgreSQL SKIP LOCKED queue.

---

## Environment Configuration

Configure server-side environment variables in `.env`:

```bash
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/repo_intelligence
DATABASE_POOLED_URL=postgresql://user:password@localhost:5432/repo_intelligence

# LLM & Embedding (Mistral AI)
LLM_PROVIDER=mistral
LLM_API_KEY=your_mistral_api_key
LLM_MODEL=mistral-small-latest

EMBEDDING_PROVIDER=mistral
EMBEDDING_API_KEY=your_mistral_api_key
EMBEDDING_MODEL=mistral-embed
EMBEDDING_DIMENSIONS=1024

# Universal Resource Intelligence Providers
FIRECRAWL_API_KEY=your_firecrawl_api_key
TAVILY_API_KEY=your_tavily_api_key

# Limits
MAX_REPOSITORY_SIZE_MB=100
MAX_FILE_SIZE_KB=500
```

> **Note**: API keys are kept strictly server-side and never exposed to the browser. If keys are missing, Open Eye gracefully runs with native fallbacks.

---

## Getting Started

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Run Database Migrations

```bash
pnpm run db:migrate
```

### 3. Start Development Server

```bash
pnpm run dev
```

Visit `http://localhost:3000` to open **Open Eye Studio**.
Navigate to `http://localhost:3000/resources` to explore the **Resource Library**.

---

## API Reference

### Universal Resources

- `GET /api/resources` — List indexed resources with filtering (`type`, `status`, `search`) and collection metrics.
- `POST /api/resources` — Submit any URL (GitHub, YouTube, Web, LinkedIn, PDF) with automatic source detection.
- `GET /api/resources/:id` — Full intelligence profile including problems solved, practical uses, capabilities, and evidence.
- `GET /api/resources/:id/status` — Ingestion progress and status polling.
- `POST /api/resources/:id/reindex` — Re-ingest and re-analyze a resource.
- `DELETE /api/resources/:id` — Delete a resource.

### Live Web & Chat

- `POST /api/search/live` — Live Tavily web search returning discoverable sources with save capability.
- `POST /api/chat` — Streaming architectural reasoning across internal and external sources (`mode: 'INTERNAL' | 'WEB' | 'BOTH'`).
- `GET /api/health` — Service diagnostics including database, worker, and provider connectivity (Firecrawl, Tavily, LLM).
