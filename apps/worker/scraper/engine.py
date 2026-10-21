import logging
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse

logger = logging.getLogger("open_eye.scraper")


class StealthScraperEngine:
    """
    High-performance web extraction engine utilizing Scrapling and Camoufox.
    
    Tiers:
      1. Fast HTTP (Scrapling Fetcher) for public documentation, blogs, and static sites.
      2. Camoufox Stealth (Scrapling StealthyFetcher) for anti-bot protected sites
         (Cloudflare Turnstile, Akamai, DataDome, LinkedIn HTTP 999, SPAs).
    """

    PROTECTED_DOMAINS = {
        "linkedin.com",
        "www.linkedin.com",
        "twitter.com",
        "x.com",
        "bloomberg.com",
        "wsj.com",
        "medium.com",
    }

    @classmethod
    def is_protected_domain(cls, url: str) -> bool:
        try:
            parsed = urlparse(url)
            host = parsed.netloc.lower()
            return any(d in host for d in cls.PROTECTED_DOMAINS)
        except Exception:
            return False

    @classmethod
    def scrape(
        cls,
        url: str,
        stealth: Optional[bool] = None,
        timeout: int = 30000,
        wait_for: int = 0,
    ) -> Dict[str, Any]:
        """
        Scrapes a URL using Scrapling, escalating to Camoufox if stealth is requested
        or if an anti-bot challenge is encountered.
        """
        try:
            from scrapling.fetchers import Fetcher
        except ImportError:
            logger.error("Scrapling is not installed. Please run `pip install scrapling`.")
            return {
                "success": False,
                "url": url,
                "title": "",
                "markdown": "",
                "links": [],
                "status_code": 500,
                "error_message": "Scrapling dependency is not installed in worker environment",
            }

        should_use_stealth = stealth or (stealth is None and cls.is_protected_domain(url))

        # 1. Attempt Camoufox StealthyFetcher directly if requested or protected
        if should_use_stealth:
            return cls._scrape_with_camoufox(url, timeout=timeout, wait_for=wait_for)

        # 2. Otherwise attempt fast HTTP fetcher first
        try:
            fetcher = Fetcher()
            res = fetcher.get(url, timeout=timeout / 1000.0)

            # Detect anti-bot block (403, 429, 999, or Cloudflare challenge in body)
            html_text = res.text or ""
            is_blocked = (
                res.status in (403, 429, 999)
                or "cf-browser-verification" in html_text
                or "challenge-platform" in html_text
                or "Attention Required! | Cloudflare" in html_text
                or "Just a moment..." in html_text
            )

            if is_blocked:
                logger.info("Bot challenge or block detected on %s (HTTP %s). Escalating to Camoufox StealthyFetcher.", url, res.status)
                return cls._scrape_with_camoufox(url, timeout=timeout, wait_for=wait_for)

            return cls._parse_scrapling_response(url, res)
        except Exception as e:
            logger.warning("Fast HTTP scrape failed for %s: %s. Attempting Camoufox fallback.", url, e)
            return cls._scrape_with_camoufox(url, timeout=timeout, wait_for=wait_for)

    @classmethod
    def _scrape_with_camoufox(
        cls,
        url: str,
        timeout: int = 30000,
        wait_for: int = 0,
    ) -> Dict[str, Any]:
        """
        Runs headless anti-detect extraction with Camoufox via Scrapling StealthyFetcher.
        """
        try:
            from scrapling.fetchers import StealthyFetcher

            # Launch Camoufox headless browser with native fingerprint masking
            res = StealthyFetcher.fetch(
                url,
                headless=True,
                timeout=timeout,
                network_idle=True,
            )
            return cls._parse_scrapling_response(url, res)
        except Exception as e:
            logger.error("Camoufox StealthyFetcher failed for %s: %s", url, e)
            return {
                "success": False,
                "url": url,
                "title": "",
                "markdown": "",
                "links": [],
                "status_code": 500,
                "error_message": f"Camoufox stealth extraction failed: {str(e)}",
            }

    @classmethod
    def _parse_scrapling_response(cls, url: str, res: Any) -> Dict[str, Any]:
        """
        Parses Scrapling response, extracts metadata, clean markdown, and links.
        """
        try:
            from markdownify import markdownify as md
        except ImportError:
            md = None

        status_code = getattr(res, "status", 200)

        if status_code >= 400:
            return {
                "success": False,
                "url": url,
                "title": "",
                "markdown": "",
                "links": [],
                "status_code": status_code,
                "error_message": f"HTTP {status_code} from target website",
            }

        # Title extraction
        title = ""
        try:
            title_node = res.css_first("meta[property='og:title']") or res.css_first("title") or res.css_first("h1")
            if title_node:
                title = title_node.attrib.get("content") or title_node.text or ""
        except Exception:
            pass

        # Description extraction
        description = ""
        try:
            desc_node = res.css_first("meta[name='description']") or res.css_first("meta[property='og:description']")
            if desc_node:
                description = desc_node.attrib.get("content") or desc_node.text or ""
        except Exception:
            pass

        # Author extraction
        author = ""
        try:
            author_node = res.css_first("meta[name='author']") or res.css_first("[rel='author']")
            if author_node:
                author = author_node.attrib.get("content") or author_node.text or ""
        except Exception:
            pass

        # Links extraction
        links: List[str] = []
        try:
            raw_links = res.css("a[href]")
            for a in raw_links:
                href = a.attrib.get("href", "").strip()
                if href.startswith("http://") or href.startswith("https://"):
                    if href not in links:
                        links.append(href)
                if len(links) >= 30:
                    break
        except Exception:
            pass

        # HTML to Markdown conversion
        html_content = getattr(res, "html", None) or getattr(res, "text", "") or ""
        if md and html_content:
            try:
                markdown = md(
                    html_content,
                    heading_style="ATX",
                    strip=["script", "style", "nav", "footer", "noscript"],
                )
            except Exception:
                markdown = html_content[:5000]
        else:
            # Fallback to plain text if markdownify unavailable
            markdown = getattr(res, "text", "") or ""

        # Clean excess whitespaces
        import re
        markdown = re.sub(r"\n{3,}", "\n\n", markdown).strip()

        return {
            "success": True,
            "url": url,
            "title": title.strip() or url,
            "description": description.strip(),
            "author": author.strip() or None,
            "markdown": markdown,
            "links": links,
            "status_code": status_code,
            "error_message": None,
        }
