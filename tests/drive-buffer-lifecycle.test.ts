import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-drive-buffer-'));
process.env.MERLIN_DB_PATH = resolve(tempDir, 'merlin-or.sqlite');
process.env.MERLIN_RUNTIME = 'test';
process.env.MERLIN_INTAKE_ENABLED = 'true';
process.env.MERLIN_INTAKE_MEALSCOUT_ENABLED = 'true';
process.env.MERLIN_INTAKE_APPLY_ENABLED = 'false';
process.env.MERLIN_INTAKE_CLEANUP_ENABLED = 'false';

const { createMerlinServer } = await import('../src/server.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeDriveBufferLifecycleStore } = await import('../src/driveBufferLifecycle.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');
const { closeMerlinThreadRuntime } = await import('../src/merlin/threadRuntime.ts');
const { closeMerlinWorkspaceRuntime } = await import('../src/merlin/workspaceRuntime.ts');

let server: Server;
let baseUrl = '';

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-operator-id': 'drive-buffer-test-user',
      'x-operator-role': 'admin',
      ...(init.headers || {})
    },
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
  closeDriveBufferLifecycleStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
  closeMerlinThreadRuntime();
  closeMerlinWorkspaceRuntime();
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
});

test('buffer lifecycle record is created when drive file is first requested', async () => {
  const response = await requestJson<{
    mutationAllowed: boolean;
    lifecycle: { drive_file_id: string; lifecycle_state: string; note?: string };
  }>('/api/drive/buffer-lifecycle/file-buffer-001');

  assert.equal(response.status, 200);
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.lifecycle.drive_file_id, 'file-buffer-001');
  assert.equal(response.body.lifecycle.lifecycle_state, 'buffered');
});

test('drive import creates buffered record and thread flow advances it to preview_ready', async () => {
  await requestJson('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-buffer-002',
      file_name: 'account.pdf',
      mime_type: 'application/pdf',
      folder_path: 'Merlin OR Storage/00_Inbox/2026-07',
      web_url: 'https://drive.google.com/file/d/file-buffer-002',
      entity_id: 'business-buffer-002',
      observed_at: '2026-07-01T12:00:00.000Z'
    })
  });

  const created = await requestJson<{ thread: { id: string } }>('/api/merlin/threads', {
    method: 'POST',
    body: JSON.stringify({
      workspace_id: 'merlin-workspace-system',
      title: 'Drive buffer thread'
    })
  });
  assert.equal(created.status, 201);

  await requestJson(`/api/merlin/threads/${encodeURIComponent(created.body.thread.id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      role: 'user',
      message_text: 'Process accounts first and skip logos and menus.',
      attachments: [
        {
          fileId: 'file-buffer-002',
          fileName: 'account.pdf',
          mimeType: 'application/pdf',
          extractedText: [
            'Atlas Kitchen',
            'Food Truck',
            'Chicago, IL',
            'Service Area: North Side'
          ].join('\n')
        }
      ]
    })
  });

  const attached = await requestJson<{
    lifecycle: { lifecycle_state: string; thread_id?: string };
  }>('/api/drive/buffer-lifecycle/file-buffer-002');
  assert.equal(attached.status, 200);
  assert.equal(attached.body.lifecycle.lifecycle_state, 'attached_to_thread');
  assert.equal(typeof attached.body.lifecycle.thread_id, 'string');

  const handoff = await requestJson<{
    uploadIntent: { uploadId: string };
  }>(`/api/merlin/threads/${encodeURIComponent(created.body.thread.id)}/intent-handoff`, {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(handoff.status, 201);

  const previewReady = await requestJson<{
    lifecycle: { lifecycle_state: string; upload_intent_id?: string };
  }>('/api/drive/buffer-lifecycle/file-buffer-002');
  assert.equal(previewReady.status, 200);
  assert.equal(previewReady.body.lifecycle.lifecycle_state, 'preview_ready');
  assert.equal(previewReady.body.lifecycle.upload_intent_id, handoff.body.uploadIntent.uploadId);
});

test('cleanup flow requires acceptance and proof before marking cleaned', async () => {
  const preAccept = await requestJson<{
    error: string;
    lifecycle_state: string | null;
    mutationAllowed: boolean;
  }>('/api/drive/buffer-lifecycle/file-buffer-003/cleanup-ready', {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(preAccept.status, 409);
  assert.equal(preAccept.body.error, 'drive_file_not_ready_for_cleanup');
  assert.equal(preAccept.body.mutationAllowed, false);

  const accepted = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    lifecycle: { lifecycle_state: string; accepted_by?: string; proof_reference?: string };
  }>('/api/drive/buffer-lifecycle/file-buffer-003/accept', {
    method: 'POST',
    body: JSON.stringify({
      proof_reference: 'operator-review-proof-003',
      upload_intent_id: 'upload-intent-003'
    })
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.status, 'ok');
  assert.equal(accepted.body.mutationAllowed, false);
  assert.equal(accepted.body.lifecycle.lifecycle_state, 'accepted_for_apply');
  assert.equal(accepted.body.lifecycle.accepted_by, 'drive-buffer-test-user');
  assert.equal(accepted.body.lifecycle.proof_reference, 'operator-review-proof-003');

  const cleanupReady = await requestJson<{
    status: string;
    lifecycle: { lifecycle_state: string; proof_reference?: string };
  }>('/api/drive/buffer-lifecycle/file-buffer-003/cleanup-ready', {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(cleanupReady.status, 200);
  assert.equal(cleanupReady.body.status, 'ok');
  assert.equal(cleanupReady.body.lifecycle.lifecycle_state, 'cleanup_ready');
  assert.equal(cleanupReady.body.lifecycle.proof_reference, 'operator-review-proof-003');

  const cleaned = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    lifecycle: { lifecycle_state: string; cleanup_mode?: string };
  }>('/api/drive/buffer-lifecycle/file-buffer-003/clean', {
    method: 'POST',
    body: JSON.stringify({
      cleanup_mode: 'mark_only',
      note: 'accepted and ready for manual disposal'
    })
  });
  assert.equal(cleaned.status, 200);
  assert.equal(cleaned.body.status, 'ok');
  assert.equal(cleaned.body.mutationAllowed, false);
  assert.equal(cleaned.body.lifecycle.lifecycle_state, 'cleaned');
  assert.equal(cleaned.body.lifecycle.cleanup_mode, 'mark_only');
});

test('clean endpoint rejects non cleanup_ready records', async () => {
  const response = await requestJson<{
    error: string;
    lifecycle_state: string | null;
    mutationAllowed: boolean;
  }>('/api/drive/buffer-lifecycle/file-buffer-004/clean', {
    method: 'POST',
    body: JSON.stringify({
      cleanup_mode: 'mark_only'
    })
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'drive_file_not_ready_to_clean');
  assert.equal(response.body.lifecycle_state, null);
  assert.equal(response.body.mutationAllowed, false);
});
