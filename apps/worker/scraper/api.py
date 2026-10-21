import json
import logging
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import Optional
from .engine import StealthScraperEngine

logger = logging.getLogger("open_eye.scraper.api")


class ScraperHTTPRequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code: int, data: dict):
        response_bytes = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(response_bytes)

    def do_OPTIONS(self):
        self._send_json(200, {"status": "ok"})

    def do_GET(self):
        if self.path in ("/health", "/", "/api/health"):
            self._send_json(200, {
                "status": "healthy",
                "service": "open-eye-scrapling-camoufox",
                "engine": "Scrapling + Camoufox (Firefox Anti-Detect)"
            })
        else:
            self._send_json(404, {"error": "Not found"})

    def do_POST(self):
        if self.path in ("/scrape", "/api/scrape"):
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                payload = json.loads(body) if body else {}

                url = payload.get("url")
                if not url:
                    self._send_json(400, {"error": "Missing 'url' in request body"})
                    return

                stealth = payload.get("stealth", None)
                timeout = payload.get("timeout", 30000)
                wait_for = payload.get("waitFor", 0)

                result = StealthScraperEngine.scrape(
                    url=url,
                    stealth=stealth,
                    timeout=timeout,
                    wait_for=wait_for
                )
                self._send_json(200, result)
            except Exception as e:
                logger.error("Scrape error: %s", e)
                self._send_json(500, {
                    "success": False,
                    "url": payload.get("url", ""),
                    "title": "",
                    "markdown": "",
                    "links": [],
                    "status_code": 500,
                    "error_message": str(e)
                })
        elif self.path in ("/crawl", "/api/crawl"):
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                payload = json.loads(body) if body else {}

                url = payload.get("url")
                limit = int(payload.get("limit", 3))

                if not url:
                    self._send_json(400, {"error": "Missing 'url' in request body"})
                    return

                root_result = StealthScraperEngine.scrape(url=url)
                results = [root_result]

                if root_result.get("success"):
                    discovered_links = root_result.get("links", [])[:limit - 1]
                    for sub_url in discovered_links:
                        sub_res = StealthScraperEngine.scrape(url=sub_url)
                        if sub_res.get("success") and len(sub_res.get("markdown", "")) > 50:
                            results.append(sub_res)

                self._send_json(200, {"pages": results})
            except Exception as e:
                self._send_json(500, {"error": str(e)})
        else:
            self._send_json(404, {"error": "Not found"})

    def log_message(self, format, *args):
        # Prevent noisy standard stderr logging
        logger.debug("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), format % args))


def run_scraper_server(port: int = 8001, host: str = "0.0.0.0"):
    """Runs the Scrapling & Camoufox scraper HTTP microservice daemon."""
    server = HTTPServer((host, port), ScraperHTTPRequestHandler)
    logger.info("Scrapling & Camoufox scraper service listening on http://%s:%s", host, port)
    server.serve_forever()


if __name__ == "__main__":
    import os
    port = int(os.environ.get("SCRAPER_PORT", 8001))
    run_scraper_server(port=port)
