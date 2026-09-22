import { ResourceAdapter, ResourceDescriptor } from './types';
import { ResourceTypeDetector } from './detector';
import { GitHubResourceAdapter } from './github';
import { YouTubeResourceAdapter } from './youtube';
import { LinkedInResourceAdapter } from './linkedin';
import { PDFResourceAdapter } from './pdf';
import { WebResourceAdapter } from './web';

export class AdapterRegistry {
  private static adapters: ResourceAdapter[] = [
    new GitHubResourceAdapter(),
    new YouTubeResourceAdapter(),
    new LinkedInResourceAdapter(),
    new PDFResourceAdapter(),
    new WebResourceAdapter()
  ];

  static detect(url: string): ResourceDescriptor {
    return ResourceTypeDetector.detect(url);
  }

  static getAdapter(url: string): ResourceAdapter {
    for (const adapter of this.adapters) {
      if (adapter.canHandle(url)) {
        return adapter;
      }
    }
    // Default fallback to WebResourceAdapter
    return this.adapters[this.adapters.length - 1];
  }
}
