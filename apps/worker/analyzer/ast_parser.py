import os
from typing import List, Dict, Any, Optional

try:
    from tree_sitter import Language, Parser
    TREE_SITTER_AVAILABLE = True
except Exception:
    TREE_SITTER_AVAILABLE = False


def _load_language(module_name: str, attr: str):
    """Loads one grammar; a missing grammar package must not disable the others."""
    if not TREE_SITTER_AVAILABLE:
        return None
    try:
        module = __import__(module_name)
        return Language(getattr(module, attr)())
    except Exception:
        return None


PY_LANG = _load_language("tree_sitter_python", "language")
JS_LANG = _load_language("tree_sitter_javascript", "language")
TS_LANG = _load_language("tree_sitter_typescript", "language_typescript")
TSX_LANG = _load_language("tree_sitter_typescript", "language_tsx")
GO_LANG = _load_language("tree_sitter_go", "language")
RUST_LANG = _load_language("tree_sitter_rust", "language")


def _node_text(src: bytes, node) -> str:
    """Tree-sitter offsets are byte offsets; slice the UTF-8 bytes, not the decoded str."""
    return src[node.start_byte:node.end_byte].decode("utf-8", errors="replace")

class CodeSymbol:
    def __init__(
        self,
        name: str,
        symbol_type: str,
        line_start: int,
        line_end: int,
        signature: str = "",
        docstring: str = "",
        is_exported: bool = True
    ):
        self.name = name
        self.symbol_type = symbol_type
        self.line_start = line_start
        self.line_end = line_end
        self.signature = signature
        self.docstring = docstring
        self.is_exported = is_exported

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "type": self.symbol_type,
            "line_start": self.line_start,
            "line_end": self.line_end,
            "signature": self.signature,
            "docstring": self.docstring,
            "is_exported": self.is_exported
        }

class TreeSitterAnalyzer:
    """Multi-language AST analyzer powered by Tree-sitter."""

    @classmethod
    def parse_python(cls, content: str) -> List[CodeSymbol]:
        symbols: List[CodeSymbol] = []
        if PY_LANG is None:
            return cls._fallback_python(content)

        parser = Parser(PY_LANG)
        src = content.encode("utf-8")
        tree = parser.parse(src)
        lines = content.splitlines()

        def visit(node, parent_class: Optional[str] = None):
            if node.type == "class_definition":
                name_node = node.child_by_field_name("name")
                class_name = _node_text(src, name_node) if name_node else "UnknownClass"
                symbols.append(CodeSymbol(
                    name=class_name,
                    symbol_type="class",
                    line_start=node.start_point.row + 1,
                    line_end=node.end_point.row + 1,
                    signature=f"class {class_name}"
                ))
                # Traverse body for methods
                body = node.child_by_field_name("body")
                if body:
                    for child in body.children:
                        visit(child, parent_class=class_name)

            elif node.type in ("function_definition", "async_function_definition"):
                name_node = node.child_by_field_name("name")
                func_name = _node_text(src, name_node) if name_node else "unknown_func"
                full_name = f"{parent_class}.{func_name}" if parent_class else func_name
                is_async = node.type == "async_function_definition"
                prefix = "async def " if is_async else "def "
                sig = f"{prefix}{func_name}(...)"

                symbols.append(CodeSymbol(
                    name=full_name,
                    symbol_type="method" if parent_class else "function",
                    line_start=node.start_point.row + 1,
                    line_end=node.end_point.row + 1,
                    signature=sig
                ))
            else:
                for child in node.children:
                    visit(child, parent_class)

        visit(tree.root_node)
        return symbols

    @classmethod
    def parse_javascript_typescript(cls, content: str, is_typescript: bool = False, is_tsx: bool = False) -> List[CodeSymbol]:
        symbols: List[CodeSymbol] = []
        lang = (TSX_LANG if is_tsx else TS_LANG) if is_typescript else JS_LANG
        if lang is None:
            return []

        parser = Parser(lang)
        src = content.encode("utf-8")
        tree = parser.parse(src)

        def visit(node):
            if node.type == "class_declaration":
                name_node = node.child_by_field_name("name")
                if name_node:
                    cname = _node_text(src, name_node)
                    symbols.append(CodeSymbol(
                        name=cname,
                        symbol_type="class",
                        line_start=node.start_point.row + 1,
                        line_end=node.end_point.row + 1,
                        signature=f"class {cname}"
                    ))
            elif node.type == "interface_declaration":
                name_node = node.child_by_field_name("name")
                if name_node:
                    iname = _node_text(src, name_node)
                    symbols.append(CodeSymbol(
                        name=iname,
                        symbol_type="interface",
                        line_start=node.start_point.row + 1,
                        line_end=node.end_point.row + 1,
                        signature=f"interface {iname}"
                    ))
            elif node.type == "function_declaration":
                name_node = node.child_by_field_name("name")
                if name_node:
                    fname = _node_text(src, name_node)
                    symbols.append(CodeSymbol(
                        name=fname,
                        symbol_type="function",
                        line_start=node.start_point.row + 1,
                        line_end=node.end_point.row + 1,
                        signature=f"function {fname}(...)"
                    ))
            elif node.type == "export_statement":
                for child in node.children:
                    if child.type != "export":
                        visit(child)
            else:
                for child in node.children:
                    visit(child)

        visit(tree.root_node)
        return symbols

    @classmethod
    def parse_go(cls, content: str) -> List[CodeSymbol]:
        symbols: List[CodeSymbol] = []
        if GO_LANG is None:
            return []

        parser = Parser(GO_LANG)
        src = content.encode("utf-8")
        tree = parser.parse(src)

        def visit(node):
            if node.type == "type_declaration":
                for child in node.children:
                    if child.type == "type_spec":
                        name_node = child.child_by_field_name("name")
                        type_node = child.child_by_field_name("type")
                        if name_node:
                            tname = _node_text(src, name_node)
                            stype = "struct" if type_node and type_node.type == "struct_type" else "type"
                            if type_node and type_node.type == "interface_type":
                                stype = "interface"
                            symbols.append(CodeSymbol(
                                name=tname,
                                symbol_type=stype,
                                line_start=child.start_point.row + 1,
                                line_end=child.end_point.row + 1,
                                signature=f"type {tname} {stype}",
                                is_exported=tname[0].isupper()
                            ))
            elif node.type == "function_declaration":
                name_node = node.child_by_field_name("name")
                if name_node:
                    fname = _node_text(src, name_node)
                    symbols.append(CodeSymbol(
                        name=fname,
                        symbol_type="function",
                        line_start=node.start_point.row + 1,
                        line_end=node.end_point.row + 1,
                        signature=f"func {fname}(...)",
                        is_exported=fname[0].isupper()
                    ))
            elif node.type == "method_declaration":
                name_node = node.child_by_field_name("name")
                receiver = node.child_by_field_name("receiver")
                if name_node:
                    mname = _node_text(src, name_node)
                    rcv_text = _node_text(src, receiver) if receiver else ""
                    symbols.append(CodeSymbol(
                        name=mname,
                        symbol_type="method",
                        line_start=node.start_point.row + 1,
                        line_end=node.end_point.row + 1,
                        signature=f"func {rcv_text} {mname}(...)",
                        is_exported=mname[0].isupper()
                    ))
            for child in node.children:
                visit(child)

        visit(tree.root_node)
        return symbols

    @classmethod
    def parse_rust(cls, content: str) -> List[CodeSymbol]:
        symbols: List[CodeSymbol] = []
        if RUST_LANG is None:
            return []

        parser = Parser(RUST_LANG)
        src = content.encode("utf-8")
        tree = parser.parse(src)

        def visit(node):
            if node.type == "struct_item":
                name_node = node.child_by_field_name("name")
                if name_node:
                    sname = _node_text(src, name_node)
                    symbols.append(CodeSymbol(
                        name=sname,
                        symbol_type="struct",
                        line_start=node.start_point.row + 1,
                        line_end=node.end_point.row + 1,
                        signature=f"struct {sname}"
                    ))
            elif node.type == "trait_item":
                name_node = node.child_by_field_name("name")
                if name_node:
                    tname = _node_text(src, name_node)
                    symbols.append(CodeSymbol(
                        name=tname,
                        symbol_type="trait",
                        line_start=node.start_point.row + 1,
                        line_end=node.end_point.row + 1,
                        signature=f"trait {tname}"
                    ))
            elif node.type == "function_item":
                name_node = node.child_by_field_name("name")
                if name_node:
                    fname = _node_text(src, name_node)
                    symbols.append(CodeSymbol(
                        name=fname,
                        symbol_type="function",
                        line_start=node.start_point.row + 1,
                        line_end=node.end_point.row + 1,
                        signature=f"fn {fname}(...)"
                    ))
            for child in node.children:
                visit(child)

        visit(tree.root_node)
        return symbols

    @classmethod
    def _fallback_python(cls, content: str) -> List[CodeSymbol]:
        import ast
        symbols = []
        try:
            tree = ast.parse(content)
            for node in ast.iter_child_nodes(tree):
                if isinstance(node, ast.ClassDef):
                    symbols.append(CodeSymbol(
                        name=node.name,
                        symbol_type="class",
                        line_start=node.lineno,
                        line_end=getattr(node, "end_lineno", node.lineno),
                        signature=f"class {node.name}"
                    ))
                elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    symbols.append(CodeSymbol(
                        name=node.name,
                        symbol_type="function",
                        line_start=node.lineno,
                        line_end=getattr(node, "end_lineno", node.lineno),
                        signature=f"def {node.name}(...)"
                    ))
        except Exception:
            pass
        return symbols

    @classmethod
    def analyze_file(cls, file_path: str, content: str) -> List[CodeSymbol]:
        ext = os.path.splitext(file_path)[1].lower()
        if ext in (".py", ".pyw"):
            return cls.parse_python(content)
        elif ext in (".ts", ".tsx"):
            return cls.parse_javascript_typescript(content, is_typescript=True, is_tsx=(ext == ".tsx"))
        elif ext in (".js", ".jsx", ".mjs"):
            return cls.parse_javascript_typescript(content, is_typescript=False)
        elif ext == ".go":
            return cls.parse_go(content)
        elif ext == ".rs":
            return cls.parse_rust(content)
        return []

    @classmethod
    def generate_symbol_outline(cls, file_path: str, symbols: List[CodeSymbol]) -> str:
        """Synthesizes structured symbol records into exact technical outline chunks."""
        if not symbols:
            return ""
        lines = [f"File: {file_path}"]
        for s in symbols:
            exported_mark = "[PUB] " if s.is_exported else ""
            lines.append(f"  {exported_mark}[{s.symbol_type.upper()}] {s.name} (L{s.line_start}-L{s.line_end}): {s.signature}")
            if s.docstring:
                clean = s.docstring.split("\n")[0].strip()
                lines.append(f"    // {clean}")
        return "\n".join(lines)
