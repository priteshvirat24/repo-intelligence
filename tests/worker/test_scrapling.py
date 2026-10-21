import json
import threading
import urllib.error
import urllib.request

import pytest

from apps.worker.scraper import api as scraper_api
from apps.worker.scraper import engine as engine_module
from apps.worker.scraper.engine import StealthScraperEngine
from apps.worker.scraper.safety import check_url

scrapling_custom = pytest.importorskip("scrapling.engines.toolbelt.custom", reason="scrapling[fetchers] not installed")


def response(html: str, url: str = "https://docs.example.com/guide/intro", status: int = 200):
    """A real Scrapling 0.5 Response, so the parser is tested against the library's actual API."""
    return scrapling_custom.Response(url=url, content=html.encode(), status=status, reason="OK", cookies={}, headers={}, request_headers={})


PAGE = """<html><head><title>Intro | Docs</title>
<meta name="description" content="Getting started">
<meta name="author" content="Ada">
<style>body { color: red; }</style>
<script>window.secretTrackingCode = 42;</script></head>
<body><nav>Menu Home About</nav><h1>Getting started</h1><p>Install the package and run it.</p>
<a href="/guide/next">Next</a><a href="https://other.example.org/x">Elsewhere</a><a href="mailto:a@b.c">Mail</a>
</body></html>"""


def test_protected_domains_match_whole_host_names():
    assert StealthScraperEngine.is_protected_domain("https://www.linkedin.com/in/sample-user")
    assert StealthScraperEngine.is_protected_domain("https://linkedin.com/posts/activity-1234")
    assert StealthScraperEngine.is_protected_domain("https://x.com/OpenAI/status/123")
    assert not StealthScraperEngine.is_protected_domain("https://www.dropbox.com/s/abc")  # contains "x.com"
    assert not StealthScraperEngine.is_protected_domain("https://notlinkedin.com/")
    assert not StealthScraperEngine.is_protected_domain("https://docs.python.org/3/")


def test_parse_uses_the_real_scrapling_api():
    result = StealthScraperEngine._parse_scrapling_response("https://docs.example.com/guide/intro", response(PAGE))
    assert result["success"] is True
    assert result["title"] == "Intro | Docs"
    assert result["description"] == "Getting started"
    assert result["author"] == "Ada"
    # Relative links are resolved; non-http links are dropped
    assert result["links"] == ["https://docs.example.com/guide/next", "https://other.example.org/x"]
    assert "# Getting started" in result["markdown"]
    # Script, style and navigation contents never reach the extracted text
    assert "secretTrackingCode" not in result["markdown"]
    assert "color: red" not in result["markdown"]
    assert "Menu Home" not in result["markdown"]


def test_login_walls_are_reported_not_returned_as_content():
    wall = response("<html><head><title>LinkedIn</title></head><body><h1>Join LinkedIn</h1><p>Sign in to view</p></body></html>",
                    url="https://www.linkedin.com/authwall?trk=x")
    result = StealthScraperEngine._parse_scrapling_response("https://www.linkedin.com/posts/abc", wall)
    assert result["success"] is False
    assert result["status_code"] == 401
    assert result["error_message"].startswith("AUTH_REQUIRED")
    assert result["markdown"] == ""


@pytest.mark.parametrize("url", [
    "http://localhost:5432/",
    "http://127.0.0.1/admin",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.5/",
    "http://[::1]/",
    "http://postgres.railway.internal:5432/",
    "file:///etc/passwd",
    "http://user:pass@example.com/",
    "ftp://example.com/",
])
def test_internal_and_unsafe_urls_are_refused(url):
    assert check_url(url) is not None


def test_public_addresses_are_allowed():
    assert check_url("https://8.8.8.8/", resolve=False) is None
    assert check_url("https://docs.example.com/", resolve=False) is None


def test_scrape_refuses_internal_urls_without_fetching(monkeypatch):
    def boom(*args, **kwargs):
        raise AssertionError("must not fetch")
    from scrapling.fetchers import Fetcher
    monkeypatch.setattr(Fetcher, "get", boom)
    result = StealthScraperEngine.scrape("http://169.254.169.254/latest/meta-data/")
    assert result["status_code"] == 403 and result["error_message"].startswith("RESOURCE_ACCESS_BLOCKED")


def test_redirect_to_an_internal_address_is_blocked():
    landed = response("<html><body>internal</body></html>", url="http://127.0.0.1:8080/secrets")
    result = StealthScraperEngine._parse_scrapling_response("https://public.example.com/r", landed)
    assert result["success"] is False and "redirected to a blocked address" in result["error_message"]
    assert result["markdown"] == ""


def test_both_tiers_share_one_time_budget(monkeypatch):
    monkeypatch.setattr(engine_module, "check_url", lambda url: None)
    from scrapling.fetchers import Fetcher, StealthyFetcher
    seen = {}
    clock = {"now": 1000.0}
    monkeypatch.setattr(engine_module.time, "monotonic", lambda: clock["now"])

    def fast(url, **kwargs):
        seen["fast_timeout_s"] = kwargs["timeout"]
        clock["now"] += kwargs["timeout"]  # the slow site uses the fast tier's whole allowance
        return response("<html><head><title>Just a moment...</title></head><body>challenge</body></html>", url=url, status=403)

    def browser(url, **kwargs):
        seen["browser_timeout_ms"] = kwargs["timeout"]
        return response(PAGE, url=url)

    monkeypatch.setattr(Fetcher, "get", fast)
    monkeypatch.setattr(StealthyFetcher, "fetch", browser)
    result = StealthScraperEngine.scrape("https://docs.example.com/guide/intro", timeout=20000)
    assert result["success"]
    assert seen["fast_timeout_s"] <= 7.0
    assert seen["fast_timeout_s"] * 1000 + seen["browser_timeout_ms"] <= 20000


def test_out_of_range_timeouts_are_clamped(monkeypatch):
    monkeypatch.setattr(engine_module, "check_url", lambda url: None)
    from scrapling.fetchers import StealthyFetcher
    seen = {}
    monkeypatch.setattr(StealthyFetcher, "fetch", lambda url, **kw: seen.update(kw) or response(PAGE, url=url))
    StealthScraperEngine.scrape("https://www.linkedin.com/posts/x", timeout=10_000_000, wait_for=999_999)
    assert seen["timeout"] <= engine_module.MAX_TIMEOUT_MS
    assert seen["wait"] == engine_module.MAX_WAIT_MS


# HTTP service

@pytest.fixture
def service(monkeypatch):
    calls = []

    def fake_scrape(url, **kwargs):
        calls.append(url)
        links = ["https://docs.example.com/a", "https://www.docs.example.com/b", "https://evil.example.net/c", "https://docs.example.com/a#frag"]
        return {"success": True, "url": url, "title": "t", "markdown": "x" * 100, "links": links, "status_code": 200, "error_message": None}

    monkeypatch.setattr(StealthScraperEngine, "scrape", staticmethod(fake_scrape))
    monkeypatch.setattr(scraper_api, "_robots_allows", lambda url, cache: not url.endswith("/b"))
    server = scraper_api.make_server(0, "127.0.0.1", "s3cret")
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}", calls
    server.shutdown()


def post(base, path, body, secret="s3cret", raw=None):
    data = raw if raw is not None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=data, method="POST", headers={"Content-Type": "application/json", "X-Scraper-Secret": secret})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read()), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read()), dict(e.headers)


def test_service_requires_the_secret_and_sends_no_cors_headers(service):
    base, _ = service
    assert post(base, "/scrape", {"url": "https://docs.example.com/"}, secret="wrong")[0] == 401
    status, body, headers = post(base, "/scrape", {"url": "https://docs.example.com/"})
    assert status == 200 and body["success"]
    assert "Access-Control-Allow-Origin" not in headers


def test_service_rejects_bad_bodies_without_crashing(service):
    base, _ = service
    assert post(base, "/scrape", None, raw=b"{not json")[0] == 400
    assert post(base, "/scrape", {"nourl": True})[0] == 400
    assert post(base, "/scrape", None, raw=b"x" * (scraper_api.MAX_BODY_BYTES + 1))[0] == 413


def test_crawl_stays_on_site_respects_robots_and_caps_pages(service):
    base, calls = service
    status, body, _ = post(base, "/crawl", {"url": "https://docs.example.com/", "limit": 500})
    assert status == 200
    # evil.example.net is another site, /b is disallowed by robots, the #frag duplicate is skipped
    assert calls == ["https://docs.example.com/", "https://docs.example.com/a"]
    assert len(body["pages"]) == 2


def test_refuses_to_listen_beyond_loopback_without_a_secret():
    with pytest.raises(RuntimeError, match="SCRAPER_SECRET"):
        scraper_api.make_server(0, "0.0.0.0", None)
