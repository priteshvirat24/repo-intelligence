import os
from pathlib import Path
from typing import List, Tuple, Dict, Any
from ..config import config

class FileFilter:
    """Configurable file and directory filtering system."""

    DEFAULT_EXCLUDED_DIRS = {
        ".git", ".github", "node_modules", "vendor", "venv", ".venv",
        "__pycache__", "dist", "build", "target", "coverage", ".next",
        "bin", "obj", "site-packages", ".idea", ".vscode"
    }

    # Low-priority test dirs that can be excluded unless explicitly configured
    LOW_PRIORITY_TEST_DIRS = {"test", "tests", "spec", "fixtures"}

    DEFAULT_EXCLUDED_EXTENSIONS = {
        ".lock", ".sum", ".min.js", ".min.css", ".map", ".svg", ".png",
        ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".tar", ".gz",
        ".exe", ".dll", ".so", ".dylib", ".pyc", ".wasm", ".bin",
        ".woff", ".woff2", ".ttf", ".eot", ".mp4", ".mov", ".avi"
    }

    HIGH_VALUE_MANIFESTS = {
        "package.json", "pyproject.toml", "requirements.txt", "setup.py",
        "go.mod", "cargo.toml", "dockerfile", "docker-compose.yml",
        "openapi.json", "openapi.yaml", "swagger.json", "swagger.yaml"
    }

    HIGH_VALUE_CODE_EXTENSIONS = {
        ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs"
    }

    HIGH_VALUE_DOC_EXTENSIONS = {
        ".md", ".markdown", ".rst", ".txt"
    }

    def __init__(
        self,
        include_tests: bool = False,
        max_file_size_kb: int = config.MAX_FILE_SIZE_KB,
        max_total_text_mb: int = config.MAX_TOTAL_TEXT_MB,
        max_files: int = config.MAX_FILES
    ):
        self.include_tests = include_tests
        self.max_file_size_bytes = max_file_size_kb * 1024
        self.max_total_text_bytes = max_total_text_mb * 1024 * 1024
        self.max_files = max_files

    def classify_file(self, rel_path: str, filename: str, ext: str) -> str:
        """Classifies a file as 'INCLUDE', 'EXCLUDE', or 'OPTIONAL'."""
        fname_lower = filename.lower()
        ext_lower = ext.lower()

        if ext_lower in self.DEFAULT_EXCLUDED_EXTENSIONS or fname_lower.endswith(".min.js") or fname_lower.endswith(".min.css"):
            return "EXCLUDE"

        if fname_lower in self.HIGH_VALUE_MANIFESTS:
            return "INCLUDE"

        if "readme" in fname_lower:
            return "INCLUDE"

        if ext_lower in self.HIGH_VALUE_CODE_EXTENSIONS:
            return "INCLUDE"

        if ext_lower in self.HIGH_VALUE_DOC_EXTENSIONS:
            # Docs and examples
            if any(k in rel_path.lower() for k in ("doc", "guide", "example", "tutorial")):
                return "INCLUDE"
            return "OPTIONAL"

        return "EXCLUDE"

    def scan_repository(self, repo_dir: Path) -> Dict[str, Any]:
        """
        Scans repository directory applying filtering and size limits.
        Returns categorized files and observability stats.
        """
        discovered_files = 0
        included_files: List[Tuple[str, str, int]] = []  # (rel_path, category, size_bytes)
        excluded_files_count = 0
        total_text_bytes = 0

        exclude_dirs = set(self.DEFAULT_EXCLUDED_DIRS)
        if not self.include_tests:
            exclude_dirs.update(self.LOW_PRIORITY_TEST_DIRS)

        for root, dirs, files in os.walk(repo_dir):
            # Prune excluded directories
            dirs[:] = [d for d in dirs if d not in exclude_dirs]

            for file in files:
                discovered_files += 1
                full_path = Path(root) / file
                rel_path = str(full_path.relative_to(repo_dir))
                ext = full_path.suffix.lower()

                classification = self.classify_file(rel_path, file, ext)
                if classification == "EXCLUDE":
                    excluded_files_count += 1
                    continue

                try:
                    file_size = full_path.stat().st_size
                except OSError:
                    excluded_files_count += 1
                    continue

                if file_size > self.max_file_size_bytes:
                    excluded_files_count += 1
                    continue

                if total_text_bytes + file_size > self.max_total_text_bytes:
                    # Enforce max total text safety limit
                    break

                if len(included_files) >= self.max_files:
                    break

                total_text_bytes += file_size
                included_files.append((rel_path, classification, file_size))

        return {
            "discovered_files": discovered_files,
            "included_files": included_files,
            "excluded_files_count": excluded_files_count,
            "total_text_bytes": total_text_bytes
        }
