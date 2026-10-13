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
C_LANG = _load_language("tree_sitter_c", "language")
CPP_LANG = _load_language("tree_sitter_cpp", "language")
JAVA_LANG = _load_language("tree_sitter_java", "language")

C_EXTENSIONS = (".c",)
CPP_EXTENSIONS = (".cc", ".cpp", ".cxx", ".c++", ".h", ".hh", ".hpp", ".hxx", ".ipp", ".inl")
JAVA_EXTENSIONS = (".java",)


def _iter_nodes(root):
    """Iterative pre-order traversal: deeply nested code must not hit Python's recursion limit."""
    stack = [root]
    while stack:
        node = stack.pop()
        yield node
        stack.extend(reversed(node.children))


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
        elif ext == ".cjs":
            return cls.parse_javascript_typescript(content, is_typescript=False)
        elif ext == ".go":
            return cls.parse_go(content)
        elif ext == ".rs":
            return cls.parse_rust(content)
        elif ext in C_EXTENSIONS:
            return cls.parse_c_family(content, CPP_LANG if C_LANG is None else C_LANG)
        elif ext in CPP_EXTENSIONS:
            # Headers are parsed as C++ (a near-superset of C for declarations)
            return cls.parse_c_family(content, CPP_LANG)
        elif ext in JAVA_EXTENSIONS:
            return cls.parse_java(content)
        return []

    @staticmethod
    def _c_declarator_name(src: bytes, declarator) -> Optional[str]:
        """Walks a C/C++ declarator chain (pointer/reference/function declarators) to the declared name."""
        node = declarator
        for _ in range(8):
            if node is None:
                return None
            if node.type in ("identifier", "field_identifier", "qualified_identifier", "destructor_name",
                             "operator_name", "type_identifier"):
                return _node_text(src, node)
            inner = node.child_by_field_name("declarator")
            if inner is None:
                # e.g. parenthesized_declarator without a field name
                inner = next((c for c in node.named_children if c.type.endswith("declarator") or c.type.endswith("identifier")), None)
            node = inner
        return None

    @classmethod
    def parse_c_family(cls, content: str, language) -> List[CodeSymbol]:
        if language is None:
            return []
        src = content.encode("utf-8")
        tree = Parser(language).parse(src)
        symbols: List[CodeSymbol] = []
        for node in _iter_nodes(tree.root_node):
            if node.type == "function_definition":
                name = cls._c_declarator_name(src, node.child_by_field_name("declarator"))
                if name:
                    declarator = node.child_by_field_name("declarator")
                    signature = _node_text(src, declarator).split("{")[0].strip()[:160] if declarator else name
                    symbols.append(CodeSymbol(
                        name=name.replace("::", "."),
                        symbol_type="method" if "::" in name else "function",
                        line_start=node.start_point.row + 1,
                        line_end=node.end_point.row + 1,
                        signature=signature,
                    ))
            elif node.type in ("class_specifier", "struct_specifier", "union_specifier", "enum_specifier"):
                name_node = node.child_by_field_name("name")
                # Only definitions (with a body), not forward declarations or `struct S s;` uses
                if name_node is not None and node.child_by_field_name("body") is not None:
                    kind = node.type.replace("_specifier", "")
                    tname = _node_text(src, name_node)
                    symbols.append(CodeSymbol(
                        name=tname.replace("::", "."),
                        symbol_type=kind,
                        line_start=node.start_point.row + 1,
                        line_end=node.end_point.row + 1,
                        signature=f"{kind} {tname}",
                    ))
        return symbols

    @classmethod
    def parse_java(cls, content: str) -> List[CodeSymbol]:
        if JAVA_LANG is None:
            return []
        src = content.encode("utf-8")
        tree = Parser(JAVA_LANG).parse(src)
        symbols: List[CodeSymbol] = []
        type_nodes = {"class_declaration": "class", "interface_declaration": "interface",
                      "enum_declaration": "enum", "record_declaration": "record"}
        for node in _iter_nodes(tree.root_node):
            name_node = node.child_by_field_name("name")
            if name_node is None:
                continue
            if node.type in type_nodes:
                tname = _node_text(src, name_node)
                symbols.append(CodeSymbol(
                    name=tname, symbol_type=type_nodes[node.type],
                    line_start=node.start_point.row + 1, line_end=node.end_point.row + 1,
                    signature=f"{type_nodes[node.type]} {tname}",
                ))
            elif node.type in ("method_declaration", "constructor_declaration"):
                mname = _node_text(src, name_node)
                params = node.child_by_field_name("parameters")
                owner = node.parent.parent if node.parent is not None else None
                owner_name = owner.child_by_field_name("name") if owner is not None and owner.type in type_nodes else None
                qualified = f"{_node_text(src, owner_name)}.{mname}" if owner_name is not None else mname
                symbols.append(CodeSymbol(
                    name=qualified, symbol_type="method",
                    line_start=node.start_point.row + 1, line_end=node.end_point.row + 1,
                    signature=f"{mname}{_node_text(src, params) if params else '()'}"[:160],
                ))
        return symbols

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
