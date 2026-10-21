"""Sandbox contract (with the fake) and LocalDockerSandbox against a real docker daemon (skipped without one)."""
import os
import shutil
import subprocess

import pytest

from apps.worker import sandbox as sandbox_pkg
from apps.worker.sandbox.base import (SAFE_ENV, ExecResult, SandboxError, SandboxNotConfigured, _Capped, check_write,
                                      safe_relative_path)
from tests.worker.sandbox_fakes import FakeProvider

# Contract (no execution)


@pytest.mark.parametrize("path", ["../etc/passwd", "/etc/passwd", "a/../../b", "a//b", "", "a b", "a;rm", "~/x"])
def test_unsafe_paths_are_refused(path):
    with pytest.raises(SandboxError):
        safe_relative_path(path)


def test_safe_paths_are_normalised():
    assert safe_relative_path("./tests/test_a.py") == "tests/test_a.py"
    assert safe_relative_path(".openeye/report.xml") == ".openeye/report.xml"


def test_write_limits():
    with pytest.raises(SandboxError):
        check_write({"big.txt": "x" * (600 * 1024)})
    assert check_write({"a.py": "print(1)"}) == {"a.py": b"print(1)"}


def test_output_is_capped_head_and_tail():
    cap = _Capped(limit=20)
    for _ in range(10):
        cap.add(b"0123456789")
    text = cap.text()
    assert text.startswith("0123456789") and text.endswith("0123456789") and "omitted" in text


def test_safe_env_carries_no_secrets():
    assert not any(k for k in SAFE_ENV if any(word in k.upper() for word in ("KEY", "TOKEN", "SECRET", "PASSWORD", "DATABASE")))


def test_fake_sandbox_follows_the_contract():
    provider = FakeProvider([(r"^echo", lambda sbx, cmd: (0, "hi"))])
    with provider.create("img", network=True) as sbx:
        sbx.write_files({"a/b.txt": "content"})
        assert sbx.read_file("a/b.txt") == "content"
        assert sbx.read_file("missing") is None
        assert sbx.exec("echo hi", 5).stdout == "hi"
        sbx.disable_network()
        assert sbx.exec("true", 5).ok
    assert sbx.destroyed
    assert sbx.commands == [("echo hi", True), ("true", False)]
    with pytest.raises(SandboxError):
        sbx.exec("echo again", 5)


def test_unknown_provider_is_not_configured():
    with pytest.raises(SandboxNotConfigured):
        sandbox_pkg.get_sandbox_provider("none")


def test_e2b_without_key_is_not_configured(monkeypatch):
    from apps.worker.sandbox.e2b import E2BProvider
    with pytest.raises(SandboxNotConfigured, match="E2B_API_KEY"):
        E2BProvider(api_key="")


def test_exec_result_tail():
    r = ExecResult(1, "a" * 10, "b" * 10, 1)
    assert r.output_tail(5) == "…bbbbb" and not r.ok


# LocalDockerSandbox, for real

def _docker_ready() -> bool:
    docker = shutil.which("docker")
    if not docker or os.getenv("SKIP_DOCKER_TESTS") == "1":
        return False
    try:
        return subprocess.run([docker, "info"], capture_output=True, timeout=20).returncode == 0
    except Exception:
        return False


DOCKER_IMAGE = os.getenv("SANDBOX_TEST_IMAGE", "python:3.12-slim")


@pytest.mark.docker
@pytest.mark.skipif(not _docker_ready(), reason="docker daemon not available")
def test_local_docker_sandbox_isolation(monkeypatch):
    from apps.worker.sandbox.docker import LocalDockerProvider
    secret = "oe-test-secret-5f2c9a"
    monkeypatch.setenv("OPENEYE_TEST_SECRET", secret)
    monkeypatch.setenv("LLM_API_KEY", secret)
    provider = LocalDockerProvider()
    sbx = provider.create(DOCKER_IMAGE, network=True, lifetime_seconds=300)
    name = sbx.name
    try:
        assert sbx.image_digest
        # No host environment or secret inside
        env = sbx.exec("env", 30)
        assert env.ok, env.stderr
        assert secret not in env.stdout and "LLM_API_KEY" not in env.stdout and "DATABASE_URL" not in env.stdout
        assert "HOME=/work" in env.stdout
        # Unprivileged, read-only root, private working directory
        assert sbx.exec("id -u", 30).stdout.strip() == "1000"
        assert not sbx.exec("touch /etc/openeye", 30).ok
        assert sbx.exec("mount | grep ' /work ' | grep -c tmpfs", 30).stdout.strip() == "1"
        # Files in and out, exit codes and output
        sbx.write_files({"pkg/hello.py": "import sys\nprint('hello from the sandbox')\nsys.exit(3)\n"})
        run = sbx.exec("python pkg/hello.py", 30)
        assert run.exit_code == 3 and "hello from the sandbox" in run.stdout
        sbx.exec("mkdir -p out && echo result > out/r.txt", 30)
        assert sbx.read_file("out/r.txt").strip() == "result"
        assert sbx.read_file("out/missing.txt") is None
        # Hard timeout
        slow = sbx.exec("sleep 20", 2)
        assert slow.timed_out and slow.duration_ms < 15000
        # Network off: no external interface and no route are left
        assert "eth0" in sbx.exec("ls /sys/class/net", 30).stdout.split()
        sbx.disable_network()
        assert "eth0" not in sbx.exec("ls /sys/class/net", 30).stdout.split()
        assert len(sbx.exec("cat /proc/net/route", 30).stdout.strip().splitlines()) == 1  # header only
        blocked = sbx.exec("python -c \"import socket; socket.create_connection(('1.1.1.1', 53), 3)\"", 30)
        assert not blocked.ok
    finally:
        sbx.destroy()
    listed = subprocess.run(["docker", "ps", "-a", "--filter", f"name={name}", "--format", "{{.Names}}"], capture_output=True, text=True, timeout=30)
    assert name not in listed.stdout
