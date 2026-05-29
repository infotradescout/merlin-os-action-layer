import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-ms-publish-exec-'));
process.env.MERLIN_DB_PATH = resolve(tempDir, 'merlin-or.sqlite');
process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { seedMealScoutTruck } = await import('../src/mealscoutProfileImport.ts');
const { rememberMealScoutPublishPlan } = await import('../src/mealscoutPublishPlan.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');

let server: Server;
let baseUrl: string;

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
  closeLisaStore();
  closeDriveManifestStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
});

async function makePlan(inputs: Array<{ fileId: string; fileName: string; sourceFolder: string; extractedText: string }>) {
  const preview = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    publishPlan: { planId: string; records: Array<{ recordId: string; plannedAction: string; publishReady: boolean; draftIds?: string[] }> };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({ inputs })
  });
  return preview.body.publishPlan;
}

test('publishReady create_new record can execute with audit', async () => {
  const plan = rememberMealScoutPublishPlan({
    planId: 'ms-plan-exec-create',
    signature: 'sig-exec-create',
    reviewDecisionVersion: 0,
    generatedAt: '2026-05-29T00:00:00.000Z',
    mutationAllowed: false,
    records: [
      {
        recordId: 'ms-plan-record-create-1',
        plannedAction: 'create_new',
        publishReady: true,
        draftIds: ['d-create-1'],
        sourceAttribution: {
          primarySourceRepId: 'rep-1',
          contributingRepIds: ['rep-1'],
          sourceFileIds: ['f-create-1'],
          attributionPolicy: 'first_required_field_contributor'
        },
        profileFields: {
          truckName: { value: 'Orbit Taco', evidenceRefs: ['name'], sourceFileIds: ['f-create-1'] },
          cityArea: { value: 'Kenner', evidenceRefs: ['city'], sourceFileIds: ['f-create-1'] },
          phone: { value: '985-111-2222', evidenceRefs: ['phone'], sourceFileIds: ['f-create-1'] }
        },
        menuItems: [{ name: 'Quesadilla', price: '$10.00', evidenceRefs: ['menu'], sourceFileIds: ['f-create-1'] }]
      }
    ]
  });
  const target = plan.records[0];
  const exec = await requestJson<{
    mutationAllowed: boolean;
    results: Array<{ result: string; auditId: string; targetId?: string }>;
    auditEntries: Array<{ result: string; auditId: string; fieldsWritten: string[]; sourceAttribution?: { contributingRepIds: string[] } }>;
  }>('/api/mealscout/intake/publish-plan/execute', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({
      planId: plan.planId,
      expectedSignature: plan.signature,
      recordIds: [target.recordId],
      confirmation: true,
      operatorId: 'operator-a'
    })
  });
  assert.equal(exec.status, 200);
  assert.equal(exec.body.mutationAllowed, true);
  assert.equal(exec.body.results[0].result, 'success');
  assert.ok(exec.body.results[0].targetId);
  assert.equal(exec.body.auditEntries[0].result, 'success');
  assert.equal(exec.body.auditEntries[0].fieldsWritten.length > 0, true);
  assert.equal(Array.isArray(exec.body.auditEntries[0].sourceAttribution?.contributingRepIds), true);
});

test('execution blocks blocked/needs_review/conflict and requires confirmation', async () => {
  const blockedPlan = rememberMealScoutPublishPlan({
    planId: 'ms-plan-exec-blocked',
    signature: 'sig-exec-blocked',
    reviewDecisionVersion: 0,
    generatedAt: '2026-05-29T00:00:00.000Z',
    mutationAllowed: false,
    records: [
      {
        recordId: 'ms-plan-record-blocked-1',
        plannedAction: 'blocked',
        publishReady: false,
        draftIds: ['d-blocked-1'],
        profileFields: {
          truckName: { value: 'Unknown Truck', evidenceRefs: ['name'], sourceFileIds: ['f-blocked-1'] },
          cityArea: { value: 'Kenner', evidenceRefs: ['city'], sourceFileIds: ['f-blocked-1'] }
        },
        menuItems: [],
        blockedReasons: ['missing_contact_or_web_or_social', 'missing_menu_or_menu_deferred']
      }
    ]
  });
  const blockedRecord = blockedPlan.records[0];
  const withoutConfirm = await requestJson<{ error: string }>('/api/mealscout/intake/publish-plan/execute', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ planId: blockedPlan.planId, recordIds: [blockedRecord.recordId], confirmation: false })
  });
  assert.equal(withoutConfirm.status, 400);

  const blockedExec = await requestJson<{ results: Array<{ result: string; failureReason?: string }>; auditEntries: Array<{ result: string }> }>(
    '/api/mealscout/intake/publish-plan/execute',
    {
      method: 'POST',
      headers: { 'x-operator-role': 'admin' },
      body: JSON.stringify({ planId: blockedPlan.planId, recordIds: [blockedRecord.recordId], confirmation: true })
    }
  );
  assert.equal(blockedExec.status, 200);
  assert.equal(blockedExec.body.results[0].result, 'skipped');
  assert.ok(blockedExec.body.results[0].failureReason);
  assert.equal(blockedExec.body.auditEntries[0].result, 'skipped');
});

test('needs_review decision prevents execution', async () => {
  const plan = rememberMealScoutPublishPlan({
    planId: 'ms-plan-exec-needs-review',
    signature: 'sig-exec-needs-review',
    reviewDecisionVersion: 0,
    generatedAt: '2026-05-29T00:00:00.000Z',
    mutationAllowed: false,
    records: [
      {
        recordId: 'ms-plan-record-needs-1',
        plannedAction: 'needs_review',
        publishReady: false,
        draftIds: ['d-needs-1'],
        profileFields: {
          truckName: { value: 'Needs Review Truck', evidenceRefs: ['name'], sourceFileIds: ['f-needs-1'] },
          cityArea: { value: 'Kenner', evidenceRefs: ['city'], sourceFileIds: ['f-needs-1'] },
          phone: { value: '985-222-3333', evidenceRefs: ['phone'], sourceFileIds: ['f-needs-1'] }
        },
        menuItems: [{ name: 'Taco', evidenceRefs: ['menu'], sourceFileIds: ['f-needs-1'] }],
        blockedReasons: ['needs_review_decision_present']
      }
    ]
  });
  const target = plan.records[0];
  const exec = await requestJson<{ results: Array<{ result: string; failureReason?: string }> }>(
    '/api/mealscout/intake/publish-plan/execute',
    {
      method: 'POST',
      headers: { 'x-operator-role': 'admin' },
      body: JSON.stringify({ planId: plan.planId, expectedSignature: plan.signature, recordIds: [target.recordId], confirmation: true })
    }
  );
  assert.equal(exec.status, 200);
  assert.equal(exec.body.results[0].result, 'skipped');
  assert.ok(exec.body.results[0].failureReason);
});

test('conflicting contact fields prevent execution', async () => {
  const plan = rememberMealScoutPublishPlan({
    planId: 'ms-plan-exec-conflict',
    signature: 'sig-exec-conflict',
    reviewDecisionVersion: 0,
    generatedAt: '2026-05-29T00:00:00.000Z',
    mutationAllowed: false,
    records: [
      {
        recordId: 'ms-plan-record-conflict-1',
        plannedAction: 'blocked',
        publishReady: false,
        draftIds: ['d-conflict-1', 'd-conflict-2'],
        profileFields: {
          truckName: { value: 'Conflict Truck', evidenceRefs: ['name'], sourceFileIds: ['f-conflict-1'] },
          cityArea: { value: 'Kenner', evidenceRefs: ['city'], sourceFileIds: ['f-conflict-1'] },
          phone: { value: '985-111-0000', evidenceRefs: ['phone'], sourceFileIds: ['f-conflict-1'] }
        },
        menuItems: [{ name: 'Taco', evidenceRefs: ['menu'], sourceFileIds: ['f-conflict-1'] }],
        conflicts: [{ field: 'phone', values: ['985-111-0000', '985-222-0000'], sourceDraftIds: ['d-conflict-1', 'd-conflict-2'] }],
        blockedReasons: ['conflicting_identity_fields']
      }
    ]
  });
  const target = plan.records[0];
  const exec = await requestJson<{ results: Array<{ result: string; failureReason?: string }> }>(
    '/api/mealscout/intake/publish-plan/execute',
    {
      method: 'POST',
      headers: { 'x-operator-role': 'admin' },
      body: JSON.stringify({ planId: plan.planId, expectedSignature: plan.signature, recordIds: [target.recordId], confirmation: true })
    }
  );
  assert.equal(exec.status, 200);
  assert.equal(exec.body.results[0].result, 'skipped');
  const reason = exec.body.results[0].failureReason || '';
  assert.equal(reason.includes('conflict') || reason.includes('blocked') || reason.includes('publish_ready'), true);
});

test('update_existing executes without creating duplicate and preview stays mutationAllowed false', async () => {
  const seeded = seedMealScoutTruck({ truckName: 'Orbit Taco', phone: '985-111-2222', cityArea: 'Kenner' });
  const preview = await requestJson<{ mutationAllowed: boolean }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({ inputs: [{ fileId: 'noop', fileName: 'noop.png', sourceFolder: '/incoming/unknown', extractedText: 'noop' }] })
  });
  assert.equal(preview.body.mutationAllowed, false);
  const plan = rememberMealScoutPublishPlan({
    planId: 'ms-plan-exec-update',
    signature: 'sig-exec-update',
    reviewDecisionVersion: 0,
    generatedAt: '2026-05-29T00:00:00.000Z',
    mutationAllowed: false,
    records: [
      {
        recordId: 'ms-plan-record-update-1',
        plannedAction: 'update_existing',
        publishReady: true,
        draftIds: ['d-update-1'],
        existingTruckId: seeded.id,
        profileFields: {
          truckName: { value: 'Orbit Taco', evidenceRefs: ['name'], sourceFileIds: ['f-update-1'] },
          cityArea: { value: 'Kenner', evidenceRefs: ['city'], sourceFileIds: ['f-update-1'] },
          phone: { value: '985-111-2222', evidenceRefs: ['phone'], sourceFileIds: ['f-update-1'] }
        },
        menuItems: [{ name: 'Quesadilla', evidenceRefs: ['menu'], sourceFileIds: ['f-update-1'] }]
      }
    ]
  });
  const update = plan.records[0];
  const exec = await requestJson<{ results: Array<{ result: string; targetId?: string }> }>(
    '/api/mealscout/intake/publish-plan/execute',
    {
      method: 'POST',
      headers: { 'x-operator-role': 'admin' },
      body: JSON.stringify({ planId: plan.planId, expectedSignature: plan.signature, recordIds: [update.recordId], confirmation: true })
    }
  );
  assert.equal(exec.status, 200);
  assert.equal(exec.body.results[0].result, 'success');
  assert.equal(exec.body.results[0].targetId, seeded.id);
});

test('unauthorized execution is rejected and authorized execution works', async () => {
  const plan = rememberMealScoutPublishPlan({
    planId: 'ms-plan-auth-check',
    signature: 'sig-auth-check',
    reviewDecisionVersion: 0,
    generatedAt: '2026-05-29T00:00:00.000Z',
    mutationAllowed: false,
    records: [
      {
        recordId: 'ms-plan-record-auth-1',
        plannedAction: 'create_new',
        publishReady: true,
        draftIds: ['d-auth-1'],
        profileFields: {
          truckName: { value: 'Auth Truck', evidenceRefs: ['name'], sourceFileIds: ['f-auth-1'] },
          cityArea: { value: 'Kenner', evidenceRefs: ['city'], sourceFileIds: ['f-auth-1'] },
          phone: { value: '985-333-2222', evidenceRefs: ['phone'], sourceFileIds: ['f-auth-1'] }
        },
        menuItems: [{ name: 'Taco', evidenceRefs: ['menu'], sourceFileIds: ['f-auth-1'] }]
      }
    ]
  });
  const denied = await requestJson<{ error: string }>('/api/mealscout/intake/publish-plan/execute', {
    method: 'POST',
    headers: { 'x-operator-role': 'viewer' },
    body: JSON.stringify({ planId: plan.planId, expectedSignature: plan.signature, recordIds: ['ms-plan-record-auth-1'], confirmation: true })
  });
  assert.equal(denied.status, 403);
  const allowed = await requestJson<{ mutationAllowed: boolean; results: Array<{ result: string }> }>(
    '/api/mealscout/intake/publish-plan/execute',
    {
      method: 'POST',
      headers: { 'x-operator-role': 'admin' },
      body: JSON.stringify({ planId: plan.planId, expectedSignature: plan.signature, recordIds: ['ms-plan-record-auth-1'], confirmation: true })
    }
  );
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.mutationAllowed, true);
  assert.equal(allowed.body.results[0].result, 'success');
});

test('re-executing same plan record is idempotent and returns already_executed', async () => {
  const plan = rememberMealScoutPublishPlan({
    planId: 'ms-plan-idempotent',
    signature: 'sig-idempotent',
    reviewDecisionVersion: 0,
    generatedAt: '2026-05-29T00:00:00.000Z',
    mutationAllowed: false,
    records: [
      {
        recordId: 'ms-plan-record-idempotent-1',
        plannedAction: 'create_new',
        publishReady: true,
        draftIds: ['d-ido-1'],
        profileFields: {
          truckName: { value: 'Ido Truck', evidenceRefs: ['name'], sourceFileIds: ['f-ido-1'] },
          cityArea: { value: 'Kenner', evidenceRefs: ['city'], sourceFileIds: ['f-ido-1'] },
          phone: { value: '985-333-2222', evidenceRefs: ['phone'], sourceFileIds: ['f-ido-1'] }
        },
        menuItems: [{ name: 'Taco', evidenceRefs: ['menu'], sourceFileIds: ['f-ido-1'] }]
      }
    ]
  });
  const first = await requestJson<{ results: Array<{ result: string; auditId: string }> }>(
    '/api/mealscout/intake/publish-plan/execute',
    {
      method: 'POST',
      headers: { 'x-operator-role': 'admin' },
      body: JSON.stringify({ planId: plan.planId, expectedSignature: plan.signature, recordIds: ['ms-plan-record-idempotent-1'], confirmation: true })
    }
  );
  const second = await requestJson<{ results: Array<{ result: string; priorAuditId?: string; failureReason?: string }> }>(
    '/api/mealscout/intake/publish-plan/execute',
    {
      method: 'POST',
      headers: { 'x-operator-role': 'admin' },
      body: JSON.stringify({ planId: plan.planId, expectedSignature: plan.signature, recordIds: ['ms-plan-record-idempotent-1'], confirmation: true })
    }
  );
  assert.equal(first.body.results[0].result, 'success');
  assert.equal(second.body.results[0].result, 'already_executed');
  assert.equal(second.body.results[0].failureReason, 'already_executed');
  assert.equal(Boolean(second.body.results[0].priorAuditId), true);
});

test('stale plan is rejected and audit retrieval works with rollback-safe metadata', async () => {
  const plan = rememberMealScoutPublishPlan({
    planId: 'ms-plan-stale',
    signature: 'sig-stale',
    reviewDecisionVersion: 0,
    generatedAt: '2026-05-29T00:00:00.000Z',
    mutationAllowed: false,
    records: [
      {
        recordId: 'ms-plan-record-stale-1',
        plannedAction: 'update_existing',
        publishReady: true,
        draftIds: ['d-stale-1'],
        existingTruckId: seedMealScoutTruck({ truckName: 'Old', phone: '985-333-4444', cityArea: 'Kenner' }).id,
        profileFields: {
          truckName: { value: 'New Name', evidenceRefs: ['name'], sourceFileIds: ['f-stale-1'] },
          cityArea: { value: 'Kenner', evidenceRefs: ['city'], sourceFileIds: ['f-stale-1'] },
          phone: { value: '985-333-4444', evidenceRefs: ['phone'], sourceFileIds: ['f-stale-1'] }
        },
        menuItems: [{ name: 'Taco', evidenceRefs: ['menu'], sourceFileIds: ['f-stale-1'] }]
      }
    ]
  });
  await requestJson('/api/mealscout/review-decisions', {
    method: 'POST',
    body: JSON.stringify({ draftIds: ['x'], decision: 'needs_review', sourceFileIds: ['f'], evidenceRefs: ['e'] })
  });
  const stale = await requestJson<{ error: string }>('/api/mealscout/intake/publish-plan/execute', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ planId: plan.planId, expectedSignature: plan.signature, recordIds: ['ms-plan-record-stale-1'], confirmation: true })
  });
  assert.equal(stale.status, 409);
  assert.equal((stale.body.error || '').includes('stale_plan'), true);

  const fresh = rememberMealScoutPublishPlan({
    ...plan,
    planId: 'ms-plan-fresh',
    signature: 'sig-fresh',
    reviewDecisionVersion: 1
  });
  const exec = await requestJson<{ executionId: string; auditEntries: Array<{ auditId: string; previousValues?: Record<string, string>; newValues?: Record<string, string>; targetId?: string }> }>(
    '/api/mealscout/intake/publish-plan/execute',
    {
      method: 'POST',
      headers: { 'x-operator-role': 'admin' },
      body: JSON.stringify({ planId: fresh.planId, expectedSignature: fresh.signature, recordIds: ['ms-plan-record-stale-1'], confirmation: true })
    }
  );
  assert.equal(exec.status, 200);
  assert.equal(Boolean(exec.body.auditEntries[0].targetId), true);
  assert.equal(Boolean(exec.body.auditEntries[0].newValues), true);
  assert.equal(Boolean(exec.body.auditEntries[0].previousValues), true);

  const audit = await requestJson<{ status: string; mutationAllowed: boolean; records: Array<{ executionId: string }> }>(
    `/api/mealscout/intake/publish-plan/audit?executionId=${encodeURIComponent(exec.body.executionId)}`,
    {
      method: 'GET',
      headers: { 'x-operator-role': 'admin' }
    }
  );
  assert.equal(audit.status, 200);
  assert.equal(audit.body.status, 'ok');
  assert.equal(audit.body.mutationAllowed, false);
  assert.equal(audit.body.records.length > 0, true);
});
