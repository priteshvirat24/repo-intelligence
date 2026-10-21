"""
HTTP service in front of the scraper engine, called by the web app (apps/web/lib/providers/scrapling.ts).

It is a server-to-server endpoint, not a public API:
- binds to 127.0.0.1 unless SCRAPER_HOST says otherwise, and refuses to listen on any other address
  without SCRAPER_SECRET, which callers must send as X-Scraper-Secret;
- no CORS headers: browsers must not be able to call it;
- bounded request bodies, timeouts, crawl sizes and concurrent browser sessions;
- /crawl stays on the starting site and respects robots.txt.
"""
import hmac
import json
import logging
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional
from urllib import robotparser
from urllib.parse import urljoin, urlparse

from .engine import StealthScraperEngine
from .safety import check_url

logger = logging.getLogger("open_eye.scraper.api")

MAX_BODY_BYTES = 64 * 1024
MAX_CRAWL_PAGES = 10
USER_AGENT = "OpenEyeBot"
_slots = threading.BoundedSemaphore(max(1, int(os.environ.get("SCRAPER_MAX_CONCURRENCY", "2"))))


def _same_site(a: str, b: str) -> bool:
    def site(u: str) -> str:
        host = (urlparse(u).hostname or "").lower()
        return host[4:] if host.startswith("www.") else host
    return site(a) == site(b)


def _robots_allows(url: str, cache: Dict[str, Optional[robotparser.RobotFileParser]]) -> bool:
    root = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
    if root not in cache:
        parser = robotparser.RobotFileParser(urljoin(root, "/robots.txt"))
        try:
            if check_url(parser.url) is None:
                parser.read()
                cache[root] = parser
            else:
                cache[root] = None
        except Exception:
            cache[root] = None  # unreadable robots.txt: treated as no rules
    parser = cache[root]
    return True if parser is None else parser.can_fetch(USER_AGENT, url)


class ScraperHTTPRequestHandler(BaseHTTPRequestHandler):
    secret: Optional[str] = None

    def _send_json(self, status_code: int, data: dict):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorised(self) -> bool:
        if not self.secret:
            return True  # loopback-only mode (enforced at startup)
        given = self.headers.get("X-Scraper-Secret") or ""
        return hmac.compare_digest(given.encode(), self.secret.encode())

    def _read_json(self) -> Optional[Dict[str, Any]]:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = -1
        if length < 0 or length > MAX_BODY_BYTES:
            self._send_json(413, {"error": "Request body too large"})
            return None
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except (ValueError, UnicodeDecodeError):
            self._send_json(400, {"error": "Request body must be JSON"})
            return None
        if not isinstance(payload, dict) or not isinstance(payload.get("url"), str) or not payload["url"].strip():
            self._send_json(400, {"error": "Missing 'url' in request body"})
            return None
        return payload

    def _scrape(self, url: str, **kwargs) -> Dict[str, Any]:
        # Browser sessions are heavy: wait briefly for a slot, then tell the caller to retry
        if not _slots.acquire(timeout=30):
            return {"success": False, "url": url, "title": "", "markdown": "", "links": [], "status_code": 503,
                    "error_message": "Scraper busy; retry shortly"}
        try:
            return StealthScraperEngine.scrape(url=url, **kwargs)
        finally:
            _slots.release()

    def do_GET(self):
        if self.path in ("/health", "/", "/api/health"):
            self._send_json(200, {"status": "healthy", "service": "open-eye-scraper", "engine": "Scrapling + Camoufox"})
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path not in ("/scrape", "/api/scrape", "/crawl", "/api/crawl"):
            self._send_json(404, {"error": "Not found"})
            return
        if not self._authorised():
            self._send_json(401, {"error": "Missing or wrong X-Scraper-Secret"})
            return
        payload = self._read_json()
        if payload is None:
            return
        url = payload["url"].strip()
        try:
            if self.path.endswith("/scrape"):
                stealth = payload.get("stealth")
                self._send_json(200, self._scrape(
                    url,
                    stealth=stealth if isinstance(stealth, bool) else None,
                    timeout=int(payload.get("timeout") or 30000),
                    wait_for=int(payload.get("waitFor") or 0),
                ))
            else:
                limit = max(1, min(int(payload.get("limit") or 3), MAX_CRAWL_PAGES))
                root = self._scrape(url)
                pages = [root]
                robots: Dict[str, Optional[robotparser.RobotFileParser]] = {}
                visited = {url.split("#")[0]}
                if root.get("success"):
                    for link in root.get("links", []):
                        if len(pages) >= limit:
                            break
                        link = link.split("#")[0]
                        if not link or link in visited or not _same_site(link, url) or not _robots_allows(link, robots):
                            continue
                        visited.add(link)
                        page = self._scrape(link)
                        if page.get("success") and len(page.get("markdown", "")) > 50:
                            pages.append(page)
                self._send_json(200, {"pages": pages})
        except (TypeError, ValueError) as e:
            self._send_json(400, {"error": f"Invalid request: {e}"})
        except Exception as e:
            logger.error("Scrape error for %s: %s", url, e)
            self._send_json(500, {"success": False, "url": url, "title": "", "markdown": "", "links": [],
                                  "status_code": 500, "error_message": str(e)})

    def log_message(self, format, *args):
        logger.debug("%s - - [%s] %s" % (self.address_string(), self.log_date_time_string(), format % args))


def make_server(port: int, host: str, secret: Optional[str]) -> ThreadingHTTPServer:
    if host not in ("127.0.0.1", "localhost", "::1") and not secret:
        raise RuntimeError(f"Refusing to serve the scraper on {host} without SCRAPER_SECRET")
    handler = type("Handler", (ScraperHTTPRequestHandler,), {"secret": secret or None})
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    return server


def run_scraper_server(port: int = 8001, host: Optional[str] = None):
    """Runs the scraper HTTP service (blocking)."""
    host = host or os.environ.get("SCRAPER_HOST", "127.0.0.1")
    server = make_server(port, host, os.environ.get("SCRAPER_SECRET"))
    logger.info("Scraper service listening on http://%s:%s", host, port)
    server.serve_forever()


if __name__ == "__main__":
    run_scraper_server(port=int(os.environ.get("SCRAPER_PORT", 8001)))
