import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');
const { closeMerlinActionCardRuntime, resetMerlinActionCardRuntimeForTest } = await import('../src/merlin/actionCardRuntime.ts');
const { closeMerlinIntakeRuntime, resetMerlinIntakeRuntimeForTest } = await import('../src/merlin/intakeRuntime.ts');

let server: Server;
let baseUrl = '';

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    ...init
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T };
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    brand_lane: 'mealscout',
    source_type: 'drive',
    source_reference: 'drive://file-123',
    origin_surface: 'admin_review_queue',
    intent_text: 'update menu from screenshot',
    raw_text: 'special tacos and fries',
    extracted_fields: { businessName: 'Lettys Backyard' },
    confidence: 0.84,
    required_real_data: ['menu_photo'],
    ...overrides
  };
}

before(async () => {
  server = createMerlinServer();
  await new Promise<void>((resolveStart, reject) => {
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Server did not bind to numeric port'));
        return;
      }
      baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
      resolveStart();
    });
  });
});

after(async () => {
  await new Promise<void>((resolveStop) => server.close(() => resolveStop()));
  closeMerlinIntakeRuntime();
  closeMerlinActionCardRuntime();
  closeLisaStore();
  closeDriveManifestStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
  resetMerlinIntakeRuntimeForTest();
  resetMerlinActionCardRuntimeForTest();
});

test('create/list/get/status/history flow persists intake records', async () => {
  const created = await requestJson<{ intake: { id: string; status: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify(validPayload())
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.intake.status, 'received');

  const list = await requestJson<{ items: Array<{ id: string }> }>('/api/merlin/intake?brand_lane=mealscout');
  assert.equal(list.status, 200);
  assert.equal(list.body.items.some((item) => item.id === created.body.intake.id), true);

  const detail = await requestJson<{ intake: { id: string }; actionCardLinks: unknown[] }>(`/api/merlin/intake/${encodeURIComponent(created.body.intake.id)}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.intake.id, created.body.intake.id);
  assert.equal(Array.isArray(detail.body.actionCardLinks), true);

  const patched = await requestJson<{ intake: { status: string } }>(`/api/merlin/intake/${encodeURIComponent(created.body.intake.id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'classified', reason: 'ocr complete' })
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.intake.status, 'classified');

  const history = await requestJson<{ history: Array<{ event_type: string; status: string }> }>(
    `/api/merlin/intake/${encodeURIComponent(created.body.intake.id)}/history`
  );
  assert.equal(history.status, 200);
  assert.equal(history.body.history.some((row) => row.event_type === 'created'), true);
  assert.equal(history.body.history.some((row) => row.event_type === 'status_updated' && row.status === 'classified'), true);
});

test('validation blocks bad payload and missing source reference', async () => {
  const missingBrand = await requestJson<{ error: string }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify({ source_type: 'drive', source_reference: 'x', intent_text: 'y' })
  });
  assert.equal(missingBrand.status, 400);
  assert.equal(missingBrand.body.error, 'validation_error');

  const missingText = await requestJson<{ error: string }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify({ brand_lane: 'mealscout', source_type: 'drive', source_reference: 'x' })
  });
  assert.equal(missingText.status, 400);

  const created = await requestJson<{ intake: { id: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify(validPayload({ source_reference: '' }))
  });
  assert.equal(created.status, 400);
});

test('action-card generation uses slice1 runtime and inherits source_of_truth', async () => {
  const created = await requestJson<{ intake: { id: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify(validPayload())
  });
  assert.equal(created.status, 201);

  const generated = await requestJson<{
    cards: Array<{ id: string; source_of_truth: string; policy_result: { level: string; blocked: boolean } }>;
    intake: { status: string };
  }>(`/api/merlin/intake/${encodeURIComponent(created.body.intake.id)}/action-cards`, {
    method: 'POST'
  });
  assert.equal(generated.status, 200);
  assert.equal(generated.body.intake.status, 'action_cards_generated');
  assert.equal(generated.body.cards.length > 0, true);
  assert.equal(generated.body.cards[0].source_of_truth, 'drive://file-123');
  assert.equal(typeof generated.body.cards[0].policy_result.level, 'string');

  const search = await requestJson<{ results: Array<{ source: string; id: string }> }>('/api/search?q=menu');
  assert.equal(search.status, 200);
  assert.equal(search.body.results.some((row) => row.source === 'merlin_intake_item'), true);
  assert.equal(search.body.results.some((row) => row.source === 'merlin_action_card'), true);
});

test('unsupported brand blocks action card generation and no connector execution endpoints are exposed', async () => {
  const created = await requestJson<{ intake: { id: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify(validPayload({ brand_lane: 'unknownlane' }))
  });
  assert.equal(created.status, 201);

  const generated = await requestJson<{ error: string }>(`/api/merlin/intake/${encodeURIComponent(created.body.intake.id)}/action-cards`, {
    method: 'POST'
  });
  assert.equal(generated.status, 409);
  assert.equal(generated.body.error, 'unsupported_brand_lane');

  const connectorExec = await requestJson<Record<string, unknown>>('/api/merlin/intake/connector-execute', { method: 'POST', body: '{}' });
  assert.equal(connectorExec.status, 404);
});
