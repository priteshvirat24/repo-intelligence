import math
import os
import re
import shutil
import tempfile
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Tuple

# Partial analysis of large repositories: at most this many directories are checked out
PARTIAL_MAX_DIRS = 8
_CONTAINER_DIRS = {"packages", "libs", "modules", "crates", "components", "plugins", "apps"}
_SOURCE_DIRS = {"src", "lib", "core", "source", "pkg", "internal", "engine", "cmd", "include"}
_LOW_VALUE_DIRS = {
    "test", "tests", "spec", "specs", "__tests__", "e2e", "benchmark", "benchmarks", "bench", "example", "examples",
    "sample", "samples", "demo", "demos", "doc", "docs", "documentation", "website", "site", "assets", "static",
    "images", "img", "media", "fixtures", "testdata", "vendor", "third_party", "thirdparty", "node_modules", "dist",
    "build", "out", "sandcastle", "gallery", "locale", "locales", "i18n", "scripts", "ci", "tools", "launches", "sampledata",
}


class _DirectoryTree:
    """Directories of a commit, from its file list (tree objects only: no file content is fetched to decide),
    with how many files each holds and how many of their paths mention the brief's terms."""

    def __init__(self, file_paths: List[str], focus_terms: List[str], max_depth: int = 5):
        self.terms = {t.lower() for t in focus_terms if t}
        self.files: Dict[str, int] = {}
        self.matches: Dict[str, int] = {}
        long_terms = [t for t in self.terms if len(t) >= 4]
        for path in file_paths:
            parts = path.split("/")[:-1]
            if not parts or any(p.startswith(".") for p in parts):
                continue
            hit = any(t in path.lower() for t in long_terms)
            for depth in range(1, min(len(parts), max_depth) + 1):
                prefix = "/".join(parts[:depth])
                self.files[prefix] = self.files.get(prefix, 0) + 1
                if hit:
                    self.matches[prefix] = self.matches.get(prefix, 0) + 1

    def children(self, prefix: str) -> List[str]:
        depth = prefix.count("/") + 1
        return [d for d in self.files if d.startswith(prefix + "/") and d.count("/") == depth]

    def top_level(self) -> List[str]:
        """Top-level directories, with monorepo containers (packages/, crates/) replaced by their packages."""
        out: List[str] = []
        for d in [d for d in self.files if "/" not in d]:
            out.extend((self.children(d) or [d]) if d.lower() in _CONTAINER_DIRS else [d])
        return out

    def score(self, path: str) -> float:
        """Names matching the brief's terms, files whose paths mention them, and source directories."""
        parts = [p.lower() for p in path.split("/")]
        words = set(re.split(r"[^a-z0-9]+", " ".join(parts))) - {""}
        value = 3.0 * len(words & self.terms) + 2.0 * math.log2(1 + self.matches.get(path, 0))
        return value + (1.0 if parts[-1] in _SOURCE_DIRS else 0.0)

    @staticmethod
    def low_value(path: str) -> bool:
        return any(p.lower() in _LOW_VALUE_DIRS for p in path.split("/"))

    def ranked(self, paths: List[str]) -> List[str]:
        """Most relevant first; tests, examples, docs, tooling and vendored code only after everything else."""
        return sorted(set(paths), key=lambda p: (self.low_value(p), -self.score(p), self.files.get(p, 0), p))


class GitCloner:
    """Handles secure, hook-isolated shallow git cloning."""

    @staticmethod
    def clone(url: str, branch: str = "main") -> Tuple[Path, str]:
        """
        Clones a repository with git hooks disabled into an isolated temporary directory.
        Returns: (scratch_directory_path, commit_sha)
        """
        scratch_dir = Path(tempfile.mkdtemp(prefix="repo_intel_clone_"))

        cmd = [
            "git",
            "-c", "core.hooksPath=/dev/null",  # Neutralize any malicious git hooks
            "-c", "core.symlinks=false",  # Check out symlinks as plain files so they can't point at host files
            "clone",
            "--depth", "1",
            "--single-branch",
            "--branch", branch,
            url,
            str(scratch_dir)
        ]

        try:
            res = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=120
            )

            # If specific branch failed, try cloning default without --branch flag
            if res.returncode != 0:
                # A failed clone may leave a partial checkout behind, which makes the retry fail
                shutil.rmtree(scratch_dir, ignore_errors=True)
                scratch_dir.mkdir(parents=True, exist_ok=True)
                fallback_cmd = [
                    "git",
                    "-c", "core.hooksPath=/dev/null",
                    "-c", "core.symlinks=false",
                    "clone",
                    "--depth", "1",
                    url,
                    str(scratch_dir)
                ]
                res = subprocess.run(
                    fallback_cmd,
                    capture_output=True,
                    text=True,
                    timeout=120
                )
                if res.returncode != 0:
                    raise RuntimeError(f"CLONE_FAILED: {res.stderr.strip()}")

            # Extract latest commit hash
            rev_res = subprocess.run(
                ["git", "rev-parse", "HEAD"],
                cwd=str(scratch_dir),
                capture_output=True,
                text=True,
                timeout=10
            )
            commit_sha = rev_res.stdout.strip() if rev_res.returncode == 0 else "unknown"

            return scratch_dir, commit_sha

        except Exception as e:
            if scratch_dir.exists():
                shutil.rmtree(scratch_dir, ignore_errors=True)
            raise e

    @staticmethod
    def partial_clone(url: str, branch: str, focus_terms: List[str], max_bytes: int, max_files: int,
                      max_dirs: int = PARTIAL_MAX_DIRS) -> Tuple[Path, str, Dict[str, Any]]:
        """A repository too large to check out whole (SYSTEM_DESIGN 6, "Large repositories"): a shallow,
        blob-less clone with only the root files checked out, then the most relevant directories added one at a
        time while the checkout stays within max_bytes and max_files. Blobs are fetched only for what is checked
        out. Returns (scratch_directory_path, commit_sha, {"paths", "considered", "skipped"})."""
        scratch_dir = Path(tempfile.mkdtemp(prefix="repo_intel_partial_"))
        base = ["git", "-c", "core.hooksPath=/dev/null", "-c", "core.symlinks=false"]

        def git(*args, timeout=120) -> subprocess.CompletedProcess:
            return subprocess.run(base + ["-C", str(scratch_dir)] + list(args), capture_output=True, text=True, timeout=timeout)

        try:
            clone = base + ["clone", "--depth", "1", "--filter=blob:none", "--sparse", "--single-branch"]
            res = subprocess.run(clone + ["--branch", branch, url, str(scratch_dir)], capture_output=True, text=True, timeout=180)
            if res.returncode != 0:
                shutil.rmtree(scratch_dir, ignore_errors=True)
                scratch_dir.mkdir(parents=True, exist_ok=True)
                res = subprocess.run(clone + [url, str(scratch_dir)], capture_output=True, text=True, timeout=180)
                if res.returncode != 0:
                    raise RuntimeError(f"CLONE_FAILED: {res.stderr.strip()}")
            commit = git("rev-parse", "HEAD", timeout=10)
            commit_sha = commit.stdout.strip() if commit.returncode == 0 else "unknown"

            listing = git("ls-tree", "-r", "--name-only", "HEAD", timeout=300)
            if listing.returncode != 0:
                raise RuntimeError(f"CLONE_FAILED: could not list the repository: {listing.stderr.strip()}")
            tree = _DirectoryTree(listing.stdout.splitlines(), focus_terms)
            queue = tree.ranked(tree.top_level())
            included: List[str] = []
            skipped: List[str] = []
            considered = 0
            files_so_far = len([p for p in scratch_dir.iterdir() if p.is_file()])
            while queue and len(included) < max_dirs:
                path = queue.pop(0)
                considered += 1
                files = tree.files[path]
                if files_so_far + files > max_files:
                    # A relevant directory too big to take whole: its subdirectories are considered instead
                    relevant = tree.score(path) > 0 and not tree.low_value(path)
                    children = tree.children(path) if relevant and path.count("/") < 4 else []
                    if children:
                        queue = tree.ranked(queue + children)
                    else:
                        skipped.append(f"{path} ({files} files)")
                    continue
                if git("sparse-checkout", "set", *(included + [path]), timeout=600).returncode != 0:
                    skipped.append(f"{path} (checkout failed)")
                    git("sparse-checkout", "set", *included, timeout=600)
                    continue
                if GitCloner.checkout_size_bytes(scratch_dir) > max_bytes:
                    skipped.append(f"{path} (over the size limit)")
                    git("sparse-checkout", "set", *included, timeout=600)
                    continue
                included.append(path)
                files_so_far += files
            return scratch_dir, commit_sha, {"paths": included, "considered": considered, "skipped": skipped[:20]}
        except Exception:
            shutil.rmtree(scratch_dir, ignore_errors=True)
            raise

    @staticmethod
    def cleanup(dir_path: Path):
        """Safely removes the temporary clone directory."""
        if dir_path and dir_path.exists():
            shutil.rmtree(dir_path, ignore_errors=True)

    @staticmethod
    def checkout_size_bytes(dir_path: Path) -> int:
        """Bytes of checked-out files, excluding the .git directory; symlinks are not followed."""
        total = 0
        for root, dirs, files in os.walk(dir_path):
            dirs[:] = [d for d in dirs if d != ".git"]
            for name in files:
                try:
                    total += os.lstat(os.path.join(root, name)).st_size
                except OSError:
                    pass
        return total

    @staticmethod
    def sanitize_path(base_dir: Path, relative_path: str) -> Path:
        """
        Ensures a requested relative path does not escape the repository base directory.
        Prevents directory traversal (e.g. ../../etc/passwd).
        """
        resolved = (base_dir / relative_path).resolve()
        base_resolved = base_dir.resolve()
        if not resolved.is_relative_to(base_resolved):
            raise ValueError(f"PATH_TRAVERSAL_DETECTED: Path {relative_path} attempts to escape repository root.")
        return resolved
