import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.MERLIN_RUNTIME = 'test';
process.env.MERLIN_INTAKE_ENABLED = 'true';
process.env.MERLIN_INTAKE_MEALSCOUT_ENABLED = 'true';
process.env.MERLIN_INTAKE_APPLY_ENABLED = 'false';
process.env.MERLIN_INTAKE_CLEANUP_ENABLED = 'false';

const { createMerlinServer } = await import('../src/server.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');

let server: Server;
let baseUrl = '';

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', 'x-operator-role': 'admin', ...(init.headers || {}) },
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

async function createIntent(actionId: string) {
  const created = await requestJson<{ intent: { uploadId: string } }>('/api/merlin/intake/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'u-1',
      accountId: 'a-1',
      brand: 'MEALSCOUT',
      actorScope: 'owner',
      entityType: 'food_truck',
      entityId: 'truck-1',
      actionId
    })
  });
  assert.equal(created.status, 201);
  return created.body.intent.uploadId;
}

test('upload intent cannot be created with unregistered actionId', async () => {
  const invalid = await requestJson<{ error: string }>('/api/merlin/intake/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'u-1',
      accountId: 'a-1',
      brand: 'MEALSCOUT',
      actorScope: 'owner',
      entityType: 'food_truck',
      entityId: 'truck-1',
      actionId: 'not_registered'
    })
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'INVALID_INTENT');
});

test('MealScout owner update_menu intent snapshots allowed/forbidden fields', async () => {
  const uploadId = await createIntent('update_menu');
  const attached = await requestJson<{
    intent: {
      uploadId: string;
      actionId: string;
      implementationAllowed: boolean;
      previewRequired: boolean;
      approvalRequired: boolean;
      actionSnapshot: { allowedFieldPaths: string[]; forbiddenFieldPaths: string[] };
    };
  }>(`/api/merlin/intake/upload-intents/${uploadId}/files`, {
    method: 'POST',
    body: JSON.stringify({
      files: [{ fileId: 'f-1', fileName: 'menu.jpg', mimeType: 'image/jpeg' }]
    })
  });
  assert.equal(attached.status, 200);
  assert.equal(attached.body.intent.actionId, 'update_menu');
  assert.equal(attached.body.intent.implementationAllowed, false);
  assert.equal(attached.body.intent.previewRequired, true);
  assert.equal(attached.body.intent.approvalRequired, true);
  assert.equal(attached.body.intent.actionSnapshot.allowedFieldPaths.includes('menu.items'), true);
  assert.equal(attached.body.intent.actionSnapshot.forbiddenFieldPaths.includes('businessName'), true);
});

test('update_menu action biases menu screenshot toward menu routing', async () => {
  const uploadId = await createIntent('update_menu');
  await requestJson(`/api/merlin/intake/upload-intents/${uploadId}/files`, {
    method: 'POST',
    body: JSON.stringify({
      files: [
        {
          fileId: 'menu-1',
          fileName: 'menu-specials.jpg',
          mimeType: 'image/jpeg',
          extractedText: "TRACI'S CHERISHED CREATIONS\nMENU\nWings 10.00"
        }
      ]
    })
  });
  const routed = await requestJson<{ routingDecisions: Array<{ routedType: string; confidence: number; reasons: string[] }> }>(
    `/api/merlin/intake/upload-intents/${uploadId}/route`,
    { method: 'POST' }
  );
  const row = routed.body.routingDecisions[0];
  assert.equal(row.routedType, 'menu');
  assert.equal(row.confidence >= 0.85, true);
  assert.equal(row.reasons.includes('action_bias_update_menu'), true);
});

test('update_schedule action biases schedule screenshot and cannot update identity fields', async () => {
  const uploadId = await createIntent('update_schedule');
  const attached = await requestJson<{ intent: { actionSnapshot: { forbiddenFieldPaths: string[] } } }>(
    `/api/merlin/intake/upload-intents/${uploadId}/files`,
    {
      method: 'POST',
      body: JSON.stringify({
        files: [
          {
            fileId: 'sched-1',
            fileName: 'weekly-schedule.png',
            mimeType: 'image/png',
            extractedText: 'Monday 11:00 AM - 6:00 PM\nTuesday 11:00 AM - 6:00 PM'
          }
        ]
      })
    }
  );
  assert.equal(attached.body.intent.actionSnapshot.forbiddenFieldPaths.includes('businessName'), true);
  const routed = await requestJson<{ routingDecisions: Array<{ routedType: string; confidence: number; reasons: string[] }> }>(
    `/api/merlin/intake/upload-intents/${uploadId}/route`,
    { method: 'POST' }
  );
  const row = routed.body.routingDecisions[0];
  assert.equal(row.routedType, 'schedule');
  assert.equal(row.confidence >= 0.85, true);
  assert.equal(row.reasons.includes('action_bias_update_schedule'), true);
});

test('files cannot attach without a valid upload intent', async () => {
  const attached = await requestJson<{ error: string }>(`/api/merlin/intake/upload-intents/upload-intent-does-not-exist/files`, {
    method: 'POST',
    body: JSON.stringify({ files: [{ fileId: 'f-1' }] })
  });
  assert.equal(attached.status, 404);
});

test('admin/staff action still requires preview and TradeScout-style evidence is held', async () => {
  const created = await requestJson<{ intent: { uploadId: string } }>('/api/merlin/intake/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'staff-1',
      accountId: 'a-1',
      brand: 'MEALSCOUT',
      actorScope: 'staff',
      entityType: 'food_truck',
      actionId: 'attach_menu_evidence'
    })
  });
  const uploadId = created.body.intent.uploadId;
  await requestJson(`/api/merlin/intake/upload-intents/${uploadId}/files`, {
    method: 'POST',
    body: JSON.stringify({
      files: [
        {
          fileId: 'trade-file',
          fileName: 'contractor-license.pdf',
          mimeType: 'application/pdf',
          extractedText: 'TradeScout contractor insurance and license update'
        }
      ]
    })
  });
  const routed = await requestJson<{ routingDecisions: Array<{ routedType: string; holdReason?: string }> }>(
    `/api/merlin/intake/upload-intents/${uploadId}/route`,
    { method: 'POST' }
  );
  assert.equal(routed.body.routingDecisions[0].routedType, 'held');
  assert.equal(['AMBIGUOUS_OR_WRONG_DOMAIN', 'unrelated'].includes(routed.body.routingDecisions[0].holdReason || ''), true);
  const preview = await requestJson<{
    mutationAllowed: boolean;
    intent: { implementationAllowed: boolean; status: string; preview: { sourceFiles: Array<{ fileId: string }> } };
  }>(`/api/merlin/intake/upload-intents/${uploadId}/preview`, { method: 'POST' });
  assert.equal(preview.body.mutationAllowed, false);
  assert.equal(preview.body.intent.implementationAllowed, false);
  assert.equal(['PREVIEW_READY', 'HELD_FOR_REVIEW'].includes(preview.body.intent.status), true);
  assert.equal(preview.body.intent.preview.sourceFiles[0].fileId, 'trade-file');
});

test('preview returns PREVIEW_READY/HELD_FOR_REVIEW with source refs and no publish execution', async () => {
  const uploadId = await createIntent('update_menu');
  await requestJson(`/api/merlin/intake/upload-intents/${uploadId}/files`, {
    method: 'POST',
    body: JSON.stringify({
      files: [
        {
          fileId: 'home-doc-1',
          fileName: 'hvac-warranty.pdf',
          mimeType: 'application/pdf',
          extractedText: 'HVAC warranty certificate for homeowner permit'
        }
      ]
    })
  });
  await requestJson(`/api/merlin/intake/upload-intents/${uploadId}/route`, { method: 'POST' });
  const preview = await requestJson<{
    mutationAllowed: boolean;
    intent: {
      status: string;
      implementationAllowed: boolean;
      preview: {
        holdReasons: string[];
        sourceFiles: Array<{ fileId: string }>;
      };
    };
  }>(`/api/merlin/intake/upload-intents/${uploadId}/preview`, { method: 'POST' });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.mutationAllowed, false);
  assert.equal(['PREVIEW_READY', 'HELD_FOR_REVIEW'].includes(preview.body.intent.status), true);
  assert.equal(preview.body.intent.implementationAllowed, false);
  assert.equal(preview.body.intent.preview.holdReasons.length >= 1, true);
  assert.equal(preview.body.intent.preview.sourceFiles[0].fileId, 'home-doc-1');

  const executionAudit = await requestJson<{ records: unknown[] }>('/api/mealscout/intake/publish-plan/audit');
  assert.equal(executionAudit.status, 200);
  assert.equal(executionAudit.body.records.length, 0);
});

