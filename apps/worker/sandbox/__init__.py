"""Sandboxed execution (Phase 6). See base.py for the contract every provider meets."""
from typing import Optional

from ..config import config
from .base import (WORKDIR, ExecResult, NetworkControlUnsupported, Sandbox, SandboxError, SandboxNotConfigured,
                   SandboxProvider, safe_relative_path)


def get_sandbox_provider(name: Optional[str] = None) -> SandboxProvider:
    """The configured provider (SANDBOX_PROVIDER: docker by default, or e2b). Raises SandboxNotConfigured
    when it cannot be used; callers then skip execution, they never run code on the host instead."""
    choice = (name or config.SANDBOX_PROVIDER or "").strip().lower()
    if choice == "docker":
        from .docker import LocalDockerProvider
        provider = LocalDockerProvider()
        if not provider.available():
            raise SandboxNotConfigured("SANDBOX_PROVIDER=docker but the docker daemon is not reachable from this host")
        return provider
    if choice == "e2b":
        from .e2b import E2BProvider
        return E2BProvider()
    raise SandboxNotConfigured(f"Sandboxed execution is disabled (SANDBOX_PROVIDER={choice or 'unset'})")


__all__ = ["WORKDIR", "ExecResult", "NetworkControlUnsupported", "Sandbox", "SandboxError", "SandboxNotConfigured",
           "SandboxProvider", "get_sandbox_provider", "safe_relative_path"]
