import re
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional
from ..github.clone import GitCloner
from .chunker import SecretSanitizer

class EvidenceVerificationGate:
    """Validates LLM-proposed evidence against repository files and calculates exact line numbers."""

    MIN_QUOTE_CHARS = 16  # non-whitespace characters; shorter quotes ("return None") prove nothing

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
    _INDEX_CODE_EXTS = {".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".rs",
                        ".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx", ".java", ".patch", ".diff"}
    _INDEX_SKIP_DIRS = {".git", ".github", "node_modules", "dist", "build", "vendor", "third_party", "__pycache__",
                        ".next", "venv", ".venv", "target", "site-packages", "bin", "obj", "coverage", ".idea", ".vscode"}
    _INDEX_MAX_FILE_BYTES = 1_000_000
    _definition_index_cache: Dict[str, Dict[str, List[Tuple[str, int, str, bool]]]] = {}

    _FILE_EXTENSIONS = {
        "py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "go", "rs", "json", "md", "rst", "txt", "patch", "diff",
        "toml", "yml", "yaml", "sh", "cfg", "ini", "html", "css", "xml", "lock", "c", "h", "cc", "cpp", "hpp", "java",
    }

    @classmethod
    def _symbol_candidates(cls, symbol: str) -> List[Tuple[str, Optional[str]]]:
        """
        (name, qualifier) pairs to look up from a model-provided symbol_name. Handles lists ("A, B"),
        backticks, "Class.method" and "Class::method" (-> ("method", "Class")). File names
        ("policies.json", "patch.py") and non-identifiers ("font-hijacker") yield nothing, so they can
        never match an unrelated definition like `def json()` or `def font()`.
        """
        candidates: List[Tuple[str, Optional[str]]] = []
        for token in re.split(r"[\s,;`'\"()\[\]{}]+", symbol.replace("::", ".")):
            if not re.fullmatch(r"[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*", token):
                continue
            parts = token.split(".")
            if len(parts) > 1 and parts[-1].lower() in cls._FILE_EXTENSIONS:
                continue
            name = parts[-1]
            qualifier = parts[-2] if len(parts) > 1 else None
            if len(name) >= cls.MIN_SYMBOL_CHARS and (name, qualifier) not in candidates:
                candidates.append((name, qualifier))
        return candidates

    @staticmethod
    def _qualifier_matches(qualified: str, name: str, qualifier: Optional[str]) -> bool:
        """`qualified` is a definition's full name ("UserService.delete"); a qualified request must match it."""
        parts = qualified.split(".")
        if parts[-1] != name:
            return False
        return qualifier is None or (len(parts) > 1 and parts[-2] == qualifier)

    @classmethod
    def locate_symbol_definition(cls, content: str, symbol: str, rel_path: Optional[str] = None) -> Optional[Tuple[int, int]]:
        """Line of the symbol's definition (def/class/function/func/fn/struct/...) in this file, if any."""
        candidates = cls._symbol_candidates(symbol)
        if rel_path:
            definitions = list(cls._file_definitions(rel_path, content))
            for name, qualifier in candidates:
                for qualified, line in definitions:
                    if cls._qualifier_matches(qualified, name, qualifier):
                        return line, line
            if definitions:
                return None  # the parser saw this file; a regex guess must not override it
        for name, qualifier in candidates:
            if qualifier:
                continue  # an unparsed file cannot confirm the qualifier
            definition = re.compile(cls._DEFINITION_PREFIX + re.escape(name) + r"\b", re.MULTILINE)
            match = definition.search(content)
            if match:
                line_no = content[:match.start()].count("\n") + 1
                return line_no, line_no
        return None

    # Definitions added by a patch: "+class Foo {", "+void Foo::Bar(...) {", "+  int helper(int x)".
    # Each alternative stops at the end of its line ([^;\n]); a line ending in ";" is a declaration or call.
    _PATCH_DEFINITION = re.compile(
        r"^\+(?!\+\+)[ \t]*(?:"
        r"(?:class|struct|enum|interface|union)[ \t]+(?:[A-Z_]+[ \t]+)?([A-Za-z_]\w*)[^;\n]*$"
        r"|(?:[A-Za-z_~][\w:<>,*&~]*[ \t]+)+[*&]?((?:[A-Za-z_]\w*::)*~?[A-Za-z_]\w*)[ \t]*\([^;\n]*$"
        r"|(?:export[ \t]+)?(?:async[ \t]+)?(?:def|function|func|fn)[ \t]+([A-Za-z_$][\w$]*)"
        r")",
        re.MULTILINE,
    )
    _NOT_FUNCTION_NAMES = {"if", "for", "while", "switch", "return", "sizeof", "catch", "else", "do", "case", "new", "delete"}

    @classmethod
    def _file_definitions(cls, rel_path: str, content: str):
        """(qualified name, line) for every definition in a file, from the language parser where available."""
        from .ast_parser import TreeSitterAnalyzer
        ext = Path(rel_path).suffix.lower()
        if ext in (".patch", ".diff"):
            for match in cls._PATCH_DEFINITION.finditer(content):
                raw = next(g for g in match.groups() if g)
                qualified = raw.replace("::", ".").replace("~", "")
                name = qualified.split(".")[-1]
                # ALL_CAPS names are macro invocations (NS_SUCCEEDED(rv)), not definitions
                if name and name not in cls._NOT_FUNCTION_NAMES and not re.fullmatch(r"[A-Z0-9_]+", name):
                    yield qualified, content[:match.start()].count("\n") + 1
            return
        try:
            symbols = TreeSitterAnalyzer.analyze_file(rel_path, content)
        except (Exception, RecursionError):
            symbols = []
        if symbols:
            for symbol in symbols:
                yield symbol.name, symbol.line_start
            return
        for match in cls._ANY_DEFINITION.finditer(content):
            yield match.group(1), content[:match.start()].count("\n") + 1

    @classmethod
    def _definition_index(cls, repo_dir: Path) -> Dict[str, List[Tuple[str, int, str, bool]]]:
        """name -> [(repo-relative path, line, qualified name, is_test)] for every definition in the clone."""
        key = str(repo_dir.resolve())
        cached = cls._definition_index_cache.get(key)
        if cached is not None:
            return cached
        index: Dict[str, List[Tuple[str, int, str, bool]]] = {}
        for path in sorted(repo_dir.rglob("*")):
            rel = path.relative_to(repo_dir)
            if any(part in cls._INDEX_SKIP_DIRS for part in rel.parts) or path.suffix.lower() not in cls._INDEX_CODE_EXTS:
                continue
            if path.is_symlink() or not path.is_file() or path.stat().st_size > cls._INDEX_MAX_FILE_BYTES:
                continue
            rel_str = rel.as_posix()
            is_test = cls.classify_evidence_strength(rel_str, None, "code", "") == "EXAMPLE"
            content = path.read_text(errors="ignore")
            for qualified, line in cls._file_definitions(rel_str, content):
                name = qualified.split(".")[-1]
                if len(name) >= cls.MIN_SYMBOL_CHARS:
                    index.setdefault(name, []).append((rel_str, line, qualified, is_test))
        # One cached index per clone; clones are deleted after each job, so keep the cache tiny
        cls._definition_index_cache = {key: index}
        return index

    @classmethod
    def _resolve_symbol_in_repo(cls, repo_dir: Path, symbol: Optional[str]) -> Optional[Tuple[str, int]]:
        """
        The single real definition the model most likely meant. Qualified names must match their
        qualifier; a bare name defined in several (non-test) files is ambiguous and is not guessed.
        """
        if not symbol:
            return None
        index = cls._definition_index(repo_dir)
        for name, qualifier in cls._symbol_candidates(symbol):
            entries = [e for e in index.get(name, []) if cls._qualifier_matches(e[2], name, qualifier)]
            if not entries:
                continue
            primary = [e for e in entries if not e[3]] or entries
            if len({e[0] for e in primary}) > 1:
                continue  # ambiguous: defined in more than one file
            return primary[0][0], primary[0][1]
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
                calculated_lines = cls.locate_symbol_definition(content, symbol, file_path_str)

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
        ev_type = evidence.get("evidence_type")
        ev_type = ev_type if ev_type in ("code_ast", "doc", "example", "manifest") else "doc"
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
        is_code = ext in (".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".rs", ".java",
                          ".c", ".h", ".cc", ".cpp", ".cxx", ".hh", ".hpp", ".hxx", ".patch", ".diff")

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
