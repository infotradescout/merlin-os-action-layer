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
    headers: { 'Content-Type': 'application/json', 'x-operator-id': 'thread-test-user', 'x-operator-role': 'admin', ...(init.headers || {}) },
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

test('thread routes persist messages and stage a preview through intent handoff', async () => {
  const created = await requestJson<{ thread: { id: string } }>('/api/merlin/threads', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: 'merlin-workspace-system',
      title: 'Thread test',
      brand: 'MEALSCOUT',
      actor_scope: 'owner',
      entity_type: 'food_truck',
      action_id: 'attach_menu_evidence'
    })
  });
  assert.equal(created.status, 201);

  const message = await requestJson<{ message: { role: string; attachments: Array<{ fileId: string }> } }>(
    `/api/merlin/threads/${encodeURIComponent(created.body.thread.id)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({
        role: 'user',
        message_text: 'Use these screenshots to review the account first.',
        attachments: [
          {
            fileId: 'acct-1',
            fileName: 'account.pdf',
            mimeType: 'application/pdf',
            extractedText: 'Sweet Heat Tacos New Orleans'
          }
        ]
      })
    }
  );
  assert.equal(message.status, 201);
  assert.equal(message.body.message.role, 'user');
  assert.equal(message.body.message.attachments[0].fileId, 'acct-1');

  const handoff = await requestJson<{
    thread: { status: string; latest_upload_intent_id: string };
    uploadIntent: { uploadId: string; preview: { sourceFiles: Array<{ fileId: string }> } };
    message: { role: string; linked_upload_intent_id: string };
  }>(`/api/merlin/threads/${encodeURIComponent(created.body.thread.id)}/intent-handoff`, {
    method: 'POST',
    body: JSON.stringify({
      brand: 'MEALSCOUT',
      actorScope: 'staff',
      entityType: 'food_truck',
      actionId: 'attach_menu_evidence'
    })
  });
  assert.equal(handoff.status, 201);
  assert.equal(['waiting_for_user', 'ready_for_preview'].includes(handoff.body.thread.status), true);
  assert.equal(handoff.body.thread.latest_upload_intent_id, handoff.body.uploadIntent.uploadId);
  assert.equal(handoff.body.uploadIntent.preview.sourceFiles[0].fileId, 'acct-1');
  assert.equal(handoff.body.message.role, 'assistant');

  const detail = await requestJson<{ thread: { id: string }; messages: Array<{ role: string }> }>(
    `/api/merlin/threads/${encodeURIComponent(created.body.thread.id)}`
  );
  assert.equal(detail.status, 200);
  assert.equal(detail.body.thread.id, created.body.thread.id);
  assert.equal(detail.body.messages.length >= 2, true);
});

test('thread handoff infers account-first context and returns account intake preview from plain language', async () => {
  const created = await requestJson<{ thread: { id: string } }>('/api/merlin/threads', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: 'merlin-workspace-system',
      title: 'Account-first thread'
    })
  });
  assert.equal(created.status, 201);

  await requestJson(`/api/merlin/threads/${encodeURIComponent(created.body.thread.id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      role: 'user',
      message_text: 'Process accounts first. Skip logos and menus. Review business facts only.',
      attachments: [
        {
          fileId: 'acct-2',
          fileName: 'sweet-heat-account.pdf',
          mimeType: 'application/pdf',
          extractedText: [
            'Sweet Heat Tacos',
            'Food Truck',
            '123 Canal St',
            'New Orleans, LA 70112',
            'Phone: 504-555-0123',
            'Email: hello@sweetheat.example',
            'Website: https://sweetheat.example',
            'Service Area: New Orleans Metro'
          ].join('\n')
        }
      ]
    })
  });

  const handoff = await requestJson<{
    inferredIntent: { actionId: string };
    uploadIntent: {
      actionId: string;
      preview: {
        detectedChanges: {
          accountIntake?: {
            kind: string;
            businessName: string;
          };
        };
      };
    };
  }>(`/api/merlin/threads/${encodeURIComponent(created.body.thread.id)}/intent-handoff`, {
    method: 'POST',
    body: JSON.stringify({})
  });

  assert.equal(handoff.status, 201);
  assert.equal(handoff.body.inferredIntent.actionId, 'account_intake_review');
  assert.equal(handoff.body.uploadIntent.actionId, 'account_intake_review');
  assert.equal(handoff.body.uploadIntent.preview.detectedChanges.accountIntake?.kind, 'account_intake');
  assert.equal(handoff.body.uploadIntent.preview.detectedChanges.accountIntake?.businessName, 'Sweet Heat Tacos');
});
