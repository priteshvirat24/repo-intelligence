import { ResourceType, ResourceRole, ResourceStatus, ResourceLocatorType } from '@repo/shared';

export interface ResourceDescriptor {
  resourceType: ResourceType;
  sourceUrl: string;
  canonicalUrl: string;
  domain: string;
  estimatedRole: ResourceRole;
  metadata?: Record<string, any>;
}

export interface ContentSegment {
  title?: string;
  content: string;
  locatorType: ResourceLocatorType;
  locator: Record<string, any>;
}

export interface IngestResult {
  success: boolean;
  status: ResourceStatus;
  title: string;
  description?: string;
  author?: string;
  publisher?: string;
  content: string;
  segments: ContentSegment[];
  metadata: Record<string, any>;
  contentHash: string;
  errorMessage?: string;
}

export interface ResourceAdapter {
  name: string;
  canHandle(url: string): boolean;
  detect(url: string): ResourceDescriptor;
  ingest(url: string): Promise<IngestResult>;
}
