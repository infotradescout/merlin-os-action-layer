import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeLisaStore, resetLisaStore } = await import('../src/lisa.ts');
const { resetApprovalQueueForTest } = await import('../src/approvalQueue.ts');
const { resetRecommendationsForTest } = await import('../src/recommendations.ts');
const { resetOutcomesForTest } = await import('../src/outcomes.ts');
const { resetReplayForTest } = await import('../src/replay.ts');
const { resetDriveManifestForTest } = await import('../src/driveManifest.ts');
const { resetEntityResolutionForTest } = await import('../src/entityResolution.ts');
const { resetSourceRegistryForTest } = await import('../src/sourceRegistry.ts');

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

beforeEach(async () => {
  resetLisaStore();
  resetApprovalQueueForTest();
  resetRecommendationsForTest();
  resetOutcomesForTest();
  resetReplayForTest();
  resetDriveManifestForTest();
  resetEntityResolutionForTest();
  resetSourceRegistryForTest();
  await requestJson('/api/demo/reset', { method: 'POST' }).catch(() => {});
});

const randomEntityId = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

test('empty LISA search returns empty results', async () => {
  const response = await requestJson<{ query: string; results: unknown[] }>(
    '/api/lisa/search?q=' + encodeURIComponent('no-such-record-xyz-01')
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.query, 'no-such-record-xyz-01');
  assert.equal(response.body.results.length, 0);
});

test('seeded demo events appear in LISA search', async () => {
  const seed = await requestJson<{ status: string }>('/api/demo/seed-tradescout-loop', { method: 'POST' });
  assert.equal(seed.status, 200);

  const response = await requestJson<{ results: Array<{ entity_id?: string; id: string }> }>(
    '/api/lisa/search?q=business_demo_001&limit=50'
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.results.length > 0, true);
  assert.equal(response.body.results.some((item) => item.entity_id === 'business_demo_001'), true);
});

test('MealScout event appears in LISA search', async () => {
  const entityId = randomEntityId('restaurant-ms');
  const posted = await requestJson<{ status: string }>('/api/events/mealscout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      event_type: 'restaurant_onboarded'
    })
  });
  assert.equal(posted.status, 200);

  const search = await requestJson<{ results: Array<{ entity_id?: string; id: string; source_refs?: string[] }> }>(
    `/api/lisa/search?q=${encodeURIComponent(entityId)}&limit=40`
  );
  assert.equal(search.status, 200);
  assert.equal(search.body.results.length > 0, true);
  assert.equal(search.body.results.some((item) => item.entity_id === entityId), true);
});

test('TradeScout event appears in LISA search', async () => {
  const entityId = randomEntityId('tradescout');
  const posted = await requestJson<{ status: string }>('/api/events/tradescout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      event_type: 'onboarding_started'
    })
  });
  assert.equal(posted.status, 200);

  const search = await requestJson<{ results: Array<{ entity_id?: string; id: string; source_refs?: string[]; type?: string }> }>(
    `/api/lisa/search?q=${encodeURIComponent(entityId)}&limit=40`
  );
  assert.equal(search.status, 200);
  const found = search.body.results.find((item) => item.entity_id === entityId);
  assert.equal(typeof found?.id, 'string');
});

test('crawlability event appears in LISA search', async () => {
  const crawled = await requestJson<{ status: string }>('/api/events/crawlability', {
    method: 'POST',
    body: JSON.stringify({
      event_type: 'crawl_check_completed',
      url: 'https://tradescout.app/p/business/123',
      payload: {
        status_code: 200,
        robots_allowed: true,
        canonical_valid: true,
        metadata_valid: true,
        structured_data_valid: true,
        og_valid: true,
        indexable: true,
        sitemap_present: true,
        llm_crawl_ready: true
      }
    })
  });
  assert.equal(crawled.status, 200);

  const search = await requestJson<{ results: Array<{ type: string; summary: string; id: string; title: string }> }>(
    '/api/lisa/search?q=crawl_check_completed&limit=40'
  );
  assert.equal(search.status, 200);
  assert.equal(search.body.results.some((item) => item.type === 'event'), true);
  assert.equal(
    search.body.results.some(
      (item) =>
        (item.title || '').includes('crawl check completed') ||
        (item.summary || '').includes('crawl check completed') ||
        (item.title || '').includes('crawl_check_completed') ||
        (item.summary || '').includes('crawl_check_completed')
    ),
    true
  );
});

test('entity detail endpoint returns state and timeline', async () => {
  const entityId = randomEntityId('entity-detail');
  const postEvent = await requestJson<{ status: string }>('/api/events/tradescout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      event_type: 'contractor_claim',
      title: 'New contractor claim'
    })
  });
  assert.equal(postEvent.status, 200);

  const detail = await requestJson<{
    entity: { entity_id: string; source_refs?: string[]; title?: string };
    timeline: Array<{ entity_id: string; signal_type?: string; id: string }>;
    timeline_results?: Array<{ entity_id: string; id: string }>;
  }>(`/api/lisa/entities/${encodeURIComponent(entityId)}`);

  assert.equal(detail.status, 200);
  assert.equal(detail.body.entity?.entity_id, entityId);
  assert.equal(Array.isArray(detail.body.timeline), true);
  assert.equal(detail.body.timeline.length >= 1, true);
  assert.equal(detail.body.timeline[0].entity_id, entityId);
});

test('replay results are searchable in LISA Browser', async () => {
  const entityId = randomEntityId('replay-search');
  const postEvent = await requestJson<{ status: string }>('/api/events/mealscout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      event_type: 'event_created'
    })
  });
  assert.equal(postEvent.status, 200);

  const search = await requestJson<{ results: Array<{ type?: string; title: string; id: string }> }>(
    '/api/lisa/search?q=event_ingested&limit=40'
  );
  assert.equal(search.status, 200);
  assert.equal(
    search.body.results.some((item) => item.type === 'replay' && item.title.includes('event_ingested')),
    true
  );
});
