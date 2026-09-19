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
