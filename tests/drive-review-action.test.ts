import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-v2-0-'));
process.env.MERLIN_DB_PATH = resolve(tempDir, 'merlin-or.sqlite');
process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeRecommendationsStore } = await import('../src/recommendations.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');

let server: Server;
let baseUrl: string;

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...init
  });
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

before(async () => {
  server = createMerlinServer();
  await new Promise<void>((resolveStart, reject) => {
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Server did not bind to a numeric port'));
        return;
      }
      baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
      resolveStart();
    });
  });
});

after(async () => {
  await new Promise<void>((resolveStop) => {
    server.close(() => resolveStop());
  });
  closeLisaStore();
  closeDriveManifestStore();
  closeRecommendationsStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
});

test('mark needs_review file reviewed', async () => {
  const imported = await requestJson<{
    manifest_entry: { drive_file_id: string; processing_status: string };
  }>('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-v2-review-001',
      file_name: 'receipt.png',
      mime_type: 'image/png',
      folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: 'https://drive.google.com/file/d/file-v2-review-001',
      entity_id: 'business-v2-review',
      observed_at: '2026-05-25T12:00:00.000Z'
    })
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.manifest_entry.processing_status, 'needs_review');

  const reviewed = await requestJson<{
    status: string;
    manifest_entry: { processing_status: string };
  }>('/api/drive/review/file-v2-review-001/mark-reviewed', { method: 'POST' });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.status, 'ok');
  assert.equal(reviewed.body.manifest_entry.processing_status, 'processed');
});

test('reviewed file disappears from needs-review endpoint', async () => {
  await requestJson('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-v2-review-002',
      file_name: 'scan.png',
      mime_type: 'image/png',
      folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: 'https://drive.google.com/file/d/file-v2-review-002',
      entity_id: 'business-v2-review',
      observed_at: '2026-05-25T12:01:00.000Z'
    })
  });

  await requestJson('/api/drive/review/file-v2-review-002/mark-reviewed', { method: 'POST' });

  const needsReview = await requestJson<{ manifest_entries: Array<{ drive_file_id: string }> }>('/api/drive/needs-review');
  assert.equal(needsReview.status, 200);
  assert.equal(needsReview.body.manifest_entries.some((entry) => entry.drive_file_id === 'file-v2-review-002'), false);
});

test('mark reviewed records outcome and replay event', async () => {
  await requestJson('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-v2-review-003',
      file_name: 'unknown.bin',
      mime_type: 'application/octet-stream',
      folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: 'https://drive.google.com/file/d/file-v2-review-003',
      entity_id: 'business-v2-review',
      observed_at: '2026-05-25T12:02:00.000Z'
    })
  });

  await requestJson('/api/drive/review/file-v2-review-003/mark-reviewed', { method: 'POST' });

  const replay = await requestJson<{ replay_events: Array<{ event_type: string; source_refs: string[] }> }>(
    '/api/replay/recent?limit=60'
  );
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replay_events.some((event) => event.event_type === 'drive_file_reviewed'), true);
  assert.equal(replay.body.replay_events.some((event) => event.event_type === 'outcome_recorded'), true);
});

test('invalid drive_file_id returns 404', async () => {
  const response = await requestJson<{ error: string }>('/api/drive/review/not-found/mark-reviewed', { method: 'POST' });
  assert.equal(response.status, 404);
  assert.equal(typeof response.body.error, 'string');
});

test('already processed file is handled safely', async () => {
  await requestJson('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-v2-review-004',
      file_name: 'invoice.pdf',
      mime_type: 'application/pdf',
      folder_path: 'Merlin OR Storage/01_Processed/2026-05',
      web_url: 'https://drive.google.com/file/d/file-v2-review-004',
      entity_id: 'business-v2-review',
      observed_at: '2026-05-25T12:03:00.000Z'
    })
  });

  const response = await requestJson<{ error: string; processing_status: string }>(
    '/api/drive/review/file-v2-review-004/mark-reviewed',
    { method: 'POST' }
  );
  assert.equal(response.status, 409);
  assert.equal(response.body.processing_status, 'processed');
});
