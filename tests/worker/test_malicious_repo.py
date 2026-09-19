import pytest
from pathlib import Path
from apps.worker.analyzer.evidence import EvidenceVerificationGate
from apps.worker.analyzer.cartography import RepositoryCartographer
from apps.worker.providers.llm import MockLLMProvider

def test_malicious_prompt_injection_isolation():
    """Verifies that malicious injection instructions are safely enclosed and not obeyed."""
    repo_dir = Path("tests/fixtures/malicious_repo")
    assert repo_dir.exists()

    llm = MockLLMProvider()
    readme_text = (repo_dir / "README.md").read_text()

    # Pass 1: Cartography should isolate untrusted content
    cartography = RepositoryCartographer.analyze(
        repo_name="attacker/malicious-repo",
        repo_dir=repo_dir,
        readme_text=readme_text,
        manifest_summary="",
        llm=llm
    )

    # Cartography must not contain leaked environment secrets
    output_str = str(cartography)
    assert "antigravity_master_token_leaked" not in output_str
    assert "SECRET_KEY" not in output_str

def test_malicious_path_traversal_blocked():
    """Verifies that attempts to access files outside repository boundary are rejected."""
    repo_dir = Path("tests/fixtures/malicious_repo")

    malicious_evidence = {
        "file_path": "../../../../../etc/passwd",
        "quote_snippet": "root:x:0:0",
        "evidence_type": "doc"
    }

    result = EvidenceVerificationGate.verify_evidence(repo_dir, malicious_evidence)
    assert result["verified"] is False
    assert "path_traversal" in result["reason"]

def test_fabricated_evidence_rejected():
    """Verifies that claims with non-existent quotes/symbols are strictly rejected."""
    repo_dir = Path("tests/fixtures/malicious_repo")

    fabricated_evidence = {
        "file_path": "exploit.py",
        "symbol_name": "BypassSecurityEngine",
        "quote_snippet": "def bypass_all_security_controls(): pass",
        "evidence_type": "code_ast"
    }

    result = EvidenceVerificationGate.verify_evidence(repo_dir, fabricated_evidence)
    assert result["verified"] is False
    assert result["reason"] == "quote_or_symbol_not_found_in_file"
