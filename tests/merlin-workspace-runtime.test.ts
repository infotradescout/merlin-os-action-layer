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
const { decideMerlinApproval, requestMerlinApproval } = await import('../src/merlin/approvalRuntime.ts');
const { closeMerlinExecutionPlanRuntime, resetMerlinExecutionPlanRuntimeForTest } = await import('../src/merlin/executionPlanRuntime.ts');
const { closeMerlinConnectorAdapterRuntime, resetMerlinConnectorAdapterRuntimeForTest } = await import('../src/merlin/connectorAdapterRuntime.ts');
const { closeMerlinDryRunExecutorRuntime, resetMerlinDryRunExecutorRuntimeForTest } = await import('../src/merlin/dryRunExecutorRuntime.ts');
const { closeMerlinLiveExecutionGateRuntime, resetMerlinLiveExecutionGateRuntimeForTest } = await import('../src/merlin/liveExecutionGateRuntime.ts');
const { createMerlinLiveExecutionGate } = await import('../src/merlin/liveExecutionGateRuntime.ts');
const { closeMerlinOutcomeRuntime, resetMerlinOutcomeRuntimeForTest } = await import('../src/merlin/outcomeRuntime.ts');
const { closeMerlinEntityMemoryRuntime, resetMerlinEntityMemoryRuntimeForTest } = await import('../src/merlin/entityMemoryRuntime.ts');
const { closeMerlinIntakeRuntime, resetMerlinIntakeRuntimeForTest } = await import('../src/merlin/intakeRuntime.ts');
const { closeMerlinWorkspaceRuntime, resetMerlinWorkspaceRuntimeForTest } = await import('../src/merlin/workspaceRuntime.ts');

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

async function createWorkspace(status = 'active') {
  const created = await requestJson<{ workspace: { id: string } }>('/api/merlin/workspaces', {
    method: 'POST',
    body: JSON.stringify({ workspace_name: `Workspace ${status}`, workspace_type: 'internal', status })
  });
  assert.equal(created.status, 201);
  return created.body.workspace.id;
}

async function addMember(workspaceId: string, operatorId: string, role: string, status = 'active') {
  const created = await requestJson<{ member: { id: string; role: string; status: string } }>(`/api/merlin/workspaces/${encodeURIComponent(workspaceId)}/members`, {
    method: 'POST',
    body: JSON.stringify({ operator_id: operatorId, operator_label: operatorId, role, status })
  });
  assert.equal(created.status, 201);
  return created.body.member;
}

async function addBrandPermissions(workspaceId: string, brand = 'mealscout', overrides: Record<string, unknown> = {}) {
  const created = await requestJson<{ brandPermission: { id: string; brand_lane: string } }>(
    `/api/merlin/workspaces/${encodeURIComponent(workspaceId)}/brand-permissions`,
    {
      method: 'POST',
      body: JSON.stringify({
        brand_lane: brand,
        can_view: true,
        can_create_intake: true,
        can_create_action_cards: true,
        can_request_approval: true,
        can_approve: true,
        can_create_execution_plan: true,
        can_run_dry_run: true,
        can_check_live_gate: true,
        ...overrides
      })
    }
  );
  assert.equal(created.status, 201);
  return created.body.brandPermission;
}

async function createCard(overrides: Record<string, unknown> = {}) {
  const created = await requestJson<{ card: { id: string } }>('/api/merlin/action-cards', {
    method: 'POST',
    body: JSON.stringify({
      brand: 'mealscout',
      kpi: 'workspace_kpi',
      intent: 'send profile link',
      source_of_truth: 'drive://workspace-source',
      required_real_data: ['approval', 'source_evidence'],
      tool: 'Gmail',
      action: 'send_external_message',
      permission_level: 'level_2',
      fail_safes: ['dry_run_only'],
      output_location: 'gmail.draft',
      source_refs: ['drive://workspace-source'],
      entity_id: 'entity-workspace-1',
      ...overrides
    })
  });
  assert.equal(created.status, 201);
  return created.body.card.id;
}

async function createSimulatedDryRun(workspaceId: string, operatorId: string) {
  const cardId = await createCard();
  const approval = requestMerlinApproval({ action_card_id: cardId, workspace_id: workspaceId, operator_id: operatorId });
  decideMerlinApproval({
    approval_id: approval.id,
    decision: 'approved',
    decided_by: operatorId,
    reason: 'Workspace role verified',
    workspace_id: workspaceId,
    operator_id: operatorId
  });
  const plan = await requestJson<{ executionPlan: { id: string } }>('/api/merlin/execution-plans', {
    method: 'POST',
    body: JSON.stringify({ action_card_id: cardId })
  });
  assert.equal(plan.status, 201);
  const check = await requestJson(`/api/merlin/execution-plans/${encodeURIComponent(plan.body.executionPlan.id)}/adapter-check`, { method: 'POST' });
  assert.equal(check.status, 201);
  const dryRun = await requestJson<{ dryRunExecution: { id: string } }>('/api/merlin/dry-run-executions', {
    method: 'POST',
    body: JSON.stringify({ execution_plan_id: plan.body.executionPlan.id })
  });
  assert.equal(dryRun.status, 201);
  return dryRun.body.dryRunExecution.id;
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
  closeMerlinWorkspaceRuntime();
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
  resetMerlinWorkspaceRuntimeForTest();
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

test('system workspace seeds and workspace/member/brand permission records persist', async () => {
  const list = await requestJson<{ workspaces: Array<{ id: string; workspace_name: string; workspace_type: string; status: string }> }>('/api/merlin/workspaces');
  assert.equal(list.status, 200);
  assert.equal(list.body.workspaces.some((workspace) => workspace.id === 'merlin-workspace-system' && workspace.workspace_name === 'Merlin System'), true);

  const workspaceId = await createWorkspace();
  await addMember(workspaceId, 'operator@example.com', 'operator');
  await addBrandPermissions(workspaceId, 'mealscout', { can_approve: false });

  const members = await requestJson<{ members: Array<{ operator_id: string; role: string }> }>(`/api/merlin/workspaces/${encodeURIComponent(workspaceId)}/members`);
  assert.equal(members.status, 200);
  assert.equal(members.body.members.some((member) => member.operator_id === 'operator@example.com' && member.role === 'operator'), true);

  const permissions = await requestJson<{ brandPermissions: Array<{ brand_lane: string; can_approve: number }> }>(
    `/api/merlin/workspaces/${encodeURIComponent(workspaceId)}/brand-permissions`
  );
  assert.equal(permissions.status, 200);
  assert.equal(permissions.body.brandPermissions.some((permission) => permission.brand_lane === 'mealscout' && permission.can_approve === 0), true);
});

test('role hierarchy and brand permissions govern role-policy checks', async () => {
  const cardId = await createCard();
  const workspaceId = await createWorkspace();
  await addBrandPermissions(workspaceId);
  await addMember(workspaceId, 'viewer@example.com', 'viewer');
  await addMember(workspaceId, 'operator@example.com', 'operator');
  await addMember(workspaceId, 'admin@example.com', 'admin');

  const viewerApprove = await requestJson<{ check: { check_status: string; reason: string } }>('/api/merlin/role-policy-checks', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: workspaceId, operator_id: 'viewer@example.com', target_type: 'action_card', target_id: cardId, action: 'approve' })
  });
  assert.equal(viewerApprove.status, 409);
  assert.equal(viewerApprove.body.check.check_status, 'role_denied');

  const operatorRequest = await requestJson<{ check: { check_status: string } }>('/api/merlin/role-policy-checks', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: workspaceId, operator_id: 'operator@example.com', target_type: 'action_card', target_id: cardId, action: 'request_approval' })
  });
  assert.equal(operatorRequest.status, 201);
  assert.equal(operatorRequest.body.check.check_status, 'pass');

  const operatorApprove = await requestJson<{ check: { check_status: string } }>('/api/merlin/role-policy-checks', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: workspaceId, operator_id: 'operator@example.com', target_type: 'action_card', target_id: cardId, action: 'approve' })
  });
  assert.equal(operatorApprove.status, 409);
  assert.equal(operatorApprove.body.check.check_status, 'role_denied');

  await addBrandPermissions(workspaceId, 'mealscout', { can_approve: false });
  const adminNoBrand = await requestJson<{ check: { check_status: string; reason: string } }>('/api/merlin/role-policy-checks', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: workspaceId, operator_id: 'admin@example.com', target_type: 'action_card', target_id: cardId, action: 'approve' })
  });
  assert.equal(adminNoBrand.status, 409);
  assert.equal(adminNoBrand.body.check.check_status, 'brand_denied');
});

test('super_admin can approve level_4 and disabled/suspended states are blocked', async () => {
  const level4CardId = await createCard({ permission_level: 'level_4' });
  const workspaceId = await createWorkspace();
  await addBrandPermissions(workspaceId);
  await addMember(workspaceId, 'admin@example.com', 'admin');
  await addMember(workspaceId, 'super@example.com', 'super_admin');
  await addMember(workspaceId, 'disabled@example.com', 'admin', 'disabled');

  const adminLevel4 = await requestJson<{ check: { check_status: string } }>('/api/merlin/role-policy-checks', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: workspaceId, operator_id: 'admin@example.com', target_type: 'action_card', target_id: level4CardId, action: 'approve' })
  });
  assert.equal(adminLevel4.status, 409);
  assert.equal(adminLevel4.body.check.check_status, 'role_denied');

  const superLevel4 = await requestJson<{ check: { check_status: string } }>('/api/merlin/role-policy-checks', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: workspaceId, operator_id: 'super@example.com', target_type: 'action_card', target_id: level4CardId, action: 'approve' })
  });
  assert.equal(superLevel4.status, 201);
  assert.equal(superLevel4.body.check.check_status, 'pass');

  const disabled = await requestJson<{ check: { check_status: string; reason: string } }>('/api/merlin/role-policy-checks', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: workspaceId, operator_id: 'disabled@example.com', target_type: 'action_card', target_id: level4CardId, action: 'approve' })
  });
  assert.equal(disabled.status, 409);
  assert.equal(disabled.body.check.check_status, 'blocked');
  assert.equal(disabled.body.check.reason, 'operator_disabled');

  const suspendedWorkspaceId = await createWorkspace('suspended');
  await addMember(suspendedWorkspaceId, 'admin@example.com', 'admin');
  await addBrandPermissions(suspendedWorkspaceId);
  const suspended = await requestJson<{ check: { check_status: string; reason: string } }>('/api/merlin/role-policy-checks', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: suspendedWorkspaceId, operator_id: 'admin@example.com', target_type: 'action_card', target_id: level4CardId, action: 'approve' })
  });
  assert.equal(suspended.status, 409);
  assert.equal(suspended.body.check.check_status, 'blocked');
  assert.equal(suspended.body.check.reason, 'workspace_suspended');
});

test('approval and live-gate integrations enforce optional workspace role policy', async () => {
  const workspaceId = await createWorkspace();
  await addBrandPermissions(workspaceId);
  await addMember(workspaceId, 'operator@example.com', 'operator');
  await addMember(workspaceId, 'admin@example.com', 'admin');
  const cardId = await createCard();

  const approvalRequest = requestMerlinApproval({ action_card_id: cardId, workspace_id: workspaceId, operator_id: 'operator@example.com' });

  assert.throws(
    () =>
      decideMerlinApproval({
        approval_id: approvalRequest.id,
      decision: 'approved',
      decided_by: 'operator@example.com',
      reason: 'operator should not approve',
      workspace_id: workspaceId,
      operator_id: 'operator@example.com'
      }),
    /role_policy_role_denied/
  );

  const adminDecision = decideMerlinApproval({
    approval_id: approvalRequest.id,
    decision: 'approved',
    decided_by: 'admin@example.com',
    reason: 'admin role verified',
    workspace_id: workspaceId,
    operator_id: 'admin@example.com'
  });
  assert.equal(adminDecision.approval_status, 'approved');

  const dryRunId = await createSimulatedDryRun(workspaceId, 'admin@example.com');
  assert.throws(
    () => createMerlinLiveExecutionGate({ dry_run_execution_id: dryRunId, workspace_id: workspaceId, operator_id: 'operator@example.com' }),
    /role_policy_role_denied/
  );

  const adminGate = createMerlinLiveExecutionGate({ dry_run_execution_id: dryRunId, workspace_id: workspaceId, operator_id: 'admin@example.com' });
  assert.equal(adminGate.gate_status, 'disabled');
  assert.equal(adminGate.eligibility_reason, 'live_execution_disabled');
});

test('operator console and search include workspace role policy checks; no connector execution path exists', async () => {
  const cardId = await createCard();
  const workspaceId = await createWorkspace();
  await addBrandPermissions(workspaceId, 'mealscout', { can_approve: false });
  await addMember(workspaceId, 'admin@example.com', 'admin');
  await requestJson('/api/merlin/role-policy-checks', {
    method: 'POST',
    body: JSON.stringify({ workspace_id: workspaceId, operator_id: 'admin@example.com', target_type: 'action_card', target_id: cardId, action: 'approve' })
  });

  const console = await requestJson<{
    summary: { workspaceActiveCount: number; rolePolicyBlockedCount: number };
    attention: { blockedRolePolicyChecks: unknown[] };
  }>('/api/merlin/operator-console?brand_lane=mealscout');
  assert.equal(console.status, 200);
  assert.equal(console.body.summary.workspaceActiveCount >= 2, true);
  assert.equal(console.body.summary.rolePolicyBlockedCount >= 1, true);
  assert.equal(console.body.attention.blockedRolePolicyChecks.length >= 1, true);

  const search = await requestJson<{ results: Array<{ source: string }> }>('/api/search?q=brand_mealscout_approve_denied');
  assert.equal(search.status, 200);
  assert.equal(search.body.results.some((row) => row.source === 'merlin_role_policy_check'), true);

  const exec = await requestJson<Record<string, unknown>>('/api/merlin/role-policy-checks/execute', { method: 'POST', body: '{}' });
  assert.equal(exec.status, 404);
});
