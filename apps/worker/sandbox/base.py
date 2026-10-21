"""
The sandbox contract (SYSTEM_DESIGN 11, PRODUCT_DEFINITION 7.1 and 11): third-party code and generated code
run only inside a sandbox, never on an application host.

A sandbox is created for one job, given files, asked to run commands with a hard timeout, read back, and
destroyed. Every implementation guarantees:
  - no secrets and no host environment inside it (only the fixed, non-secret variables in SAFE_ENV);
  - CPU, memory, process and wall-clock limits;
  - a private working directory (WORKDIR) and nothing of the host's file system;
  - network only while it is needed (dependency installation), off for running tests where the provider can;
  - destruction after use, even when the caller fails (use it as a context manager).
"""
import re
from dataclasses import dataclass, field
from typing import Dict, Optional

WORKDIR = "/work"
MAX_OUTPUT_BYTES = 64 * 1024        # per stream, per command, kept as head + tail
MAX_FILE_BYTES = 512 * 1024         # one file written into or read from a sandbox
MAX_WRITE_BYTES = 4 * 1024 * 1024   # all files of one write_files call
# The only variables a sandbox sees. Never add anything secret here.
SAFE_ENV = {
    "HOME": WORKDIR,
    "PIP_DISABLE_PIP_VERSION_CHECK": "1",
    "PIP_NO_INPUT": "1",
    "PYTHONDONTWRITEBYTECODE": "1",
    "npm_config_update_notifier": "false",
    "npm_config_fund": "false",
    "CI": "1",
}
_PATH_RE = re.compile(r"^[A-Za-z0-9_.][A-Za-z0-9_.\-/]*$")


class SandboxError(RuntimeError):
    """The sandbox could not do what was asked (start, write, run, read)."""


class SandboxNotConfigured(SandboxError):
    """No usable sandbox provider: execution is unavailable, and nothing runs anywhere else instead."""


class NetworkControlUnsupported(SandboxError):
    """The provider cannot switch the network off after creation; callers record that tests ran with network."""


@dataclass
class ExecResult:
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    timed_out: bool = False
    truncated: bool = False

    @property
    def ok(self) -> bool:
        return self.exit_code == 0 and not self.timed_out

    def output_tail(self, limit: int = 4000) -> str:
        """stdout and stderr together, the end kept (where test failures are reported)."""
        text = (self.stdout or "") + ("\n" if self.stdout and self.stderr else "") + (self.stderr or "")
        return text if len(text) <= limit else "…" + text[-limit:]


def safe_relative_path(path: str) -> str:
    """A path inside the working directory: relative, no parent references, no odd characters."""
    if not isinstance(path, str):
        raise SandboxError("File path must be a string")
    p = path.strip()
    if p.startswith("./"):
        p = p[2:]
    if not p or len(p) > 200 or p.startswith("/") or not _PATH_RE.match(p):
        raise SandboxError(f"Unsafe sandbox path: {path!r}")
    parts = p.split("/")
    if any(part in ("", ".", "..") for part in parts):
        raise SandboxError(f"Unsafe sandbox path: {path!r}")
    return p


class Sandbox:
    """One isolated environment. Subclasses implement the five operations; destroy() must be idempotent."""

    provider: str = "abstract"
    image: str = ""
    image_digest: Optional[str] = None
    network_enabled: bool = False

    def write_files(self, files: Dict[str, str]) -> None:
        raise NotImplementedError

    def exec(self, command: str, timeout: int) -> ExecResult:
        """Runs `command` with sh in WORKDIR; killed after `timeout` seconds."""
        raise NotImplementedError

    def read_file(self, path: str) -> Optional[str]:
        """The file's text, or None when it does not exist."""
        raise NotImplementedError

    def disable_network(self) -> None:
        raise NotImplementedError

    def destroy(self) -> None:
        raise NotImplementedError

    def describe(self) -> Dict[str, object]:
        """For evidence and reports: where the code ran."""
        return {"provider": self.provider, "image": self.image, "imageDigest": self.image_digest}

    def __enter__(self) -> "Sandbox":
        return self

    def __exit__(self, *exc) -> None:
        self.destroy()


class SandboxProvider:
    name: str = "abstract"

    def create(self, image: str, network: bool = True, lifetime_seconds: int = 1200) -> Sandbox:
        raise NotImplementedError


def check_write(files: Dict[str, str]) -> Dict[str, bytes]:
    """Validates and encodes files for writing; raises SandboxError for unsafe paths or sizes."""
    out: Dict[str, bytes] = {}
    total = 0
    for path, content in files.items():
        data = content.encode("utf-8") if isinstance(content, str) else bytes(content)
        if len(data) > MAX_FILE_BYTES:
            raise SandboxError(f"File too large for the sandbox: {path}")
        total += len(data)
        out[safe_relative_path(path)] = data
    if total > MAX_WRITE_BYTES:
        raise SandboxError("Files too large for the sandbox")
    return out


@dataclass
class _Capped:
    """Keeps the first and last `limit // 2` bytes of a stream."""
    limit: int = MAX_OUTPUT_BYTES
    head: bytearray = field(default_factory=bytearray)
    tail: bytearray = field(default_factory=bytearray)
    dropped: int = 0

    def add(self, chunk: bytes):
        half = self.limit // 2
        room = half - len(self.head)
        if room > 0:
            self.head += chunk[:room]
            chunk = chunk[room:]
        if chunk:
            self.tail += chunk
            if len(self.tail) > half:
                self.dropped += len(self.tail) - half
                del self.tail[: len(self.tail) - half]

    def text(self) -> str:
        middle = f"\n… [{self.dropped} bytes omitted] …\n" if self.dropped else ""
        return (bytes(self.head).decode("utf-8", "replace") + middle + bytes(self.tail).decode("utf-8", "replace"))
