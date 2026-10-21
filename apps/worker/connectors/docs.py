"""
Official documentation pages (SYSTEM_DESIGN 5.2, 5.3): one public page at a time, through the gateway.

- robots.txt of the site is honoured (fetched once per site and cached);
- every requested URL and every redirect target passes the SSRF check;
- with WORKER_SCRAPER_URL set, pages are rendered by the scraper service (Scrapling; it repeats the SSRF
  check and reports login walls as AUTH_REQUIRED); otherwise they are fetched with plain HTTP;
- the page becomes plain text with its headings kept, so a quote can be located by URL and section.
"""
import os
import re
import sys
from typing import Dict, List, Optional
from urllib import robotparser
from urllib.parse import urlparse

from ..scraper.safety import check_url
from .base import Connector, Document, SourceBlocked, SourceUnavailable, content_hash
from .gateway import flag_instructions

ROBOTS_AGENT = "OpenEyeBot"
MAX_TEXT_CHARS = 200_000
_TEXT_TYPES = ("text/html", "application/xhtml+xml", "text/plain", "text/markdown")
_DROP_TAGS = ["script", "style", "noscript", "template", "svg", "iframe", "nav", "footer", "header", "aside", "form", "button"]
_BLOCK_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "dt", "dd", "td", "th", "pre", "blockquote"]
# Heading anchors and some site generators insert zero-width characters that would break quote matching
_ZERO_WIDTH = re.compile("[​‌‍⁠﻿]")


def html_to_text(html: str) -> tuple:
    """(title, text) where text has one block per line and headings as "# ..." lines."""
    from bs4 import BeautifulSoup
    soup = BeautifulSoup(html, "html.parser")
    title = re.sub(r"\s+", " ", soup.title.get_text()).strip() if soup.title else ""
    for tag in soup(_DROP_TAGS):
        tag.decompose()
    main = soup.find("main") or soup.find("article") or soup.body or soup
    lines: List[str] = []
    for el in main.find_all(_BLOCK_TAGS):
        if el.find(_BLOCK_TAGS):
            continue  # a container of other blocks: its children are emitted on their own
        text = re.sub(r"\s+", " ", _ZERO_WIDTH.sub("", el.get_text(" "))).strip()
        if not text:
            continue
        if el.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            lines.append("#" * int(el.name[1]) + " " + text)
        else:
            lines.append(text)
    return title, "\n".join(lines)


def passages(text: str, min_chars: int = 40, max_chars: int = 600) -> List[Dict[str, str]]:
    """Blocks of a docs page with the heading they sit under: [{text, section}]."""
    out, section = [], ""
    for line in (text or "").splitlines():
        line = line.strip()
        if not line:
            continue
        heading = re.match(r"^#{1,6}\s+(.*)$", line)
        if heading:
            section = heading.group(1).strip()[:200]
            continue
        if len(line) < min_chars:
            continue
        out.append({"text": line[:max_chars], "section": section})
    return out


class DocsConnector(Connector):
    id = "docs"
    provider = "docs"
    source_type = "docs_site"
    access_basis = "public_page"
    official_hosts = ()  # any site: every URL passes the SSRF check
    cache_ttl = 3 * 24 * 3600
    min_interval = 1.0
    terms_note = "Public pages only; robots.txt honoured; no login walls, CAPTCHAs or evasion"

    def __init__(self, gateway, scraper_url: Optional[str] = None, scraper_secret: Optional[str] = None):
        super().__init__(gateway)
        self.scraper_url = (scraper_url if scraper_url is not None else os.getenv("WORKER_SCRAPER_URL", "")).rstrip("/")
        self.scraper_secret = scraper_secret if scraper_secret is not None else os.getenv("SCRAPER_SECRET", "")
        self._robots: Dict[str, Optional[robotparser.RobotFileParser]] = {}

    def robots_allows(self, url: str) -> bool:
        parsed = urlparse(url)
        root = f"{parsed.scheme}://{parsed.netloc}"
        if root not in self._robots:
            try:
                response = self.gateway.request(self, "robots", "GET", root + "/robots.txt", accept_status=(401, 403, 404, 410),
                                                follow_redirects=True)
                if response.status in (401, 403):
                    parser = robotparser.RobotFileParser()
                    parser.disallow_all = True  # robots.txt itself refused: treat the site as closed to crawlers
                elif response.status >= 400:
                    parser = None
                else:
                    parser = robotparser.RobotFileParser()
                    parser.parse(response.text.splitlines())
            except SourceBlocked:
                raise
            except SourceUnavailable:
                parser = None  # unreachable robots.txt: no rules known, the page fetch decides
            self._robots[root] = parser
        parser = self._robots[root]
        return True if parser is None else parser.can_fetch(ROBOTS_AGENT, url)

    def fetch(self, url: str) -> Optional[Document]:
        """The page as text, or None when the site does not have it (404). Raises SourceBlocked when the URL
        is refused (unsafe, or disallowed by robots.txt) and SourceUnavailable when the page cannot be read."""
        reason = check_url(url, resolve=self.gateway.resolve_dns)
        if reason:
            raise SourceBlocked(f"SOURCE_BLOCKED: {reason}")
        if not self.robots_allows(url):
            raise SourceBlocked(f"SOURCE_BLOCKED: robots.txt of {urlparse(url).netloc} disallows {urlparse(url).path or '/'}")
        if self.scraper_url:
            title, text, final_url, retrieved_at, cached = self._via_scraper(url)
            access = "rendered_public_page"
        else:
            response = self.gateway.request(self, "page", "GET", url, accept_status=(404, 410), follow_redirects=True,
                                            headers={"Accept": "text/html,application/xhtml+xml,text/plain;q=0.9"})
            if response.status in (404, 410):
                return None
            ctype = (response.content_type or "").split(";")[0].strip().lower()
            if ctype and ctype not in _TEXT_TYPES:
                raise SourceUnavailable(f"SOURCE_UNAVAILABLE: {url} is {ctype}, not a text page")
            title, text = html_to_text(response.text) if "html" in ctype or not ctype else ("", response.text)
            final_url, retrieved_at, cached, access = response.url, response.retrieved_at, response.cached, self.access_basis
        text = text[:MAX_TEXT_CHARS]
        flagged = flag_instructions(text)
        if flagged:
            print(f"[Docs] Ignored instruction-like text in {final_url}: {flagged[0][:160]}", file=sys.stderr)
        return Document(url=final_url, content=text, content_hash=content_hash(text), retrieved_at=retrieved_at,
                        access_basis=access, provenance=self.provenance(final_url, retrieved_at, cached), title=title,
                        content_type="text/plain", flagged_instructions=flagged)

    def _via_scraper(self, url: str):
        headers = {"X-Scraper-Secret": self.scraper_secret} if self.scraper_secret else {}
        response = self.gateway.request(self, "page_rendered", "POST", f"{self.scraper_url}/scrape", json_body={"url": url},
                                        headers=headers, accept_status=(), trusted_endpoint=True)
        data = response.json()
        if not data.get("success"):
            raise SourceUnavailable(f"SOURCE_UNAVAILABLE: scraper could not read {url}: {data.get('error_message') or data.get('status_code')}")
        final_url = data.get("url") or url
        if check_url(final_url, resolve=False):
            raise SourceBlocked(f"SOURCE_BLOCKED: {final_url} is not a public address")
        # Scrapling returns Markdown: keep headings as "# " lines, drop link targets and images
        text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", _ZERO_WIDTH.sub("", data.get("markdown") or ""))
        text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
        return data.get("title") or "", text, final_url, response.retrieved_at, response.cached
