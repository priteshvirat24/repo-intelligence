from pathlib import Path
from apps.worker.analyzer.ast_parser import TreeSitterAnalyzer

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"

def test_parse_python_fixture():
    py_file = FIXTURES_DIR / "python_repo" / "crawl_module.py"
    content = py_file.read_text()
    symbols = TreeSitterAnalyzer.analyze_file("crawl_module.py", content)

    names = [s.name for s in symbols]
    assert "AsyncWebCrawler" in names
    assert any("arun" in name for name in names)

def test_parse_typescript_fixture():
    ts_file = FIXTURES_DIR / "typescript_repo" / "src" / "index.ts"
    content = ts_file.read_text()
    symbols = TreeSitterAnalyzer.analyze_file("src/index.ts", content)

    names = [s.name for s in symbols]
    assert "MemoryManager" in names
    assert "recall" in names

def test_parse_go_fixture():
    go_file = FIXTURES_DIR / "go_repo" / "main.go"
    content = go_file.read_text()
    symbols = TreeSitterAnalyzer.analyze_file("main.go", content)

    names = [s.name for s in symbols]
    assert "Indexer" in names
    assert "VectorStore" in names

def test_parse_rust_fixture():
    rs_file = FIXTURES_DIR / "rust_repo" / "src" / "lib.rs"
    content = rs_file.read_text()
    symbols = TreeSitterAnalyzer.analyze_file("src/lib.rs", content)

    names = [s.name for s in symbols]
    assert "Tokenizer" in names
    assert "ChunkEngine" in names

def test_symbol_outline_generation():
    py_file = FIXTURES_DIR / "python_repo" / "crawl_module.py"
    content = py_file.read_text()
    symbols = TreeSitterAnalyzer.analyze_file("crawl_module.py", content)
    outline = TreeSitterAnalyzer.generate_symbol_outline("crawl_module.py", symbols)

    assert "File: crawl_module.py" in outline
    assert "AsyncWebCrawler" in outline
