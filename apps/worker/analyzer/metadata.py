import os
import json
import re
from pathlib import Path
from typing import List, Dict, Any, Set

class ManifestAnalyzer:
    """Analyzes repository dependency manifests and Dockerfiles."""

    DEFAULT_HEAVYWEIGHT_PACKAGES = {
        "playwright", "puppeteer", "selenium", "torch", "pytorch",
        "tensorflow", "keras", "cuda", "spacy", "opencv-python",
        "chromadb", "qdrant-client", "weaviate-client", "vllm"
    }

    def __init__(self, heavyweight_packages: Set[str] = None):
        self.heavyweight_packages = heavyweight_packages or self.DEFAULT_HEAVYWEIGHT_PACKAGES

    def analyze_all(self, repo_dir: Path) -> List[Dict[str, Any]]:
        dependencies: List[Dict[str, Any]] = []

        # 1. Python: requirements.txt
        req_file = repo_dir / "requirements.txt"
        if req_file.is_file():
            dependencies.extend(self._parse_requirements_txt(req_file))

        # 2. Python: pyproject.toml
        pyproject = repo_dir / "pyproject.toml"
        if pyproject.is_file():
            dependencies.extend(self._parse_pyproject_toml(pyproject))

        # 3. Python: setup.py
        setup_py = repo_dir / "setup.py"
        if setup_py.is_file():
            dependencies.extend(self._parse_setup_py(setup_py))

        # 4. Node.js: package.json
        pkg_json = repo_dir / "package.json"
        if pkg_json.is_file():
            dependencies.extend(self._parse_package_json(pkg_json))

        # 5. Go: go.mod
        go_mod = repo_dir / "go.mod"
        if go_mod.is_file():
            dependencies.extend(self._parse_go_mod(go_mod))

        # 6. Rust: Cargo.toml
        cargo_toml = repo_dir / "Cargo.toml"
        if cargo_toml.is_file():
            dependencies.extend(self._parse_cargo_toml(cargo_toml))

        # 7. Dockerfile inspection for heavy system dependencies (Chromium, CUDA)
        dockerfile = repo_dir / "Dockerfile"
        if dockerfile.is_file():
            docker_deps = self._inspect_dockerfile(dockerfile)
            dependencies.extend(docker_deps)

        # De-duplicate by package_name + ecosystem
        unique: Dict[str, Dict[str, Any]] = {}
        for dep in dependencies:
            key = f"{dep['ecosystem']}:{dep['package_name'].lower()}"
            if key not in unique or (dep.get('is_heavyweight') and not unique[key].get('is_heavyweight')):
                unique[key] = dep

        return list(unique.values())

    def _is_heavyweight(self, package_name: str) -> bool:
        pkg = package_name.lower().replace("_", "-")
        return any(h in pkg for h in self.heavyweight_packages)

    def _parse_requirements_txt(self, file_path: Path) -> List[Dict[str, Any]]:
        deps = []
        content = file_path.read_text(errors="ignore")
        for line in content.splitlines():
            line = line.strip().split("#")[0]
            if not line or line.startswith("-"):
                continue
            parts = re.split(r'([=><~]=?.*)', line, maxsplit=1)
            name = parts[0].strip()
            version = parts[1].strip() if len(parts) > 1 else None
            if name:
                deps.append({
                    "package_name": name,
                    "ecosystem": "pypi",
                    "version_spec": version,
                    "is_runtime": True,
                    "is_heavyweight": self._is_heavyweight(name)
                })
        return deps

    def _parse_pyproject_toml(self, file_path: Path) -> List[Dict[str, Any]]:
        deps = []
        content = file_path.read_text(errors="ignore")
        # Match dependencies in dependencies = [...] or [project.dependencies]
        matches = re.findall(r'["\']([a-zA-Z0-9_\-\.]+)(?:([=><~]=?[^"\']+))?["\']', content)
        for name, version in matches:
            if name and not name.startswith("python"):
                deps.append({
                    "package_name": name,
                    "ecosystem": "pypi",
                    "version_spec": version.strip() if version else None,
                    "is_runtime": True,
                    "is_heavyweight": self._is_heavyweight(name)
                })
        return deps

    def _parse_setup_py(self, file_path: Path) -> List[Dict[str, Any]]:
        deps = []
        content = file_path.read_text(errors="ignore")
        matches = re.findall(r'install_requires\s*=\s*\[(.*?)\]', content, re.DOTALL)
        if matches:
            pkg_matches = re.findall(r'["\']([a-zA-Z0-9_\-\.]+)(?:([=><~]=?[^"\']+))?["\']', matches[0])
            for name, ver in pkg_matches:
                deps.append({
                    "package_name": name,
                    "ecosystem": "pypi",
                    "version_spec": ver.strip() if ver else None,
                    "is_runtime": True,
                    "is_heavyweight": self._is_heavyweight(name)
                })
        return deps

    def _parse_package_json(self, file_path: Path) -> List[Dict[str, Any]]:
        deps = []
        try:
            data = json.loads(file_path.read_text(errors="ignore"))
            # Runtime dependencies
            for pkg, ver in data.get("dependencies", {}).items():
                deps.append({
                    "package_name": pkg,
                    "ecosystem": "npm",
                    "version_spec": str(ver),
                    "is_runtime": True,
                    "is_heavyweight": self._is_heavyweight(pkg)
                })
            # Dev dependencies
            for pkg, ver in data.get("devDependencies", {}).items():
                deps.append({
                    "package_name": pkg,
                    "ecosystem": "npm",
                    "version_spec": str(ver),
                    "is_runtime": False,
                    "is_heavyweight": self._is_heavyweight(pkg)
                })
        except Exception:
            pass
        return deps

    def _parse_go_mod(self, file_path: Path) -> List[Dict[str, Any]]:
        deps = []
        content = file_path.read_text(errors="ignore")
        # Match require lines in go.mod
        matches = re.findall(r'^\s*([a-zA-Z0-9_\-\.\/]+)\s+([v0-9\.\-\+a-zA-Z]+)', content, re.MULTILINE)
        for mod, ver in matches:
            if mod != "module" and mod != "go":
                deps.append({
                    "package_name": mod,
                    "ecosystem": "go",
                    "version_spec": ver,
                    "is_runtime": True,
                    "is_heavyweight": self._is_heavyweight(mod)
                })
        return deps

    def _parse_cargo_toml(self, file_path: Path) -> List[Dict[str, Any]]:
        deps = []
        content = file_path.read_text(errors="ignore")
        # Match [dependencies] section entries
        dep_section = re.search(r'\[dependencies\](.*?)(?:\[|\Z)', content, re.DOTALL)
        if dep_section:
            matches = re.findall(r'^([a-zA-Z0-9_\-]+)\s*=\s*(?:["\']([^"\']+)["\']|\{.*?version\s*=\s*["\']([^"\']+)["\'])', dep_section.group(1), re.MULTILINE)
            for m in matches:
                name = m[0]
                ver = m[1] or m[2] or None
                deps.append({
                    "package_name": name,
                    "ecosystem": "cargo",
                    "version_spec": ver,
                    "is_runtime": True,
                    "is_heavyweight": self._is_heavyweight(name)
                })
        return deps

    def _inspect_dockerfile(self, file_path: Path) -> List[Dict[str, Any]]:
        deps = []
        content = file_path.read_text(errors="ignore").lower()
        if "chromium" in content or "playwright" in content:
            deps.append({
                "package_name": "chromium-browser",
                "ecosystem": "system",
                "version_spec": None,
                "is_runtime": True,
                "is_heavyweight": True
            })
        if "cuda" in content or "nvidia" in content:
            deps.append({
                "package_name": "nvidia-cuda",
                "ecosystem": "system",
                "version_spec": None,
                "is_runtime": True,
                "is_heavyweight": True
            })
        return deps
