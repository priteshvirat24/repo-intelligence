"""
Live check of a sandbox provider (TECHNOLOGY_DECISIONS TD-13: "revisit when a live E2B spike measures cold start,
egress control and cost per check"). It runs the same isolation checks as the docker sandbox test, against the
real service, and reports what it measured instead of failing on the first difference.

    E2B_API_KEY=... python -m apps.worker.sandbox.check --provider e2b --out eval/sandbox/e2b-check.json
    python -m apps.worker.sandbox.check --provider e2b --install --price-per-hour 0.10

It starts two short-lived sandboxes (one with network, one without) and destroys them; with E2B that spends a
few cents of credit. Nothing from the host is passed in: the test secret below must not appear inside.
"""
import argparse
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional

from .base import NetworkControlUnsupported, SandboxProvider

SECRET_NAME = "OPENEYE_SANDBOX_CHECK_SECRET"
# A marker no error message contains ("unreachable" contains "reachable")
NET_MARKER = "OE_NET_REACHABLE"
NET_PROBE = f"python3 -c \"import socket; socket.create_connection(('1.1.1.1', 53), 5); print('{NET_MARKER}')\""


def _timed(fn: Callable[[], Any]):
    started = time.time()
    value = fn()
    return value, int((time.time() - started) * 1000)


def run_checks(provider: SandboxProvider, image: str = "python:3.12-slim", install: bool = False,
               price_per_hour: Optional[float] = None, clock: Callable[[], float] = time.time) -> Dict[str, Any]:
    """Every check, each recorded as {ok, detail}; a check that raises is recorded as failed, the rest still run."""
    secret = f"oe-check-{int(clock())}"
    os.environ[SECRET_NAME] = secret
    checks: Dict[str, Dict[str, Any]] = {}
    sandbox_seconds = 0.0

    def check(name: str, fn: Callable[[], Dict[str, Any]]):
        try:
            checks[name] = fn()
        except Exception as e:  # report and keep going: one failure must not hide the others
            checks[name] = {"ok": False, "detail": f"{type(e).__name__}: {e}"[:500]}

    started = clock()
    sbx, cold_ms = _timed(lambda: provider.create(image, network=True, lifetime_seconds=300))
    try:
        checks["coldStart"] = {"ok": True, "ms": cold_ms, "imageDigest": getattr(sbx, "image_digest", None)}

        def latency():
            times = [sbx.exec("echo ok", 30).duration_ms for _ in range(3)]
            return {"ok": True, "medianMs": int(statistics.median(times)), "samplesMs": times}
        check("execLatency", latency)

        def no_secrets():
            env = sbx.exec("env", 30)
            leaked = [n for n in (secret, SECRET_NAME, "LLM_API_KEY", "DATABASE_URL", "E2B_API_KEY") if n in env.stdout]
            return {"ok": env.ok and not leaked, "leaked": leaked}
        check("noHostSecrets", no_secrets)

        def files():
            sbx.write_files({"pkg/hello.py": "print('hello from the sandbox')\n"})
            run = sbx.exec("python3 pkg/hello.py && mkdir -p out && echo result > out/r.txt", 60)
            back = sbx.read_file("out/r.txt")
            return {"ok": run.ok and "hello from the sandbox" in run.stdout and (back or "").strip() == "result",
                    "missingFileIsNone": sbx.read_file("out/missing.txt") is None}
        check("filesInAndOut", files)

        def hard_timeout():
            slow = sbx.exec("sleep 20", 2)
            return {"ok": slow.timed_out and slow.duration_ms < 15000, "durationMs": slow.duration_ms, "timedOut": slow.timed_out}
        check("hardTimeout", hard_timeout)

        def network_on():
            probe = sbx.exec(NET_PROBE, 30)
            return {"ok": NET_MARKER in probe.stdout, "detail": probe.output_tail(300) if not probe.ok else "internet reachable"}
        check("networkWhenAllowed", network_on)

        if install:
            def install_package():
                run, ms = _timed(lambda: sbx.exec("python3 -m pip install --quiet --disable-pip-version-check six", 300))
                return {"ok": run.ok, "ms": ms, "detail": run.output_tail(300) if not run.ok else "pip install six"}
            check("packageInstall", install_package)

        def switch_off():
            try:
                sbx.disable_network()
            except NetworkControlUnsupported as e:
                return {"ok": False, "supported": False, "detail": str(e)}
            probe = sbx.exec(NET_PROBE, 30)
            return {"ok": NET_MARKER not in probe.stdout, "supported": True}
        check("networkSwitchedOffAfterInstall", switch_off)
    finally:
        sbx.destroy()
        sandbox_seconds += clock() - started

    # Egress control at creation: a sandbox created without network must not reach the internet
    started = clock()
    def created_offline():
        offline = provider.create(image, network=False, lifetime_seconds=120)
        try:
            probe = offline.exec(NET_PROBE, 30)
            return {"ok": NET_MARKER not in probe.stdout, "networkEnabledFlag": getattr(offline, "network_enabled", None)}
        finally:
            offline.destroy()
    check("noNetworkWhenCreatedWithout", created_offline)
    sandbox_seconds += clock() - started

    report = {
        "provider": getattr(provider, "name", type(provider).__name__),
        "image": image,
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "checks": checks,
        "passed": sorted(n for n, c in checks.items() if c.get("ok")),
        "failed": sorted(n for n, c in checks.items() if not c.get("ok")),
        "sandboxSeconds": round(sandbox_seconds, 1),
        # Price is not hard-coded: it changes and must be read from the provider's pricing page
        "estimatedCostUsd": round(sandbox_seconds / 3600 * price_per_hour, 4) if price_per_hour is not None else None,
    }
    os.environ.pop(SECRET_NAME, None)
    return report


def summary(report: Dict[str, Any]) -> str:
    lines = [f"Sandbox check: {report['provider']} ({report['image']}), {len(report['passed'])} passed, {len(report['failed'])} failed"]
    for name, c in report["checks"].items():
        extra = {k: v for k, v in c.items() if k != "ok"}
        lines.append(f"  {'PASS' if c.get('ok') else 'FAIL'}  {name}  {json.dumps(extra)[:200]}")
    cost = f", about ${report['estimatedCostUsd']}" if report["estimatedCostUsd"] is not None else ""
    lines.append(f"  Sandbox time {report['sandboxSeconds']}s{cost}")
    return "\n".join(lines)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="Live check of a sandbox provider")
    parser.add_argument("--provider", default="e2b", help="e2b or docker (default e2b)")
    parser.add_argument("--image", default="python:3.12-slim", help="image (docker) or the image E2B_TEMPLATES maps to a template")
    parser.add_argument("--install", action="store_true", help="also time a pip install inside the sandbox")
    parser.add_argument("--price-per-hour", type=float, help="the provider's sandbox price per hour in USD, to estimate cost")
    parser.add_argument("--out", help="write the JSON report here")
    args = parser.parse_args(argv)
    from . import get_sandbox_provider
    report = run_checks(get_sandbox_provider(args.provider), args.image, args.install, args.price_per_hour)
    print(summary(report))
    if args.out:
        os.makedirs(os.path.dirname(args.out) or ".", exist_ok=True)
        with open(args.out, "w") as f:
            json.dump(report, f, indent=2)
        print(f"Report written to {args.out}")
    return 0 if not report["failed"] else 1


if __name__ == "__main__":
    sys.exit(main())
