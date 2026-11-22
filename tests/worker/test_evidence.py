from pathlib import Path
from apps.worker.analyzer.evidence import EvidenceVerificationGate

FIXTURES_DIR = Path(__file__).resolve().parent.parent / "fixtures"

def test_valid_evidence():
    repo_dir = FIXTURES_DIR / "python_repo"
    evidence = {
        "file_path": "crawl_module.py",
        "quote": "AsyncWebCrawler",
        "symbol_name": "AsyncWebCrawler"
    }
    result = EvidenceVerificationGate.verify_evidence(repo_dir, evidence)
    assert result["verified"] is True
    assert result["start_line"] >= 1
    assert result["end_line"] >= result["start_line"]

def test_invalid_file():
    repo_dir = FIXTURES_DIR / "python_repo"
    evidence = {
        "file_path": "non_existent_file.py",
        "quote": "some code"
    }
    result = EvidenceVerificationGate.verify_evidence(repo_dir, evidence)
    assert result["verified"] is False
    assert "file_not_found" in result["reason"]

def test_invalid_quote():
    repo_dir = FIXTURES_DIR / "python_repo"
    evidence = {
        "file_path": "crawl_module.py",
        "quote": "this quote definitely does not exist in the file at all"
    }
    result = EvidenceVerificationGate.verify_evidence(repo_dir, evidence)
    assert result["verified"] is False
    assert result["reason"] == "quote_or_symbol_not_found_in_file"

def test_path_traversal_rejection():
    repo_dir = FIXTURES_DIR / "python_repo"
    evidence = {
        "file_path": "../../etc/passwd",
        "quote": "root"
    }
    result = EvidenceVerificationGate.verify_evidence(repo_dir, evidence)
    assert result["verified"] is False
    assert "path_traversal" in result["reason"]


def test_an_overlong_model_path_is_rejected_not_raised(tmp_path):
    # ENAMETOOLONG used to escape Path.is_file() and fail the whole repository's job
    result = EvidenceVerificationGate.verify_evidence(tmp_path, {"file_path": "x" * 300 + ".py", "quote_snippet": "a"})
    assert result["verified"] is False


def test_evidence_lines_ignore_form_feeds(tmp_path):
    # Lines are numbered on "\n"; cutting the quote with splitlines() also split on \f and stored the wrong line
    (tmp_path / "m.py").write_text("import os\n\x0c\n\n\n\ndef helper_fn():\n    return 1\n")
    result = EvidenceVerificationGate.verify_evidence(tmp_path, {"file_path": "m.py", "symbol_name": "helper_fn"})
    assert result["verified"] and result["start_line"] == 6 and result["quote_snippet"] == "def helper_fn():"
