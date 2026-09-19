import os
from typing import List, Dict, Any, Optional

try:
    from tree_sitter import Language, Parser
    import tree_sitter_python as tspython
    import tree_sitter_javascript as tsjs
    import tree_sitter_typescript as tstypescript
    import tree_sitter_go as tsgo
    import tree_sitter_rust as tsrust

    PY_LANG = Language(tspython.language())
    JS_LANG = Language(tsjs.language())
    TS_LANG = Language(tstypescript.language_typescript())
    TSX_LANG = Language(tstypescript.language_tsx())
    GO_LANG = Language(tsgo.language())
    RUST_LANG = Language(tsrust.language())
    TREE_SITTER_AVAILABLE = True
except Exception as e:
    TREE_SITTER_AVAILABLE = False

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
        if not TREE_SITTER_AVAILABLE:
            return cls._fallback_python(content)

        parser = Parser(PY_LANG)
        tree = parser.parse(content.encode("utf-8"))
        lines = content.splitlines()

        def visit(node, parent_class: Optional[str] = None):
            if node.type == "class_definition":
                name_node = node.child_by_field_name("name")
                class_name = content[name_node.start_byte:name_node.end_byte] if name_node else "UnknownClass"
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
                func_name = content[name_node.start_byte:name_node.end_byte] if name_node else "unknown_func"
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
    def parse_javascript_typescript(cls, content: str, is_typescript: bool = False) -> List[CodeSymbol]:
        symbols: List[CodeSymbol] = []
        if not TREE_SITTER_AVAILABLE:
            return []

        lang = TS_LANG if is_typescript else JS_LANG
        parser = Parser(lang)
        tree = parser.parse(content.encode("utf-8"))

        def visit(node):
            if node.type == "class_declaration":
                name_node = node.child_by_field_name("name")
                if name_node:
                    cname = content[name_node.start_byte:name_node.end_byte]
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
                    iname = content[name_node.start_byte:name_node.end_byte]
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
                    fname = content[name_node.start_byte:name_node.end_byte]
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
        if not TREE_SITTER_AVAILABLE:
            return []

        parser = Parser(GO_LANG)
        tree = parser.parse(content.encode("utf-8"))

        def visit(node):
            if node.type == "type_declaration":
                for child in node.children:
                    if child.type == "type_spec":
                        name_node = child.child_by_field_name("name")
                        type_node = child.child_by_field_name("type")
                        if name_node:
                            tname = content[name_node.start_byte:name_node.end_byte]
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
                    fname = content[name_node.start_byte:name_node.end_byte]
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
                    mname = content[name_node.start_byte:name_node.end_byte]
                    rcv_text = content[receiver.start_byte:receiver.end_byte] if receiver else ""
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
        if not TREE_SITTER_AVAILABLE:
            return []

        parser = Parser(RUST_LANG)
        tree = parser.parse(content.encode("utf-8"))

        def visit(node):
            if node.type == "struct_item":
                name_node = node.child_by_field_name("name")
                if name_node:
                    sname = content[name_node.start_byte:name_node.end_byte]
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
                    tname = content[name_node.start_byte:name_node.end_byte]
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
                    fname = content[name_node.start_byte:name_node.end_byte]
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
            return cls.parse_javascript_typescript(content, is_typescript=True)
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
