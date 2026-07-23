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
const { closeMerlinConnectorAdapterRuntime, resetMerlinConnectorAdapterRuntimeForTest } = await import('../src/merlin/connectorAdapterRuntime.ts');
const { closeMerlinDryRunExecutorRuntime, resetMerlinDryRunExecutorRuntimeForTest } = await import('../src/merlin/dryRunExecutorRuntime.ts');
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
      kpi: 'dry_run_kpi',
      intent: 'send profile link',
      source_of_truth: 'drive://dry-run-source',
      required_real_data: ['approval', 'source_evidence'],
      tool: 'Gmail',
      action: 'send_external_message',
      permission_level: 'level_2',
      fail_safes: ['dry_run_only'],
      output_location: 'gmail.draft',
      source_refs: ['drive://dry-run-source'],
      entity_id: 'entity-dry-run-1',
      ...overrides
    })
  });
  assert.equal(created.status, 201);
  return created.body.card.id;
}

async function createEligiblePlan() {
  const cardId = await createCard();
  const approval = await requestJson<{ approval: { id: string } }>('/api/merlin/approvals/request', {
    method: 'POST',
    body: JSON.stringify({ action_card_id: cardId })
  });
  assert.equal(approval.status, 201);
  const decision = await requestJson(`/api/merlin/approvals/${encodeURIComponent(approval.body.approval.id)}/decision`, {
    method: 'PATCH',
    body: JSON.stringify({ decision: 'approved', decided_by: 'operator@example.com', reason: 'Real source verified' })
  });
  assert.equal(decision.status, 200);
  const plan = await requestJson<{ executionPlan: { id: string } }>('/api/merlin/execution-plans', {
    method: 'POST',
    body: JSON.stringify({ action_card_id: cardId })
  });
  assert.equal(plan.status, 201);
  return { planId: plan.body.executionPlan.id, cardId };
}

async function createBlockedPlan() {
  const cardId = await createCard();
  const plan = await requestJson<{ executionPlan: { id: string } }>('/api/merlin/execution-plans', {
    method: 'POST',
    body: JSON.stringify({ action_card_id: cardId })
  });
  assert.equal(plan.status, 201);
  return plan.body.executionPlan.id;
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
  closeMerlinDryRunExecutorRuntime();
  closeMerlinConnectorAdapterRuntime();
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
  resetMerlinDryRunExecutorRuntimeForTest();
  resetMerlinConnectorAdapterRuntimeForTest();
  resetMerlinExecutionPlanRuntimeForTest();
  resetMerlinApprovalRuntimeForTest();
  resetMerlinOutcomeRuntimeForTest();
  resetMerlinEntityMemoryRuntimeForTest();
  resetMerlinIntakeRuntimeForTest();
  resetMerlinActionCardRuntimeForTest();
});

test('dry-run execution persists, links to plan, and marks plan executed_dry_run', async () => {
  const { planId, cardId } = await createEligiblePlan();
  const check = await requestJson<{ check: { id: string } }>(`/api/merlin/execution-plans/${encodeURIComponent(planId)}/adapter-check`, { method: 'POST' });
  assert.equal(check.status, 201);
  const created = await requestJson<{
    dryRunExecution: {
      id: string;
      execution_plan_id: string;
      adapter_check_id: string;
      action_card_id: string;
      dry_run_status: string;
      suggested_outcome_type: string;
      simulated_result: { externalMutation: boolean; wouldExecute: boolean; payloadSummary: Record<string, unknown> };
    };
  }>('/api/merlin/dry-run-executions', {
    method: 'POST',
    body: JSON.stringify({ execution_plan_id: planId })
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.dryRunExecution.execution_plan_id, planId);
  assert.equal(created.body.dryRunExecution.adapter_check_id, check.body.check.id);
  assert.equal(created.body.dryRunExecution.action_card_id, cardId);
  assert.equal(created.body.dryRunExecution.dry_run_status, 'simulated');
  assert.equal(created.body.dryRunExecution.simulated_result.externalMutation, false);
  assert.equal(created.body.dryRunExecution.simulated_result.wouldExecute, true);
  assert.equal(created.body.dryRunExecution.suggested_outcome_type, 'external_reply_received');

  const plan = await requestJson<{ executionPlan: { execution_status: string } }>(`/api/merlin/execution-plans/${encodeURIComponent(planId)}`);
  assert.equal(plan.body.executionPlan.execution_status, 'executed_dry_run');
});

test('dry-run requires passing adapter check and eligible plan', async () => {
  const { planId } = await createEligiblePlan();
  const noCheck = await requestJson<{ error: string }>('/api/merlin/dry-run-executions', {
    method: 'POST',
    body: JSON.stringify({ execution_plan_id: planId })
  });
  assert.equal(noCheck.status, 409);
  assert.equal(noCheck.body.error, 'adapter_check_required');

  const blockedPlanId = await createBlockedPlan();
  await requestJson(`/api/merlin/execution-plans/${encodeURIComponent(blockedPlanId)}/adapter-check`, { method: 'POST' });
  const blocked = await requestJson<{ error: string }>('/api/merlin/dry-run-executions', {
    method: 'POST',
    body: JSON.stringify({ execution_plan_id: blockedPlanId })
  });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, 'adapter_check_blocked');
});

test('status update writes history and list/detail work', async () => {
  const { planId } = await createEligiblePlan();
  await requestJson(`/api/merlin/execution-plans/${encodeURIComponent(planId)}/adapter-check`, { method: 'POST' });
  const created = await requestJson<{ dryRunExecution: { id: string } }>('/api/merlin/dry-run-executions', {
    method: 'POST',
    body: JSON.stringify({ execution_plan_id: planId })
  });
  assert.equal(created.status, 201);
  const patched = await requestJson<{ dryRunExecution: { dry_run_status: string } }>(
    `/api/merlin/dry-run-executions/${encodeURIComponent(created.body.dryRunExecution.id)}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled', reason: 'operator cancelled simulation' })
    }
  );
  assert.equal(patched.status, 200);
  assert.equal(patched.body.dryRunExecution.dry_run_status, 'cancelled');

  const history = await requestJson<{ history: Array<{ event_type: string; dry_run_status: string }> }>(
    `/api/merlin/dry-run-executions/${encodeURIComponent(created.body.dryRunExecution.id)}/history`
  );
  assert.equal(history.status, 200);
  assert.equal(history.body.history.some((row) => row.event_type === 'status_updated' && row.dry_run_status === 'cancelled'), true);

  const list = await requestJson<{ dryRunExecutions: unknown[] }>('/api/merlin/dry-run-executions?brand_lane=mealscout');
  assert.equal(list.status, 200);
  assert.equal(list.body.dryRunExecutions.length >= 1, true);
});

test('operator console and search include dry-runs; no connector execution path exists', async () => {
  const { planId } = await createEligiblePlan();
  await requestJson(`/api/merlin/execution-plans/${encodeURIComponent(planId)}/adapter-check`, { method: 'POST' });
  await requestJson('/api/merlin/dry-run-executions', {
    method: 'POST',
    body: JSON.stringify({ execution_plan_id: planId })
  });

  const console = await requestJson<{
    summary: { dryRunSimulatedCount: number; dryRunBlockedCount: number };
    attention: { recentDryRunExecutions: unknown[]; blockedDryRunExecutions: unknown[] };
  }>('/api/merlin/operator-console?brand_lane=mealscout');
  assert.equal(console.status, 200);
  assert.equal(console.body.summary.dryRunSimulatedCount >= 1, true);
  assert.equal(console.body.summary.dryRunBlockedCount, 0);
  assert.equal(console.body.attention.recentDryRunExecutions.length >= 1, true);

  const search = await requestJson<{ results: Array<{ source: string }> }>('/api/search?q=external_reply_received');
  assert.equal(search.status, 200);
  assert.equal(search.body.results.some((row) => row.source === 'merlin_dry_run_execution'), true);

  const exec = await requestJson<Record<string, unknown>>('/api/merlin/dry-run-executions/execute', { method: 'POST', body: '{}' });
  assert.equal(exec.status, 404);
});
