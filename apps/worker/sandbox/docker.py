"""
LocalDockerSandbox: the sandbox for local development, driven through the docker CLI.

Isolation of each container:
  - runs as uid 1000 with every capability dropped and no-new-privileges, on a read-only root file system;
  - the working directory and /tmp are in-memory tmpfs mounts: no host directory is mounted at all;
  - memory (swap included), CPU and process-count limits;
  - only SAFE_ENV inside; the docker CLI itself is started with a scrubbed environment, so no host
    variable can reach the container by any route;
  - bridge network only while dependencies install, then disconnected (`--network none` from the start
    when the caller needs no network);
  - every command is killed at its timeout, and the container's own process is `sleep <lifetime>`, so a
    container whose worker died stops by itself; `--rm` removes it when it stops, and destroy() removes it
    at once.

Application hosts without docker (Railway) use the E2B adapter instead.
"""
import os
import shlex
import shutil
import subprocess
import threading
import time
import uuid
from typing import Dict, List, Optional

from ..config import config
from .base import (MAX_FILE_BYTES, SAFE_ENV, WORKDIR, ExecResult, Sandbox, SandboxError, SandboxNotConfigured,
                   SandboxProvider, _Capped, check_write, safe_relative_path)

LABEL = "openeye.sandbox=1"
# Variables the docker CLI needs to find its daemon; nothing else of the worker's environment is passed on
_CLI_ENV_KEYS = ("PATH", "HOME", "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY", "TMPDIR")
_KILL_GRACE_SECONDS = 15


def _cli_env() -> Dict[str, str]:
    return {k: os.environ[k] for k in _CLI_ENV_KEYS if k in os.environ}


def _run(args: List[str], timeout: float, stdin: Optional[bytes] = None, cap: int = 64 * 1024):
    """Runs a docker CLI command; output is capped while it streams, so a noisy command cannot exhaust
    the worker's memory. Returns (exit_code, stdout, stderr, timed_out, truncated)."""
    proc = subprocess.Popen(args, stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=_cli_env())
    out, err = _Capped(cap), _Capped(cap)

    def pump(stream, sink):
        for chunk in iter(lambda: stream.read(8192), b""):
            sink.add(chunk)
        stream.close()

    readers = [threading.Thread(target=pump, args=(proc.stdout, out), daemon=True),
               threading.Thread(target=pump, args=(proc.stderr, err), daemon=True)]
    for r in readers:
        r.start()
    if stdin is not None:
        try:
            proc.stdin.write(stdin)
        except BrokenPipeError:
            pass
        finally:
            proc.stdin.close()
    timed_out = False
    try:
        proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        proc.kill()
        proc.wait()
    for r in readers:
        r.join(timeout=5)
    return proc.returncode, out.text(), err.text(), timed_out, bool(out.dropped or err.dropped)


class LocalDockerSandbox(Sandbox):
    provider = "docker"

    def __init__(self, docker: str, name: str, image: str, network: bool):
        self.docker = docker
        self.name = name
        self.image = image
        self.network_enabled = network
        self.image_digest = None
        self._destroyed = False
        self._has_timeout = True

    def _exec_args(self, interactive: bool = False) -> List[str]:
        return [self.docker, "exec"] + (["-i"] if interactive else []) + ["-w", WORKDIR, self.name]

    def write_files(self, files: Dict[str, str]) -> None:
        for path, data in check_write(files).items():
            # The path is an argument to sh, never part of the script
            args = self._exec_args(interactive=True) + ["sh", "-c", 'mkdir -p "$(dirname "$1")" && cat > "$1"', "sh", path]
            code, _, err, timed_out, _ = _run(args, timeout=60, stdin=data)
            if code != 0 or timed_out:
                raise SandboxError(f"Could not write {path} into the sandbox: {err.strip()[:300]}")

    def exec(self, command: str, timeout: int) -> ExecResult:
        if self._destroyed:
            raise SandboxError("The sandbox was destroyed")
        timeout = max(1, int(timeout))
        inner = ["timeout", "-s", "KILL", str(timeout)] if self._has_timeout else []
        args = self._exec_args() + inner + ["sh", "-c", command]
        started = time.time()
        code, out, err, host_timed_out, truncated = _run(args, timeout=timeout + _KILL_GRACE_SECONDS)
        duration = int((time.time() - started) * 1000)
        if host_timed_out:
            # The command outlived its own kill: the container is no longer trustworthy, so it goes
            self.destroy()
            return ExecResult(137, out, err + "\n[sandbox] command exceeded its timeout; sandbox destroyed", duration, True, truncated)
        timed_out = code in (124, 137) and duration >= timeout * 1000 - 250
        if timed_out:
            err += f"\n[sandbox] command killed after {timeout}s"
        return ExecResult(code, out, err, duration, timed_out, truncated)

    def read_file(self, path: str) -> Optional[str]:
        p = safe_relative_path(path)
        code, out, err, _, truncated = _run(self._exec_args() + ["sh", "-c", 'test -f "$1" && cat -- "$1"', "sh", p],
                                            timeout=60, cap=2 * MAX_FILE_BYTES)
        if code != 0:
            return None
        if truncated:
            raise SandboxError(f"{path} is too large to read back")
        return out

    def disable_network(self) -> None:
        if not self.network_enabled:
            return
        code, _, err, _, _ = _run([self.docker, "network", "disconnect", "--force", "bridge", self.name], timeout=60)
        if code != 0:
            raise SandboxError(f"Could not disconnect the sandbox from the network: {err.strip()[:300]}")
        code, out, _, _, _ = _run([self.docker, "inspect", "-f", "{{len .NetworkSettings.Networks}}", self.name], timeout=30)
        if code != 0 or out.strip() != "0":
            self.destroy()
            raise SandboxError("The sandbox still had a network after disconnecting; destroyed it")
        self.network_enabled = False

    def destroy(self) -> None:
        if self._destroyed:
            return
        self._destroyed = True
        code, _, err, _, _ = _run([self.docker, "rm", "-f", self.name], timeout=60)
        if code != 0 and "No such container" not in err:
            # --rm and the lifetime limit still remove it; say so rather than fail the caller
            print(f"[Sandbox] Could not remove container {self.name}: {err.strip()[:200]}")


class LocalDockerProvider(SandboxProvider):
    name = "docker"

    def __init__(self, docker: Optional[str] = None, memory: Optional[str] = None, cpus: Optional[str] = None,
                 pids: Optional[int] = None):
        self.docker = docker or shutil.which("docker") or ""
        self.memory = memory or config.SANDBOX_MEMORY
        self.cpus = cpus or config.SANDBOX_CPUS
        self.pids = pids or config.SANDBOX_PIDS
        if not self.docker:
            raise SandboxNotConfigured("SANDBOX_PROVIDER=docker but the docker CLI is not installed on this host")

    def available(self) -> bool:
        code, _, _, timed_out, _ = _run([self.docker, "info", "--format", "{{.ServerVersion}}"], timeout=20)
        return code == 0 and not timed_out

    def run_args(self, name: str, image: str, network: bool, lifetime_seconds: int) -> List[str]:
        env: List[str] = []
        for k, v in SAFE_ENV.items():
            env += ["--env", f"{k}={v}"]
        return [
            self.docker, "run", "--detach", "--rm", "--name", name, "--label", LABEL,
            "--user", "1000:1000",
            "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
            "--read-only",
            "--tmpfs", f"{WORKDIR}:rw,exec,nosuid,nodev,size=1024m,uid=1000,gid=1000,mode=0755",
            "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=256m,mode=1777",
            "--memory", self.memory, "--memory-swap", self.memory,
            "--cpus", str(self.cpus), "--pids-limit", str(self.pids),
            "--network", "bridge" if network else "none",
            "--workdir", WORKDIR,
            *env,
            "--entrypoint", "sleep",
            image, str(int(lifetime_seconds)),
        ]

    def create(self, image: str, network: bool = True, lifetime_seconds: int = 1200) -> LocalDockerSandbox:
        name = f"openeye-sbx-{uuid.uuid4().hex[:12]}"
        # Pulling the image on first use can take a while
        code, _, err, timed_out, _ = _run(self.run_args(name, image, network, lifetime_seconds), timeout=600)
        sandbox = LocalDockerSandbox(self.docker, name, image, network)
        if code != 0 or timed_out:
            sandbox.destroy()
            raise SandboxError(f"Could not start a sandbox from {image}: {err.strip()[:400] or 'timed out'}")
        try:
            dcode, dout, _, _, _ = _run([self.docker, "image", "inspect", "--format",
                                         "{{if .RepoDigests}}{{index .RepoDigests 0}}{{else}}{{.Id}}{{end}}", image], timeout=30)
            sandbox.image_digest = (dout.strip() or None) if dcode == 0 else None
            tcode, _, _, _, _ = _run([self.docker, "exec", name, "sh", "-c", "command -v timeout"], timeout=30)
            sandbox._has_timeout = tcode == 0
        except Exception:
            sandbox.destroy()
            raise
        return sandbox


def quote(*parts: str) -> str:
    return " ".join(shlex.quote(p) for p in parts)
