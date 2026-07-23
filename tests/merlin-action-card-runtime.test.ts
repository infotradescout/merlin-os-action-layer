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
const { resetMerlinActionCardRuntimeForTest, closeMerlinActionCardRuntime } = await import('../src/merlin/actionCardRuntime.ts');

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
  closeMerlinActionCardRuntime();
  closeLisaStore();
  closeDriveManifestStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
  resetMerlinActionCardRuntimeForTest();
});

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    brand: 'tradescout',
    kpi: 'verified_connection_outcome',
    intent: 'verify contractor proof',
    source_of_truth: 'drive_manifest:abc123',
    required_real_data: ['license_doc', 'insurance_doc'],
    tool: 'drive',
    action: 'approve_verification',
    permission_level: 'level_2',
    fail_safes: ['requires_approval'],
    output_location: 'tradescout.review_queue',
    source_refs: ['drive://abc123'],
    ...overrides
  };
}

test('create/list/detail/decision/history flow persists with policy result', async () => {
  const created = await requestJson<{ card: { id: string; status: string; policy_result: { requires_approval: boolean }; source_of_truth: string } }>(
    '/api/merlin/action-cards',
    {
      method: 'POST',
      body: JSON.stringify(validPayload())
    }
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.card.source_of_truth, 'drive_manifest:abc123');
  assert.equal(created.body.card.policy_result.requires_approval, true);
  assert.equal(created.body.card.status, 'action_card_generated');

  const list = await requestJson<{ cards: Array<{ id: string }> }>('/api/merlin/action-cards?brand=tradescout');
  assert.equal(list.status, 200);
  assert.equal(list.body.cards.some((row) => row.id === created.body.card.id), true);

  const detail = await requestJson<{ card: { id: string; status: string } }>(`/api/merlin/action-cards/${encodeURIComponent(created.body.card.id)}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.card.id, created.body.card.id);

  const decision = await requestJson<{ card: { status: string } }>(`/api/merlin/action-cards/${encodeURIComponent(created.body.card.id)}/decision`, {
    method: 'PATCH',
    body: JSON.stringify({ decision: 'approved', reason: 'ready', decided_by: 'admin-1' })
  });
  assert.equal(decision.status, 200);
  assert.equal(decision.body.card.status, 'approved');

  const history = await requestJson<{ history: Array<{ event_type: string; status: string }> }>(
    `/api/merlin/action-cards/${encodeURIComponent(created.body.card.id)}/history`
  );
  assert.equal(history.status, 200);
  assert.equal(history.body.history.some((row) => row.event_type === 'created'), true);
  assert.equal(history.body.history.some((row) => row.event_type === 'decision' && row.status === 'approved'), true);
});

test('unknown and high-risk actions remain blocked', async () => {
  const unknown = await requestJson<{ card: { status: string; policy_result: { blocked: boolean; level: string } } }>(
    '/api/merlin/action-cards',
    { method: 'POST', body: JSON.stringify(validPayload({ action: 'nonexistent_action' })) }
  );
  assert.equal(unknown.status, 201);
  assert.equal(unknown.body.card.status, 'blocked');
  assert.equal(unknown.body.card.policy_result.blocked, true);
  assert.equal(unknown.body.card.policy_result.level, 'blocked_high_risk');

  const financial = await requestJson<{ card: { status: string; policy_result: { blocked: boolean } } }>(
    '/api/merlin/action-cards',
    { method: 'POST', body: JSON.stringify(validPayload({ action: 'change_payment_state', brand: 'mealscout' })) }
  );
  assert.equal(financial.status, 201);
  assert.equal(financial.body.card.status, 'blocked');
  assert.equal(financial.body.card.policy_result.blocked, true);
});

test('external send requires approval policy and search includes action cards', async () => {
  const created = await requestJson<{ card: { id: string; policy_result: { requires_approval: boolean } } }>('/api/merlin/action-cards', {
    method: 'POST',
    body: JSON.stringify(validPayload({ action: 'send_external_message', brand: 'merlin', kpi: 'action_completed' }))
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.card.policy_result.requires_approval, true);

  const search = await requestJson<{ results: Array<{ id: string; source: string }> }>('/api/search?q=external');
  assert.equal(search.status, 200);
  assert.equal(search.body.results.some((row) => row.id === created.body.card.id && row.source === 'merlin_action_card'), true);
});

test('validation rejects malformed payload and invalid decision', async () => {
  const badCreate = await requestJson<{ error: string }>('/api/merlin/action-cards', {
    method: 'POST',
    body: JSON.stringify({ brand: 'tradescout' })
  });
  assert.equal(badCreate.status, 400);

  const created = await requestJson<{ card: { id: string } }>('/api/merlin/action-cards', {
    method: 'POST',
    body: JSON.stringify(validPayload())
  });
  assert.equal(created.status, 201);
  const badDecision = await requestJson<{ error: string }>(`/api/merlin/action-cards/${encodeURIComponent(created.body.card.id)}/decision`, {
    method: 'PATCH',
    body: JSON.stringify({ decision: 'execute_now' })
  });
  assert.equal(badDecision.status, 400);
});
