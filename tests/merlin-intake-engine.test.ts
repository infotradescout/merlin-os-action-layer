import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.MERLIN_RUNTIME = 'test';
process.env.MERLIN_INTAKE_ENABLED = 'true';
process.env.MERLIN_INTAKE_MEALSCOUT_ENABLED = 'true';
process.env.MERLIN_INTAKE_TRADESCOUT_ENABLED = 'false';
process.env.MERLIN_INTAKE_HOMEID_ENABLED = 'false';
process.env.MERLIN_INTAKE_ADMIN_ENABLED = 'false';
process.env.MERLIN_INTAKE_APPLY_ENABLED = 'false';
process.env.MERLIN_INTAKE_CLEANUP_ENABLED = 'false';

const { createMerlinServer } = await import('../src/server.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');
const { getRegisteredActions } = await import('../src/merlin/intake/intentRegistry.ts');

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
  closeLisaStore();
  closeDriveManifestStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
});

beforeEach(async () => {
  process.env.MERLIN_INTAKE_ENABLED = 'true';
  process.env.MERLIN_INTAKE_MEALSCOUT_ENABLED = 'true';
  process.env.MERLIN_INTAKE_APPLY_ENABLED = 'false';
  process.env.MERLIN_INTAKE_CLEANUP_ENABLED = 'false';
  await requestJson('/api/demo/reset', { method: 'POST' });
});

async function createIntent(actionId: string, actorScope: 'owner' | 'staff' | 'admin' = 'owner') {
  const created = await requestJson<{ intent: { uploadId: string } }>('/api/merlin/intake/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'u-1',
      accountId: 'a-1',
      brand: 'MEALSCOUT',
      actorScope,
      entityType: 'food_truck',
      entityId: 'truck-1',
      actionId
    })
  });
  assert.equal(created.status, 201);
  return created.body.intent.uploadId;
}

test('Merlin registry loads MealScout adapter actions', async () => {
  await createIntent('update_menu');
  const actions = getRegisteredActions();
  assert.equal(actions.some((row) => row.brand === 'MEALSCOUT' && row.actionId === 'update_menu'), true);
});

test('Global flag off blocks Merlin intake endpoints', async () => {
  process.env.MERLIN_INTAKE_ENABLED = 'false';
  const response = await requestJson<{ error: string }>('/api/merlin/intake/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'u-1',
      accountId: 'a-1',
      brand: 'MEALSCOUT',
      actorScope: 'owner',
      entityType: 'food_truck',
      entityId: 'truck-1',
      actionId: 'update_menu'
    })
  });
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'MERLIN_INTAKE_DISABLED');
});

test('MealScout product flag off blocks MealScout intake', async () => {
  process.env.MERLIN_INTAKE_MEALSCOUT_ENABLED = 'false';
  const response = await requestJson<{ error: string }>('/api/merlin/intake/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'u-1',
      accountId: 'a-1',
      brand: 'MEALSCOUT',
      actorScope: 'owner',
      entityType: 'food_truck',
      entityId: 'truck-1',
      actionId: 'update_menu'
    })
  });
  assert.equal(response.status, 503);
  assert.equal(response.body.error, 'PRODUCT_INTAKE_DISABLED');
});

test('Invalid MealScout action is rejected', async () => {
  const response = await requestJson<{ error: string }>('/api/merlin/intake/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'u-1',
      accountId: 'a-1',
      brand: 'MEALSCOUT',
      actorScope: 'owner',
      entityType: 'food_truck',
      entityId: 'truck-1',
      actionId: 'unknown_action'
    })
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'INVALID_INTENT');
});

test('Valid update_menu intent snapshots allowed/forbidden fields and implementationAllowed false', async () => {
  const uploadId = await createIntent('update_menu');
  const get = await requestJson<{ intent: { actionSnapshot: { allowedFieldPaths: string[]; forbiddenFieldPaths: string[] }; implementationAllowed: boolean } }>(
    `/api/merlin/intake/upload-intents/${uploadId}`
  );
  assert.equal(get.status, 200);
  assert.equal(get.body.intent.actionSnapshot.allowedFieldPaths.includes('menu.items'), true);
  assert.equal(get.body.intent.actionSnapshot.forbiddenFieldPaths.includes('businessName'), true);
  assert.equal(get.body.intent.implementationAllowed, false);
});

test('Files cannot attach without valid upload intent', async () => {
  const attach = await requestJson<{ error: string }>('/api/merlin/intake/upload-intents/missing/files', {
    method: 'POST',
    body: JSON.stringify({ files: [{ fileId: 'f-1' }] })
  });
  assert.equal(attach.status, 404);
});

test('Route uses Merlin router and holds TradeScout-like evidence under MealScout action', async () => {
  const uploadId = await createIntent('attach_menu_evidence', 'staff');
  await requestJson(`/api/merlin/intake/upload-intents/${uploadId}/files`, {
    method: 'POST',
    body: JSON.stringify({
      files: [{ fileId: 'x-1', fileName: 'license.pdf', mimeType: 'application/pdf', extractedText: 'TradeScout contractor insurance update' }]
    })
  });
  const route = await requestJson<{ routingDecisions: Array<{ routedType: string; holdReason?: string }> }>(
    `/api/merlin/intake/upload-intents/${uploadId}/route`,
    { method: 'POST' }
  );
  assert.equal(route.status, 200);
  assert.equal(route.body.routingDecisions[0].routedType, 'held');
  assert.equal(route.body.routingDecisions[0].holdReason, 'AMBIGUOUS_OR_WRONG_DOMAIN');
});

test('Preview stops at PREVIEW_READY or HELD_FOR_REVIEW and never mutates/publishes', async () => {
  const uploadId = await createIntent('update_schedule');
  await requestJson(`/api/merlin/intake/upload-intents/${uploadId}/files`, {
    method: 'POST',
    body: JSON.stringify({
      files: [{ fileId: 'sch-1', fileName: 'schedule.png', mimeType: 'image/png', extractedText: 'Monday 11:00 AM - 6:00 PM' }]
    })
  });
  await requestJson(`/api/merlin/intake/upload-intents/${uploadId}/route`, { method: 'POST' });
  const preview = await requestJson<{
    mutationAllowed: boolean;
    implementationAllowed: boolean;
    applyEnabled: boolean;
    cleanupEnabled: boolean;
    intent: { status: string; preview: { sourceFiles: Array<{ fileId: string }>; mutationAllowed: boolean; implementationAllowed: boolean } };
  }>(`/api/merlin/intake/upload-intents/${uploadId}/preview`, { method: 'POST' });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.mutationAllowed, false);
  assert.equal(preview.body.implementationAllowed, false);
  assert.equal(['PREVIEW_READY', 'HELD_FOR_REVIEW'].includes(preview.body.intent.status), true);
  assert.equal(preview.body.intent.preview.sourceFiles[0].fileId, 'sch-1');
  assert.equal(preview.body.intent.preview.mutationAllowed, false);
  assert.equal(preview.body.intent.preview.implementationAllowed, false);
  assert.equal(preview.body.applyEnabled, false);
  assert.equal(preview.body.cleanupEnabled, false);

  const audit = await requestJson<{ records: unknown[] }>('/api/mealscout/intake/publish-plan/audit', {
    headers: { 'x-operator-role': 'admin' }
  });
  assert.equal(audit.status, 200);
  assert.equal(audit.body.records.length, 0);
});

test('flags endpoint reflects default safe behavior and actions endpoint lists MealScout actions', async () => {
  const flags = await requestJson<{ flags: Record<string, boolean> }>('/api/merlin/intake/flags');
  assert.equal(flags.status, 200);
  assert.equal(flags.body.flags.MERLIN_INTAKE_ENABLED, true);
  assert.equal(flags.body.flags.MERLIN_INTAKE_MEALSCOUT_ENABLED, true);
  assert.equal(flags.body.flags.MERLIN_INTAKE_APPLY_ENABLED, false);
  assert.equal(flags.body.flags.MERLIN_INTAKE_CLEANUP_ENABLED, false);

  const actions = await requestJson<{ actions: Array<{ brand: string; actionId: string }> }>('/api/merlin/intake/actions?brand=MEALSCOUT');
  assert.equal(actions.status, 200);
  assert.equal(actions.body.actions.some((row) => row.brand === 'MEALSCOUT' && row.actionId === 'update_menu'), true);
});
