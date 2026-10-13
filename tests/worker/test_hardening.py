"""Regression tests for ingestion hardening: evidence grounding, parsing, chunking, retries."""
import json
import subprocess
from pathlib import Path

import httpx
import pytest

from apps.worker.analyzer.ast_parser import TreeSitterAnalyzer
from apps.worker.analyzer.capability import CapabilityEngine
from apps.worker.analyzer.chunker import SecretSanitizer, SemanticChunker
from apps.worker.analyzer.evidence import EvidenceVerificationGate as Gate
from apps.worker.analyzer.file_filter import FileFilter
from apps.worker.analyzer.metadata import ManifestAnalyzer
from apps.worker.github.clone import GitCloner
from apps.worker.providers.llm import parse_json_object
from apps.worker.worker import is_transient_error, select_chunks


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "orbit.py").write_text(
        "import os\n\nclass Propagator:\n    \"\"\"Doc string here.\"\"\"\n"
        "    def propagate_orbit(self, timestamp: float):\n        return timestamp\n"
    )
    (tmp_path / "src" / "http.ts").write_text("export async function serverFetch(url: string) {\n  return url;\n}\n")
    (tmp_path / "engine.cpp").write_text("class FontMasker {\n public:\n  void apply();\n};\nvoid FontMasker::apply() {}\n")
    (tmp_path / "Spoofer.java").write_text("public class Spoofer {\n  public String fingerprint(int seed) { return \"\"; }\n}\n")
    (tmp_path / "audio.patch").write_text(
        "--- a/x.cpp\n+++ b/x.cpp\n@@ -1 +1,4 @@\n+class AudioFingerprintManager {\n+  if (NS_SUCCEEDED(rv)) {\n+};\n"
    )
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_x.py").write_text("def json():\n    pass\n")
    Gate._definition_index_cache = {}
    return tmp_path


# ---------------- evidence gate ----------------

def test_fabricated_quote_is_not_rescued_by_mentioned_symbol(repo):
    out = Gate.verify_evidence(repo, {"file_path": "src/orbit.py", "quote": "implements quantum teleportation", "symbol_name": "os"})
    assert out["verified"] is False


def test_partial_quote_prefix_is_rejected(repo):
    out = Gate.verify_evidence(repo, {"file_path": "src/orbit.py",
                                      "quote": "def propagate_orbit(self, timestamp: float) uses GPU Kalman filtering"})
    assert out["verified"] is False


def test_paraphrased_quote_with_defined_symbol_stores_real_line(repo):
    out = Gate.verify_evidence(repo, {"file_path": "src/orbit.py", "quote": "propagates orbits", "symbol_name": "Propagator.propagate_orbit"})
    assert out["verified"] is True
    assert out["start_line"] == 5
    assert out["quote_snippet"] == "def propagate_orbit(self, timestamp: float):"


def test_symbol_attributed_to_wrong_file_resolves_to_real_definition(repo):
    out = Gate.verify_evidence(repo, {"file_path": "src/browser-runtime.ts", "quote": "handles fetch", "symbol_name": "serverFetch"})
    assert out["verified"] is True
    assert out["file_path"] == "src/http.ts" and out["start_line"] == 1


def test_filename_is_never_treated_as_symbol(repo):
    out = Gate.verify_evidence(repo, {"file_path": "policies.json", "quote": "policy file", "symbol_name": "policies.json"})
    assert out["verified"] is False


def test_hyphenated_name_does_not_match_generic_words(repo):
    assert Gate._symbol_candidates("font-hijacker") == []
    assert Gate._symbol_candidates("NetworkRequest, NetworkObserver") == ["NetworkRequest", "NetworkObserver"]
    assert Gate._symbol_candidates("FontMasker::apply") == ["apply"]


def test_cpp_java_and_patch_definitions_resolve(repo):
    for symbol, expected_file in [("FontMasker", "engine.cpp"), ("fingerprint", "Spoofer.java"),
                                  ("AudioFingerprintManager", "audio.patch")]:
        out = Gate.verify_evidence(repo, {"file_path": "made/up.cpp", "quote": "x", "symbol_name": symbol})
        assert out["verified"] is True, symbol
        assert out["file_path"] == expected_file
    out = Gate.verify_evidence(repo, {"file_path": "audio.patch", "quote": "x", "symbol_name": "NS_SUCCEEDED"})
    assert out["verified"] is False


def test_leading_slash_path_and_multiline_quote(repo):
    out = Gate.verify_evidence(repo, {"file_path": "/src/orbit.py", "quote": "class Propagator:\n  \"\"\"Doc string here.\"\"\""})
    assert out["verified"] is True and (out["start_line"], out["end_line"]) == (3, 4)


# ---------------- parsers ----------------

def test_ast_byte_offsets_with_non_ascii():
    names = [s.name for s in TreeSitterAnalyzer.analyze_file("a.py", "# 日本語のコメント\nclass MyCrawler:\n    def run(self): pass\n")]
    assert names == ["MyCrawler", "MyCrawler.run"]


def test_cpp_skips_forward_declarations():
    names = [s.name for s in TreeSitterAnalyzer.analyze_file("a.hpp", "struct Fwd;\nstruct Point { int x; };\n")]
    assert names == ["Point"]


def test_manifest_parsing(tmp_path: Path):
    (tmp_path / "pyproject.toml").write_text(
        '[project]\nname = "mypkg"\nversion = "0.1.0"\nlicense = "MIT"\n'
        'dependencies = ["python-dotenv>=1.0", "uvicorn[standard]>=0.30", "requests ; python_version>\'3.8\'"]\n'
    )
    (tmp_path / "go.mod").write_text("module example.com/m\n\ngo 1.22\ntoolchain go1.22.1\nrequire github.com/spf13/cobra v1.8.0\n")
    (tmp_path / "Cargo.toml").write_text('[dependencies]\nserde = { version = "1.0", features = ["derive"] }\ntokio = "1.37"\n')
    names = {d["package_name"] for d in ManifestAnalyzer().analyze_all(tmp_path)}
    assert names == {"python-dotenv", "uvicorn", "requests", "github.com/spf13/cobra", "serde", "tokio"}


def test_parse_json_object_handles_fences_inside_strings():
    payload = json.dumps({"capabilities": [{"quote": "```bash\npip install foo\n```"}]})
    assert parse_json_object(payload)["capabilities"][0]["quote"].startswith("```bash")
    assert parse_json_object("Sure: {\"a\": 2} thanks") == {"a": 2}
    assert parse_json_object("[1, 2]") is None


def test_map_slug_is_deterministic_and_not_overbroad():
    assert CapabilityEngine.map_slug("Advanced Web Crawling") == "web-crawling"
    assert CapabilityEngine.map_slug("Memory") == "memory"
    assert CapabilityEngine.map_slug("卫星轨道传播").startswith("cap-")


# ---------------- chunking & secrets ----------------

def test_chunker_respects_budget_and_redacts_across_boundaries():
    bundle = SemanticChunker.chunk_text("x" * 400_000, "bundle.js", "code", "js")
    assert max(c.token_count for c in bundle) <= 512
    key = "-----BEGIN PRIVATE KEY-----\n" + "\n".join(["A" * 64] * 40) + "\n-----END PRIVATE KEY-----"
    doc = "\n".join("line %d %s" % (i, "x" * 60) for i in range(30)) + "\n" + key + "\nafter = 1\n"
    chunks = SemanticChunker.chunk_text(doc, "k.pem", "config")
    assert not any("AAAAAAAA" in c.content for c in chunks)
    assert chunks[-1].end_line == doc.count("\n")
    assert SecretSanitizer.sanitize("task-scheduler-configuration-panel") == "task-scheduler-configuration-panel"


def test_select_chunks_spreads_budget_across_files():
    chunks = []
    for name, count in [("a.py", 200), ("b.py", 200), ("z/late.py", 50)]:
        chunks += SemanticChunker.chunk_text("\n".join("y" * 80 + " %d" % i for i in range(count * 30)), name, "code")[:count]
    selected = select_chunks(chunks, 250)
    assert len(selected) == 250
    assert any(c.file_path == "z/late.py" for c in selected)


# ---------------- repository safety ----------------

def test_symlinks_are_not_followed(tmp_path: Path):
    (tmp_path / "README.md").symlink_to("/etc/hosts")
    (tmp_path / "main.py").write_text("print(1)\n")
    included = [f[0] for f in FileFilter().scan_repository(tmp_path)["included_files"]]
    assert included == ["main.py"]


def test_sanitize_path_rejects_sibling_prefix(tmp_path: Path):
    base = tmp_path / "repo"
    base.mkdir()
    (tmp_path / "repoX").mkdir()
    with pytest.raises(ValueError):
        GitCloner.sanitize_path(base, "../repoX/secret")


# ---------------- retries ----------------

def test_transient_error_classification():
    request = httpx.Request("POST", "https://api.example")
    assert is_transient_error(httpx.HTTPStatusError("x", request=request, response=httpx.Response(429, request=request)))
    assert not is_transient_error(httpx.HTTPStatusError("x", request=request, response=httpx.Response(401, request=request)))
    assert is_transient_error(subprocess.TimeoutExpired("git", 120))
    assert is_transient_error(RuntimeError("CLONE_FAILED: fatal: unable to access x: Could not resolve host"))
    assert not is_transient_error(RuntimeError("CLONE_FAILED: remote: Repository not found."))
    assert not is_transient_error(ValueError("REPOSITORY_TOO_LARGE: 900MB"))
    assert not is_transient_error(KeyError("bug"))
