import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeLisaStore, resetLisaStore } = await import('../src/lisa.ts');
const { resetApprovalQueueForTest } = await import('../src/approvalQueue.ts');
const { resetOutcomesForTest } = await import('../src/outcomes.ts');
const { resetRecommendationsForTest } = await import('../src/recommendations.ts');
const { resetReplayForTest } = await import('../src/replay.ts');

let server: Server;
let baseUrl: string;

function randomEntityId(entityType: string): string {
  return `${entityType}-ms-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
}

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
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Server did not bind to a numeric port'));
        return;
      }
      baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
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
  resetApprovalQueueForTest();
  resetRecommendationsForTest();
  resetOutcomesForTest();
  resetReplayForTest();
});

test('POST /api/events/mealscout creates a record', async () => {
  const entityId = randomEntityId('restaurant');
  const response = await requestJson<{ status: string; signal_id: string }>('/api/events/mealscout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      event_type: 'restaurant_onboarded',
      payload: {
        restaurant_name: 'Taco Bay',
        county: 'Tangipahoa'
      }
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(typeof response.body.signal_id, 'string');
});

test('MealScout event updates entity state', async () => {
  const entityId = randomEntityId('restaurant');
  const posted = await requestJson<{ status: string; signal_id: string }>('/api/events/mealscout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      event_type: 'vendor_onboarded'
    })
  });
  assert.equal(posted.status, 200);

  const state = await requestJson<{
    entity_id: string;
    entity_type: string;
    brand_lane: string;
    source_refs: string[];
  }>(`/api/entities/${encodeURIComponent(entityId)}/state`);

  assert.equal(state.status, 200);
  assert.equal(state.body.entity_id, entityId);
  assert.equal(state.body.brand_lane, 'MealScout');
  assert.equal(state.body.source_refs.includes(`mealscout:${entityId}`), true);
});

test('MealScout timeline reflects posted event', async () => {
  const entityId = randomEntityId('restaurant');
  const posted = await requestJson<{ status: string; signal_id: string }>('/api/events/mealscout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      event_type: 'parking_booking_started',
      title: 'Parking booking started'
    })
  });
  assert.equal(posted.status, 200);

  const timeline = await requestJson<{ entity_id: string; timeline: Array<{ entity_id: string; signal_type: string; source: string }> }>(
    `/api/entities/${encodeURIComponent(entityId)}/timeline`
  );
  assert.equal(timeline.status, 200);
  assert.equal(timeline.body.timeline.length >= 1, true);
  assert.equal(timeline.body.timeline[0].signal_type, 'parking_booking_started');
  assert.equal(timeline.body.timeline[0].source.includes('mealscout'), true);
});

test('MealScout recent changes include mealscout signal', async () => {
  const entityId = randomEntityId('restaurant');
  const posted = await requestJson<{ status: string; signal_id: string }>('/api/events/mealscout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      event_type: 'online_order_completed'
    })
  });
  assert.equal(posted.status, 200);

  const recent = await requestJson<{ changes: Array<{ source: string; entity_id: string }> }>(
    '/api/changes/recent?limit=10'
  );
  assert.equal(recent.status, 200);
  assert.equal(recent.body.changes.some((change) => change.entity_id === entityId && change.source.includes('mealscout')), true);
});

test('MealScout daily mapping puts completed order in changed section', async () => {
  const entityId = randomEntityId('restaurant');
  const posted = await requestJson<{ status: string; signal_id: string }>('/api/events/mealscout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      event_type: 'online_order_completed'
    })
  });
  assert.equal(posted.status, 200);

  const daily = await requestJson<{
    sections: {
      changed: Array<{ source_refs: string[] }>;
      needs_attention: Array<{ source_refs: string[] }>;
      waiting: Array<{ source_refs: string[] }>;
      stale: Array<{ source_refs: string[] }>;
      suggested_next_steps: Array<{ id: string }>;
    };
  }>('/api/daily');
  assert.equal(daily.status, 200);
  const inChanged = daily.body.sections.changed.some((item) =>
    item.source_refs.some((source) => source === `mealscout:${entityId}`)
  );
  assert.equal(inChanged, true);
});

test('MealScout replay events are recorded', async () => {
  const entityId = randomEntityId('restaurant');
  const posted = await requestJson<{ status: string; signal_id: string }>('/api/events/mealscout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      event_type: 'event_created'
    })
  });
  assert.equal(posted.status, 200);

  const replay = await requestJson<{ replay_events: Array<{ entity_id?: string; event_type: string; source_refs: string[] }> }>(
    '/api/replay/recent?limit=20'
  );
  assert.equal(replay.status, 200);
  const hasEventIngested = replay.body.replay_events.some(
    (event) => event.event_type === 'event_ingested' && event.entity_id === entityId
  );
  assert.equal(hasEventIngested, true);
});
