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

        if not target_file.is_file():
            return {"verified": False, "reason": f"file_not_found: {file_path_str}"}

        try:
            content = target_file.read_text(errors="ignore")
        except Exception as e:
            return {"verified": False, "reason": f"file_read_error: {str(e)}"}

        quote = evidence.get("quote_snippet") or evidence.get("quote") or ""
        quote = quote if isinstance(quote, str) else ""
        symbol = evidence.get("symbol_name")
        symbol = symbol.strip() if isinstance(symbol, str) and symbol.strip() else None

        calculated_lines = None
        if quote:
            calculated_lines = cls.locate_text_in_file(content, quote)

        if quote and not calculated_lines:
            # The model quoted text that is not in the file: the claim is fabricated, and a common
            # symbol name elsewhere in the file must not rescue it
            return {"verified": False, "reason": "quote_or_symbol_not_found_in_file"}

        # Symbol-only claim: locate the symbol in the file
        if not calculated_lines and symbol:
            symbol_pattern = re.compile(rf'\b{re.escape(symbol)}\b')
            match = symbol_pattern.search(content)
            if match:
                pos = match.start()
                line_no = content[:pos].count("\n") + 1
                calculated_lines = (line_no, line_no)

        if not calculated_lines:
            return {
                "verified": False,
                "reason": "quote_or_symbol_not_found_in_file"
            }

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
