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
const { closeMerlinExecutionPlanRuntime, resetMerlinExecutionPlanRuntimeForTest } = await import('../src/merlin/executionPlanRuntime.ts');
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
  const created = await requestJson<{ card: { id: string } }>('/api/merlin/action-cards', {
    method: 'POST',
    body: JSON.stringify({
      brand: 'mealscout',
      kpi: 'execution_plan_kpi',
      intent: 'send profile link',
      source_of_truth: 'drive://execution-source',
      required_real_data: ['approval', 'source_evidence'],
      tool: 'gmail',
      action: 'send_external_message',
      permission_level: 'level_2',
      fail_safes: ['dry_run_only'],
      output_location: 'gmail.draft',
      source_refs: ['drive://execution-source'],
      entity_id: 'entity-exec-1',
      ...overrides
    })
  });
  assert.equal(created.status, 201);
  return created.body.card.id;
}

async function approveCard(cardId: string) {
  const requested = await requestJson<{ approval: { id: string } }>('/api/merlin/approvals/request', {
    method: 'POST',
    body: JSON.stringify({ action_card_id: cardId })
  });
  assert.equal(requested.status, 201);
  const approved = await requestJson<{ approval: { id: string; approval_status: string } }>(
    `/api/merlin/approvals/${encodeURIComponent(requested.body.approval.id)}/decision`,
    {
      method: 'PATCH',
      body: JSON.stringify({ decision: 'approved', decided_by: 'operator@example.com', reason: 'Real source verified' })
    }
  );
  assert.equal(approved.status, 200);
  assert.equal(approved.body.approval.approval_status, 'approved');
  return approved.body.approval.id;
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
  closeMerlinExecutionPlanRuntime();
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
  resetMerlinExecutionPlanRuntimeForTest();
  resetMerlinApprovalRuntimeForTest();
  resetMerlinOutcomeRuntimeForTest();
  resetMerlinEntityMemoryRuntimeForTest();
  resetMerlinIntakeRuntimeForTest();
  resetMerlinActionCardRuntimeForTest();
});

test('unapproved approval-required card creates blocked dry-run plan', async () => {
  const cardId = await createCard();
  const created = await requestJson<{ executionPlan: { action_card_id: string; execution_status: string; execution_mode: string; eligibility_reason: string } }>(
    '/api/merlin/execution-plans',
    { method: 'POST', body: JSON.stringify({ action_card_id: cardId }) }
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.executionPlan.action_card_id, cardId);
  assert.equal(created.body.executionPlan.execution_status, 'blocked');
  assert.equal(created.body.executionPlan.execution_mode, 'dry_run');
  assert.equal(created.body.executionPlan.eligibility_reason, 'approval_required');
});

test('approved card creates eligible plan with safe deterministic payload', async () => {
  const cardId = await createCard();
  const approvalId = await approveCard(cardId);
  const created = await requestJson<{
    executionPlan: {
      approval_id?: string;
      execution_status: string;
      payload: Record<string, unknown>;
      source_refs: string[];
    };
  }>('/api/merlin/execution-plans', {
    method: 'POST',
    body: JSON.stringify({ action_card_id: cardId })
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.executionPlan.approval_id, approvalId);
  assert.equal(created.body.executionPlan.execution_status, 'eligible');
  assert.equal(created.body.executionPlan.payload.dryRun, true);
  assert.equal(created.body.executionPlan.payload.tool, 'gmail');
  assert.equal(created.body.executionPlan.payload.action, 'send_external_message');
  assert.equal(Object.prototype.hasOwnProperty.call(created.body.executionPlan.payload, 'recipient'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(created.body.executionPlan.payload, 'messageBody'), false);
  assert.deepEqual(created.body.executionPlan.source_refs, ['drive://execution-source']);
});

test('policy-blocked card creates blocked plan', async () => {
  const cardId = await createCard({ action: 'change_payment_state', tool: 'stripe', permission_level: 'level_4' });
  const created = await requestJson<{ executionPlan: { execution_status: string; eligibility_reason: string; payload: Record<string, unknown> } }>(
    '/api/merlin/execution-plans',
    { method: 'POST', body: JSON.stringify({ action_card_id: cardId }) }
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.executionPlan.execution_status, 'blocked');
  assert.equal(created.body.executionPlan.eligibility_reason, 'policy_blocked');
  assert.equal(created.body.executionPlan.payload.dryRun, true);
});

test('status update writes history and list/detail work', async () => {
  const cardId = await createCard();
  await approveCard(cardId);
  const created = await requestJson<{ executionPlan: { id: string } }>('/api/merlin/execution-plans', {
    method: 'POST',
    body: JSON.stringify({ action_card_id: cardId })
  });
  assert.equal(created.status, 201);

  const patched = await requestJson<{ executionPlan: { execution_status: string } }>(
    `/api/merlin/execution-plans/${encodeURIComponent(created.body.executionPlan.id)}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'executed_dry_run', reason: 'dry-run inspected' })
    }
  );
  assert.equal(patched.status, 200);
  assert.equal(patched.body.executionPlan.execution_status, 'executed_dry_run');

  const history = await requestJson<{ history: Array<{ event_type: string; execution_status: string }> }>(
    `/api/merlin/execution-plans/${encodeURIComponent(created.body.executionPlan.id)}/history`
  );
  assert.equal(history.status, 200);
  assert.equal(history.body.history.some((row) => row.event_type === 'status_updated' && row.execution_status === 'executed_dry_run'), true);

  const list = await requestJson<{ executionPlans: unknown[] }>('/api/merlin/execution-plans?brand_lane=mealscout');
  assert.equal(list.status, 200);
  assert.equal(list.body.executionPlans.length >= 1, true);
});

test('operator console and search include execution plans; no connector execution path exists', async () => {
  const blockedCard = await createCard();
  await requestJson('/api/merlin/execution-plans', { method: 'POST', body: JSON.stringify({ action_card_id: blockedCard }) });
  const eligibleCard = await createCard();
  await approveCard(eligibleCard);
  await requestJson('/api/merlin/execution-plans', { method: 'POST', body: JSON.stringify({ action_card_id: eligibleCard }) });

  const console = await requestJson<{
    summary: { executionPlanEligibleCount: number; executionPlanBlockedCount: number; executionPlanDryRunCount: number };
    attention: { blockedExecutionPlans: unknown[]; eligibleExecutionPlans: unknown[] };
  }>('/api/merlin/operator-console?brand_lane=mealscout');
  assert.equal(console.status, 200);
  assert.equal(console.body.summary.executionPlanEligibleCount >= 1, true);
  assert.equal(console.body.summary.executionPlanBlockedCount >= 1, true);
  assert.equal(console.body.summary.executionPlanDryRunCount >= 2, true);
  assert.equal(console.body.attention.blockedExecutionPlans.length >= 1, true);
  assert.equal(console.body.attention.eligibleExecutionPlans.length >= 1, true);

  const search = await requestJson<{ results: Array<{ source: string }> }>('/api/search?q=eligible');
  assert.equal(search.status, 200);
  assert.equal(search.body.results.some((row) => row.source === 'merlin_execution_plan'), true);

  const exec = await requestJson<Record<string, unknown>>('/api/merlin/execution-plans/execute', { method: 'POST', body: '{}' });
  assert.equal(exec.status, 404);
});
