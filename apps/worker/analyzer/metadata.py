import os
import json
import re
import tomllib
from pathlib import Path
from typing import List, Dict, Any, Set, Optional

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

    # PEP 508: name, optional [extras], then version specifiers / markers / "@ url"
    _REQ_RE = re.compile(r'^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$')

    def _dep(self, name: str, ecosystem: str, version: Any, is_runtime: bool) -> Dict[str, Any]:
        version = str(version).strip() if version not in (None, "") else None
        return {
            "package_name": name,
            "ecosystem": ecosystem,
            "version_spec": version or None,
            "is_runtime": is_runtime,
            "is_heavyweight": self._is_heavyweight(name)
        }

    def _parse_requirement(self, spec: str, is_runtime: bool = True) -> Optional[Dict[str, Any]]:
        """Parses one PEP 508 requirement string; returns None for anything that is not a named requirement."""
        spec = spec.split("#", 1)[0].strip()
        if not spec or spec.startswith("-") or "://" in spec.split("@", 1)[0]:
            return None  # options (-r, -e, --index-url) and bare URLs carry no reliable package name
        match = self._REQ_RE.match(spec)
        if not match:
            return None
        name, _extras, rest = match.groups()
        rest = rest.split(";", 1)[0].strip()  # environment markers are not part of the version
        if rest.startswith("@"):
            rest = ""  # direct reference: no version specifier
        if rest and not re.match(r'^[=<>!~]', rest):
            return None  # not a requirement line (e.g. stray text)
        return self._dep(name, "pypi", rest, is_runtime)

    def _parse_requirements_txt(self, file_path: Path) -> List[Dict[str, Any]]:
        deps = []
        for line in file_path.read_text(errors="ignore").splitlines():
            dep = self._parse_requirement(line)
            if dep:
                deps.append(dep)
        return deps

    @staticmethod
    def _load_toml(file_path: Path) -> Dict[str, Any]:
        try:
            return tomllib.loads(file_path.read_text(errors="ignore"))
        except (tomllib.TOMLDecodeError, ValueError):
            return {}

    def _parse_pyproject_toml(self, file_path: Path) -> List[Dict[str, Any]]:
        data = self._load_toml(file_path)
        deps: List[Dict[str, Any]] = []
        project = data.get("project") or {}
        for spec in project.get("dependencies") or []:
            dep = self._parse_requirement(spec, is_runtime=True) if isinstance(spec, str) else None
            if dep:
                deps.append(dep)
        for group in (project.get("optional-dependencies") or {}).values():
            for spec in group or []:
                dep = self._parse_requirement(spec, is_runtime=False) if isinstance(spec, str) else None
                if dep:
                    deps.append(dep)

        poetry = (data.get("tool") or {}).get("poetry") or {}
        poetry_sections = [(poetry.get("dependencies") or {}, True), (poetry.get("dev-dependencies") or {}, False)]
        poetry_sections += [((g or {}).get("dependencies") or {}, False) for g in (poetry.get("group") or {}).values()]
        for section, is_runtime in poetry_sections:
            for name, spec in section.items():
                if name.lower() == "python":
                    continue  # interpreter constraint, not a package
                version = spec.get("version") if isinstance(spec, dict) else spec
                deps.append(self._dep(name, "pypi", version, is_runtime))
        return deps

    def _parse_setup_py(self, file_path: Path) -> List[Dict[str, Any]]:
        deps = []
        content = file_path.read_text(errors="ignore")
        matches = re.findall(r'install_requires\s*=\s*\[(.*?)\]', content, re.DOTALL)
        if matches:
            for spec in re.findall(r'["\']([^"\']+)["\']', matches[0]):
                dep = self._parse_requirement(spec)
                if dep:
                    deps.append(dep)
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
        in_require_block = False
        for raw_line in file_path.read_text(errors="ignore").splitlines():
            line = raw_line.split("//", 1)[0].strip()
            if not line:
                continue
            if in_require_block:
                if line == ")":
                    in_require_block = False
                    continue
                parts = line.split()
            elif line.startswith("require ("):
                in_require_block = True
                continue
            elif line.startswith("require "):
                parts = line[len("require "):].split()
            else:
                continue  # module, go, toolchain, replace, exclude, retract: not dependencies
            if len(parts) >= 2:
                deps.append(self._dep(parts[0], "go", parts[1], True))
        return deps

    def _parse_cargo_toml(self, file_path: Path) -> List[Dict[str, Any]]:
        data = self._load_toml(file_path)
        deps = []
        for section, is_runtime in (("dependencies", True), ("dev-dependencies", False), ("build-dependencies", False)):
            for name, spec in (data.get(section) or {}).items():
                version = spec.get("version") if isinstance(spec, dict) else spec
                deps.append(self._dep(name, "cargo", version, is_runtime))
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
