import logging
import re
import time
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse

from .safety import check_url

logger = logging.getLogger("open_eye.scraper")

DEFAULT_TIMEOUT_MS = 30000
MAX_TIMEOUT_MS = 60000
MAX_WAIT_MS = 10000
MAX_MARKDOWN_CHARS = 400_000
MAX_LINKS = 30
# The fast HTTP attempt gets at most this share of the budget, so the browser tier still has time
FAST_SHARE = 0.35
MIN_BROWSER_MS = 5000

# Elements whose text is never page content: removed (with their contents) before Markdown conversion
_NON_CONTENT_TAGS = ["script", "style", "noscript", "template", "svg", "iframe", "nav", "footer"]

# Final URLs and page text that mean the site wants a signed-in user. Open Eye reports these honestly
# as AUTH_REQUIRED and never indexes the wall as if it were the content (PRODUCT_DEFINITION 7.1).
_AUTH_WALL_PATHS = ("/authwall", "/login", "/signin", "/sign-in", "/uas/login", "/checkpoint", "/i/flow/login", "/m/signin")
_AUTH_WALL_PHRASES = (
    "join linkedin", "sign in to linkedin", "sign in to view", "join now to see", "log in to x", "sign in to x",
    "log in to twitter", "you must be logged in", "please log in to continue",
)


def _host_matches(host: str, domain: str) -> bool:
    return host == domain or host.endswith("." + domain)


def _result(url: str, success: bool, status_code: int, error: Optional[str] = None, **fields) -> Dict[str, Any]:
    return {"success": success, "url": url, "title": fields.pop("title", ""), "markdown": fields.pop("markdown", ""),
            "links": fields.pop("links", []), "status_code": status_code, "error_message": error, **fields}


class StealthScraperEngine:
    """
    Web extraction with Scrapling (0.5 API).

    Tiers:
      1. Fast HTTP (Scrapling Fetcher) for public documentation, blogs, and static sites.
      2. Browser rendering (Scrapling StealthyFetcher, Camoufox) for pages that need JavaScript or that
         refused the plain HTTP client.

    Both tiers share one time budget, every requested and final URL passes the SSRF check, and pages that
    turn out to be login walls are reported as AUTH_REQUIRED, never returned as content.
    """

    PROTECTED_DOMAINS = {"linkedin.com", "twitter.com", "x.com", "bloomberg.com", "wsj.com", "medium.com"}

    @classmethod
    def is_protected_domain(cls, url: str) -> bool:
        try:
            host = (urlparse(url).hostname or "").lower()
        except ValueError:
            return False
        return any(_host_matches(host, d) for d in cls.PROTECTED_DOMAINS)

    @classmethod
    def scrape(cls, url: str, stealth: Optional[bool] = None, timeout: int = DEFAULT_TIMEOUT_MS, wait_for: int = 0) -> Dict[str, Any]:
        blocked = check_url(url)
        if blocked:
            return _result(url, False, 403, f"RESOURCE_ACCESS_BLOCKED: {blocked}")
        try:
            from scrapling.fetchers import Fetcher  # noqa: F401  (needs scrapling[fetchers])
        except ImportError as e:
            logger.error("Scrapling fetchers are not installed: %s", e)
            return _result(url, False, 500, "Scrapling fetchers are not installed in the worker (pip install 'scrapling[fetchers]')")

        timeout = max(1000, min(int(timeout or DEFAULT_TIMEOUT_MS), MAX_TIMEOUT_MS))
        wait_for = max(0, min(int(wait_for or 0), MAX_WAIT_MS))
        deadline = time.monotonic() + timeout / 1000.0

        if stealth or (stealth is None and cls.is_protected_domain(url)):
            return cls._scrape_with_browser(url, deadline, wait_for)

        try:
            from scrapling.fetchers import Fetcher
            fast_s = max(1.0, min(10.0, timeout / 1000.0 * FAST_SHARE))
            res = Fetcher.get(url, timeout=fast_s, follow_redirects=True, max_redirects=5, retries=1)
        except Exception as e:
            logger.warning("Fast HTTP scrape failed for %s: %s; trying browser rendering", url, e)
            return cls._scrape_with_browser(url, deadline, wait_for)

        if cls._needs_browser(res):
            logger.info("HTTP %s or a challenge page from %s; trying browser rendering", res.status, url)
            return cls._scrape_with_browser(url, deadline, wait_for, fallback=res)
        return cls._parse_scrapling_response(url, res)

    @staticmethod
    def _needs_browser(res: Any) -> bool:
        html = (getattr(res, "html_content", "") or "")[:20000]
        return (
            getattr(res, "status", 200) in (403, 429, 999)
            or "cf-browser-verification" in html
            or "challenge-platform" in html
            or "Attention Required! | Cloudflare" in html
            or "<title>Just a moment...</title>" in html
        )

    @classmethod
    def _scrape_with_browser(cls, url: str, deadline: float, wait_for: int, fallback: Any = None) -> Dict[str, Any]:
        remaining_ms = int((deadline - time.monotonic()) * 1000)
        if remaining_ms < MIN_BROWSER_MS:
            if fallback is not None:
                return cls._parse_scrapling_response(url, fallback)
            return _result(url, False, 504, "Timed out before browser rendering could start")
        try:
            from scrapling.fetchers import StealthyFetcher
            res = StealthyFetcher.fetch(
                url,
                headless=True,
                network_idle=True,
                timeout=remaining_ms,
                wait=wait_for,
                # Images, fonts and media are not content; skipping them is faster and fetches less
                disable_resources=True,
            )
        except Exception as e:
            logger.error("Browser rendering failed for %s: %s", url, e)
            return _result(url, False, 500, f"Browser rendering failed: {e}")
        return cls._parse_scrapling_response(url, res)

    @staticmethod
    def detect_auth_wall(final_url: str, text: str) -> bool:
        path = (urlparse(final_url or "").path or "").lower()
        if any(path.startswith(p) for p in _AUTH_WALL_PATHS):
            return True
        head = (text or "")[:3000].lower()
        return any(phrase in head for phrase in _AUTH_WALL_PHRASES)

    @classmethod
    def _parse_scrapling_response(cls, url: str, res: Any) -> Dict[str, Any]:
        status_code = int(getattr(res, "status", 200) or 200)
        final_url = str(getattr(res, "url", "") or url)

        # Redirects are followed by the fetchers: the place we ended up must be public too
        if final_url != url:
            blocked = check_url(final_url)
            if blocked:
                return _result(url, False, 403, f"RESOURCE_ACCESS_BLOCKED: redirected to a blocked address ({blocked})")

        if status_code >= 400:
            return _result(url, False, status_code, f"HTTP {status_code} from target website")

        def first(selector: str) -> str:
            try:
                value = res.css(selector).get()
                return str(value).strip() if value else ""
            except Exception:
                return ""

        title = first("meta[property='og:title']::attr(content)") or first("title::text") or first("h1::text")
        description = first("meta[name='description']::attr(content)") or first("meta[property='og:description']::attr(content)")
        author = first("meta[name='author']::attr(content)") or first("[rel='author']::text")

        links: List[str] = []
        try:
            for href in res.css("a::attr(href)").getall():
                absolute = res.urljoin(str(href).strip()) if hasattr(res, "urljoin") else str(href).strip()
                if absolute.startswith(("http://", "https://")) and absolute not in links:
                    links.append(absolute)
                if len(links) >= MAX_LINKS:
                    break
        except Exception:
            pass

        html_content = getattr(res, "html_content", "") or ""
        markdown = cls._to_markdown(html_content) if html_content else ""
        if not markdown:
            try:
                markdown = res.get_all_text(separator="\n") or ""
            except Exception:
                markdown = ""
        markdown = re.sub(r"\n{3,}", "\n\n", markdown).strip()[:MAX_MARKDOWN_CHARS]

        if cls.detect_auth_wall(final_url, f"{title}\n{markdown}"):
            return _result(url, False, 401, "AUTH_REQUIRED: the site requires signing in to view this content; Open Eye does not bypass authentication",
                           title=title)

        return _result(url, True, status_code, None, title=title or url, description=description,
                       author=author or None, markdown=markdown, links=links, final_url=final_url)

    @staticmethod
    def _to_markdown(html: str) -> str:
        """HTML to Markdown with non-content elements removed entirely. markdownify's strip= removes only the
        tags and keeps their text, which puts JavaScript and CSS source into the extracted content."""
        try:
            from bs4 import BeautifulSoup
            from markdownify import markdownify as md
        except ImportError:
            return ""
        try:
            soup = BeautifulSoup(html, "html.parser")
            for tag in soup(_NON_CONTENT_TAGS):
                tag.decompose()
            return md(str(soup), heading_style="ATX")
        except Exception as e:
            logger.warning("Markdown conversion failed: %s", e)
            return ""
