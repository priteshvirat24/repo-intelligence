import re
import hashlib
from typing import List, Dict, Any, Optional

class SecretSanitizer:
    """Detects and masks credentials and secrets before embedding or persisting."""

    SECRET_PATTERNS = [
        # GitHub Personal Access Token
        (re.compile(r'gh[pousr]_[A-Za-z0-9_]{36,255}'), '[REDACTED_GITHUB_TOKEN]'),
        # OpenAI / Anthropic / Mistral / Generic API Keys
        # Left boundary so identifiers like "task-scheduler-configuration" are not mangled
        (re.compile(r'(?<![A-Za-z0-9_-])sk-[a-zA-Z0-9_\-]{20,100}'), '[REDACTED_API_KEY]'),
        (re.compile(r'xox[baprs]-[0-9a-zA-Z]{10,48}'), '[REDACTED_SLACK_TOKEN]'),
        # AWS Access Key ID
        (re.compile(r'\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b'), '[REDACTED_AWS_KEY]'),
        # Private Keys
        # Covers PKCS#8 "BEGIN PRIVATE KEY" as well as "BEGIN RSA/EC/OPENSSH PRIVATE KEY"; the replacement
        # keeps the original newlines so line numbers of later chunks stay correct
        (re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----'),
         lambda m: '[REDACTED_PRIVATE_KEY]' + '\n' * m.group(0).count('\n')),
        # Generic Bearer Tokens
        (re.compile(r'Bearer\s+[a-zA-Z0-9_\-\.]{25,}'), 'Bearer [REDACTED_TOKEN]')
    ]

    @classmethod
    def sanitize(cls, text: str) -> str:
        for pattern, replacement in cls.SECRET_PATTERNS:
            text = pattern.sub(replacement, text)
        return text

class SemanticChunk:
    def __init__(
        self,
        content: str,
        file_path: str,
        doc_type: str,
        language: str,
        chunk_index: int,
        start_line: int,
        end_line: int,
        symbol_name: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ):
        self.content = SecretSanitizer.sanitize(content)
        self.file_path = file_path
        self.doc_type = doc_type
        self.language = language
        self.chunk_index = chunk_index
        self.start_line = start_line
        self.end_line = end_line
        self.symbol_name = symbol_name
        self.token_count = max(1, len(self.content) // 4)
        self.chunk_hash = hashlib.sha256(self.content.encode("utf-8")).hexdigest()
        self.metadata = metadata or {}

class SemanticChunker:
    """Splits documents and source code outlines into bounded semantic chunks."""

    @staticmethod
    def chunk_text(
        text: str,
        file_path: str,
        doc_type: str,
        language: str = "text",
        target_tokens: int = 512,
        overlap_tokens: int = 64
    ) -> List[SemanticChunk]:
        chunks: List[SemanticChunk] = []
        if not text.strip():
            return chunks

        # Redact the whole document before splitting: a secret straddling a chunk boundary would
        # otherwise match in neither chunk and be stored/embedded verbatim
        text = SecretSanitizer.sanitize(text)

        lines = text.splitlines()

        # Split any line longer than one chunk (e.g. minified bundles) so no chunk exceeds the
        # target size; every piece keeps its original line number.
        max_line_chars = target_tokens * 4
        entries: List[tuple] = []  # (line_number, text)
        for line_no, line in enumerate(lines, start=1):
            if len(line) <= max_line_chars:
                entries.append((line_no, line))
            else:
                for offset in range(0, len(line), max_line_chars):
                    entries.append((line_no, line[offset:offset + max_line_chars]))

        def tokens_of(line: str) -> int:
            return max(1, len(line) // 4)

        current: List[tuple] = []
        current_tokens = 0
        overlap_count = 0  # leading entries of `current` carried over from the previous chunk
        chunk_idx = 0

        def flush():
            nonlocal chunk_idx
            chunks.append(SemanticChunk(
                content="\n".join(t for _, t in current),
                file_path=file_path,
                doc_type=doc_type,
                language=language,
                chunk_index=chunk_idx,
                start_line=current[0][0],
                end_line=current[-1][0],
                metadata={"filePath": file_path, "docType": doc_type}
            ))
            chunk_idx += 1

        for line_no, line in entries:
            line_tokens = tokens_of(line)

            # Check semantic boundary: Markdown headers or major symbol definition
            is_semantic_boundary = line.startswith("#") or line.startswith("class ") or line.startswith("def ") or line.startswith("func ")

            if (current_tokens + line_tokens > target_tokens) or (is_semantic_boundary and current_tokens >= target_tokens // 2):
                if len(current) > overlap_count:
                    flush()
                    # Carry trailing lines worth at most `overlap_tokens` into the next chunk
                    carried: List[tuple] = []
                    carried_tokens = 0
                    for entry in reversed(current):
                        t = tokens_of(entry[1])
                        if carried_tokens + t > overlap_tokens:
                            break
                        carried.insert(0, entry)
                        carried_tokens += t
                    current = carried
                    current_tokens = carried_tokens
                    overlap_count = len(carried)
                if current_tokens + line_tokens > target_tokens:
                    # Overlap alone would push this chunk over budget; drop it rather than emit a duplicate
                    current, current_tokens, overlap_count = [], 0, 0

            current.append((line_no, line))
            current_tokens += line_tokens

        # Flush final chunk (unless it is only overlap already present in the previous chunk)
        if len(current) > overlap_count:
            flush()

        return chunks
