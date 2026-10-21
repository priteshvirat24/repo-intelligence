import os
import re
import sys
import time
import signal
import socket
import threading
import hashlib
from pathlib import Path
from typing import Optional, Dict, Any, List

from .config import config
from .github.client import GitHubWorkerClient
from .github.clone import GitCloner
from .analyzer.file_filter import FileFilter
from .analyzer.metadata import ManifestAnalyzer
from .analyzer.ast_parser import TreeSitterAnalyzer
from .analyzer.doc_parser import DocumentParser
from .analyzer.chunker import SemanticChunker, SemanticChunk
from .analyzer.capability import CapabilityEngine
from .analyzer.cartography import RepositoryCartographer
from .analyzer.module_analyzer import ModuleAnalyzer
from .analyzer.synthesis import RepositorySynthesizer
from .analyzer.evidence import EvidenceVerificationGate
from .analyzer.repo_digest import (
    readme_digest, file_doc_line, detect_families, format_families, compact_outline,
    mostly_non_latin, is_english_readme_variant,
)
from .providers.llm import get_llm_provider
from .providers.embeddings import get_embedding_provider
from .db.repository import DatabaseRepository, JobLostError
from .discovery.github_search import GitHubRateLimited
from .orchestrator.store import DEFAULT_BUDGET, TaskStore
from .orchestrator.handlers import HANDLERS, TaskContext, fingerprint
from .memory import MemoryMaintenance
from .builder.runner import BuildStore, process_build

# The progress step shown while each task runs (discovery refines it as it goes)
TASK_STEP = {"understand": "UNDERSTANDING", "recall": "RECALLING_MEMORY", "discover": "PLANNING_QUERIES", "verify": "VERIFYING",
             "docs": "READING_DOCS", "execute": "EXECUTING", "blueprint": "DESIGNING"}
from .providers import ledger
from . import tuning as tuning_registry

# Error messages that mean "try again later" rather than "this repository cannot be indexed"
_TRANSIENT_MARKERS = (
    "LLM_UNAVAILABLE", "LLM_INVALID_JSON", "EMBEDDING_RATE_LIMITED", "EMBEDDING_COUNT_MISMATCH",
    "Could not resolve host", "timed out", "Timeout", "Connection reset", "Connection refused",
    "early EOF", "RPC failed", "The requested URL returned error: 5", "unable to access",
    "server closed the connection", "could not connect to server", "SSL", "Temporary failure",
)


def is_transient_error(error: Exception) -> bool:
    """True for failures worth retrying: network/provider/database blips, not bad input."""
    import httpx
    import psycopg2
    import subprocess
    if isinstance(error, (TimeoutError, ConnectionError, subprocess.TimeoutExpired, psycopg2.OperationalError)):
        return True
    if isinstance(error, httpx.HTTPStatusError):
        return error.response.status_code == 429 or error.response.status_code >= 500
    if isinstance(error, httpx.TransportError):
        return True
    message = str(error)
    if message.startswith("REPOSITORY_TOO_LARGE") or "Repository not found" in message or "not found in database" in message:
        return False
    if re.search(r"returned error: (401|403|404|410|451)\b", message):
        return False  # deleted, private, or DMCA/disabled: retrying cannot help
    return any(marker in message for marker in _TRANSIENT_MARKERS)


CODE_EXTENSIONS = (".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".rs",
                   ".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx", ".java")


def select_chunks(chunks: List[SemanticChunk], budget: int) -> List[SemanticChunk]:
    """
    Picks up to `budget` chunks spread across the repository instead of the first N in walk order.
    Docs (README first) may take at most a third of the budget; the rest is filled round-robin across
    code files, sampled evenly over the sorted file list when there are more files than slots.
    """
    if len(chunks) <= budget:
        return list(chunks)
    by_file: Dict[str, List[SemanticChunk]] = {}
    for chunk in chunks:
        by_file.setdefault(chunk.file_path, []).append(chunk)

    def round_robin(files: List[str], limit: int) -> List[SemanticChunk]:
        if limit <= 0 or not files:
            return []
        if len(files) > limit:
            step = len(files) / limit  # evenly spaced sample across the whole list
            files = [files[int(k * step)] for k in range(limit)]
        picked: List[SemanticChunk] = []
        depth = 0
        while len(picked) < limit:
            added = False
            for file_path in files:
                if depth < len(by_file[file_path]):
                    picked.append(by_file[file_path][depth])
                    added = True
                    if len(picked) >= limit:
                        break
            if not added:
                break
            depth += 1
        return picked

    def is_doc(file_path: str) -> bool:
        return by_file[file_path][0].doc_type in ("readme", "doc")

    doc_files = sorted((f for f in by_file if is_doc(f)), key=lambda f: (by_file[f][0].doc_type != "readme", f))
    other_files = sorted(f for f in by_file if not is_doc(f))
    docs = round_robin(doc_files, budget // 3 if other_files else budget)
    rest = round_robin(other_files, budget - len(docs))
    if len(docs) + len(rest) < budget and len(docs) < sum(len(by_file[f]) for f in doc_files):
        # Few code chunks: give the unused share back to docs
        docs = round_robin(doc_files, budget - len(rest))
    return docs + rest


def _named_items(value: Any) -> List[Dict[str, Any]]:
    """LLM list fields: keep only objects that actually have a name (never invent one)."""
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, dict) and isinstance(item.get("name"), str) and item["name"].strip()]


class IngestionWorker:
    """Production-grade asynchronous repository ingestion worker."""

    def __init__(self, worker_id: str = "worker-1"):
        self.worker_id = worker_id
        self.running = True
        self.active_job: Optional[Dict[str, Any]] = None
        self.active_task: Optional[Dict[str, Any]] = None
        self.active_build: Optional[Dict[str, Any]] = None
        self.db = DatabaseRepository()
        self.tasks = TaskStore(self.db)
        # Phase 4: revalidation and distillation of memory while idle, at most every few minutes
        self.memory = MemoryMaintenance(self.db)
        self.builds = BuildStore(self.db)
        # Every LLM and embedding call is recorded in provider_usage
        ledger.add_sink(ledger.DatabaseSink(self.db))
        self.llm = get_llm_provider()
        self.embedding_provider = get_embedding_provider()
        if self.embedding_provider.get_dimensions() != config.EMBEDDING_DIMENSIONS:
            # Every chunk insert would fail against the vector(EMBEDDING_DIMENSIONS) column
            raise RuntimeError(
                f"Embedding provider {type(self.embedding_provider).__name__} produces "
                f"{self.embedding_provider.get_dimensions()}-d vectors but EMBEDDING_DIMENSIONS="
                f"{config.EMBEDDING_DIMENSIONS}; set them to match the database column."
            )
        self.file_filter = FileFilter()
        self.manifest_analyzer = ManifestAnalyzer()

        # Register graceful shutdown signals
        signal.signal(signal.SIGINT, self._handle_shutdown)
        signal.signal(signal.SIGTERM, self._handle_shutdown)

        print(f"[{self.worker_id}] Initialized. LLM: {type(self.llm).__name__}, Embeddings: {type(self.embedding_provider).__name__} ({self.embedding_provider.get_dimensions()}d)")

    def _handle_shutdown(self, signum, frame):
        print(f"\n[{self.worker_id}] Received shutdown signal ({signum}). Initiating graceful shutdown...", flush=True)
        self.running = False
        try:
            self.db.record_heartbeat(self.worker_id, status="STOPPED")
        except Exception:
            pass
        if self.active_job:
            try:
                print(f"[{self.worker_id}] Releasing locked job {self.active_job['id']} back to queue...", flush=True)
                self.db.release_job_on_shutdown(self.active_job["id"], self.active_job["repository_id"], self.worker_id)
            except Exception as e:
                print(f"[{self.worker_id}] Error releasing job: {e}", file=sys.stderr, flush=True)
        if self.active_task:
            try:
                print(f"[{self.worker_id}] Releasing task {self.active_task['type']} of brief {self.active_task['brief_id']}...", flush=True)
                self.tasks.release(self.active_task, self.worker_id)
            except Exception as e:
                print(f"[{self.worker_id}] Error releasing task: {e}", file=sys.stderr, flush=True)
        if self.active_build:
            try:
                self.builds.release(str(self.active_build["id"]), self.worker_id)
            except Exception as e:
                print(f"[{self.worker_id}] Error releasing build: {e}", file=sys.stderr, flush=True)
        sys.exit(0)

    def _start_lock_heartbeat(self, job_id: str) -> threading.Event:
        """Refreshes the job lock every minute while a job runs, so long LLM passes are not mistaken
        for a dead worker (and the job is not reclaimed and run twice)."""
        stop = threading.Event()

        def beat():
            while not stop.wait(60):
                try:
                    if not self.db.refresh_lock(job_id, self.worker_id):
                        return  # cancelled or superseded; the main flow notices at its next ownership check
                except Exception as beat_error:
                    print(f"[{self.worker_id}] Lock heartbeat failed for {job_id}: {beat_error}", file=sys.stderr)

        threading.Thread(target=beat, name=f"lock-heartbeat-{job_id}", daemon=True).start()
        return stop

    def process_job(self, job: Dict[str, Any]):
        job_id = job["id"]
        repo_id = job["repository_id"]
        self.active_job = job
        heartbeat = self._start_lock_heartbeat(job_id)

        stage_metrics: Dict[str, Any] = {
            "durations": {},
            "counts": {}
        }
        total_start = time.time()
        scratch_dir: Optional[Path] = None

        try:
            # 1. Fetch Repository Details
            conn = self.db.get_connection()
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT id, owner, name, url, default_branch, latest_commit_hash FROM repositories WHERE id = %s", (repo_id,))
                    row = cur.fetchone()
            finally:
                conn.close()

            if not row:
                raise ValueError(f"Repository {repo_id} not found in database.")

            repo_owner, repo_name, repo_url, default_branch, existing_commit = row[1], row[2], row[3], row[4], row[5]
            print(f"[{self.worker_id}] Ingesting {repo_owner}/{repo_name} (Job: {job_id})", flush=True)

            # 2. Stage: CLONING
            print(f"[{self.worker_id}] Starting Stage: CLONING...", flush=True)
            s_time = time.time()
            self.db.update_job_step(job_id, repo_id, "CLONING", "CLONING", self.worker_id)
            # Phase 2: a repository over the size limit is analysed partially (scope set by the brief's verify task)
            scope = self._job_scope(job_id)
            partial: Optional[Dict[str, Any]] = None
            if scope.get("mode") == "partial":
                scratch_dir, commit_sha, partial = GitCloner.partial_clone(
                    repo_url, default_branch or "main", scope.get("focusTerms") or [],
                    config.MAX_REPOSITORY_SIZE_MB * 1024 * 1024, config.MAX_FILES)
            else:
                scratch_dir, commit_sha = GitCloner.clone(repo_url, default_branch or "main")
            # Safety net for disk usage (submission checks the same limit via the GitHub API)
            checkout_bytes = GitCloner.checkout_size_bytes(scratch_dir)
            if checkout_bytes > config.MAX_REPOSITORY_SIZE_MB * 1024 * 1024:
                raise ValueError(
                    f"REPOSITORY_TOO_LARGE: Checked-out files total {checkout_bytes // (1024 * 1024)}MB, "
                    f"exceeding the limit of {config.MAX_REPOSITORY_SIZE_MB}MB."
                )
            stage_metrics["durations"]["cloning_ms"] = int((time.time() - s_time) * 1000)
            print(f"[{self.worker_id}] CLONING complete in {stage_metrics['durations']['cloning_ms']}ms. SHA: {commit_sha}", flush=True)

            # 3. Stage: FILE_FILTERING
            print(f"[{self.worker_id}] Starting Stage: FILE_FILTERING...", flush=True)
            s_time = time.time()
            self.db.update_job_step(job_id, repo_id, "FILE_FILTERING", "ANALYZING", self.worker_id)
            scan_result = self.file_filter.scan_repository(scratch_dir)
            stage_metrics["counts"]["files_discovered"] = scan_result["discovered_files"]
            stage_metrics["counts"]["files_included"] = len(scan_result["included_files"])
            stage_metrics["counts"]["files_excluded"] = scan_result["excluded_files_count"]
            stage_metrics["durations"]["filtering_ms"] = int((time.time() - s_time) * 1000)
            print(f"[{self.worker_id}] FILE_FILTERING complete: {len(scan_result['included_files'])} included files.", flush=True)

            # 4. Stage: MANIFEST_ANALYSIS
            print(f"[{self.worker_id}] Starting Stage: MANIFEST_ANALYSIS...", flush=True)
            s_time = time.time()
            self.db.update_job_step(job_id, repo_id, "MANIFEST_ANALYSIS", "ANALYZING", self.worker_id)
            dependencies = self.manifest_analyzer.analyze_all(scratch_dir)
            stage_metrics["counts"]["dependencies_found"] = len(dependencies)
            stage_metrics["durations"]["manifest_ms"] = int((time.time() - s_time) * 1000)
            print(f"[{self.worker_id}] MANIFEST_ANALYSIS complete: {len(dependencies)} deps found.", flush=True)

            # 5. Stage: AST_ANALYSIS & DOC_PARSING
            print(f"[{self.worker_id}] Starting Stage: AST_ANALYSIS...", flush=True)
            s_time = time.time()
            self.db.update_job_step(job_id, repo_id, "AST_ANALYSIS", "ANALYZING", self.worker_id)
            documents: List[Dict[str, Any]] = []
            all_chunks: List[SemanticChunk] = []
            readme_text = ""
            readme_depth: Optional[int] = None
            english_readme_text = ""
            # Per code file: one-line purpose and top-level symbols, for the analysis passes
            file_infos: Dict[str, Dict[str, Any]] = {}
            symbol_outlines: List[str] = []
            ast_files_count = 0
            symbols_count = 0

            for rel_path, classification, file_size in scan_result["included_files"]:
                full_path = scratch_dir / rel_path
                try:
                    content = full_path.read_text(errors="ignore")
                except Exception:
                    continue
                if "\x00" in content:
                    # Binary or UTF-16 content: PostgreSQL text columns cannot store NUL bytes
                    continue

                content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
                ext = full_path.suffix.lower()

                if is_english_readme_variant(rel_path) and not english_readme_text:
                    english_readme_text = content
                if Path(rel_path).stem.lower() == "readme":
                    # The shallowest README describes the repository; nested ones describe examples/subpackages
                    depth = len(Path(rel_path).parts)
                    if readme_depth is None or depth < readme_depth:
                        readme_text = content
                        readme_depth = depth
                    doc_type = "readme"
                elif ext in (".md", ".rst", ".txt"):
                    doc_type = "doc"
                elif ext in CODE_EXTENSIONS:
                    doc_type = "code"
                else:
                    doc_type = "config"

                documents.append({
                    "file_path": rel_path,
                    "doc_type": doc_type,
                    "language": ext.replace(".", "") if ext else "text",
                    "token_count": max(1, len(content) // 4),
                    "content_hash": content_hash
                })

                # AST extraction on code files
                if doc_type == "code":
                    ast_files_count += 1
                    try:
                        symbols = TreeSitterAnalyzer.analyze_file(rel_path, content)
                    except (Exception, RecursionError) as ex:
                        # One pathological file (e.g. deeply nested expression) must not fail the repository
                        print(f"[{self.worker_id}] Warning: AST analysis failed for {rel_path}: {ex}", file=sys.stderr)
                        symbols = []
                    symbols_count += len(symbols)
                    file_infos[rel_path] = {
                        "doc": file_doc_line(rel_path, content),
                        "classes": [s.name for s in symbols if s.symbol_type in ("class", "struct", "interface", "trait", "enum", "record")],
                        "functions": [s.name for s in symbols if s.symbol_type == "function"][:12],
                    }
                    if symbols:
                        outline = TreeSitterAnalyzer.generate_symbol_outline(rel_path, symbols)
                        symbol_outlines.append(outline)

                # Chunking
                chunks = SemanticChunker.chunk_text(
                    text=content,
                    file_path=rel_path,
                    doc_type=doc_type,
                    language=ext.replace(".", "")
                )
                all_chunks.extend(chunks)

            stage_metrics["counts"]["ast_files_parsed"] = ast_files_count
            stage_metrics["counts"]["symbols_discovered"] = symbols_count
            stage_metrics["counts"]["documents_created"] = len(documents)
            stage_metrics["durations"]["ast_ms"] = int((time.time() - s_time) * 1000)

            # What the analysis passes read: the informative parts of the README (an English variant when
            # the main README is mostly in another language) and families of sibling implementations
            if english_readme_text and mostly_non_latin(readme_text):
                readme_text = english_readme_text
            readme_summary = readme_digest(readme_text, 6000)
            families = detect_families(file_infos)
            families_summary = format_families(families)
            stage_metrics["counts"]["implementation_families"] = len(families)

            # 6. Stage: HIERARCHICAL OPEN-WORLD UNDERSTANDING & SYNTHESIS
            s_time = time.time()
            self.db.update_job_step(job_id, repo_id, "CAPABILITY_EXTRACTION", "ANALYZING", self.worker_id)
            
            manifest_summary = ", ".join(d["package_name"] for d in dependencies[:25])
            full_repo_name = f"{repo_owner}/{repo_name}"

            # PASS 1: Repository Cartography
            print(f"[{self.worker_id}] Running Pass 1: Repository Cartography for {full_repo_name}...")
            cartography = RepositoryCartographer.analyze(
                repo_name=full_repo_name,
                repo_dir=scratch_dir,
                readme_text=readme_summary,
                manifest_summary=manifest_summary,
                llm=self.llm
            )

            # PASS 2: Module / Subsystem Analysis
            print(f"[{self.worker_id}] Running Pass 2: Module Understanding for {full_repo_name}...")
            module_analyses = []
            subsystems = [sub for sub in (cartography.get("majorSubsystems") or []) if isinstance(sub, dict)]
            if not subsystems:
                # Infer top subsystems from code directories
                code_dirs = sorted(list(set(str(Path(f[0]).parent) for f in scan_result["included_files"] if Path(f[0]).suffix.lower() in CODE_EXTENSIONS and str(Path(f[0]).parent) != ".")))
                subsystems = [{"name": Path(d).name or d, "path": d} for d in code_dirs[:config.MAX_SUBSYSTEMS]]

            subsystems_found = len(subsystems)
            subsystems = subsystems[:config.MAX_SUBSYSTEMS]
            for sub in subsystems:
                # The model sometimes returns a list of paths for one subsystem
                raw_path = sub.get("path")
                sub_paths = [p for p in (raw_path if isinstance(raw_path, list) else [raw_path]) if isinstance(p, str) and p]
                sub_path = ", ".join(sub_paths)
                # Every file of the subsystem, compacted, instead of the first 15 outlines cut at 3000 chars
                sub_text = compact_outline(file_infos, sub_paths, 6000) or "\n".join(
                    so for so in symbol_outlines if any(p in so for p in sub_paths)
                )[:6000]
                sub_docs = "\n".join(
                    f"{path}: {info['doc']}" for path, info in sorted(file_infos.items())
                    if info.get("doc") and any(path == sp or path.startswith(sp.rstrip('/') + '/') for sp in sub_paths)
                )
                try:
                    mod_res = ModuleAnalyzer.analyze_module(
                        module_name=str(sub.get("name") or sub_path),
                        module_path=sub_path,
                        symbol_outline=sub_text,
                        doc_excerpt=sub_docs,
                        llm=self.llm
                    )
                    module_analyses.append(mod_res)
                except Exception as ex:
                    print(f"[{self.worker_id}] Warning: Module analysis failed for {sub_path}: {ex}", file=sys.stderr)

            # PASS 3: Repository Synthesis (Open-World Knowledge Model)
            print(f"[{self.worker_id}] Running Pass 3: Repository Synthesis for {full_repo_name}...")
            synthesis = RepositorySynthesizer.synthesize(
                repo_name=full_repo_name,
                cartography=cartography,
                module_analyses=module_analyses,
                manifest_deps=dependencies,
                llm=self.llm,
                readme_summary=readme_summary,
                families_summary=families_summary
            )

            proposal_counts = {
                key: len(synthesis.get(key) or []) if isinstance(synthesis.get(key), list) else 0
                for key in ("capabilities", "features", "concepts", "techniques", "useCases", "components", "interfaces")
            }
            print(f"[{self.worker_id}] Synthesis proposed: {proposal_counts}", flush=True)
            if not any(proposal_counts.values()):
                # An empty analysis must not replace a repository's existing knowledge; retry instead
                raise ValueError("LLM_INVALID_JSON: repository synthesis returned no capabilities, features, or concepts")

            # PASS 4: Evidence Mapping & Verification
            print(f"[{self.worker_id}] Running Pass 4: Strict Evidence Verification Gate...")
            verified_capabilities = []
            proposed_caps = synthesis.get("capabilities", [])
            verified_caps_count = 0
            rejected_ev_count = 0

            for cap in proposed_caps:
                if not isinstance(cap, dict) or not cap.get("name"):
                    continue
                cap_name = str(cap["name"])
                slug = CapabilityEngine.map_slug(cap.get("slug") or cap_name)
                category = cap.get("category") or "uncategorized"
                notes = cap.get("description", "")
                try:
                    confidence = min(1.0, max(0.1, float(cap.get("confidence"))))
                except (TypeError, ValueError):
                    confidence = 0.5

                valid_evidence_items = []
                for ev in cap.get("evidence") or []:
                    if not isinstance(ev, dict):
                        rejected_ev_count += 1
                        continue
                    check = EvidenceVerificationGate.verify_evidence(scratch_dir, ev)
                    if check.get("verified"):
                        location = (check.get("file_path"), check.get("start_line"), check.get("end_line"))
                        # Two claims can resolve to the same definition; keep each location once
                        if all((v.get("file_path"), v.get("start_line"), v.get("end_line")) != location for v in valid_evidence_items):
                            valid_evidence_items.append(check)
                    else:
                        rejected_ev_count += 1

                # No verified evidence -> the capability is not persisted (never fabricate evidence)
                if valid_evidence_items:
                    verified_caps_count += 1
                    verified_capabilities.append({
                        "slug": slug,
                        "name": cap_name,
                        "category": category,
                        "confidence": confidence,
                        "notes": notes,
                        "evidence": valid_evidence_items
                    })

            stage_metrics["counts"]["capabilities_proposed"] = len(proposed_caps)
            stage_metrics["counts"]["capabilities_verified"] = verified_caps_count
            stage_metrics["counts"]["evidence_rejected"] = rejected_ev_count
            stage_metrics["durations"]["capabilities_ms"] = int((time.time() - s_time) * 1000)

            # Build Open-World Knowledge Objects (Multi-level representations)
            knowledge_objects: List[Dict[str, Any]] = []

            # 1. Repository Profile semantic object
            knowledge_objects.append({
                "object_type": "repository_profile",
                "name": full_repo_name,
                "description": f"{synthesis.get('purpose', '')} Problem space: {synthesis.get('problemSpace', '')}",
                "category": synthesis["domains"][0] if synthesis.get("domains") else "uncategorized",
                "importance": "critical",
                "confidence": 1.0,
                "metadata_json": {
                    "domains": synthesis.get("domains", []),
                    "architecture": synthesis.get("architecture", {})
                }
            })

            # 2. Capabilities
            for vc in verified_capabilities:
                knowledge_objects.append({
                    "object_type": "capability",
                    "name": vc["name"],
                    "description": vc.get("notes", vc["name"]),
                    "category": vc.get("category") or "uncategorized",
                    "importance": "high",
                    "confidence": vc.get("confidence", 0.95),
                    "evidence": vc.get("evidence", []),
                    "metadata_json": {"slug": vc["slug"]}
                })

            # 3. Features
            for feat in _named_items(synthesis.get("features")):
                knowledge_objects.append({
                    "object_type": "feature",
                    "name": feat["name"],
                    "description": feat.get("description", ""),
                    "category": "feature",
                    "importance": "high",
                    "confidence": 0.90
                })

            # 4. Domain Concepts
            for conc in _named_items(synthesis.get("concepts")):
                knowledge_objects.append({
                    "object_type": "concept",
                    "name": conc["name"],
                    "description": conc.get("description", ""),
                    "category": "domain-concept",
                    "importance": "medium",
                    "confidence": 0.88
                })

            # 5. Techniques
            for tech in _named_items(synthesis.get("techniques")):
                knowledge_objects.append({
                    "object_type": "technique",
                    "name": tech["name"],
                    "description": tech.get("description", ""),
                    "category": "technique",
                    "importance": "medium",
                    "confidence": 0.88
                })

            # 6. Use Cases
            for uc in _named_items(synthesis.get("useCases")):
                knowledge_objects.append({
                    "object_type": "use_case",
                    "name": uc["name"],
                    "description": uc.get("description", ""),
                    "category": "use-case",
                    "importance": "high",
                    "confidence": 0.92
                })

            # 7. Subsystems / Components
            for comp in _named_items(synthesis.get("components")):
                knowledge_objects.append({
                    "object_type": "component",
                    "name": comp["name"],
                    "description": comp.get("description", ""),
                    "category": "subsystem",
                    "importance": "medium",
                    "confidence": 0.90
                })

            # 8. Interfaces (Classes, APIs, CLI entry points)
            for iface in _named_items(synthesis.get("interfaces")):
                knowledge_objects.append({
                    "object_type": "interface",
                    "name": iface["name"],
                    "description": iface.get("description", ""),
                    "category": iface.get("type", "class"),
                    "importance": "high",
                    "confidence": 0.90
                })

            # 9. Semantic Inputs
            for inp in _named_items(synthesis.get("inputs")):
                knowledge_objects.append({
                    "object_type": "input",
                    "name": inp["name"],
                    "description": inp.get("format", ""),
                    "category": "data-input",
                    "importance": "medium",
                    "confidence": 0.88
                })

            # 10. Semantic Outputs
            for out in _named_items(synthesis.get("outputs")):
                knowledge_objects.append({
                    "object_type": "output",
                    "name": out["name"],
                    "description": out.get("format", ""),
                    "category": "data-output",
                    "importance": "medium",
                    "confidence": 0.88
                })

            # 11. Limitations
            all_limitations = [l for l in (synthesis.get("limitations") or []) if isinstance(l, dict) and l.get("description")]
            for lim in all_limitations:
                knowledge_objects.append({
                    "object_type": "limitation",
                    "name": lim.get("category") or "limitation",
                    "description": lim.get("description", ""),
                    "category": lim.get("category", "scalability"),
                    "importance": "low",
                    "confidence": 0.85
                })

            # 7. Stage: INDEXING (Multi-Level Embedding Generation)
            s_time = time.time()
            self.db.update_job_step(job_id, repo_id, "INDEXING", "INDEXING", self.worker_id)

            # A. Embed Knowledge Objects
            ko_texts = [f"{ko['name']}: {ko['description']}" for ko in knowledge_objects]
            ko_embeddings = self.embedding_provider.embed_texts(ko_texts) if ko_texts else []
            if len(ko_embeddings) != len(ko_texts):
                raise RuntimeError(f"EMBEDDING_COUNT_MISMATCH: {len(ko_embeddings)} vectors for {len(ko_texts)} knowledge objects")
            for idx, ko in enumerate(knowledge_objects):
                ko["embedding"] = ko_embeddings[idx] if idx < len(ko_embeddings) else None

            # B. Embed Chunks (up to MAX_CHUNKS, spread across files)
            selected_chunks = select_chunks(all_chunks, config.MAX_CHUNKS)
            chunk_dicts = [
                {
                    "file_path": c.file_path,
                    "chunk_index": c.chunk_index,
                    "content": c.content,
                    "chunk_hash": c.chunk_hash,
                    "metadata": c.metadata
                }
                for c in selected_chunks
            ]

            chunk_texts = [c["content"] for c in chunk_dicts]
            chunk_embeddings = self.embedding_provider.embed_texts(chunk_texts) if chunk_texts else []
            if len(chunk_embeddings) != len(chunk_texts):
                raise RuntimeError(f"EMBEDDING_COUNT_MISMATCH: {len(chunk_embeddings)} vectors for {len(chunk_texts)} chunks")

            stage_metrics["counts"]["chunks_created"] = len(chunk_dicts)
            stage_metrics["counts"]["knowledge_objects_created"] = len(knowledge_objects)
            stage_metrics["counts"]["embeddings_generated"] = len(chunk_embeddings) + len(ko_embeddings)
            stage_metrics["durations"]["indexing_ms"] = int((time.time() - s_time) * 1000)

            # 8. Stage: PERSISTING (Atomic Transaction)
            s_time = time.time()
            stage_metrics["durations"]["total_duration_ms"] = int((time.time() - total_start) * 1000)

            domain_tags = [d for d in (synthesis.get("domains") or []) if isinstance(d, str)]
            knowledge_relationships = synthesis.get("relationships", [])

            # Calculate analysis completeness. Files excluded by type (images, lockfiles, licenses) are not
            # "missing" analysis; only budgets that actually cut content make a result partial.
            files_discovered = stage_metrics["counts"].get("files_discovered", 0)
            files_included = stage_metrics["counts"].get("files_included", 0)
            reasons = []
            if scan_result.get("is_truncated", False):
                reasons.append("Repository exceeded the file or text-size budget; some files were not analyzed")
            if len(all_chunks) > len(selected_chunks):
                reasons.append(f"Indexed {len(selected_chunks)} of {len(all_chunks)} text excerpts for search")
            if subsystems_found > len(subsystems):
                reasons.append(f"Studied {len(subsystems)} of {subsystems_found} subsystems in depth")
            if partial is not None:
                shown = ", ".join(partial["paths"]) or "root files only"
                reasons.insert(0, f"{scope.get('reason') or 'Repository exceeds the size limit'}; checked out: {shown}")
            if files_included < 5:
                completeness_level = "limited"
                reasons.insert(0, f"Repository has only {files_included} analyzable file{'s' if files_included != 1 else ''}")
            else:
                completeness_level = "partial" if reasons else "full"
            reason = "; ".join(reasons) or None

            analysis_completeness = {
                "level": completeness_level,
                "filesDiscovered": files_discovered,
                "filesAnalyzed": files_included,
                "subsystemsAnalyzed": len(subsystems),
                "reason": reason
            }
            if partial is not None:
                analysis_completeness["analysedPaths"] = partial["paths"]
                analysis_completeness["skippedPaths"] = partial["skipped"]

            self.db.persist_ingestion_atomic(
                job_id=job_id,
                repo_id=repo_id,
                commit_hash=commit_sha,
                documents=documents,
                chunks=chunk_dicts,
                embeddings=chunk_embeddings,
                capabilities=verified_capabilities,
                dependencies=dependencies,
                limitations=all_limitations,
                stage_metrics=stage_metrics,
                domain_tags=domain_tags,
                open_knowledge_json=synthesis,
                knowledge_objects=knowledge_objects,
                knowledge_relationships=knowledge_relationships,
                analysis_completeness=analysis_completeness,
                worker_id=self.worker_id
            )

            print(f"[{self.worker_id}] Successfully indexed {full_repo_name} in {stage_metrics['durations']['total_duration_ms']}ms. Caps: {len(verified_capabilities)}, KOs: {len(knowledge_objects)}, Chunks: {len(chunk_dicts)}, Completeness: {completeness_level}", flush=True)

        except JobLostError as e:
            # Cancelled by the user, superseded by a newer ingestion, or reclaimed after a stall
            print(f"[{self.worker_id}] Abandoning job {job_id}: {e}", file=sys.stderr)
            try:
                self.db.abandon_lost_job(job_id, self.worker_id, f"Abandoned: {e}")
            except Exception as close_error:
                print(f"[{self.worker_id}] Could not close abandoned job {job_id}: {close_error}", file=sys.stderr)
        except Exception as e:
            err_msg = str(e)
            attempts = int(job.get("attempts") or 1)
            if is_transient_error(e) and attempts < config.MAX_JOB_ATTEMPTS:
                delay = 60 * (2 ** (attempts - 1))  # 1 min, 2 min, 4 min ...
                print(f"[{self.worker_id}] Transient failure for job {job_id} (attempt {attempts}/{config.MAX_JOB_ATTEMPTS}), retrying in {delay}s: {err_msg}", file=sys.stderr)
                try:
                    self.db.requeue_job_for_retry(job_id, repo_id, f"Retrying after a temporary error: {err_msg}"[:1000], self.worker_id, delay)
                except Exception as requeue_error:
                    print(f"[{self.worker_id}] Could not requeue job {job_id}: {requeue_error}", file=sys.stderr)
                    self.db.mark_job_failed(job_id, repo_id, err_msg, self.worker_id)
            else:
                print(f"[{self.worker_id}] Ingestion failed for job {job_id}: {err_msg}", file=sys.stderr)
                self.db.mark_job_failed(job_id, repo_id, err_msg, self.worker_id)
        finally:
            heartbeat.set()
            if scratch_dir:
                GitCloner.cleanup(scratch_dir)
            self.active_job = None

    def _job_scope(self, job_id: str) -> Dict[str, Any]:
        """The job's analysis scope (ingestion_jobs.scope_json, migration 010); {} means the whole repository."""
        conn = self.db.get_connection()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT scope_json FROM ingestion_jobs WHERE id = %s", (job_id,))
                row = cur.fetchone()
        finally:
            conn.close()
        return (row[0] if row else None) or {}

    def process_task(self, task: Dict[str, Any]):
        """Runs one task of a brief's run graph inside the brief's budget and ledger scope."""
        self.active_task = task
        brief_id = str(task["brief_id"])
        try:
            loaded = self.tasks.load_context(brief_id)
            brief = loaded["brief"]
            active = tuning_registry.load_active(self.db)
            ctx = TaskContext(
                task=task, brief=brief, outputs=loaded["outputs"], tuning=active,
                llm_for=lambda key: self._llm_for(active, key), db=self.db,
                set_step=lambda step: self.tasks.set_step(brief_id, step),
                heartbeat=lambda: self.tasks.heartbeat(task, self.worker_id),
            )
            fp = fingerprint(ctx)
            previous = task.get("output_json") or {}
            self.tasks.set_step(brief_id, TASK_STEP[task["type"]])
            if fp == task.get("inputs_fingerprint") and task.get("output_hash") and previous.get("phase") != "waiting":
                # Inputs unchanged since the last successful run: the result still holds, nothing downstream changes
                self.tasks.complete(task, previous, fp, self.worker_id)
                print(f"[{self.worker_id}] {task['type']} for brief {brief_id}: inputs unchanged, reused", flush=True)
                return

            budget_cfg = brief.get("budget_json") or {}
            limits = {**DEFAULT_BUDGET, **(budget_cfg.get("limits") or {})}
            budget = ledger.Budget(limits, self.tasks.budget_usage(brief_id, budget_cfg.get("resetAt")))
            with ledger.budget_scope(budget), ledger.ledger_scope(scope_type="brief", scope_id=brief_id, tuning_version=active.version):
                outcome = HANDLERS[task["type"]](ctx)
            if outcome.kind == "wait":
                self.tasks.wait(task, outcome.wait_seconds, self.worker_id, outcome.output, fp, outcome.persist)
            elif outcome.kind == "await_input":
                self.tasks.await_input(task, outcome.output, fp, self.worker_id, outcome.persist)
                print(f"[{self.worker_id}] {task['type']} for brief {brief_id} needs answers before research continues", flush=True)
            else:
                self.tasks.complete(task, outcome.output, fp, self.worker_id, outcome.persist)
                print(f"[{self.worker_id}] {task['type']} for brief {brief_id} done", flush=True)
        except JobLostError as e:
            print(f"[{self.worker_id}] Abandoning {task['type']} for brief {brief_id}: {e}", file=sys.stderr)
        except ledger.BudgetExceeded as e:
            print(f"[{self.worker_id}] {task['type']} for brief {brief_id} stopped: {e}", file=sys.stderr)
            self._try(lambda: self.tasks.fail(task, str(e), self.worker_id, stop_reason="budget"))
        except Exception as e:
            err_msg = str(e)
            attempts = int(task.get("attempts") or 1)
            if (isinstance(e, GitHubRateLimited) or is_transient_error(e)) and attempts < config.MAX_JOB_ATTEMPTS:
                delay = 60 * (2 ** (attempts - 1))
                print(f"[{self.worker_id}] Transient failure in {task['type']} for brief {brief_id} (attempt {attempts}), retrying in {delay}s: {err_msg}", file=sys.stderr)
                self._try(lambda: self.tasks.retry(task, f"Retrying after a temporary error: {err_msg}", delay, self.worker_id))
            else:
                print(f"[{self.worker_id}] {task['type']} for brief {brief_id} failed: {err_msg}", file=sys.stderr)
                self._try(lambda: self.tasks.fail(task, err_msg, self.worker_id))
        finally:
            self.active_task = None

    @staticmethod
    def _try(action):
        try:
            action()
        except JobLostError:
            pass

    def _llm_for(self, active: "tuning_registry.Tuning", key: str):
        """The model the active tuning routes this task to, or the worker's default provider."""
        model = active.get(key)
        return get_llm_provider(model=model) if model else self.llm

    def run_next(self) -> bool:
        """Processes one unit of work: repository indexing first (verification tasks wait for it), then the next
        ready task of any brief's run graph. Returns False when nothing is waiting."""
        job = self.db.claim_next_job(worker_id=self.worker_id)
        if job:
            self.db.record_heartbeat(self.worker_id, current_job_id=job["id"], status="BUSY")
            with ledger.ledger_scope(scope_type="repository_job", scope_id=str(job["id"])):
                self.process_job(job)
            self.db.record_heartbeat(self.worker_id, status="ALIVE")
            return True
        task = self.tasks.claim_next(self.worker_id)
        if task:
            self.db.record_heartbeat(self.worker_id, status="BUSY", metadata={"briefId": str(task["brief_id"]), "task": task["type"]})
            self.process_task(task)
            self.db.record_heartbeat(self.worker_id, status="ALIVE")
            return True
        # Authorised builds (Phase 6): separate from the run graph, run only in the sandbox
        build = self.builds.claim_next(self.worker_id)
        if build:
            self.active_build = build
            self.db.record_heartbeat(self.worker_id, status="BUSY", metadata={"buildId": str(build["id"])})
            try:
                process_build(self.db, build, lambda key: self._llm_for(tuning_registry.load_active(self.db), key), self.worker_id)
            finally:
                self.active_build = None
            self.db.record_heartbeat(self.worker_id, status="ALIVE")
            return True
        return False

    def run_batch(self):
        print(f"[{self.worker_id}] Batch mode: Processing all queued jobs...", flush=True)
        processed = 0
        while self.running:
            self.db.record_heartbeat(self.worker_id, status="ALIVE")
            if not self.run_next():
                print(f"[{self.worker_id}] No more queued jobs found. Batch completed. Total processed: {processed}", flush=True)
                break
            processed += 1

    def run_loop(self):
        print(f"[{self.worker_id}] Polling PostgreSQL-native queue for ingestion jobs...", flush=True)
        while self.running:
            try:
                self.db.record_heartbeat(self.worker_id, status="ALIVE")
                if not self.run_next():
                    self.memory.maybe_run()
                    self._idle_evolution_monitor()
                    time.sleep(config.WORKER_POLL_INTERVAL_SECONDS)
            except Exception as e:
                print(f"[{self.worker_id}] Queue polling loop error: {e}", file=sys.stderr, flush=True)
                time.sleep(3)

    def _idle_evolution_monitor(self):
        """Phase 5: when idle, at most every few hours, compare live feedback on the promoted tuning with its
        predecessor and roll back on a regression (apps/worker/evolution/monitor.py)."""
        from .evolution import monitor
        if time.time() - getattr(self, "_last_evolution_check", 0.0) < monitor.MONITOR_INTERVAL_SECONDS:
            return
        self._last_evolution_check = time.time()
        try:
            outcome = monitor.check(self.db)
            if outcome["action"] != "none":
                print(f"[{self.worker_id}] Evolution monitor: {outcome['reason']}", flush=True)
        except Exception as e:
            print(f"[{self.worker_id}] Evolution monitor failed: {e}", file=sys.stderr, flush=True)


def start_scraper_daemon(port: int = 8001):
    """Starts the Scrapling & Camoufox HTTP extraction service in a background thread.

    It listens on SCRAPER_HOST (default 127.0.0.1). To serve the web app over a private network, set
    SCRAPER_HOST (e.g. "::" on Railway) together with SCRAPER_SECRET; without the secret it will not
    listen beyond loopback. The socket is bound here, before the thread starts, so a failure is reported
    at startup instead of killing the thread silently."""
    try:
        from .scraper.api import make_server
        host = os.getenv("SCRAPER_HOST", "127.0.0.1")
        server = make_server(port, host, os.getenv("SCRAPER_SECRET"))
        threading.Thread(target=server.serve_forever, name="scraper-service", daemon=True).start()
        print(f"[Worker] Scraper service listening on {host}:{port}", flush=True)
    except Exception as e:
        print(f"[Worker] Could not start the scraper service: {e}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    # Start the Scrapling/Camoufox scraper daemon on the configured port
    start_scraper_daemon(port=int(os.getenv("SCRAPER_PORT", 8001)))

    # Unique per replica: job ownership checks compare locked_by, so replicas must not share an id
    worker = IngestionWorker(worker_id=os.getenv("WORKER_ID") or os.getenv("RAILWAY_REPLICA_ID") or f"worker-{socket.gethostname()}")
    if "--batch" in sys.argv:
        worker.run_batch()
    else:
        worker.run_loop()

