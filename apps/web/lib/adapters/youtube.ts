import crypto from 'crypto';
import { ResourceAdapter, ResourceDescriptor, IngestResult, ContentSegment } from './types';
import { ResourceTypeDetector } from './detector';

export class YouTubeResourceAdapter implements ResourceAdapter {
  name = 'YouTubeResourceAdapter';

  canHandle(url: string): boolean {
    const desc = ResourceTypeDetector.detect(url);
    return desc.resourceType === 'youtube_video';
  }

  detect(url: string): ResourceDescriptor {
    return ResourceTypeDetector.detect(url);
  }

  async ingest(url: string): Promise<IngestResult> {
    const desc = this.detect(url);
    const videoId = desc.metadata?.videoId || '';

    const failure = (status: 'FAILED' | 'BLOCKED' | 'PARTIAL', errorMessage: string, title = desc.canonicalUrl): IngestResult => ({
      success: false,
      status,
      title,
      content: '',
      segments: [],
      metadata: { videoId },
      contentHash: '',
      errorMessage
    });

    // 1. Fetch metadata via YouTube oEmbed API (public, no key required). Real metadata or nothing:
    // a missing/private video must not be indexed under a placeholder title and channel.
    let title: string;
    let channel: string;
    let thumbnailUrl = '';
    try {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(desc.canonicalUrl)}&format=json`;
      const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(10000) });
      if (res.status === 401 || res.status === 403) {
        return failure('BLOCKED', 'RESOURCE_ACCESS_BLOCKED: This video is private or embedding is disabled.');
      }
      if (!res.ok) {
        return failure('FAILED', `RESOURCE_NOT_FOUND: YouTube returned HTTP ${res.status} for this video (it may not exist).`);
      }
      const data = await res.json();
      if (!data.title) {
        return failure('FAILED', 'RESOURCE_ACCESS_FAILED: YouTube returned no metadata for this video.');
      }
      title = data.title;
      channel = data.author_name || '';
      thumbnailUrl = data.thumbnail_url || '';
    } catch (err: any) {
      return failure('FAILED', `RESOURCE_ACCESS_FAILED: Could not reach YouTube (${err?.message || 'network error'}).`);
    }

    // 2. Fetch transcript if publicly accessible
    let transcriptAvailable = false;
    let transcriptText = '';
    const segments: ContentSegment[] = [];

    try {
      // Attempt to retrieve public timed captions
      const timedText = await this.fetchPublicCaptions(videoId);
      if (timedText && timedText.length > 0) {
        transcriptAvailable = true;
        transcriptText = timedText.map(t => `[${t.label}] ${t.text}`).join('\n');

        for (const t of timedText) {
          segments.push({
            title: `Timestamp: ${t.label}`,
            content: t.text,
            locatorType: 'youtube_timestamp',
            locator: {
              videoId,
              startSeconds: t.start,
              endSeconds: t.start + t.dur,
              timestampLabel: t.label,
              videoUrl: `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(t.start)}s`
            }
          });
        }
      }
    } catch (transcriptErr) {
      console.log('[YouTubeResourceAdapter] Captions not available or restricted');
    }

    // Without a transcript there is no content to analyze: stop instead of letting the LLM
    // "analyze" a video from its title alone (which can only produce invented knowledge)
    if (!transcriptAvailable || !transcriptText) {
      return failure('PARTIAL', 'No public transcript is available for this video, so its content cannot be analyzed.', title);
    }
    const content = `# ${title}\n**Channel**: ${channel}\n**Video ID**: ${videoId}\n\n## Transcript\n${transcriptText}`;

    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    return {
      success: true,
      status: 'READY',
      title,
      description: channel ? `YouTube video by ${channel}` : '',
      author: channel || undefined,
      publisher: 'YouTube',
      content,
      segments,
      metadata: {
        videoId,
        channel,
        thumbnailUrl,
        transcriptAvailable
      },
      contentHash
    };
  }

  private async fetchPublicCaptions(videoId: string): Promise<Array<{ start: number; dur: number; text: string; label: string }> | null> {
    if (!videoId) return null;

    try {
      // Scrape video page to find timedtext URL
      const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (!pageRes.ok) return null;

      const html = await pageRes.text();
      const timedTextMatch = html.match(/"captionTracks":\s*(\[[^\]]+\])/);
      if (!timedTextMatch) return null;

      const captionTracks = JSON.parse(timedTextMatch[1]);
      if (!captionTracks || captionTracks.length === 0) return null;

      // Find English or first caption track
      const track = captionTracks.find((t: any) => t.languageCode === 'en') || captionTracks[0];
      if (!track?.baseUrl) return null;

      const captionRes = await fetch(track.baseUrl, { signal: AbortSignal.timeout(8000) });
      if (!captionRes.ok) return null;

      const xml = await captionRes.text();
      // Parse XML <text start="12.3" dur="4.5">...</text>
      const textRegex = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
      const results: Array<any> = [];
      let match;
      let aggregatedText = '';
      let chunkStart = 0;
      let chunkDur = 0;

      while ((match = textRegex.exec(xml)) !== null) {
        const start = parseFloat(match[1]);
        const dur = parseFloat(match[2]);
        const cleanText = match[3]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'")
          .replace(/&quot;/g, '"')
          .trim();

        if (!aggregatedText) chunkStart = start;
        aggregatedText += ' ' + cleanText;
        chunkDur += dur;

        // Group into ~30 second chunks
        if (chunkDur >= 30 || aggregatedText.length > 200) {
          const mins = Math.floor(chunkStart / 60);
          const secs = Math.floor(chunkStart % 60);
          const label = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
          results.push({
            start: chunkStart,
            dur: chunkDur,
            text: aggregatedText.trim(),
            label
          });
          aggregatedText = '';
          chunkDur = 0;
        }
      }

      if (aggregatedText.trim()) {
        const mins = Math.floor(chunkStart / 60);
        const secs = Math.floor(chunkStart % 60);
        const label = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        results.push({
          start: chunkStart,
          dur: chunkDur,
          text: aggregatedText.trim(),
          label
        });
      }

      return results.length > 0 ? results : null;
    } catch {
      return null;
    }
  }
}
