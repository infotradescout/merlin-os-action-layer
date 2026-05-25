export type CrawlabilityEventType =
  | 'crawl_check_completed'
  | 'crawl_check_failed'
  | 'robots_allowed'
  | 'robots_blocked'
  | 'sitemap_discovered'
  | 'sitemap_missing'
  | 'canonical_valid'
  | 'canonical_missing'
  | 'metadata_valid'
  | 'metadata_missing'
  | 'og_valid'
  | 'og_missing'
  | 'structured_data_valid'
  | 'structured_data_invalid'
  | 'http_status_changed'
  | 'page_indexable'
  | 'page_not_indexable'
  | 'llm_crawl_ready'
  | 'llm_crawl_blocked'
  | 'stale_crawl_check';

export interface CrawlabilityPayload {
  url?: string;
  status_code?: number;
  indexable?: boolean;
  robots_allowed?: boolean;
  canonical_valid?: boolean;
  canonical_missing?: boolean;
  metadata_valid?: boolean;
  metadata_missing?: boolean;
  og_valid?: boolean;
  og_missing?: boolean;
  structured_data_valid?: boolean;
  structured_data_invalid?: boolean;
  sitemap_present?: boolean;
  sitemap_missing?: boolean;
  llm_crawl_ready?: boolean;
  llm_crawl_blocked?: boolean;
  indexable_block_reason?: string;
  [key: string]: unknown;
}

export interface CrawlabilityEventInput {
  entity_id?: string;
  event_type: string;
  origin_surface?: string;
  observed_at?: string;
  payload?: CrawlabilityPayload;
  source_reference?: string;
  url?: string;
  status_code?: number;
  indexable?: boolean;
  robots_allowed?: boolean;
  canonical_valid?: boolean;
  metadata_valid?: boolean;
  structured_data_valid?: boolean;
  og_valid?: boolean;
  sitemap_present?: boolean;
  llm_crawl_ready?: boolean;
  llm_crawl_blocked?: boolean;
}

type CrawlabilityEventSummary = {
  event_type: CrawlabilityEventType;
  payload: CrawlabilityPayload;
};

type CrawlabilityDailySection = 'changed' | 'needs_attention' | 'stale' | 'ignore';

const DEFAULT_SECTION: CrawlabilityEventType[] = [
  'crawl_check_completed',
  'crawl_check_failed',
  'robots_allowed',
  'robots_blocked',
  'sitemap_discovered',
  'sitemap_missing',
  'canonical_valid',
  'canonical_missing',
  'metadata_valid',
  'metadata_missing',
  'og_valid',
  'og_missing',
  'structured_data_valid',
  'structured_data_invalid',
  'http_status_changed',
  'page_indexable',
  'page_not_indexable',
  'llm_crawl_ready',
  'llm_crawl_blocked',
  'stale_crawl_check'
];

const crawlabilityEventTypes = new Set<CrawlabilityEventType>(DEFAULT_SECTION);

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'number' || Number.isNaN(value)) return undefined;
  return value === 1;
}

export function normalizeUrlEntityId(url?: string): string {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return 'url_unknown';
  }
  const trimmed = url.trim();
  try {
    const parsed = new URL(trimmed);
    const path = parsed.pathname.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
    const normalized = `${parsed.protocol}//${parsed.hostname}${path}${parsed.search}`;
    const safe = normalized
      .toLowerCase()
      .replace(/https?:\/\//g, 'https_')
      .replace(/[^a-z0-9._/:-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');
    return `url_${safe}`;
  } catch {
    return `url_${trimmed.toLowerCase().replace(/[^a-z0-9._/-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '')}`;
  }
}

export function createCrawlabilityEvent(input: CrawlabilityEventInput): {
  entity_id: string;
  event_type: CrawlabilityEventType;
  origin_surface: 'bot_crawlability';
  observed_at: string;
  source_reference: string;
  payload: CrawlabilityPayload;
} {
  const candidate = (input.event_type || '').trim().toLowerCase();
  if (!crawlabilityEventTypes.has(candidate as CrawlabilityEventType)) {
    throw new Error(`Unsupported crawlability event type: ${input.event_type}`);
  }
  const eventType = candidate as CrawlabilityEventType;
  const entityId = input.entity_id?.trim() || normalizeUrlEntityId(input.url);
  const url = input.url || input.payload?.url || input.payload?.['url'] || '';
  const mergedPayload: CrawlabilityPayload = {
    ...(input.payload || {}),
    url: typeof input.payload?.url === 'string' ? input.payload.url : typeof url === 'string' ? url : undefined,
    status_code: typeof input.status_code === 'number' ? input.status_code : undefined,
    indexable: typeof input.indexable === 'boolean' ? input.indexable : input.payload?.indexable,
    robots_allowed: typeof input.robots_allowed === 'boolean' ? input.robots_allowed : input.payload?.robots_allowed,
    canonical_valid: typeof input.canonical_valid === 'boolean' ? input.canonical_valid : input.payload?.canonical_valid,
    metadata_valid: typeof input.metadata_valid === 'boolean' ? input.metadata_valid : input.payload?.metadata_valid,
    structured_data_valid:
      typeof input.structured_data_valid === 'boolean' ? input.structured_data_valid : input.payload?.structured_data_valid,
    og_valid: typeof input.og_valid === 'boolean' ? input.og_valid : input.payload?.og_valid,
    sitemap_present: typeof input.sitemap_present === 'boolean' ? input.sitemap_present : input.payload?.sitemap_present,
    llm_crawl_ready: typeof input.llm_crawl_ready === 'boolean' ? input.llm_crawl_ready : input.payload?.llm_crawl_ready,
    llm_crawl_blocked: typeof input.llm_crawl_blocked === 'boolean' ? input.llm_crawl_blocked : input.payload?.llm_crawl_blocked
  };

  return {
    entity_id: entityId,
    event_type: eventType,
    origin_surface: 'bot_crawlability',
    observed_at: input.observed_at || new Date().toISOString(),
    source_reference: input.source_reference || `bot_crawlability:${entityId}`,
    payload: mergedPayload
  };
}

export function classifyCrawlabilityStatus(input: CrawlabilityEventSummary): CrawlabilityDailySection {
  const { event_type, payload } = input;
  switch (event_type) {
    case 'crawl_check_completed':
      if (
        payload.robots_allowed === false ||
        payload.canonical_valid === false ||
        payload.metadata_valid === false ||
        payload.structured_data_valid === false ||
        payload.og_valid === false ||
        payload.indexable === false ||
        payload.llm_crawl_blocked === true
      ) {
        return 'needs_attention';
      }
      return 'changed';
    case 'robots_blocked':
    case 'sitemap_missing':
    case 'canonical_missing':
    case 'metadata_missing':
    case 'structured_data_invalid':
    case 'http_status_changed':
    case 'page_not_indexable':
    case 'llm_crawl_blocked':
    case 'crawl_check_failed':
      return 'needs_attention';
    case 'stale_crawl_check':
      return 'stale';
    default:
      return 'ignore';
  }
}

export function shouldCreateCrawlabilityRecommendation(event: CrawlabilityEventSummary): boolean {
  const status = classifyCrawlabilityStatus(event);
  return status === 'needs_attention' || status === 'stale';
}
