import pytest
from pathlib import Path
from apps.worker.analyzer.cartography import RepositoryCartographer
from apps.worker.analyzer.module_analyzer import ModuleAnalyzer
from apps.worker.analyzer.synthesis import RepositorySynthesizer
from apps.worker.analyzer.evidence import EvidenceVerificationGate
from apps.worker.analyzer.capability import CapabilityEngine
from apps.worker.providers.llm import MockLLMProvider

def test_satellite_open_world_analysis():
    repo_dir = Path("tests/fixtures/satellite_orbital_repo")
    assert repo_dir.exists()

    llm = MockLLMProvider()

    # Pass 1: Cartography
    readme_text = (repo_dir / "README.md").read_text()
    cartography = RepositoryCartographer.analyze(
        repo_name="aerospace-labs/satellite-sgp4-core",
        repo_dir=repo_dir,
        readme_text=readme_text,
        manifest_summary="numpy, scipy",
        llm=llm
    )
    assert cartography is not None
    assert "purpose" in cartography
    assert "problemSpace" in cartography

    # Pass 2: Module analysis
    sgp4_file = (repo_dir / "orbit" / "sgp4.py").read_text()
    module_res = ModuleAnalyzer.analyze_module(
        module_name="orbit",
        module_path="orbit/sgp4.py",
        symbol_outline="class SGP4Propagator\ndef propagate_orbit",
        doc_excerpt=sgp4_file[:500],
        llm=llm
    )
    assert module_res is not None

    # Pass 3: Synthesis
    synthesis = RepositorySynthesizer.synthesize(
        repo_name="aerospace-labs/satellite-sgp4-core",
        cartography=cartography,
        module_analyses=[module_res],
        manifest_deps=[{"package_name": "numpy", "ecosystem": "pypi"}],
        llm=llm
    )
    assert synthesis is not None
    assert "capabilities" in synthesis

    # Pass 4: Strict Evidence Verification Gate on SGP4 capability
    evidence_claim = {
        "file_path": "orbit/sgp4.py",
        "symbol_name": "SGP4Propagator",
        "quote_snippet": "class SGP4Propagator",
        "evidence_type": "code_ast"
    }
    verification = EvidenceVerificationGate.verify_evidence(repo_dir, evidence_claim)
    assert verification["verified"] is True
    assert verification["file_path"] == "orbit/sgp4.py"
    assert verification["start_line"] == 1
    assert verification["symbol_name"] == "SGP4Propagator"

    # Verify novel slug preservation (not mapped to UNMAPPED)
    novel_slug = CapabilityEngine.map_slug("SGP4 orbital propagation")
    assert novel_slug == "sgp4-orbital-propagation"
