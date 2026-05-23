import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { resetLisaStore } = await import('../src/lisa.ts');

let server: Server;
let baseUrl: string;

function randomEventId(prefix: string, entityId: string): string {
  return `${prefix}-${entityId}-${Date.now()}`;
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
});

beforeEach(() => {
  resetLisaStore();
});

test('empty LISA store returns empty daily sections', async () => {
  const response = await requestJson<{
    sections: {
      changed: unknown[];
      needs_attention: unknown[];
      waiting: unknown[];
      stale: unknown[];
      suggested_next_steps: unknown[];
    };
  }>('/api/daily');

  assert.equal(response.status, 200);
  assert.equal(response.body.sections.changed.length, 0);
  assert.equal(response.body.sections.needs_attention.length, 0);
  assert.equal(response.body.sections.waiting.length, 0);
  assert.equal(response.body.sections.stale.length, 0);
  assert.equal(response.body.sections.suggested_next_steps.length, 0);
});

test('POST /api/events/tradescout creates a record', async () => {
  const entityId = randomEventId('contractor', 'alpha');
  const response = await requestJson<{ status: string; signal_id: string }>('/api/events/tradescout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      entity_type: 'contractor',
      event_type: 'contractor_claim',
      title: 'Verification upload',
      summary: 'Contractor uploaded verification docs',
      review_required: false
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(typeof response.body.signal_id, 'string');
});

test('entity state reflects the posted TradeScout event', async () => {
  const entityId = randomEventId('contractor', 'beta');
  const postResponse = await requestJson<{ status: string; signal_id: string }>('/api/events/tradescout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      entity_type: 'contractor',
      event_type: 'contractor_claim'
    })
  });
  assert.equal(postResponse.status, 200);

  const stateResponse = await requestJson<{
    entity_id: string;
    entity_type: string;
    brand_lane: string;
    current_state: string;
    source_refs: string[];
  }>(`/api/entities/${encodeURIComponent(entityId)}/state`);

  assert.equal(stateResponse.status, 200);
  assert.equal(stateResponse.body.entity_id, entityId);
  assert.equal(stateResponse.body.entity_type, 'contractor');
  assert.equal(stateResponse.body.brand_lane, 'TradeScout');
  assert.equal(stateResponse.body.current_state, 'active');
  assert.equal(stateResponse.body.source_refs.includes(`tradescout:${entityId}`), true);
});

test('timeline reflects the posted TradeScout event', async () => {
  const entityId = randomEventId('contractor', 'gamma');
  const postResponse = await requestJson<{ status: string; signal_id: string }>('/api/events/tradescout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      event_type: 'support_request',
      title: 'Aging customer response',
      review_required: true
    })
  });
  assert.equal(postResponse.status, 200);

  const timelineResponse = await requestJson<{ entity_id: string; timeline: Array<{ entity_id: string; id: string; signal_type: string }> }>(
    `/api/entities/${encodeURIComponent(entityId)}/timeline`
  );

  assert.equal(timelineResponse.status, 200);
  assert.equal(timelineResponse.body.entity_id, entityId);
  assert.equal(Array.isArray(timelineResponse.body.timeline), true);
  assert.equal(timelineResponse.body.timeline.length, 1);
  assert.equal(timelineResponse.body.timeline[0].entity_id, entityId);
  assert.equal(timelineResponse.body.timeline[0].signal_type, 'support_request');
});

test('recent changes reflects the posted TradeScout event', async () => {
  const entityId = randomEventId('contractor', 'delta');
  const response = await requestJson<{ status: string; signal_id: string }>('/api/events/tradescout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      event_type: 'support_request',
      review_required: true
    })
  });
  assert.equal(response.status, 200);

  const changesResponse = await requestJson<{ changes: Array<{ entity_id: string; id: string; source: string }> }>(
    '/api/changes/recent'
  );

  assert.equal(changesResponse.status, 200);
  assert.equal(changesResponse.body.changes.length >= 1, true);
  assert.equal(changesResponse.body.changes[0].entity_id, entityId);
});

test('Merlin Daily reflects real activity from LISA', async () => {
  const entityId = randomEventId('contractor', 'epsilon');
  const response = await requestJson<{ status: string; signal_id: string }>('/api/events/tradescout', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: entityId,
      event_type: 'contractor_claim',
      title: 'Verified profile changed',
      summary: 'Contractor uploaded verification docs'
    })
  });
  assert.equal(response.status, 200);

  const dailyResponse = await requestJson<{
    sections: {
      changed: Array<{ id: string; source_refs: string[] }>;
      needs_attention: Array<{ id: string }>;
      waiting: Array<{ id: string }>;
      stale: Array<{ id: string }>;
      suggested_next_steps: Array<{ id: string }>;
    };
  }>('/api/daily');

  assert.equal(dailyResponse.status, 200);
  assert.equal(dailyResponse.body.sections.changed.length, 1);
  assert.equal(dailyResponse.body.sections.changed[0].source_refs.includes(`tradescout:${entityId}`), true);
});
