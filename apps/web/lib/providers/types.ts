export interface SearchOptions {
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  includeDomains?: string[];
  excludeDomains?: string[];
  includeAnswer?: boolean;
}

export interface SearchResultItem {
  title: string;
  url: string;
  content: string;
  score?: number;
  publishedDate?: string;
  domain?: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
  answer?: string;
  provider: string;
  fromCache?: boolean;
}

export interface WebSearchProvider {
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;
  extract(urls: string[]): Promise<Array<{ url: string; rawContent: string }>>;
  isAvailable(): boolean;
}

export interface ScrapeOptions {
  formats?: ('markdown' | 'html' | 'rawHtml' | 'links')[];
  onlyMainContent?: boolean;
  timeout?: number;
  waitFor?: number;
}

export interface ScrapedPage {
  url: string;
  canonicalUrl?: string;
  title: string;
  description?: string;
  markdown: string;
  author?: string;
  publishedTime?: string;
  links?: string[];
  statusCode?: number;
  success: boolean;
  errorMessage?: string;
}

export interface CrawlOptions {
  limit?: number;
  maxDepth?: number;
  allowBackwardLinks?: boolean;
}

export interface WebExtractionProvider {
  scrape(url: string, options?: ScrapeOptions): Promise<ScrapedPage>;
  crawl(url: string, options?: CrawlOptions): Promise<ScrapedPage[]>;
  isAvailable(): boolean;
}
