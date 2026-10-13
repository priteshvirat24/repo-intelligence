import re
from pathlib import Path
from typing import Dict, Any, Tuple, Optional
from ..github.clone import GitCloner
from .chunker import SecretSanitizer

class EvidenceVerificationGate:
    """Validates LLM-proposed evidence against repository files and calculates exact line numbers."""

    MIN_QUOTE_CHARS = 8  # non-whitespace characters; shorter quotes match almost anything

    @staticmethod
    def _normalize_with_lines(content: str) -> Tuple[str, list]:
        """Lowercases and collapses whitespace, keeping the source line number of every output char."""
        out_chars = []
        line_of = []
        line = 1
        prev_space = True
        for ch in content:
            if ch.isspace():
                if not prev_space:
                    out_chars.append(" ")
                    line_of.append(line)
                    prev_space = True
                if ch == "\n":
                    line += 1
            else:
                out_chars.append(ch.lower())
                line_of.append(line)
                prev_space = False
        return "".join(out_chars), line_of

    @classmethod
    def locate_text_in_file(cls, content: str, quote: str) -> Optional[Tuple[int, int]]:
        """
        Locates the start and end line numbers of a quote in the file content.
        The ENTIRE quote must occur in the file; only whitespace and letter case may differ
        (indentation, wrapping). Partial or paraphrased quotes are rejected.
        """
        quote_clean = " ".join(quote.split()).lower()
        if len(quote_clean.replace(" ", "")) < cls.MIN_QUOTE_CHARS:
            return None

        normalized, line_of = cls._normalize_with_lines(content)
        pos = normalized.find(quote_clean)
        if pos == -1:
            return None
        return line_of[pos], line_of[pos + len(quote_clean) - 1]

    MIN_SYMBOL_CHARS = 3
    _DEFINITION_PREFIX = (
        r"^[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:pub(?:\([^)]*\))?[ \t]+)?(?:abstract[ \t]+)?"
        r"(?:async[ \t]+)?(?:def|class|function\*?|func|fn|struct|enum|trait|interface|type|impl|const|let|var)"
        r"[ \t]+(?:\([^)]*\)[ \t]*)?"
    )
    _ANY_DEFINITION = re.compile(_DEFINITION_PREFIX + r"([A-Za-z_$][\w$]*)", re.MULTILINE)
    _INDEX_CODE_EXTS = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".rs"}
    _INDEX_SKIP_DIRS = {".git", "node_modules", "dist", "build", "vendor", "__pycache__", ".next", "venv", ".venv", "target"}
    _INDEX_MAX_FILE_BYTES = 1_000_000
    _definition_index_cache: Dict[str, Dict[str, Tuple[str, int]]] = {}

    _FILE_EXTENSIONS = {
        "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "go", "rs", "json", "md", "rst", "txt", "patch", "diff",
        "toml", "yml", "yaml", "sh", "cfg", "ini", "html", "css", "xml", "lock", "c", "h", "cc", "cpp", "hpp", "java",
    }

    @classmethod
    def _symbol_candidates(cls, symbol: str) -> list:
        """
        Identifier names to look up from a model-provided symbol_name. Handles lists ("A, B"),
        backticks and "Class.method" (-> "method"); file names ("policies.json", "patch.py") are not
        symbols and yield nothing, so they can never match an unrelated definition like `def json()`.
        """
        names = []
        for token in re.split(r"[\s,;`'\"()\[\]{}]+", symbol):
            # Only whole identifiers: "font-hijacker" must not become the generic words "font"/"hijacker"
            if not re.fullmatch(r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*", token):
                continue
            parts = token.split(".")
            if len(parts) > 1 and parts[-1].lower() in cls._FILE_EXTENSIONS:
                continue
            name = parts[-1]
            if len(name) >= cls.MIN_SYMBOL_CHARS and name not in names:
                names.append(name)
        return names

    @classmethod
    def locate_symbol_definition(cls, content: str, symbol: str) -> Optional[Tuple[int, int]]:
        """Line of the symbol's definition (def/class/function/func/fn/struct/...), if any."""
        for name in cls._symbol_candidates(symbol):
            definition = re.compile(cls._DEFINITION_PREFIX + re.escape(name) + r"\b", re.MULTILINE)
            match = definition.search(content)
            if match:
                line_no = content[:match.start()].count("\n") + 1
                return line_no, line_no
        return None

    @classmethod
    def _definition_index(cls, repo_dir: Path) -> Dict[str, Tuple[str, int]]:
        """symbol name -> (repo-relative path, line) of its definition, preferring non-test files."""
        key = str(repo_dir.resolve())
        cached = cls._definition_index_cache.get(key)
        if cached is not None:
            return cached
        index: Dict[str, Tuple[str, int]] = {}
        from_test: set = set()
        for path in sorted(repo_dir.rglob("*")):
            rel = path.relative_to(repo_dir)
            if any(part in cls._INDEX_SKIP_DIRS for part in rel.parts) or path.suffix.lower() not in cls._INDEX_CODE_EXTS:
                continue
            if path.is_symlink() or not path.is_file() or path.stat().st_size > cls._INDEX_MAX_FILE_BYTES:
                continue
            rel_str = rel.as_posix()
            is_test = cls.classify_evidence_strength(rel_str, None, "code", "") == "EXAMPLE"
            content = path.read_text(errors="ignore")
            for match in cls._ANY_DEFINITION.finditer(content):
                name = match.group(1)
                if name in index and not (name in from_test and not is_test):
                    continue
                index[name] = (rel_str, content[:match.start()].count("\n") + 1)
                if is_test:
                    from_test.add(name)
                else:
                    from_test.discard(name)
        # One cached index per clone; clones are deleted after each job, so keep the cache tiny
        cls._definition_index_cache = {key: index}
        return index

    @classmethod
    def _resolve_symbol_in_repo(cls, repo_dir: Path, symbol: Optional[str]) -> Optional[Tuple[str, int]]:
        if not symbol:
            return None
        index = cls._definition_index(repo_dir)
        for name in cls._symbol_candidates(symbol):
            if name in index:
                return index[name]
        return None

    @classmethod
    def verify_evidence(cls, repo_dir: Path, evidence: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validates an evidence claim:
        - Ensures file path exists without escaping repository root
        - Confirms quote or symbol actually occurs in file
        - Programmatically calculates real start_line and end_line from source
        """
        file_path_str = evidence.get("file_path") or ""
        if not isinstance(file_path_str, str):
            return {"verified": False, "reason": "invalid_file_path"}
        # Models often write repo-relative paths as "/src/x.py" or "./src/x.py"
        file_path_str = re.sub(r"^(\./)+", "", file_path_str.strip()).lstrip("/")
        if not file_path_str:
            return {"verified": False, "reason": "missing_file_path"}

        try:
            target_file = GitCloner.sanitize_path(repo_dir, file_path_str)
        except ValueError as e:
            return {"verified": False, "reason": f"path_traversal: {str(e)}"}

        quote = evidence.get("quote_snippet") or evidence.get("quote") or ""
        quote = quote if isinstance(quote, str) else ""
        symbol = evidence.get("symbol_name")
        symbol = symbol.strip() if isinstance(symbol, str) and symbol.strip() else None

        content = ""
        calculated_lines = None
        if target_file.is_file():
            try:
                content = target_file.read_text(errors="ignore")
            except Exception as e:
                return {"verified": False, "reason": f"file_read_error: {str(e)}"}
            if quote:
                calculated_lines = cls.locate_text_in_file(content, quote)
            # Quote not found verbatim (the synthesis pass only sees summaries and symbol outlines, so
            # its quotes are often paraphrased): accept the claim only if the named symbol is DEFINED
            # in this file. A mere mention (e.g. "import os") does not substantiate anything.
            if not calculated_lines and symbol:
                calculated_lines = cls.locate_symbol_definition(content, symbol)

        # The model often names a real symbol but attributes it to the wrong (or a non-existent) file.
        # Point the evidence at the file that actually defines it.
        if not calculated_lines and symbol:
            resolved = cls._resolve_symbol_in_repo(repo_dir, symbol)
            if resolved:
                file_path_str, line_no = resolved
                content = (repo_dir / file_path_str).read_text(errors="ignore")
                calculated_lines = (line_no, line_no)

        if not calculated_lines:
            if not target_file.is_file():
                return {"verified": False, "reason": f"file_not_found: {file_path_str}"}
            return {"verified": False, "reason": "quote_or_symbol_not_found_in_file"}

        start_line, end_line = calculated_lines
        # Persist the actual source text of the matched lines, never the model's rendition of it
        quote = SecretSanitizer.sanitize("\n".join(content.splitlines()[start_line - 1:end_line]).strip())
        ev_type = evidence.get("evidence_type", "doc")
        strength = cls.classify_evidence_strength(file_path_str, symbol, ev_type, quote)

        return {
            "verified": True,
            "file_path": file_path_str,
            "start_line": start_line,
            "end_line": end_line,
            "symbol_name": symbol,
            "quote_snippet": quote,
            "evidence_type": ev_type,
            "evidence_strength": strength
        }

    @staticmethod
    def classify_evidence_strength(file_path: str, symbol: Optional[str], evidence_type: str, content_quote: str) -> str:
        """
        Classifies evidence into five rigor tiers:
        - DIRECT_IMPLEMENTATION: Verified source code implementation (classes, functions, methods)
        - DIRECT_INTERFACE: Exported types, interfaces, structs, or API contracts
        - DOCUMENTATION: README or documentation text quotes
        - EXAMPLE: Code in examples, tests, or demo folders
        - INFERRED: Structural or configuration references
        """
        fp_lower = file_path.lower()
        ext = Path(file_path).suffix.lower()
        is_code = ext in (".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".cpp", ".c", ".h")

        segments = re.split(r"[/\\]", fp_lower)
        stem = Path(fp_lower).stem
        example_dirs = {"test", "tests", "__tests__", "spec", "example", "examples", "fixture", "fixtures", "demo", "demos", "sample", "samples"}
        if (any(seg in example_dirs for seg in segments[:-1])
                or stem.startswith("test_") or stem.endswith(("_test", ".test", ".spec", "_spec"))):
            return "EXAMPLE"

        if is_code:
            quote_lower = (content_quote or "").lower()
            if any(k in quote_lower for k in ("interface ", "type ", "struct ", "typedef ", "trait ")):
                return "DIRECT_INTERFACE"
            if symbol or any(k in quote_lower for k in ("def ", "class ", "function ", "func ", "fn ")):
                return "DIRECT_IMPLEMENTATION"
            return "DIRECT_INTERFACE"

        if "readme" in fp_lower or ext in (".md", ".rst", ".txt", ".adoc", ".html"):
            return "DOCUMENTATION"

        if any(m in fp_lower for m in ("package.json", "pyproject.toml", "cargo.toml", "go.mod", "pom.xml")):
            return "DOCUMENTATION"

        return "INFERRED"
