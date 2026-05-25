import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.MERLIN_RUNTIME = 'test';

const { createCrawlabilityEvent, classifyCrawlabilityStatus, normalizeUrlEntityId } = await import('../src/crawlability.ts');
const { createMerlinServer } = await import('../src/server.ts');
const { closeLisaStore, resetLisaStore } = await import('../src/lisa.ts');

let server: Server;
let baseUrl: string;

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...init
  });
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

before(async () => {
  server = createMerlinServer();
  await new Promise<void>((resolve, reject) => {
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Server did not bind to a numeric port'));
        return;
      }
      baseUrl = `http://127.0.0.1:${(addr as AddressInfo).port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  closeLisaStore();
});

beforeEach(() => {
  resetLisaStore();
});

test('normalizeUrlEntityId derives deterministic entity IDs from URLs', () => {
  const url = 'https://tradescout.app/p/business/123?source=site';
  const first = normalizeUrlEntityId(url);
  const second = normalizeUrlEntityId(url);
  assert.equal(first, second);
  assert.equal(first.startsWith('url_https_tradescout.app/p/business/123'), true);
});

test('crawlability event helper derives entity_id from url and normalizes payload', () => {
  const event = createCrawlabilityEvent({
    event_type: 'crawl_check_completed',
    url: 'https://tradescout.app/p/business/456',
    payload: {
      indexable: true,
      robots_allowed: true,
      canonical_valid: true,
      metadata_valid: true,
      structured_data_valid: true,
      og_valid: true,
      llm_crawl_ready: true
    }
  });

  assert.equal(event.origin_surface, 'bot_crawlability');
  assert.equal(event.entity_id, normalizeUrlEntityId('https://tradescout.app/p/business/456'));
  assert.equal(event.payload.indexable, true);
  assert.equal(event.payload.robots_allowed, true);
});

test('crawl_check_completed maps healthy check to changed', async () => {
  const url = 'https://tradescout.app/p/business/100';
  const entityId = normalizeUrlEntityId(url);

  const posted = await requestJson<{ status: string; signal_id: string }>('/api/events/crawlability', {
    method: 'POST',
    body: JSON.stringify({
      event_type: 'crawl_check_completed',
      url,
      payload: {
        indexable: true,
        robots_allowed: true,
        canonical_valid: true,
        metadata_valid: true,
        structured_data_valid: true,
        og_valid: true,
        llm_crawl_ready: true
      }
    })
  });
  assert.equal(posted.status, 200);
  assert.equal(posted.body.status, 'ok');
  assert.equal(typeof posted.body.signal_id, 'string');

  const daily = await requestJson<{
    sections: {
      changed: Array<{ source_refs: string[] }>;
      needs_attention: Array<{ source_refs: string[] }>;
      waiting: Array<{ source_refs: string[] }>;
      stale: Array<{ source_refs: string[] }>;
      suggested_next_steps: Array<{ source_refs: string[] }>;
    };
  }>('/api/daily');
  assert.equal(daily.status, 200);
  const inChanged = daily.body.sections.changed.some((item) => item.source_refs.includes(`bot_crawlability:${entityId}`));
  assert.equal(inChanged, true);
});

test('robots_blocked maps to needs_attention', async () => {
  const response = await requestJson<{ status: string; signal_id: string }>('/api/events/crawlability', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: 'business_robo',
      event_type: 'robots_blocked',
      payload: {
        robots_allowed: false
      }
    })
  });
  assert.equal(response.status, 200);

  const daily = await requestJson<{
    sections: {
      changed: Array<{ source_refs: string[] }>;
      needs_attention: Array<{ source_refs: string[] }>;
      waiting: Array<{ source_refs: string[] }>;
      stale: Array<{ source_refs: string[] }>;
      suggested_next_steps: Array<{ source_refs: string[] }>;
    };
  }>('/api/daily');
  assert.equal(daily.status, 200);
  const inNeedsAttention = daily.body.sections.needs_attention.some((item) =>
    item.source_refs.includes('bot_crawlability:business_robo')
  );
  assert.equal(inNeedsAttention, true);
});

test('metadata_missing maps to needs_attention', async () => {
  const response = await requestJson<{ status: string; signal_id: string }>('/api/events/crawlability', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: 'business_meta',
      event_type: 'metadata_missing',
      payload: {
        metadata_missing: true
      }
    })
  });
  assert.equal(response.status, 200);

  const daily = await requestJson<{
    sections: {
      changed: Array<{ source_refs: string[] }>;
      needs_attention: Array<{ source_refs: string[] }>;
      waiting: Array<{ source_refs: string[] }>;
      stale: Array<{ source_refs: string[] }>;
      suggested_next_steps: Array<{ source_refs: string[] }>;
    };
  }>('/api/daily');
  assert.equal(daily.status, 200);
  const inNeedsAttention = daily.body.sections.needs_attention.some((item) =>
    item.source_refs.includes('bot_crawlability:business_meta')
  );
  assert.equal(inNeedsAttention, true);
});

test('page_not_indexable maps to needs_attention', async () => {
  const response = await requestJson<{ status: string; signal_id: string }>('/api/events/crawlability', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: 'business_index',
      event_type: 'page_not_indexable',
      payload: {
        indexable: false
      }
    })
  });
  assert.equal(response.status, 200);

  const daily = await requestJson<{
    sections: {
      changed: Array<{ source_refs: string[] }>;
      needs_attention: Array<{ source_refs: string[] }>;
      waiting: Array<{ source_refs: string[] }>;
      stale: Array<{ source_refs: string[] }>;
      suggested_next_steps: Array<{ source_refs: string[] }>;
    };
  }>('/api/daily');
  assert.equal(daily.status, 200);
  const inNeedsAttention = daily.body.sections.needs_attention.some((item) =>
    item.source_refs.includes('bot_crawlability:business_index')
  );
  assert.equal(inNeedsAttention, true);
});

test('stale_crawl_check maps to stale', async () => {
  const response = await requestJson<{ status: string; signal_id: string }>('/api/events/crawlability', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: 'business_stale',
      event_type: 'stale_crawl_check',
      payload: {
        reason: 'check overdue'
      }
    })
  });
  assert.equal(response.status, 200);

  const daily = await requestJson<{
    sections: {
      changed: Array<{ source_refs: string[] }>;
      needs_attention: Array<{ source_refs: string[] }>;
      waiting: Array<{ source_refs: string[] }>;
      stale: Array<{ source_refs: string[] }>;
      suggested_next_steps: Array<{ source_refs: string[] }>;
    };
  }>('/api/daily');
  assert.equal(daily.status, 200);
  const inStale = daily.body.sections.stale.some((item) => item.source_refs.includes('bot_crawlability:business_stale'));
  assert.equal(inStale, true);
});

test('crawl classification helper identifies stale and attention states', () => {
  const good = classifyCrawlabilityStatus({
    event_type: 'crawl_check_completed',
    payload: {
      robots_allowed: true,
      canonical_valid: true,
      metadata_valid: true,
      structured_data_valid: true,
      og_valid: true,
      indexable: true
    }
  });
  assert.equal(good, 'changed');

  const needsAttention = classifyCrawlabilityStatus({
    event_type: 'crawl_check_completed',
    payload: {
      robots_allowed: false
    }
  });
  assert.equal(needsAttention, 'needs_attention');
});
