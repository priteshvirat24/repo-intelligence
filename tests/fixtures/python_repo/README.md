# Python Web Crawler Fixture

An ultra-fast asynchronous web crawler for testing repository intelligence.

## Features
- Headless browser automation
- High throughput async crawling
- Markdown extraction

## Usage
```python
from crawl_module import AsyncWebCrawler
crawler = AsyncWebCrawler()
result = await crawler.arun("https://example.com")
```
