import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';

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
      kpi: 'adapter_contract_kpi',
      intent: 'send profile link',
      source_of_truth: 'drive://adapter-source',
      required_real_data: ['approval', 'source_evidence'],
      tool: 'Gmail',
      action: 'send_external_message',
      permission_level: 'level_2',
      fail_safes: ['dry_run_only'],
      output_location: 'gmail.draft',
      source_refs: ['drive://adapter-source'],
      entity_id: 'entity-adapter-1',
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
  const approved = await requestJson(`/api/merlin/approvals/${encodeURIComponent(requested.body.approval.id)}/decision`, {
    method: 'PATCH',
    body: JSON.stringify({ decision: 'approved', decided_by: 'operator@example.com', reason: 'Real source verified' })
  });
  assert.equal(approved.status, 200);
}

async function createPlan(status: 'eligible' | 'blocked' = 'eligible') {
  const cardId = await createCard();
  if (status === 'eligible') await approveCard(cardId);
  const created = await requestJson<{ executionPlan: { id: string } }>('/api/merlin/execution-plans', {
    method: 'POST',
    body: JSON.stringify({ action_card_id: cardId })
  });
  assert.equal(created.status, 201);
  return created.body.executionPlan.id;
}

function patchPlanPayload(planId: string, mutate: (payload: Record<string, unknown>) => Record<string, unknown>) {
  const db = new Database(resolve(process.cwd(), process.env.MERLIN_DB_PATH || './data/merlin-or.sqlite'));
  const row = db.prepare('SELECT payload_json FROM merlin_execution_plans WHERE id = ?').get(planId) as { payload_json: string };
  const payload = mutate(JSON.parse(row.payload_json) as Record<string, unknown>);
  db.prepare('UPDATE merlin_execution_plans SET payload_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(payload), new Date().toISOString(), planId);
  db.close();
}

function patchPlanToolAction(planId: string, tool: string, action: string) {
  const db = new Database(resolve(process.cwd(), process.env.MERLIN_DB_PATH || './data/merlin-or.sqlite'));
  db.prepare('UPDATE merlin_execution_plans SET tool = ?, action = ?, updated_at = ? WHERE id = ?').run(tool, action, new Date().toISOString(), planId);
  db.close();
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
  resetMerlinConnectorAdapterRuntimeForTest();
  resetMerlinExecutionPlanRuntimeForTest();
  resetMerlinApprovalRuntimeForTest();
  resetMerlinOutcomeRuntimeForTest();
  resetMerlinEntityMemoryRuntimeForTest();
  resetMerlinIntakeRuntimeForTest();
  resetMerlinActionCardRuntimeForTest();
});

test('default adapters seed and Stripe is not active/seeded', async () => {
  const list = await requestJson<{ adapters: Array<{ tool: string; action: string; execution_mode: string; adapter_status: string }> }>(
    '/api/merlin/connector-adapters'
  );
  assert.equal(list.status, 200);
  assert.equal(list.body.adapters.some((adapter) => adapter.tool === 'Gmail' && adapter.action === 'send_external_message'), true);
  assert.equal(list.body.adapters.some((adapter) => adapter.tool === 'GoogleDrive' && adapter.action === 'create'), true);
  assert.equal(list.body.adapters.every((adapter) => adapter.execution_mode === 'dry_run_only'), true);
  assert.equal(list.body.adapters.some((adapter) => adapter.tool.toLowerCase() === 'stripe'), false);
});

test('eligible dry-run plan passes adapter check and blocked plan fails', async () => {
  const eligiblePlanId = await createPlan('eligible');
  const pass = await requestJson<{ check: { check_status: string; reason: string } }>(
    `/api/merlin/execution-plans/${encodeURIComponent(eligiblePlanId)}/adapter-check`,
    { method: 'POST' }
  );
  assert.equal(pass.status, 201);
  assert.equal(pass.body.check.check_status, 'pass');
  assert.equal(pass.body.check.reason, 'adapter_contract_passed');

  const blockedPlanId = await createPlan('blocked');
  const blocked = await requestJson<{ check: { check_status: string; reason: string } }>(
    `/api/merlin/execution-plans/${encodeURIComponent(blockedPlanId)}/adapter-check`,
    { method: 'POST' }
  );
  assert.equal(blocked.status, 201);
  assert.equal(blocked.body.check.check_status, 'blocked');
  assert.equal(blocked.body.check.reason, 'execution_plan_blocked');
});

test('missing required field, forbidden field, and missing adapter are recorded', async () => {
  const missingPlan = await createPlan('eligible');
  patchPlanPayload(missingPlan, (payload) => {
    delete payload.source_of_truth;
    return payload;
  });
  const missing = await requestJson<{ check: { check_status: string; missing_fields: string[] } }>(
    `/api/merlin/execution-plans/${encodeURIComponent(missingPlan)}/adapter-check`,
    { method: 'POST' }
  );
  assert.equal(missing.body.check.check_status, 'missing_fields');
  assert.deepEqual(missing.body.check.missing_fields, ['source_of_truth']);

  const forbiddenPlan = await createPlan('eligible');
  patchPlanPayload(forbiddenPlan, (payload) => ({ ...payload, sendNow: true }));
  const forbidden = await requestJson<{ check: { check_status: string; forbidden_fields_found: string[] } }>(
    `/api/merlin/execution-plans/${encodeURIComponent(forbiddenPlan)}/adapter-check`,
    { method: 'POST' }
  );
  assert.equal(forbidden.body.check.check_status, 'forbidden_fields');
  assert.deepEqual(forbidden.body.check.forbidden_fields_found, ['sendNow']);

  const missingAdapterPlan = await createPlan('eligible');
  patchPlanToolAction(missingAdapterPlan, 'Stripe', 'charge');
  const missingAdapter = await requestJson<{ check: { check_status: string; reason: string } }>(
    `/api/merlin/execution-plans/${encodeURIComponent(missingAdapterPlan)}/adapter-check`,
    { method: 'POST' }
  );
  assert.equal(missingAdapter.body.check.check_status, 'adapter_not_found');
  assert.equal(missingAdapter.body.check.reason, 'adapter_not_found');
});

test('operator console and search include adapter check results; no execution path exists', async () => {
  const passPlan = await createPlan('eligible');
  await requestJson(`/api/merlin/execution-plans/${encodeURIComponent(passPlan)}/adapter-check`, { method: 'POST' });
  const blockedPlan = await createPlan('blocked');
  await requestJson(`/api/merlin/execution-plans/${encodeURIComponent(blockedPlan)}/adapter-check`, { method: 'POST' });

  const console = await requestJson<{
    summary: { adapterCheckPassCount: number; adapterCheckBlockedCount: number };
    attention: { passedAdapterChecks: unknown[]; blockedAdapterChecks: unknown[] };
  }>('/api/merlin/operator-console?brand_lane=mealscout');
  assert.equal(console.status, 200);
  assert.equal(console.body.summary.adapterCheckPassCount >= 1, true);
  assert.equal(console.body.summary.adapterCheckBlockedCount >= 1, true);
  assert.equal(console.body.attention.passedAdapterChecks.length >= 1, true);
  assert.equal(console.body.attention.blockedAdapterChecks.length >= 1, true);

  const search = await requestJson<{ results: Array<{ source: string }> }>('/api/search?q=adapter_contract_passed');
  assert.equal(search.status, 200);
  assert.equal(search.body.results.some((row) => row.source === 'merlin_connector_adapter_check'), true);

  const exec = await requestJson<Record<string, unknown>>('/api/merlin/connector-adapters/execute', { method: 'POST', body: '{}' });
  assert.equal(exec.status, 404);
});
