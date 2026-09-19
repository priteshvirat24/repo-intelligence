import os
import shutil
import tempfile
import subprocess
from pathlib import Path
from typing import Tuple

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
                fallback_cmd = [
                    "git",
                    "-c", "core.hooksPath=/dev/null",
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
    def cleanup(dir_path: Path):
        """Safely removes the temporary clone directory."""
        if dir_path and dir_path.exists():
            shutil.rmtree(dir_path, ignore_errors=True)

    @staticmethod
    def sanitize_path(base_dir: Path, relative_path: str) -> Path:
        """
        Ensures a requested relative path does not escape the repository base directory.
        Prevents directory traversal (e.g. ../../etc/passwd).
        """
        resolved = (base_dir / relative_path).resolve()
        base_resolved = base_dir.resolve()
        if not str(resolved).startswith(str(base_resolved)):
            raise ValueError(f"PATH_TRAVERSAL_DETECTED: Path {relative_path} attempts to escape repository root.")
        return resolved
