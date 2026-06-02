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
const { closeMerlinApprovalRuntime, resetMerlinApprovalRuntimeForTest } = await import('../src/merlin/approvalRuntime.ts');
const { closeMerlinOutcomeRuntime, resetMerlinOutcomeRuntimeForTest } = await import('../src/merlin/outcomeRuntime.ts');
const { closeMerlinEntityMemoryRuntime, resetMerlinEntityMemoryRuntimeForTest } = await import('../src/merlin/entityMemoryRuntime.ts');
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

async function createCard(overrides: Record<string, unknown> = {}) {
  const created = await requestJson<{ card: { id: string; status: string } }>('/api/merlin/action-cards', {
    method: 'POST',
    body: JSON.stringify({
      brand: 'mealscout',
      kpi: 'approval_gate_kpi',
      intent: 'approval gate action',
      source_of_truth: 'drive://approval-source',
      required_real_data: ['source_evidence'],
      tool: 'drive',
      action: 'send_external_message',
      permission_level: 'level_2',
      fail_safes: ['requires_approval'],
      output_location: 'merlin.approvals',
      source_refs: ['drive://approval-source'],
      entity_id: 'entity-approval-1',
      ...overrides
    })
  });
  assert.equal(created.status, 201);
  return created.body.card.id;
}

async function requestApproval(cardId: string, expiresAt?: string) {
  const created = await requestJson<{ approval: { id: string; approval_status: string } }>('/api/merlin/approvals/request', {
    method: 'POST',
    body: JSON.stringify({ action_card_id: cardId, expires_at: expiresAt })
  });
  assert.equal(created.status, 201);
  return created.body.approval.id;
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
  closeMerlinApprovalRuntime();
  closeMerlinOutcomeRuntime();
  closeMerlinEntityMemoryRuntime();
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
  resetMerlinApprovalRuntimeForTest();
  resetMerlinOutcomeRuntimeForTest();
  resetMerlinEntityMemoryRuntimeForTest();
  resetMerlinIntakeRuntimeForTest();
  resetMerlinActionCardRuntimeForTest();
});

test('approval request persists, links to action card, and starts as requested', async () => {
  const cardId = await createCard();
  const approvalId = await requestApproval(cardId);
  const detail = await requestJson<{ approval: { action_card_id: string; approval_status: string; brand_lane: string; kpi: string } }>(
    `/api/merlin/approvals/${encodeURIComponent(approvalId)}`
  );
  assert.equal(detail.status, 200);
  assert.equal(detail.body.approval.action_card_id, cardId);
  assert.equal(detail.body.approval.approval_status, 'requested');
  assert.equal(detail.body.approval.brand_lane, 'mealscout');
  assert.equal(detail.body.approval.kpi, 'approval_gate_kpi');

  const history = await requestJson<{ history: Array<{ event_type: string }> }>(`/api/merlin/approvals/${encodeURIComponent(approvalId)}/history`);
  assert.equal(history.status, 200);
  assert.equal(history.body.history.some((row) => row.event_type === 'requested'), true);
});

test('blocked policy creates blocked approval and cannot be approved directly', async () => {
  const cardId = await createCard({ action: 'change_payment_state', permission_level: 'level_4' });
  const approvalId = await requestApproval(cardId);
  const blocked = await requestJson<{ approval: { approval_status: string } }>(`/api/merlin/approvals/${encodeURIComponent(approvalId)}`);
  assert.equal(blocked.body.approval.approval_status, 'blocked');

  const decision = await requestJson<{ error: string }>(`/api/merlin/approvals/${encodeURIComponent(approvalId)}/decision`, {
    method: 'PATCH',
    body: JSON.stringify({ decision: 'approved', decided_by: 'operator@example.com', reason: 'try anyway' })
  });
  assert.equal(decision.status, 409);
});

test('approve/reject/revoke decisions update action-card status', async () => {
  const approvedCard = await createCard();
  const approved = await requestApproval(approvedCard);
  const approvedDecision = await requestJson<{ approval: { approval_status: string } }>(`/api/merlin/approvals/${encodeURIComponent(approved)}/decision`, {
    method: 'PATCH',
    body: JSON.stringify({ decision: 'approved', decided_by: 'operator@example.com', reason: 'Real source verified' })
  });
  assert.equal(approvedDecision.status, 200);
  assert.equal(approvedDecision.body.approval.approval_status, 'approved');
  const approvedCardState = await requestJson<{ card: { status: string } }>(`/api/merlin/action-cards/${encodeURIComponent(approvedCard)}`);
  assert.equal(approvedCardState.body.card.status, 'approved');

  const rejectedCard = await createCard();
  const rejected = await requestApproval(rejectedCard);
  await requestJson(`/api/merlin/approvals/${encodeURIComponent(rejected)}/decision`, {
    method: 'PATCH',
    body: JSON.stringify({ decision: 'rejected', reason: 'Insufficient source proof' })
  });
  const rejectedCardState = await requestJson<{ card: { status: string } }>(`/api/merlin/action-cards/${encodeURIComponent(rejectedCard)}`);
  assert.equal(rejectedCardState.body.card.status, 'rejected');

  const revokedCard = await createCard();
  const revoked = await requestApproval(revokedCard);
  await requestJson(`/api/merlin/approvals/${encodeURIComponent(revoked)}/decision`, {
    method: 'PATCH',
    body: JSON.stringify({ decision: 'revoked', reason: 'Operator pulled approval' })
  });
  const revokedCardState = await requestJson<{ card: { status: string } }>(`/api/merlin/action-cards/${encodeURIComponent(revokedCard)}`);
  assert.equal(revokedCardState.body.card.status, 'deferred');
});

test('approval-state blocks execution until approved and rejects expired approvals', async () => {
  const cardId = await createCard();
  const before = await requestJson<{ approvalState: { executionEligible: boolean; reason: string } }>(
    `/api/merlin/action-cards/${encodeURIComponent(cardId)}/approval-state`
  );
  assert.equal(before.status, 200);
  assert.equal(before.body.approvalState.executionEligible, false);
  assert.equal(before.body.approvalState.reason, 'approval_required');

  const approvalId = await requestApproval(cardId);
  await requestJson(`/api/merlin/approvals/${encodeURIComponent(approvalId)}/decision`, {
    method: 'PATCH',
    body: JSON.stringify({ decision: 'approved', decided_by: 'operator@example.com', reason: 'Real source verified' })
  });
  const after = await requestJson<{ approvalState: { executionEligible: boolean; reason: string } }>(
    `/api/merlin/action-cards/${encodeURIComponent(cardId)}/approval-state`
  );
  assert.equal(after.body.approvalState.executionEligible, true);
  assert.equal(after.body.approvalState.reason, 'approved');

  const expiredCardId = await createCard();
  await requestApproval(expiredCardId, '2000-01-01T00:00:00.000Z');
  const expired = await requestJson<{ approvalState: { executionEligible: boolean; reason: string; approvalStatus: string } }>(
    `/api/merlin/action-cards/${encodeURIComponent(expiredCardId)}/approval-state`
  );
  assert.equal(expired.body.approvalState.executionEligible, false);
  assert.equal(expired.body.approvalState.approvalStatus, 'expired');
});

test('operator console and search include approvals; no execution path exists', async () => {
  const cardId = await createCard();
  await requestApproval(cardId);
  const blockedCardId = await createCard({ action: 'change_payment_state', permission_level: 'level_4' });
  await requestApproval(blockedCardId);

  const console = await requestJson<{
    summary: { approvalRequestedCount: number; approvalBlockedCount: number };
    attention: { pendingApprovals: unknown[]; blockedApprovals: unknown[] };
  }>('/api/merlin/operator-console?brand_lane=mealscout');
  assert.equal(console.status, 200);
  assert.equal(console.body.summary.approvalRequestedCount >= 1, true);
  assert.equal(console.body.summary.approvalBlockedCount >= 1, true);
  assert.equal(console.body.attention.pendingApprovals.length >= 1, true);
  assert.equal(console.body.attention.blockedApprovals.length >= 1, true);

  const search = await requestJson<{ results: Array<{ source: string }> }>('/api/search?q=approval_gate');
  assert.equal(search.status, 200);
  assert.equal(search.body.results.some((row) => row.source === 'merlin_approval'), true);

  const exec = await requestJson<Record<string, unknown>>('/api/merlin/approvals/execute', { method: 'POST', body: '{}' });
  assert.equal(exec.status, 404);
});
