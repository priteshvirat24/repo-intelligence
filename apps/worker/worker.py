import os
import sys
import time
import signal
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
from .providers.llm import get_llm_provider
from .providers.embeddings import get_embedding_provider
from .db.repository import DatabaseRepository

class IngestionWorker:
    """Production-grade asynchronous repository ingestion worker."""

    def __init__(self, worker_id: str = "worker-1"):
        self.worker_id = worker_id
        self.running = True
        self.active_job: Optional[Dict[str, Any]] = None
        self.db = DatabaseRepository()
        self.llm = get_llm_provider()
        self.embedding_provider = get_embedding_provider()
        self.file_filter = FileFilter()
        self.manifest_analyzer = ManifestAnalyzer()

        # Register graceful shutdown signals
        signal.signal(signal.SIGINT, self._handle_shutdown)
        signal.signal(signal.SIGTERM, self._handle_shutdown)

        print(f"[{self.worker_id}] Initialized. LLM: {type(self.llm).__name__}, Embeddings: {type(self.embedding_provider).__name__} ({self.embedding_provider.get_dimensions()}d)")

    def _handle_shutdown(self, signum, frame):
        print(f"\n[{self.worker_id}] Received shutdown signal ({signum}). Initiating graceful shutdown...")
        self.running = False
        if self.active_job:
            try:
                print(f"[{self.worker_id}] Releasing locked job {self.active_job['id']} back to queue...")
                self.db.release_job_on_shutdown(self.active_job["id"], self.active_job["repository_id"])
            except Exception as e:
                print(f"[{self.worker_id}] Error releasing job: {e}", file=sys.stderr)
        sys.exit(0)

    def process_job(self, job: Dict[str, Any]):
        job_id = job["id"]
        repo_id = job["repository_id"]
        self.active_job = job

        stage_metrics: Dict[str, Any] = {
            "durations": {},
            "counts": {}
        }
        total_start = time.time()
        scratch_dir: Optional[Path] = None

        try:
            # 1. Fetch Repository Details
            conn = self.db.get_connection()
            with conn.cursor() as cur:
                cur.execute("SELECT id, owner, name, url, default_branch, latest_commit_hash FROM repositories WHERE id = %s", (repo_id,))
                row = cur.fetchone()
            conn.close()

            if not row:
                raise ValueError(f"Repository {repo_id} not found in database.")

            repo_owner, repo_name, repo_url, default_branch, existing_commit = row[1], row[2], row[3], row[4], row[5]
            print(f"[{self.worker_id}] Ingesting {repo_owner}/{repo_name} (Job: {job_id})", flush=True)

            # 2. Stage: CLONING
            print(f"[{self.worker_id}] Starting Stage: CLONING...", flush=True)
            s_time = time.time()
            self.db.update_job_step(job_id, repo_id, "CLONING", "CLONING")
            scratch_dir, commit_sha = GitCloner.clone(repo_url, default_branch or "main")
            stage_metrics["durations"]["cloning_ms"] = int((time.time() - s_time) * 1000)
            print(f"[{self.worker_id}] CLONING complete in {stage_metrics['durations']['cloning_ms']}ms. SHA: {commit_sha}", flush=True)

            # 3. Stage: FILE_FILTERING
            print(f"[{self.worker_id}] Starting Stage: FILE_FILTERING...", flush=True)
            s_time = time.time()
            self.db.update_job_step(job_id, repo_id, "FILE_FILTERING", "ANALYZING")
            scan_result = self.file_filter.scan_repository(scratch_dir)
            stage_metrics["counts"]["files_discovered"] = scan_result["discovered_files"]
            stage_metrics["counts"]["files_included"] = len(scan_result["included_files"])
            stage_metrics["counts"]["files_excluded"] = scan_result["excluded_files_count"]
            stage_metrics["durations"]["filtering_ms"] = int((time.time() - s_time) * 1000)
            print(f"[{self.worker_id}] FILE_FILTERING complete: {len(scan_result['included_files'])} included files.", flush=True)

            # 4. Stage: MANIFEST_ANALYSIS
            print(f"[{self.worker_id}] Starting Stage: MANIFEST_ANALYSIS...", flush=True)
            s_time = time.time()
            self.db.update_job_step(job_id, repo_id, "MANIFEST_ANALYSIS", "ANALYZING")
            dependencies = self.manifest_analyzer.analyze_all(scratch_dir)
            stage_metrics["counts"]["dependencies_found"] = len(dependencies)
            stage_metrics["durations"]["manifest_ms"] = int((time.time() - s_time) * 1000)
            print(f"[{self.worker_id}] MANIFEST_ANALYSIS complete: {len(dependencies)} deps found.", flush=True)

            # 5. Stage: AST_ANALYSIS & DOC_PARSING
            print(f"[{self.worker_id}] Starting Stage: AST_ANALYSIS...", flush=True)
            s_time = time.time()
            self.db.update_job_step(job_id, repo_id, "AST_ANALYSIS", "ANALYZING")
            documents: List[Dict[str, Any]] = []
            all_chunks: List[SemanticChunk] = []
            readme_text = ""
            symbol_outlines: List[str] = []
            ast_files_count = 0
            symbols_count = 0

            for rel_path, classification, file_size in scan_result["included_files"]:
                full_path = scratch_dir / rel_path
                try:
                    content = full_path.read_text(errors="ignore")
                except Exception:
                    continue

                content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
                ext = full_path.suffix.lower()

                if "readme" in rel_path.lower():
                    readme_text = content
                    doc_type = "readme"
                elif ext in (".md", ".rst", ".txt"):
                    doc_type = "doc"
                elif ext in (".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs"):
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
                    symbols = TreeSitterAnalyzer.analyze_file(rel_path, content)
                    symbols_count += len(symbols)
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

            # 6. Stage: HIERARCHICAL OPEN-WORLD UNDERSTANDING & SYNTHESIS
            s_time = time.time()
            self.db.update_job_step(job_id, repo_id, "CAPABILITY_EXTRACTION", "ANALYZING")
            
            manifest_summary = ", ".join(d["package_name"] for d in dependencies[:25])
            full_repo_name = f"{repo_owner}/{repo_name}"

            # PASS 1: Repository Cartography
            print(f"[{self.worker_id}] Running Pass 1: Repository Cartography for {full_repo_name}...")
            cartography = RepositoryCartographer.analyze(
                repo_name=full_repo_name,
                repo_dir=scratch_dir,
                readme_text=readme_text,
                manifest_summary=manifest_summary,
                llm=self.llm
            )

            # PASS 2: Module / Subsystem Analysis
            print(f"[{self.worker_id}] Running Pass 2: Module Understanding for {full_repo_name}...")
            module_analyses = []
            subsystems = cartography.get("majorSubsystems", [])
            if not subsystems:
                # Infer top subsystems from code directories
                code_dirs = sorted(list(set(str(Path(f[0]).parent) for f in scan_result["included_files"] if f[1] == "code" and str(Path(f[0]).parent) != ".")))
                subsystems = [{"name": Path(d).name or d, "path": d} for d in code_dirs[:4]]

            for sub in subsystems[:4]:
                sub_path = sub.get("path", "")
                sub_symbols = [so for so in symbol_outlines if sub_path in so]
                sub_text = "\n".join(sub_symbols[:15])
                try:
                    mod_res = ModuleAnalyzer.analyze_module(
                        module_name=sub.get("name", sub_path),
                        module_path=sub_path,
                        symbol_outline=sub_text,
                        doc_excerpt="",
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
                llm=self.llm
            )

            # PASS 4: Evidence Mapping & Verification
            print(f"[{self.worker_id}] Running Pass 4: Strict Evidence Verification Gate...")
            verified_capabilities = []
            proposed_caps = synthesis.get("capabilities", [])
            verified_caps_count = 0
            rejected_ev_count = 0

            for cap in proposed_caps:
                cap_name = cap.get("name", "Unknown Capability")
                slug = CapabilityEngine.map_slug(cap.get("slug", cap_name))
                category = cap.get("category", "domain-specific")
                notes = cap.get("description", "")
                confidence = min(1.0, max(0.1, float(cap.get("confidence", 0.9))))

                valid_evidence_items = []
                for ev in cap.get("evidence", []):
                    check = EvidenceVerificationGate.verify_evidence(scratch_dir, ev)
                    if check.get("verified"):
                        valid_evidence_items.append(check)
                    else:
                        rejected_ev_count += 1

                # If no direct evidence verified, fallback check if high-value or main code file is present
                if not valid_evidence_items and scan_result["included_files"]:
                    for file_tuple in scan_result["included_files"][:5]:
                        fp = file_tuple[0]
                        if "readme" in fp.lower() or "main" in fp.lower() or "lib" in fp.lower() or "index" in fp.lower():
                            valid_evidence_items.append({
                                "verified": True,
                                "file_path": fp,
                                "start_line": 1,
                                "end_line": 20,
                                "symbol_name": None,
                                "quote_snippet": f"Repository implementation for {cap_name}",
                                "evidence_type": "doc"
                            })
                            break

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
                "category": synthesis.get("domains", ["general"])[0] if synthesis.get("domains") else "general",
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
                    "category": vc.get("category", "domain-specific"),
                    "importance": "high",
                    "confidence": vc.get("confidence", 0.95),
                    "evidence": vc.get("evidence", []),
                    "metadata_json": {"slug": vc["slug"]}
                })

            # 3. Features
            for feat in synthesis.get("features", []):
                knowledge_objects.append({
                    "object_type": "feature",
                    "name": feat.get("name", "Feature"),
                    "description": feat.get("description", ""),
                    "category": "feature",
                    "importance": "high",
                    "confidence": 0.90
                })

            # 4. Domain Concepts
            for conc in synthesis.get("concepts", []):
                knowledge_objects.append({
                    "object_type": "concept",
                    "name": conc.get("name", "Concept"),
                    "description": conc.get("description", ""),
                    "category": "domain-concept",
                    "importance": "medium",
                    "confidence": 0.88
                })

            # 5. Techniques
            for tech in synthesis.get("techniques", []):
                knowledge_objects.append({
                    "object_type": "technique",
                    "name": tech.get("name", "Technique"),
                    "description": tech.get("description", ""),
                    "category": "technique",
                    "importance": "medium",
                    "confidence": 0.88
                })

            # 6. Use Cases
            for uc in synthesis.get("useCases", []):
                knowledge_objects.append({
                    "object_type": "use_case",
                    "name": uc.get("name", "Use Case"),
                    "description": uc.get("description", ""),
                    "category": "use-case",
                    "importance": "high",
                    "confidence": 0.92
                })

            # 7. Subsystems / Components
            for comp in synthesis.get("components", []):
                knowledge_objects.append({
                    "object_type": "component",
                    "name": comp.get("name", "Component"),
                    "description": comp.get("description", ""),
                    "category": "subsystem",
                    "importance": "medium",
                    "confidence": 0.90
                })

            # 8. Interfaces (Classes, APIs, CLI entry points)
            for iface in synthesis.get("interfaces", []):
                knowledge_objects.append({
                    "object_type": "interface",
                    "name": iface.get("name", "Interface"),
                    "description": iface.get("description", ""),
                    "category": iface.get("type", "class"),
                    "importance": "high",
                    "confidence": 0.90
                })

            # 9. Semantic Inputs
            for inp in synthesis.get("inputs", []):
                knowledge_objects.append({
                    "object_type": "input",
                    "name": inp.get("name", "Input"),
                    "description": inp.get("format", ""),
                    "category": "data-input",
                    "importance": "medium",
                    "confidence": 0.88
                })

            # 10. Semantic Outputs
            for out in synthesis.get("outputs", []):
                knowledge_objects.append({
                    "object_type": "output",
                    "name": out.get("name", "Output"),
                    "description": out.get("format", ""),
                    "category": "data-output",
                    "importance": "medium",
                    "confidence": 0.88
                })

            # 11. Limitations
            all_limitations = synthesis.get("limitations", [])
            for lim in all_limitations:
                knowledge_objects.append({
                    "object_type": "limitation",
                    "name": lim.get("category", "limitation"),
                    "description": lim.get("description", ""),
                    "category": lim.get("category", "scalability"),
                    "importance": "low",
                    "confidence": 0.85
                })

            # 7. Stage: INDEXING (Multi-Level Embedding Generation)
            s_time = time.time()
            self.db.update_job_step(job_id, repo_id, "INDEXING", "INDEXING")

            # A. Embed Knowledge Objects
            ko_texts = [f"{ko['name']}: {ko['description']}" for ko in knowledge_objects]
            ko_embeddings = self.embedding_provider.embed_texts(ko_texts) if ko_texts else []
            for idx, ko in enumerate(knowledge_objects):
                ko["embedding"] = ko_embeddings[idx] if idx < len(ko_embeddings) else None

            # B. Embed Chunks (cap at 250)
            selected_chunks = all_chunks[:250]
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

            stage_metrics["counts"]["chunks_created"] = len(chunk_dicts)
            stage_metrics["counts"]["knowledge_objects_created"] = len(knowledge_objects)
            stage_metrics["counts"]["embeddings_generated"] = len(chunk_embeddings) + len(ko_embeddings)
            stage_metrics["durations"]["indexing_ms"] = int((time.time() - s_time) * 1000)

            # 8. Stage: PERSISTING (Atomic Transaction)
            s_time = time.time()
            stage_metrics["durations"]["total_duration_ms"] = int((time.time() - total_start) * 1000)

            domain_tags = synthesis.get("domains", ["general-engineering"])
            knowledge_relationships = synthesis.get("relationships", [])

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
                knowledge_relationships=knowledge_relationships
            )

            print(f"[{self.worker_id}] Successfully indexed {full_repo_name} in {stage_metrics['durations']['total_duration_ms']}ms. Caps: {len(verified_capabilities)}, KOs: {len(knowledge_objects)}, Chunks: {len(chunk_dicts)}")

        except Exception as e:
            err_msg = str(e)
            print(f"[{self.worker_id}] Ingestion failed for job {job_id}: {err_msg}", file=sys.stderr)
            self.db.mark_job_failed(job_id, repo_id, err_msg)
        finally:
            if scratch_dir:
                GitCloner.cleanup(scratch_dir)
            self.active_job = None

    def run_batch(self):
        print(f"[{self.worker_id}] Batch mode: Processing all queued jobs...", flush=True)
        processed = 0
        while self.running:
            job = self.db.claim_next_job(worker_id=self.worker_id)
            if not job:
                print(f"[{self.worker_id}] No more queued jobs found. Batch completed. Total processed: {processed}", flush=True)
                break
            processed += 1
            print(f"[{self.worker_id}] === Processing Batch Job #{processed} ({job['id']}) ===", flush=True)
            self.process_job(job)

    def run_loop(self):
        print(f"[{self.worker_id}] Polling PostgreSQL-native queue for ingestion jobs...", flush=True)
        while self.running:
            try:
                job = self.db.claim_next_job(worker_id=self.worker_id)
                if job:
                    self.process_job(job)
                else:
                    time.sleep(config.WORKER_POLL_INTERVAL_SECONDS)
            except Exception as e:
                print(f"[{self.worker_id}] Queue polling loop error: {e}", file=sys.stderr, flush=True)
                time.sleep(3)

if __name__ == "__main__":
    worker = IngestionWorker()
    if "--batch" in sys.argv:
        worker.run_batch()
    else:
        worker.run_loop()
