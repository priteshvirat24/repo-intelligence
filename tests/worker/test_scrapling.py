import pytest
from apps.worker.scraper.engine import StealthScraperEngine


def test_is_protected_domain():
    assert StealthScraperEngine.is_protected_domain("https://www.linkedin.com/in/sample-user") is True
    assert StealthScraperEngine.is_protected_domain("https://linkedin.com/posts/activity-1234") is True
    assert StealthScraperEngine.is_protected_domain("https://x.com/OpenAI/status/123") is True
    assert StealthScraperEngine.is_protected_domain("https://docs.python.org/3/") is False
    assert StealthScraperEngine.is_protected_domain("https://fastapi.tiangolo.com") is False


def test_parse_scrapling_response_mock():
    class MockElement:
        def __init__(self, text, attrib=None):
            self.text = text
            self.attrib = attrib or {}

    class MockResponse:
        status = 200
        html = "<html><head><title>FastAPI Framework</title></head><body><h1>FastAPI</h1><p>Modern, fast web framework for Python.</p><a href='https://fastapi.tiangolo.com/tutorial'>Tutorial</a></body></html>"
        text = "FastAPI Modern, fast web framework for Python."

        def css_first(self, selector):
            if selector in ("title", "h1"):
                return MockElement("FastAPI Framework")
            return None

        def css(self, selector):
            if selector == "a[href]":
                return [MockElement("Tutorial", {"href": "https://fastapi.tiangolo.com/tutorial"})]
            return []

    result = StealthScraperEngine._parse_scrapling_response("https://fastapi.tiangolo.com", MockResponse())
    assert result["success"] is True
    assert result["title"] == "FastAPI Framework"
    assert "FastAPI" in result["markdown"]
    assert "https://fastapi.tiangolo.com/tutorial" in result["links"]
