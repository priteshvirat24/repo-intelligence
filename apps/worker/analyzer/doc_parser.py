import re
from typing import List, Dict, Any

class DocSection:
    def __init__(self, title: str, level: int, content: str, line_start: int, line_end: int):
        self.title = title
        self.level = level
        self.content = content
        self.line_start = line_start
        self.line_end = line_end

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "level": self.level,
            "content": self.content,
            "line_start": self.line_start,
            "line_end": self.line_end
        }

class DocumentParser:
    """Parses technical markdown documents, READMEs, and guides into structured sections."""

    @staticmethod
    def parse_markdown(content: str) -> List[DocSection]:
        sections: List[DocSection] = []
        lines = content.splitlines()

        heading_regex = re.compile(r'^(#{1,6})\s+(.*)$')
        current_title = "Overview"
        current_level = 1
        current_lines: List[str] = []
        current_start_line = 1

        for i, line in enumerate(lines, start=1):
            match = heading_regex.match(line)
            if match:
                # Save previous section if it has content
                if current_lines:
                    sections.append(DocSection(
                        title=current_title,
                        level=current_level,
                        content="\n".join(current_lines).strip(),
                        line_start=current_start_line,
                        line_end=i - 1
                    ))
                    current_lines = []

                current_level = len(match.group(1))
                current_title = match.group(2).strip()
                current_start_line = i
            else:
                current_lines.append(line)

        # Flush final section
        if current_lines:
            sections.append(DocSection(
                title=current_title,
                level=current_level,
                content="\n".join(current_lines).strip(),
                line_start=current_start_line,
                line_end=len(lines)
            ))

        return sections

    @staticmethod
    def extract_code_blocks(content: str) -> List[Dict[str, Any]]:
        """Extracts fenced code examples from markdown."""
        code_block_regex = re.compile(r'```([a-zA-Z0-9_\-\+]*)\n(.*?)```', re.DOTALL)
        blocks = []
        for match in code_block_regex.finditer(content):
            lang = match.group(1).strip() or "text"
            code = match.group(2).strip()
            blocks.append({
                "language": lang,
                "code": code
            })
        return blocks
