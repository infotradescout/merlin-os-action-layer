import assert from 'node:assert/strict';
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
const { closeMerlinDryRunExecutorRuntime, resetMerlinDryRunExecutorRuntimeForTest } = await import('../src/merlin/dryRunExecutorRuntime.ts');
const {
  closeMerlinLiveExecutionGateRuntime,
  determineMerlinLiveExecutionRisk,
  resetMerlinLiveExecutionGateRuntimeForTest
} = await import('../src/merlin/liveExecutionGateRuntime.ts');
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

function withDb<T>(fn: (db: Database.Database) => T): T {
  const db = new Database('./data/merlin-or.sqlite');
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function createCard(overrides: Record<string, unknown> = {}) {
  const created = await requestJson<{ card: { id: string } }>('/api/merlin/action-cards', {
    method: 'POST',
    body: JSON.stringify({
      brand: 'mealscout',
      kpi: 'live_gate_kpi',
      intent: 'send profile link',
      source_of_truth: 'drive://live-gate-source',
      required_real_data: ['approval', 'source_evidence'],
      tool: 'Gmail',
      action: 'send_external_message',
      permission_level: 'level_2',
      fail_safes: ['dry_run_only', 'live_gate_required'],
      output_location: 'gmail.draft',
      source_refs: ['drive://live-gate-source'],
      entity_id: 'entity-live-gate-1',
      ...overrides
    })
  });
  assert.equal(created.status, 201);
  return created.body.card.id;
}

async function createSimulatedDryRun() {
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
  const check = await requestJson<{ check: { id: string } }>(`/api/merlin/execution-plans/${encodeURIComponent(plan.body.executionPlan.id)}/adapter-check`, {
    method: 'POST'
  });
  assert.equal(check.status, 201);
  const dryRun = await requestJson<{ dryRunExecution: { id: string; adapter_check_id: string } }>('/api/merlin/dry-run-executions', {
    method: 'POST',
    body: JSON.stringify({ execution_plan_id: plan.body.executionPlan.id })
  });
  assert.equal(dryRun.status, 201);
  return {
    cardId,
    approvalId: approval.body.approval.id,
    planId: plan.body.executionPlan.id,
    adapterCheckId: check.body.check.id,
    dryRunId: dryRun.body.dryRunExecution.id
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
  closeMerlinLiveExecutionGateRuntime();
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
  resetMerlinLiveExecutionGateRuntimeForTest();
  resetMerlinDryRunExecutorRuntimeForTest();
  resetMerlinConnectorAdapterRuntimeForTest();
  resetMerlinExecutionPlanRuntimeForTest();
  resetMerlinApprovalRuntimeForTest();
  resetMerlinOutcomeRuntimeForTest();
  resetMerlinEntityMemoryRuntimeForTest();
  resetMerlinIntakeRuntimeForTest();
  resetMerlinActionCardRuntimeForTest();
});

test('simulated dry-run creates disabled live gate because live execution is globally disabled', async () => {
  const ids = await createSimulatedDryRun();
  const created = await requestJson<{
    liveExecutionGate: {
      id: string;
      dry_run_execution_id: string;
      execution_plan_id: string;
      adapter_check_id: string;
      approval_id: string;
      gate_status: string;
      risk_level: string;
      live_execution_enabled: number;
      eligibility_reason: string;
      missing_gates: string[];
    };
  }>('/api/merlin/live-execution-gates', {
    method: 'POST',
    body: JSON.stringify({ dry_run_execution_id: ids.dryRunId })
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.liveExecutionGate.dry_run_execution_id, ids.dryRunId);
  assert.equal(created.body.liveExecutionGate.execution_plan_id, ids.planId);
  assert.equal(created.body.liveExecutionGate.adapter_check_id, ids.adapterCheckId);
  assert.equal(created.body.liveExecutionGate.approval_id, ids.approvalId);
  assert.equal(created.body.liveExecutionGate.gate_status, 'disabled');
  assert.equal(created.body.liveExecutionGate.live_execution_enabled, 0);
  assert.equal(created.body.liveExecutionGate.eligibility_reason, 'live_execution_disabled');
  assert.deepEqual(created.body.liveExecutionGate.missing_gates, ['live_execution_enabled']);

  const history = await requestJson<{ history: Array<{ event_type: string; gate_status: string }> }>(
    `/api/merlin/live-execution-gates/${encodeURIComponent(created.body.liveExecutionGate.id)}/history`
  );
  assert.equal(history.status, 200);
  assert.equal(history.body.history.some((row) => row.event_type === 'created' && row.gate_status === 'disabled'), true);
});

test('non-simulated dry-run, missing adapter check, policy block, and unapproved approval all block gate', async () => {
  const nonSim = await createSimulatedDryRun();
  await requestJson(`/api/merlin/dry-run-executions/${encodeURIComponent(nonSim.dryRunId)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'cancelled', reason: 'operator cancelled simulation' })
  });
  const nonSimGate = await requestJson<{ liveExecutionGate: { gate_status: string; missing_gates: string[] } }>('/api/merlin/live-execution-gates', {
    method: 'POST',
    body: JSON.stringify({ dry_run_execution_id: nonSim.dryRunId })
  });
  assert.equal(nonSimGate.status, 201);
  assert.equal(nonSimGate.body.liveExecutionGate.gate_status, 'blocked');
  assert.equal(nonSimGate.body.liveExecutionGate.missing_gates.includes('dry_run_execution_simulated'), true);

  const missingCheck = await createSimulatedDryRun();
  withDb((db) => db.prepare('DELETE FROM merlin_connector_adapter_checks WHERE id = ?').run(missingCheck.adapterCheckId));
  const missingCheckGate = await requestJson<{ liveExecutionGate: { gate_status: string; missing_gates: string[] } }>('/api/merlin/live-execution-gates', {
    method: 'POST',
    body: JSON.stringify({ dry_run_execution_id: missingCheck.dryRunId })
  });
  assert.equal(missingCheckGate.status, 201);
  assert.equal(missingCheckGate.body.liveExecutionGate.gate_status, 'blocked');
  assert.equal(missingCheckGate.body.liveExecutionGate.missing_gates.includes('adapter_check_exists'), true);

  const policyBlocked = await createSimulatedDryRun();
  withDb((db) => {
    const row = db.prepare('SELECT policy_result_json FROM merlin_action_cards WHERE id = ?').get(policyBlocked.cardId) as { policy_result_json: string };
    const policy = JSON.parse(row.policy_result_json) as Record<string, unknown>;
    policy.blocked = true;
    policy.allowed = false;
    policy.reason = 'Test policy block';
    db.prepare('UPDATE merlin_action_cards SET policy_result_json = ? WHERE id = ?').run(JSON.stringify(policy), policyBlocked.cardId);
  });
  const policyGate = await requestJson<{ liveExecutionGate: { gate_status: string; missing_gates: string[] } }>('/api/merlin/live-execution-gates', {
    method: 'POST',
    body: JSON.stringify({ dry_run_execution_id: policyBlocked.dryRunId })
  });
  assert.equal(policyGate.status, 201);
  assert.equal(policyGate.body.liveExecutionGate.gate_status, 'blocked');
  assert.equal(policyGate.body.liveExecutionGate.missing_gates.includes('policy_not_blocked'), true);

  const revoked = await createSimulatedDryRun();
  await requestJson(`/api/merlin/approvals/${encodeURIComponent(revoked.approvalId)}/decision`, {
    method: 'PATCH',
    body: JSON.stringify({ decision: 'revoked', decided_by: 'operator@example.com', reason: 'approval pulled before live gate' })
  });
  const revokedGate = await requestJson<{ liveExecutionGate: { gate_status: string; missing_gates: string[] } }>('/api/merlin/live-execution-gates', {
    method: 'POST',
    body: JSON.stringify({ dry_run_execution_id: revoked.dryRunId })
  });
  assert.equal(revokedGate.status, 201);
  assert.equal(revokedGate.body.liveExecutionGate.gate_status, 'blocked');
  assert.equal(revokedGate.body.liveExecutionGate.missing_gates.includes('approval_approved_when_required'), true);
});

test('risk levels classify supported tools and Stripe/payment actions stay critical blocked', async () => {
  assert.equal(determineMerlinLiveExecutionRisk('Manual', 'inspect'), 'low');
  assert.equal(determineMerlinLiveExecutionRisk('GitHub', 'update'), 'medium');
  assert.equal(determineMerlinLiveExecutionRisk('GoogleDrive', 'create'), 'medium');
  assert.equal(determineMerlinLiveExecutionRisk('GoogleCalendar', 'schedule'), 'high');
  assert.equal(determineMerlinLiveExecutionRisk('Gmail', 'send_external_message'), 'high');
  assert.equal(determineMerlinLiveExecutionRisk('Canva', 'generate'), 'medium');
  assert.equal(determineMerlinLiveExecutionRisk('Stripe', 'charge_customer'), 'critical');

  const stripeLike = await createSimulatedDryRun();
  withDb((db) =>
    db
      .prepare("UPDATE merlin_dry_run_executions SET tool = 'Stripe', action = 'charge_customer', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), stripeLike.dryRunId)
  );
  const gate = await requestJson<{ liveExecutionGate: { gate_status: string; risk_level: string; eligibility_reason: string } }>('/api/merlin/live-execution-gates', {
    method: 'POST',
    body: JSON.stringify({ dry_run_execution_id: stripeLike.dryRunId })
  });
  assert.equal(gate.status, 201);
  assert.equal(gate.body.liveExecutionGate.risk_level, 'critical');
  assert.equal(gate.body.liveExecutionGate.gate_status, 'blocked');
  assert.equal(gate.body.liveExecutionGate.eligibility_reason, 'critical_tool_or_action_blocked');
});

test('operator console and search include live gates; no connector execution path exists', async () => {
  const ids = await createSimulatedDryRun();
  await requestJson('/api/merlin/live-execution-gates', {
    method: 'POST',
    body: JSON.stringify({ dry_run_execution_id: ids.dryRunId })
  });
  const critical = await createSimulatedDryRun();
  withDb((db) =>
    db
      .prepare("UPDATE merlin_dry_run_executions SET tool = 'Stripe', action = 'charge_customer', updated_at = ? WHERE id = ?")
      .run(new Date().toISOString(), critical.dryRunId)
  );
  await requestJson('/api/merlin/live-execution-gates', {
    method: 'POST',
    body: JSON.stringify({ dry_run_execution_id: critical.dryRunId })
  });

  const console = await requestJson<{
    summary: {
      liveGateDisabledCount: number;
      liveGateBlockedCount: number;
      liveGateCriticalCount: number;
    };
    attention: {
      disabledLiveExecutionGates: unknown[];
      blockedLiveExecutionGates: unknown[];
      criticalLiveExecutionGates: unknown[];
    };
  }>('/api/merlin/operator-console?brand_lane=mealscout');
  assert.equal(console.status, 200);
  assert.equal(console.body.summary.liveGateDisabledCount >= 1, true);
  assert.equal(console.body.summary.liveGateBlockedCount >= 1, true);
  assert.equal(console.body.summary.liveGateCriticalCount >= 1, true);
  assert.equal(console.body.attention.disabledLiveExecutionGates.length >= 1, true);
  assert.equal(console.body.attention.blockedLiveExecutionGates.length >= 1, true);
  assert.equal(console.body.attention.criticalLiveExecutionGates.length >= 1, true);

  const search = await requestJson<{ results: Array<{ source: string }> }>('/api/search?q=live_execution_disabled');
  assert.equal(search.status, 200);
  assert.equal(search.body.results.some((row) => row.source === 'merlin_live_execution_gate'), true);

  const exec = await requestJson<Record<string, unknown>>('/api/merlin/live-execution-gates/execute', { method: 'POST', body: '{}' });
  assert.equal(exec.status, 404);
});
