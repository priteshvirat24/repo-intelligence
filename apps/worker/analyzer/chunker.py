import re
import hashlib
from typing import List, Dict, Any, Optional

class SecretSanitizer:
    """Detects and masks credentials and secrets before embedding or persisting."""

    SECRET_PATTERNS = [
        # GitHub Personal Access Token
        (re.compile(r'gh[pousr]_[A-Za-z0-9_]{36,255}'), '[REDACTED_GITHUB_TOKEN]'),
        # OpenAI / Anthropic / Mistral / Generic API Keys
        (re.compile(r'sk-[a-zA-Z0-9_\-]{20,100}'), '[REDACTED_API_KEY]'),
        (re.compile(r'xox[baprs]-[0-9a-zA-Z]{10,48}'), '[REDACTED_SLACK_TOKEN]'),
        # AWS Access Key ID
        (re.compile(r'\b(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}\b'), '[REDACTED_AWS_KEY]'),
        # Private Keys
        (re.compile(r'-----BEGIN\s+[A-Z\s]+PRIVATE\s+KEY-----[\s\S]*?-----END\s+[A-Z\s]+PRIVATE\s+KEY-----'), '[REDACTED_PRIVATE_KEY]'),
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

        lines = text.splitlines()
        current_lines: List[str] = []
        current_tokens = 0
        chunk_idx = 0
        current_start_line = 1

        for i, line in enumerate(lines, start=1):
            line_tokens = max(1, len(line) // 4)

            # Check semantic boundary: Markdown headers or major symbol definition
            is_semantic_boundary = line.startswith("#") or line.startswith("class ") or line.startswith("def ") or line.startswith("func ")
            
            if (current_tokens + line_tokens > target_tokens) or (is_semantic_boundary and current_tokens >= target_tokens // 2):
                if current_lines:
                    chunk_text = "\n".join(current_lines)
                    chunks.append(SemanticChunk(
                        content=chunk_text,
                        file_path=file_path,
                        doc_type=doc_type,
                        language=language,
                        chunk_index=chunk_idx,
                        start_line=current_start_line,
                        end_line=i - 1,
                        metadata={"filePath": file_path, "docType": doc_type}
                    ))
                    chunk_idx += 1

                    # Compute overlap lines
                    overlap_lines_count = max(1, overlap_tokens // 10)
                    current_lines = current_lines[-overlap_lines_count:]
                    current_start_line = max(1, i - len(current_lines))
                    current_tokens = sum(max(1, len(l) // 4) for l in current_lines)

            current_lines.append(line)
            current_tokens += line_tokens

        # Flush final chunk
        if current_lines:
            chunk_text = "\n".join(current_lines)
            chunks.append(SemanticChunk(
                content=chunk_text,
                file_path=file_path,
                doc_type=doc_type,
                language=language,
                chunk_index=chunk_idx,
                start_line=current_start_line,
                end_line=len(lines),
                metadata={"filePath": file_path, "docType": doc_type}
            ))

        return chunks
