import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-v1-1-'));
process.env.MERLIN_DB_PATH = resolve(tempDir, 'merlin-or.sqlite');
process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeAllMerlinStoresForTest } = await import('./testSupport/closeAllStores.ts');

let server: Server;
let baseUrl: string;
const demoEntityId = 'business_demo_001';

type Approval = {
  id: string;
  status: 'pending' | 'approved' | 'dismissed' | 'completed' | 'failed' | 'expired';
  entity_id: string;
};

type TimelineItem = {
  id: string;
  entity_id: string;
  signal_type: string;
};

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
  closeAllMerlinStoresForTest();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
});

beforeEach(async () => {
  await requestJson<{ status: string }>('/api/demo/reset', { method: 'POST' });
});

test('demo reset endpoint returns empty daily state', async () => {
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

test('demo seed creates recent changes', async () => {
  const seedResponse = await requestJson<{
    status: string;
    signals: string[];
  }>('/api/demo/seed-tradescout-loop', { method: 'POST' });
  assert.equal(seedResponse.status, 200);
  assert.equal(seedResponse.body.status, 'ok');
  assert.equal(seedResponse.body.signals.length > 0, true);

  const changes = await requestJson<{
    changes: Array<{ entity_id: string; signal_id: string }>;
  }>('/api/changes/recent');
  assert.equal(changes.status, 200);
  assert.equal(changes.body.changes.length >= 6, true);
  assert.equal(changes.body.changes.some((change) => change.entity_id === demoEntityId), true);
});

test('demo seed creates entity state', async () => {
  await requestJson('/api/demo/seed-tradescout-loop', { method: 'POST' });

  const state = await requestJson<{
    entity_id: string;
    entity_type: string;
    current_state: string;
  }>(`/api/entities/${encodeURIComponent(demoEntityId)}/state`);

  assert.equal(state.status, 200);
  assert.equal(state.body.entity_id, demoEntityId);
  assert.equal(typeof state.body.current_state, 'string');
});

test('demo seed creates entity timeline rows', async () => {
  await requestJson('/api/demo/seed-tradescout-loop', { method: 'POST' });

  const timeline = await requestJson<{ entity_id: string; timeline: TimelineItem[] }>(
    `/api/entities/${encodeURIComponent(demoEntityId)}/timeline`
  );

  assert.equal(timeline.status, 200);
  assert.equal(timeline.body.entity_id, demoEntityId);
  assert.equal(timeline.body.timeline.length >= 6, true);
  assert.equal(timeline.body.timeline.every((item) => item.entity_id === demoEntityId), true);
});

test('demo seed creates Merlin Daily sections', async () => {
  await requestJson('/api/demo/seed-tradescout-loop', { method: 'POST' });

  const daily = await requestJson<{
    sections: {
      changed: unknown[];
      needs_attention: unknown[];
      waiting: unknown[];
      stale: unknown[];
      suggested_next_steps: unknown[];
    };
  }>('/api/daily');

  assert.equal(daily.status, 200);
  assert.equal(daily.body.sections.changed.length >= 1, true);
  assert.equal(daily.body.sections.needs_attention.length >= 1, true);
  assert.equal(daily.body.sections.suggested_next_steps.length >= 1, true);
});

test('demo seed creates replay events', async () => {
  await requestJson('/api/demo/seed-tradescout-loop', { method: 'POST' });

  const replay = await requestJson<{
    replay_events: Array<{
      id: string;
      event_type:
        | 'event_ingested'
        | 'state_updated'
        | 'recommendation_created'
        | 'policy_evaluated'
        | 'recommendation_status_updated'
        | 'outcome_recorded'
        | 'outcome_linked'
        | 'daily_generated';
      entity_id?: string;
      signal_id?: string;
      summary: string;
    }>;
  }>('/api/replay/recent');

  assert.equal(replay.status, 200);
  assert.equal(replay.body.replay_events.length >= 6, true);
  assert.equal(
    replay.body.replay_events.some((event) => event.event_type === 'event_ingested'),
    true
  );
  assert.equal(
    replay.body.replay_events.some((event) => event.event_type === 'recommendation_created'),
    true
  );
});

test('demo seed creates pending approvals when policy requires approval', async () => {
  await requestJson('/api/demo/seed-tradescout-loop', { method: 'POST' });

  const approvals = await requestJson<{ approvals: Approval[] }>(
    '/api/approvals?status=pending'
  );

  assert.equal(approvals.status, 200);
  assert.equal(Array.isArray(approvals.body.approvals), true);
  assert.equal(approvals.body.approvals.length >= 1, true);
  assert.equal(approvals.body.approvals.every((item) => item.entity_id === demoEntityId), true);
  assert.equal(approvals.body.approvals.every((item) => item.status === 'pending'), true);
});

test('demo reset clears seeded data', async () => {
  await requestJson('/api/demo/seed-tradescout-loop', { method: 'POST' });

  const seededChanges = await requestJson<{ changes: unknown[] }>('/api/changes/recent');
  assert.equal(seededChanges.body.changes.length >= 6, true);

  await requestJson('/api/demo/reset', { method: 'POST' });

  const changes = await requestJson<{ changes: unknown[] }>('/api/changes/recent');
  assert.equal(changes.status, 200);
  assert.equal(changes.body.changes.length, 0);

  const state = await requestJson<{ error?: string }>(`/api/entities/${encodeURIComponent(demoEntityId)}/state`);
  assert.equal(state.status, 404);
  assert.equal(state.body.error, 'Entity not found');

  const timeline = await requestJson<{ timeline: unknown[] }>(
    `/api/entities/${encodeURIComponent(demoEntityId)}/timeline`
  );
  assert.equal(timeline.status, 200);
  assert.equal(timeline.body.timeline.length, 0);

  const approvals = await requestJson<{ approvals: unknown[] }>(
    '/api/approvals?status=pending'
  );
  assert.equal(approvals.status, 200);
  assert.equal(approvals.body.approvals.length, 0);
});
