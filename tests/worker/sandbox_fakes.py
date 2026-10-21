"""
A fake sandbox for tests: records what was written and run, and answers commands from a script.
It executes nothing. Lives under tests/ because production code must never stand in for a real sandbox.
"""
import re
from typing import Callable, Dict, List, Optional, Tuple, Union

from apps.worker.sandbox.base import ExecResult, Sandbox, SandboxError, SandboxProvider, check_write, safe_relative_path

Responder = Callable[["FakeSandbox", str], Union[ExecResult, Tuple[int, str]]]


class FakeSandbox(Sandbox):
    provider = "fake"

    def __init__(self, image: str, network: bool, script: List[Tuple[str, Responder]], log: List[Dict]):
        self.image = image
        self.image_digest = f"{image}@sha256:fake"
        self.network_enabled = network
        self.files: Dict[str, str] = {}
        self.commands: List[Tuple[str, bool]] = []  # (command, network enabled when it ran)
        self.destroyed = False
        self._script = script
        self._log = log
        log.append({"event": "create", "sandbox": self})

    def write_files(self, files: Dict[str, str]) -> None:
        self._alive()
        for path, data in check_write(files).items():
            self.files[path] = data.decode("utf-8")

    def exec(self, command: str, timeout: int) -> ExecResult:
        self._alive()
        self.commands.append((command, self.network_enabled))
        for pattern, respond in self._script:
            if re.search(pattern, command):
                result = respond(self, command)
                return result if isinstance(result, ExecResult) else ExecResult(result[0], result[1], "", 5)
        return ExecResult(0, "", "", 1)

    def read_file(self, path: str) -> Optional[str]:
        self._alive()
        return self.files.get(safe_relative_path(path))

    def disable_network(self) -> None:
        self.network_enabled = False

    def destroy(self) -> None:
        self.destroyed = True

    def _alive(self):
        if self.destroyed:
            raise SandboxError("destroyed")


class FakeProvider(SandboxProvider):
    name = "fake"

    def __init__(self, script: Optional[List[Tuple[str, Responder]]] = None):
        self.script = script or []
        self.log: List[Dict] = []

    @property
    def sandboxes(self) -> List[FakeSandbox]:
        return [e["sandbox"] for e in self.log if e["event"] == "create"]

    def create(self, image: str, network: bool = True, lifetime_seconds: int = 1200) -> FakeSandbox:
        return FakeSandbox(image, network, self.script, self.log)
