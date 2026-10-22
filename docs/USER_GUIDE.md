# Open Eye: User Guide

**How to use everything Open Eye can do, end to end.**

This guide is written against the running product (the `main` build, 2026-10-22). It covers what Open Eye does, every screen and control, and how to run it. It describes the system as it is today, including the parts marked *draft* or *gap*.

- For what the finished product is meant to be, see [PRODUCT_DEFINITION.md](PRODUCT_DEFINITION.md).
- For how the parts fit together, see [SYSTEM_DESIGN.md](SYSTEM_DESIGN.md).

---

## 1. What Open Eye is for

Open Eye answers one kind of question: **"What should I build, and what can I reuse to build it?"**

You give it a project brief. It reads the brief, searches GitHub and the package registries for projects that already solve parts of it, reads their code and docs, checks each claim against real evidence, and writes an engineering blueprint that tells you, per requirement, whether to **reuse**, **adapt**, or **build** — with a citation behind every decision. When you authorise it, it can also write and test the missing code in a sandbox and open a pull request.

It also runs a second, lighter tool: a **Studio** that answers questions about repositories you have already indexed, citing file and line.

Two things it is careful about:
- **Evidence, not guesses.** Every claim carries a grade (E1–E5). A claim it could not verify is labelled as such, never hidden.
- **Honest limits.** It respects robots directives, rate limits and sign-in walls. A source it cannot read is reported as blocked, not faked.

### The two ways in

| You want to… | Use | Starts at |
|---|---|---|
| Decide what to build and what to reuse | **Briefs** | `/briefs` |
| Ask questions about code you have indexed | **Studio** | `/` |

---

## 2. The five-minute tour

1. **Index a repository.** Click **Add repository** (top right, any page). Paste a public GitHub URL. Open Eye clones it, extracts what it can do, and keeps the evidence. (Docs, YouTube, PDFs and more work too.)
2. **Ask about it.** On the **Studio** (`/`), type a question, keep **Search in: Library**, and press Enter. The answer cites `file:line`; click a citation to see the evidence.
3. **Run a brief.** Go to **Briefs** (`/briefs`), paste a project brief (what you want to build, the requirements, the constraints), and click **Find existing implementations**.
4. **Read the blueprint.** When the run finishes, the brief page shows the requirements, a build-versus-reuse decision per requirement, the recommended architecture, an integration guide and a roadmap — each line cited.
5. **(Optional) Build it.** If the blueprint is complete, choose roadmap items in the **Build** panel, authorise the build, and let Open Eye write and test the code in a sandbox. Download the diff or open a pull request.

---

## 3. The navigation bar

Every page has the same top bar:

| Item | Where it goes |
|---|---|
| **Open Eye** (left) | Studio (`/`) |
| **Studio** | `/` — ask questions of indexed repositories |
| **Briefs** | `/briefs` — the main research flow |
| **Library** | `/resources` — everything Open Eye has read |
| **Capabilities** | `/capabilities` — what the indexed code can do |
| **Memory** | `/memory` — what Open Eye remembers across runs |
| **Evaluation** | `/evaluation` — how well it performs, measured |
| **Evolution** | `/evolution` — how its configuration changes over time |

On the right:
- An **Indexing N** pulse appears while background jobs run.
- **N repositories** shows the ready count.
- **Add repository** opens the add-resource modal from anywhere.
- **Sign in with GitHub** / your name + **sign out**, when sign-in is configured (section 11).

---

## 4. Adding resources (the Add-repository modal)

Open the modal with **Add repository**. Paste a public URL (or drag a link onto it). Open Eye detects the type and shows a live preview and a "what happens next" note.

**What you can add:**

| Type | Example | Notes |
|---|---|---|
| GitHub repository | `https://github.com/owner/repo` | Cloned, parsed with tree-sitter, capabilities verified against code |
| YouTube video | a single watch URL | Metadata + timed transcript |
| arXiv paper | `arxiv.org/abs/...` | Page-aware PDF text |
| PDF | any `.pdf` link | Up to 20 MB; no code execution |
| Documentation site | `docs.*`, GitBook, ReadTheDocs, `/docs` | Crawled and converted to Markdown |
| Article / blog | Medium, Substack, dev.to, `/blog` | Markdown scrape |
| LinkedIn post | a public post, pulse or article | Public content only |
| Any other public page | — | Native fetch with an SSRF guard |

**What it rejects, each with a reason:** GitLab URLs; the github.com root, profiles, issues, PRs and commits; YouTube playlists and channels; LinkedIn `/in/` profiles; non-`http(s)` links; and private or missing repositories.

**Limits:** repositories up to `MAX_REPOSITORY_SIZE_MB` (default 100 MB); PDFs up to 20 MB.

**While it indexes**, a checklist shows progress: *Source detected and validated → Repository and dependencies fetched → Code parsed, capabilities extracted → Search index built*. You can:
- **Cancel** the job, or
- **Continue in background** and close the modal (indexing keeps running; watch the **Indexing N** pulse in the nav).

**Outcomes:** *Ready. You can ask about it now.* or *Indexed with gaps…*, then shortcuts to open it or **Ask about {name}**. A duplicate shows *Already in your library* with **Open it** and **Re-index**. A failure shows a titled callout with **Why** / **Try** and a **Retry** when the error is retryable (rate limit, timeout, provider unavailable).

**Advanced → Force reindex** skips the cache and re-fetches everything.

---

## 5. Studio: ask questions of indexed code (`/`)

The Studio answers questions grounded in what you have indexed.

**Left shelf — Library (N):** up to 12 indexed items with type icons and status badges. **View all** goes to the Library. On a narrow screen this collapses into a disclosure in the composer.

**Composer:**
- Type in the box (placeholder: *Ask about the code: how it works, where it lives, what to reuse*).
- **Enter** sends; **Shift+Enter** adds a line.
- **Ask** sends; **Stop** appears while the answer streams; **Jump to latest** scrolls down; **New conversation** clears the thread (threads persist in your browser; the last 12 turns are sent as context).
- **Try asking** offers three starter prompts built from your indexed repositories.

**Search in** (the segmented control) chooses where answers come from:

| Mode | Behaviour |
|---|---|
| **Library** | Answers only from your indexed repositories, citing file and line. |
| **Web** | Searches the public web. Answers cite web pages, not your code. |
| **Both** | Your repositories first, plus the web for anything they do not cover. |

**The answer** streams with status lines (*Understanding the question → Searching your repositories / the web → Writing the answer*) and a header badge naming its sources (Library / Web / Library + Web / No matching sources).

**Citations:** inline `[1]`, `[2]` for code and `[W1]` for web. The **Sources** list shows each code source as `path:line` with an **Inferred** badge when unverified; clicking one opens the **Evidence drawer** (Repository / Path / Lines / Symbol / Timestamp, with **Open original source** and **Copy excerpt**). Web sources open in a new tab and offer **Save to library** to index them permanently.

**Show how these repositories fit together** reveals an architecture graph across your indexed repositories.

---

## 6. Briefs: the main research flow (`/briefs`)

This is where Open Eye earns its keep. You describe a project; it tells you what to reuse and what to build.

### 6.1 Starting a brief

On `/briefs`:
- **Title** (optional, up to 200 characters; taken from the first line if left blank).
- **Brief** — paste the text: what you want to build, who it is for, the requirements and constraints. At least 40 characters. **Or** upload a file (`.txt`, `.md`, `.pdf`, `.docx`, up to 10 MB).
- **Add constraints** (optional) — languages, infrastructure, technologies to favour or avoid, and a licence policy. You can also set these later.
- **Find existing implementations** starts the run and opens the brief page.

Write the brief the way you would brief an engineer: state the hard requirements, name the stack you must use, and call out what is non-negotiable. Open Eye pulls out the requirements and marks each MUST / SHOULD / NICE-TO-HAVE.

The briefs list refreshes every few seconds and shows each brief's status: **QUEUED, RUNNING, AWAITING_INPUT, COMPLETED, STOPPED** (budget used up) or **FAILED**.

### 6.2 What the run does

Open Eye runs a fixed pipeline, shown as a live timeline on the brief page:

| Step | What it does |
|---|---|
| **Understand the brief** | Extracts requirements, acceptance criteria, assumptions, and up to three clarifying questions |
| **Recall what memory knows** | Reuses verified findings from earlier runs (section 8) |
| **Discover existing solutions** | Searches GitHub and the package registries (npm, crates.io, deps.dev) |
| **Verify against code** | Clones the strongest candidates and checks each capability against real code |
| **Check docs, advisories and forums** | Reads official docs, OSV advisories and Stack Exchange |
| **Run checks in the sandbox** | (Only if you opted in) runs package-level checks to grade a claim E1 |
| **Write the blueprint** | Produces the staged engineering blueprint |

The progress bar names the current sub-step (Planning GitHub searches, Reading READMEs, Ranking candidates, and so on). Results appear as soon as the step that produces them finishes — you do not have to wait for the whole run.

### 6.3 Answering clarifying questions

If the run needs a decision only you can make, the brief goes to **AWAITING_INPUT** and the question is marked under **What Open Eye understood** with a *research waits for this* badge. Type your answer and click **Send answers**. Only the steps affected by your answer re-run. Questions without the blocking badge are optional — the research proceeds on a stated assumption, which you can correct later.

### 6.4 Reading the blueprint

The blueprint is the product. Its sections:

- **Executive recommendation** — the strategy, strongest building blocks, main challenges, remaining work, top risks, and decisions that need a person.
- **Build versus reuse** — one row per requirement, each with a class and its evidence:

  | Class | Meaning |
  |---|---|
  | **1 · Available and verified** | A repository does this, confirmed in its code (E1/E2) |
  | **2 · Available, needs configuration** | Exists; needs config to fit |
  | **3 · Available, needs modification** | Exists; needs code changes |
  | **4 · Partially solved** | Part of it exists; the rest must be built |
  | **5 · Missing, must be built** | No candidate does this |
  | **6 · Unresolved** | Claimed but not yet confirmed — verify before relying on it |

- **Existing solutions** — the shortlisted repositories, each marked Reuse / Adapt / Investigate / Reject, with licence and maintenance risk.
- **Recommended architecture** — components, interfaces and data flows.
- **Integration guide** — ordered steps (prerequisites, install, configuration, integration, verification), each cited. Steps not yet executed say so.
- **Implementation roadmap** — tasks with a complexity and uncertainty *estimate*.
- **Left to build** — the gaps, with their dependencies.
- **Evidence and uncertainty** and **Risks** — with grades and traceability.
- **Sources (N)** — every citation. A citation `[C1]` is verified code, `[R2]` a README claim, `[L1]` a stated limitation. Click one to jump to the source, which shows `repo · path:lines`, its kind, and its grade.

**Evidence grades**, which appear throughout:

| Grade | Meaning |
|---|---|
| **E1** | Executed: observed by running the code |
| **E2** | Verified in code at a file, lines and commit |
| **E3** | Officially documented or reported by the platform |
| **E4** | Claimed by a README or article; not yet checked |
| **E5** | Inferred by Open Eye |

### 6.5 Pushing the research further

- **Challenge this decision** (per requirement) — object to a decision ("Why not this repository?" plus your reasoning). Only the blueprint is rewritten; it answers your challenge from the evidence and says whether the decision **changed** or was **upheld**.
- **Investigate deeper** (per requirement) — re-runs discovery with extra queries aimed at that one requirement.
- **Useful / Not useful** on a candidate, and **Right decision / Wrong decision** on a blueprint decision — this feedback trains the ranking (section 9).
- **Run discovery again** — re-runs the whole search.
- **Add to library** on a candidate — indexes it so you can verify it against its code and ask about it in Studio.

### 6.6 Constraints and budget (on the brief page)

- **Change constraints** — edit Languages, Infrastructure, Prefer, Avoid, the licence policy (*Any open licence; flag copyleft* / *Permissive only* / *Any licence*), and the execution opt-in. **Save and re-run what changes** re-runs only the affected steps.
- **Budget** — every run has a cap: AI calls (default 60), tokens (400k), GitHub requests (250) and source requests (300). The panel shows what is used. If a run **STOPS** on budget, raise the limits and **Raise budget and continue** picks up where it left off.

### 6.7 Build mode (optional, maintainer only)

When the blueprint is **COMPLETED**, the **Build** panel appears. Open Eye can write and test the missing code:

1. Tick the roadmap items and/or requirements to build (at most 5 per build).
2. Tick **I authorise this build** — generated code and its dependencies are installed and run **in an isolated sandbox** (no secrets, no network during tests), and it counts against the brief's budget.
3. **Start build.** Open Eye writes code and tests, installs dependencies, runs the tests in the sandbox, and feeds failures back for a few rounds (steps: *Writing code → Installing and testing*).

The result shows the test report (all tests pass / needs a person / failed), the number of iterations, and the diff. You can:
- **Download diff** and apply it locally with `git apply`, or
- **Deliver as a pull request** — set owner/name and a branch (default `open-eye/build-…`), tick the approval box, and **Open pull request**. The default branch is never pushed to. This needs `GITHUB_BUILD_TOKEN` to be configured; without it the panel says so.

Build mode is limited to **workspace maintainers**; others see a note to that effect.

---

## 7. Library and Capabilities

**Library (`/resources`)** — everything Open Eye has read. Search by name, problem, technique or domain; filter by type (GitHub, Web & docs, Videos, PDFs & papers, LinkedIn). Each card shows what it **Solves**, what to **Use it for**, and links to open, re-index or remove it. A repository card opens a full profile at **`/repositories/{id}`**: purpose, capabilities (each with a confidence badge and evidence chips), components, entry points, inputs/outputs, dependencies and known limitations.

**Capabilities (`/capabilities`)** — a cross-repository index of what the indexed code can actually do, extracted from the code with evidence. Search it (e.g. "crawling", "kalman filter") or filter by category; each capability lists the repositories that implement it.

---

## 8. Memory (`/memory`)

Open Eye remembers across runs so it does not re-research what it already knows. Three tabs:

- **Semantic** — graded facts about repositories and sources (e.g. "repo X does Y, verified E2"). Filter by grade, freshness and status. If a fact is wrong, **This is wrong → Refute claim**; blueprints that cited it are flagged for rewriting. **Confirm** marks it still true.
- **Episodic** — what happened in each past run and the feedback since: the queries tried, results found, and how many became shortlisted candidates.
- **Procedural** — ways of researching that have worked, learned from runs and evaluations. A maintainer can **Activate** a procedure (after enough successes) or **Retire** one.

Memory is read before every brief's discovery step; a candidate it supplies is tagged *from memory* on the brief page.

---

## 9. Evaluation and Evolution (how it measures and improves)

These two pages are mostly read-only windows into how Open Eye performs and changes. They matter because they are *why you can trust the numbers*.

**Evaluation (`/evaluation`)** — "Measured, not claimed." A benchmark of briefs with expert-labelled answers scores the system on:
- **Recall@10** — the share of the essential solutions an expert expects that appear in the top 10.
- **Shortlist precision** — the share of recommended starting points that are labelled essential or acceptable.
- **Trap rejection** — the share of look-alike, abandoned or unusable repositories it correctly did not recommend.
- Plus **AI calls per run** and **time per brief**.

It compares Open Eye (**B1**) against plain search baselines (**B0**, **B0s**). Means are shown with the range across runs in brackets; differences inside the range are noise, not improvement.

> The suite-v1 labels are a **draft** (labelled by one AI labeller, checked against GitHub, not yet double-reviewed). Treat the numbers as provisional.

**Evolution (`/evolution`)** — "Changed only on evidence." Open Eye tunes its own ranking configuration, but a change is promoted only if it wins on the benchmark and passes a replay gate. The page shows the **active configuration**, proposals **waiting for approval** (with **Benchmark win / No benchmark win**), and the **history** of promotions, rejections and rollbacks. A maintainer can **Approve and promote**, **Reject**, or **Roll back**. Code and security changes are never applied automatically — they go through a reviewed pull request.

---

## 10. Honest limits (what it will not do)

- It never bypasses a login, a paywall, a CAPTCHA or a rate limit. A sign-in wall is reported as blocked, not worked around.
- The **stealth browser** (decision 14) reads *public* pages that turn away ordinary bots (LinkedIn/X public posts, Medium, docs behind bot protection) — public content only. See [PRODUCT_DEFINITION.md §14](PRODUCT_DEFINITION.md) and [TECHNOLOGY_DECISIONS.md TD-09](TECHNOLOGY_DECISIONS.md).
- A claim it could not verify is labelled E4/E5 or **Unresolved**, never presented as fact.
- Build mode runs only in a sandbox and pushes nowhere until you approve a pull request.

---

## 11. Running Open Eye

### 11.1 The three parts

| Part | What it is | Port |
|---|---|---|
| **Web app** | Next.js UI + API routes | 3000 (dev) |
| **Worker** | Python pipeline: indexing, research, builds; also serves the scraper | 8001 (scraper) |
| **Database** | PostgreSQL + pgvector | 5432 |

The web app and the worker never call each other directly — the database (including the job queue) is the only contract between them. Start the web app and nothing happens to a brief until the worker picks the job up.

### 11.2 First run (local)

```bash
pnpm install
pnpm run db:migrate        # create the schema
pnpm run db:seed           # optional: demo data
pnpm run dev               # web app on http://localhost:3000
```

In a second terminal, start the worker (from the repo root), with the same `DATABASE_URL`:

```bash
python -m apps.worker.worker
```

The worker also starts the scraper on port 8001. Open `http://localhost:3000`, add a repository, and you are running.

Check everything is healthy at **`/api/health`** — it reports the database, worker heartbeat and each provider's connectivity.

### 11.3 Configuration

Copy `.env.example` to `.env` and fill it in. The ones that matter most:

| Variable | Why |
|---|---|
| `DATABASE_URL`, `DATABASE_POOLED_URL` | Postgres connection |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL` | The reasoning model (Mistral by default) |
| `EMBEDDING_PROVIDER`, `EMBEDDING_API_KEY`, `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS` | Embeddings for search |
| `GITHUB_TOKEN` | Higher GitHub rate limits during discovery (without it, discovery runs slower) |
| `TAVILY_API_KEY` | Live web search (Studio Web/Both mode, docs discovery) |
| `FIRECRAWL_API_KEY` | Cleaner web-page extraction (optional; native fallback otherwise) |
| `MAX_REPOSITORY_SIZE_MB` | Largest repository to index (default 100) |

Feature switches:

| Variable | Effect |
|---|---|
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET`, `AUTH_SECRET` | Turns on GitHub sign-in and per-workspace separation. Without them, everyone shares one workspace as maintainer. |
| `REQUIRE_AUTH=true` | Refuses to serve without sign-in configured (use in production). |
| `WORKER_SCRAPER_URL` | Points the research path at the scraper service (browser tier). |
| `SANDBOX_PROVIDER` | `docker` (default, needs a Docker daemon) or `e2b` (needs `E2B_API_KEY`). Build mode and E1 checks need this. |
| `GITHUB_BUILD_TOKEN` | Enables pull-request delivery from build mode. |
| `STACKEXCHANGE_KEY` | Higher Stack Exchange limits for the docs step (optional). |

### 11.4 Running the evaluation

The numbers on `/evaluation` come from a harness, run from the command line and committed to `eval/results/`. See [eval/README.md](../eval/README.md). In outline:

```bash
# record a run against the benchmark, then replay/fill to measure variants
python -m apps.worker.eval.run --suite eval/suite-v1 --system b1 --mode record
python -m apps.worker.eval.report eval/results/suite-v1/<run>.json
```

---

## 12. Quick reference

| I want to… | Do this |
|---|---|
| Ask about code I have | Studio (`/`), **Search in: Library** |
| Research what to build | Briefs (`/briefs`) → paste brief → **Find existing implementations** |
| Correct a wrong decision | **Challenge this decision** on the requirement |
| Dig into one requirement | **Investigate deeper** on it |
| Let a run spend more | Raise the budget → **Raise budget and continue** |
| Have Open Eye write the code | **Build** panel (blueprint complete, maintainer) → authorise → **Start build** |
| Ship the result | **Deliver as a pull request** (needs `GITHUB_BUILD_TOKEN`) |
| See what it can do across repos | Capabilities (`/capabilities`) |
| Fix something it remembers wrong | Memory (`/memory`) → **This is wrong** |
| Check it is healthy | `/api/health` |
