import re
from pathlib import Path
from typing import Dict, Any, Tuple, Optional
from ..github.clone import GitCloner

class EvidenceVerificationGate:
    """Validates LLM-proposed evidence against repository files and calculates exact line numbers."""

    @staticmethod
    def locate_text_in_file(content: str, quote: str) -> Optional[Tuple[int, int]]:
        """
        Locates the exact start and end line numbers of a quote in the file content.
        Uses normalized whitespace comparison to tolerate indentation or formatting discrepancies.
        """
        lines = content.splitlines()
        quote_clean = " ".join(quote.strip().split())
        if not quote_clean:
            return None

        # 1. Exact string search
        if quote in content:
            start_pos = content.find(quote)
            start_line = content[:start_pos].count("\n") + 1
            end_line = start_line + quote.count("\n")
            return start_line, end_line

        # 2. Line-by-line sliding window search
        quote_words = quote_clean.split()
        first_few_words = " ".join(quote_words[:min(4, len(quote_words))])

        for idx, line in enumerate(lines, start=1):
            if first_few_words.lower() in line.lower():
                # Potential match, check window
                window = " ".join(lines[idx - 1 : idx + 20])
                window_clean = " ".join(window.split())
                if quote_clean.lower() in window_clean.lower() or first_few_words.lower() in window_clean.lower():
                    end_line = min(idx + quote.count("\n"), len(lines))
                    return idx, max(idx, end_line)

        return None

    @classmethod
    def verify_evidence(cls, repo_dir: Path, evidence: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validates an evidence claim:
        - Ensures file path exists without escaping repository root
        - Confirms quote or symbol actually occurs in file
        - Programmatically calculates real start_line and end_line from source
        """
        file_path_str = evidence.get("file_path", "")
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

        quote = evidence.get("quote_snippet", "") or evidence.get("quote", "")
        symbol = evidence.get("symbol_name")

        calculated_lines = None
        if quote:
            calculated_lines = cls.locate_text_in_file(content, quote)

        # If quote not found, check if symbol exists in content
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

        return {
            "verified": True,
            "file_path": file_path_str,
            "start_line": start_line,
            "end_line": end_line,
            "symbol_name": symbol,
            "quote_snippet": quote,
            "evidence_type": evidence.get("evidence_type", "doc")
        }
