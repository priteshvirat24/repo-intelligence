"""
Outbound URL checks for the scraper (the worker-side counterpart of apps/web/lib/security/ssrf.ts).

The scraper fetches URLs on request from the web app, so without these checks it would fetch internal
addresses (the database host, cloud metadata endpoints, localhost services) and return their content.
"""
import ipaddress
import socket
from typing import Optional
from urllib.parse import urlparse

_BLOCKED_HOST_SUFFIXES = (".internal", ".local", ".localhost", ".lan", ".home.arpa")


def _ip_blocked(ip: ipaddress._BaseAddress) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return (
        ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast
        or ip.is_reserved or ip.is_unspecified or not ip.is_global
    )


def check_url(url: str, resolve: bool = True) -> Optional[str]:
    """None if the URL may be fetched, otherwise the reason it may not."""
    try:
        parsed = urlparse(url)
    except ValueError:
        return "Malformed URL"
    if parsed.scheme not in ("http", "https"):
        return f"Only http and https URLs are allowed (got {parsed.scheme or 'none'})"
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host:
        return "URL has no host"
    if host == "localhost" or host.endswith(_BLOCKED_HOST_SUFFIXES):
        return f"Host {host} is internal"
    if parsed.username or parsed.password:
        return "URLs with credentials are not allowed"
    try:
        literal = ipaddress.ip_address(host.strip("[]"))
        return f"Address {literal} is not public" if _ip_blocked(literal) else None
    except ValueError:
        pass
    if not resolve:
        return None
    try:
        infos = socket.getaddrinfo(host, parsed.port or (443 if parsed.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return f"Host {host} does not resolve"
    for info in infos:
        ip = ipaddress.ip_address(info[4][0].split("%")[0])
        if _ip_blocked(ip):
            return f"Host {host} resolves to non-public address {ip}"
    return None
