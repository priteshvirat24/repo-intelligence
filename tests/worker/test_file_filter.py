import os
from pathlib import Path
from apps.worker.analyzer.file_filter import FileFilter

def test_file_classification():
    ff = FileFilter()

    # Excluded extensions
    assert ff.classify_file("package-lock.json", "package-lock.json", ".lock") == "EXCLUDE"
    assert ff.classify_file("assets/logo.png", "logo.png", ".png") == "EXCLUDE"
    assert ff.classify_file("bundle.min.js", "bundle.min.js", ".js") == "EXCLUDE"

    # Included manifests and docs
    assert ff.classify_file("package.json", "package.json", ".json") == "INCLUDE"
    assert ff.classify_file("README.md", "README.md", ".md") == "INCLUDE"
    assert ff.classify_file("Dockerfile", "Dockerfile", "") == "INCLUDE"
    assert ff.classify_file("pyproject.toml", "pyproject.toml", ".toml") == "INCLUDE"

    # Included source code
    assert ff.classify_file("src/main.py", "main.py", ".py") == "INCLUDE"
    assert ff.classify_file("src/index.ts", "index.ts", ".ts") == "INCLUDE"
    assert ff.classify_file("main.go", "main.go", ".go") == "INCLUDE"
    assert ff.classify_file("lib.rs", "lib.rs", ".rs") == "INCLUDE"

def test_scan_python_fixture():
    fixture_dir = Path(__file__).resolve().parent.parent / "fixtures" / "python_repo"
    ff = FileFilter()
    scan = ff.scan_repository(fixture_dir)

    included_paths = [item[0] for item in scan["included_files"]]
    assert any("README.md" in p for p in included_paths)
    assert any("crawl_module.py" in p for p in included_paths)
    assert any("requirements.txt" in p for p in included_paths)
