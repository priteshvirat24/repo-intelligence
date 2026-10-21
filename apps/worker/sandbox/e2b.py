"""
E2B adapter (SANDBOX_PROVIDER=e2b): managed microVM sandboxes for hosts that cannot run containers
themselves (Railway; SYSTEM_DESIGN 12, sandbox row).

It needs E2B_API_KEY and the `e2b` Python SDK. Without either it raises SandboxNotConfigured: there is no
fallback that runs code anywhere else. Written against the SDK's documented interface (Sandbox, files.write,
files.read, commands.run, kill); it has not been run against the live service from this repository yet.

E2B decides internet access when a sandbox is created, so disable_network() raises
NetworkControlUnsupported and callers record that tests ran with network access.
"""
import json
import os
import time
from typing import Dict, Optional

from ..config import config
from .base import (SAFE_ENV, ExecResult, NetworkControlUnsupported, Sandbox, SandboxError, SandboxNotConfigured,
                   SandboxProvider, check_write, safe_relative_path)

E2B_WORKDIR = "/home/user/work"


def _template_for(image: str) -> str:
    """E2B uses templates, not images: E2B_TEMPLATES maps images to templates, else the default template."""
    try:
        mapping = json.loads(os.getenv("E2B_TEMPLATES") or "{}")
    except json.JSONDecodeError:
        mapping = {}
    return mapping.get(image) or os.getenv("E2B_DEFAULT_TEMPLATE", "base")


class E2BSandbox(Sandbox):
    provider = "e2b"

    def __init__(self, sdk, handle, image: str, template: str, network: bool):
        self._sdk = sdk
        self._sbx = handle
        self.image = image
        self.image_digest = f"e2b-template:{template}"
        self.network_enabled = network
        self._destroyed = False

    def write_files(self, files: Dict[str, str]) -> None:
        for path, data in check_write(files).items():
            try:
                self._sbx.files.write(f"{E2B_WORKDIR}/{path}", data)
            except Exception as e:
                raise SandboxError(f"Could not write {path} into the sandbox: {e}")

    def exec(self, command: str, timeout: int) -> ExecResult:
        started = time.time()
        exit_exc = getattr(self._sdk, "CommandExitException", None)
        timeout_exc = getattr(self._sdk, "TimeoutException", None)
        try:
            result = self._sbx.commands.run(command, cwd=E2B_WORKDIR, envs=dict(SAFE_ENV, HOME=E2B_WORKDIR), timeout=timeout)
            code, out, err, timed_out = result.exit_code, result.stdout, result.stderr, False
        except Exception as e:
            if exit_exc and isinstance(e, exit_exc):
                code, out, err, timed_out = e.exit_code, e.stdout, e.stderr, False
            elif timeout_exc and isinstance(e, timeout_exc):
                code, out, err, timed_out = 137, "", f"[sandbox] command killed after {timeout}s", True
            else:
                raise SandboxError(f"E2B command failed: {e}")
        return ExecResult(int(code), (out or "")[-64 * 1024:], (err or "")[-64 * 1024:], int((time.time() - started) * 1000), timed_out,
                          len(out or "") > 64 * 1024 or len(err or "") > 64 * 1024)

    def read_file(self, path: str) -> Optional[str]:
        p = safe_relative_path(path)
        try:
            return self._sbx.files.read(f"{E2B_WORKDIR}/{p}")
        except Exception:
            return None

    def disable_network(self) -> None:
        raise NetworkControlUnsupported("E2B sets internet access when the sandbox is created")

    def destroy(self) -> None:
        if self._destroyed:
            return
        self._destroyed = True
        try:
            self._sbx.kill()
        except Exception as e:
            print(f"[Sandbox] Could not kill E2B sandbox (it expires at its timeout): {e}")


class E2BProvider(SandboxProvider):
    name = "e2b"

    def __init__(self, api_key: Optional[str] = None):
        self.api_key = (api_key if api_key is not None else config.E2B_API_KEY).strip()
        if not self.api_key:
            raise SandboxNotConfigured("SANDBOX_PROVIDER=e2b but E2B_API_KEY is not set; sandboxed execution is unavailable")
        try:
            import e2b  # type: ignore
        except ImportError:
            raise SandboxNotConfigured("SANDBOX_PROVIDER=e2b but the e2b SDK is not installed (pip install e2b)")
        self.sdk = e2b

    def create(self, image: str, network: bool = True, lifetime_seconds: int = 1200) -> E2BSandbox:
        template = _template_for(image)
        factory = getattr(self.sdk.Sandbox, "create", None) or self.sdk.Sandbox
        try:
            handle = factory(template=template, api_key=self.api_key, timeout=int(lifetime_seconds), envs={},
                             allow_internet_access=network)
        except TypeError:
            # Older SDKs have no allow_internet_access: the sandbox then has network throughout
            handle = factory(template=template, api_key=self.api_key, timeout=int(lifetime_seconds), envs={})
            network = True
        except Exception as e:
            raise SandboxError(f"Could not start an E2B sandbox: {e}")
        sandbox = E2BSandbox(self.sdk, handle, image, template, network)
        try:
            sandbox.exec(f"mkdir -p {E2B_WORKDIR}", 30)
        except Exception:
            sandbox.destroy()
            raise
        return sandbox
