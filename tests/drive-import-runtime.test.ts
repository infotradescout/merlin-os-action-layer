import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-v1-5-'));
process.env.MERLIN_DB_PATH = resolve(tempDir, 'merlin-or.sqlite');
process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeAllMerlinStoresForTest } = await import('./testSupport/closeAllStores.ts');

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

type DriveImportResponse = {
  status: string;
  status_hint: 'processed' | 'needs_review' | 'skipped' | 'failed';
  manifest_entry: {
    id: string;
    drive_file_id: string;
    processing_status: string;
  };
  event_id?: string;
};

before(async () => {
  server = createMerlinServer();
  await new Promise<void>((resolve, reject) => {
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Server did not bind to a numeric port'));
        return;
      }
      baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  closeAllMerlinStoresForTest();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
});

test('import supported PDF creates manifest entry', async () => {
  const entityId = `business-drive-${Date.now()}`;
  const response = await requestJson<DriveImportResponse>('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-supported-001',
      file_name: 'insurance.pdf',
      mime_type: 'application/pdf',
      folder_path: 'Merlin OR Storage/01_Processed/contracts',
      web_url: 'https://drive.google.com/file/d/file-supported-001',
      entity_id: entityId,
      observed_at: '2026-05-24T12:00:00.000Z',
      raw_metadata: {
        source: 'manual-test'
      }
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.status_hint, 'processed');
  assert.equal(response.body.manifest_entry.processing_status, 'processed');
  assert.equal(typeof response.body.event_id, 'string');
});

test('unsupported file import marks skipped or needs_review', async () => {
  const response = await requestJson<DriveImportResponse>('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-unsupported-001',
      file_name: 'malware.exe',
      mime_type: 'application/x-msdownload',
      folder_path: 'Merlin OR Storage/01_Processed',
      web_url: 'https://drive.google.com/file/d/file-unsupported-001',
      entity_id: 'business-drive-unsupported',
      observed_at: '2026-05-24T12:01:00.000Z'
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.manifest_entry.processing_status === 'skipped' || response.body.status_hint === 'needs_review', true);
});

test('imported file appears in manifest list', async () => {
  const response = await requestJson<DriveImportResponse>('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-list-001',
      file_name: 'insurance.pdf',
      mime_type: 'application/pdf',
      folder_path: 'Merlin OR Storage/01_Processed/contracts',
      web_url: 'https://drive.google.com/file/d/file-list-001',
      entity_id: 'business-drive-list',
      observed_at: '2026-05-24T12:02:00.000Z'
    })
  });
  assert.equal(response.status, 200);

  const manifest = await requestJson<{ manifest_entries: Array<{ drive_file_id: string }> }>(
    '/api/drive/manifest?limit=20'
  );
  assert.equal(manifest.status, 200);
  assert.equal(manifest.body.manifest_entries.some((entry) => entry.drive_file_id === 'file-list-001'), true);
});

test('imported file lookup by drive_file_id works', async () => {
  const response = await requestJson<DriveImportResponse>('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-lookup-001',
      file_name: 'insurance.pdf',
      mime_type: 'application/pdf',
      folder_path: 'Merlin OR Storage/01_Processed/contracts',
      web_url: 'https://drive.google.com/file/d/file-lookup-001',
      entity_id: 'business-drive-lookup',
      observed_at: '2026-05-24T12:03:00.000Z'
    })
  });
  assert.equal(response.status, 200);

  const lookup = await requestJson<{ manifest_entry: { drive_file_id: string } }>(
    `/api/drive/manifest/${encodeURIComponent('file-lookup-001')}`
  );
  assert.equal(lookup.status, 200);
  assert.equal(lookup.body.manifest_entry.drive_file_id, 'file-lookup-001');
});

test('needs_review endpoint returns review records', async () => {
  const response = await requestJson<DriveImportResponse>('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-review-001',
      file_name: 'receipt.png',
      mime_type: 'image/png',
      folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: 'https://drive.google.com/file/d/file-review-001',
      entity_id: 'business-drive-review',
      observed_at: '2026-05-24T12:04:00.000Z'
    })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.manifest_entry.processing_status, 'needs_review');

  const needsReview = await requestJson('/api/drive/needs-review');
  assert.equal(needsReview.status, 200);
  assert.equal(
    ((needsReview.body as { manifest_entries: Array<{ drive_file_id: string }> }).manifest_entries.some(
      (entry) => entry.drive_file_id === 'file-review-001'
    )),
    true
  );
});

test('Drive import appears in LISA search when eligible', async () => {
  const entityId = 'business-drive-search';
  const imported = await requestJson<DriveImportResponse>('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-search-001',
      file_name: 'vendor_profile.pdf',
      mime_type: 'application/pdf',
      folder_path: 'Merlin OR Storage/01_Processed/contracts',
      web_url: 'https://drive.google.com/file/d/file-search-001',
      entity_id: entityId,
      observed_at: '2026-05-24T12:05:00.000Z'
    })
  });
  assert.equal(imported.status, 200);

  const search = await requestJson<{ query: string; results: Array<{ type: string; entity_id?: string }> }>(
    `/api/lisa/search?q=${encodeURIComponent(entityId)}&limit=40`
  );
  assert.equal(search.status, 200);
  assert.equal(search.body.results.length > 0, true);
  assert.equal(search.body.results.some((item) => item.entity_id === entityId), true);
});

test('extracted text appears in LISA search and replay records extraction lifecycle', async () => {
  const uniqueText = `roofing-checklist-${Date.now()}`;
  const imported = await requestJson<DriveImportResponse>('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-extract-001',
      file_name: 'notes.txt',
      mime_type: 'text/plain',
      folder_path: 'Merlin OR Storage/01_Processed/contracts',
      web_url: 'https://drive.google.com/file/d/file-extract-001',
      entity_id: 'business-drive-extract',
      observed_at: '2026-05-24T12:08:00.000Z',
      raw_metadata: {
        text_content: `Drive extraction content ${uniqueText}`
      }
    })
  });
  assert.equal(imported.status, 200);

  const search = await requestJson<{ results: Array<{ id: string; summary: string }> }>(
    `/api/lisa/search?q=${encodeURIComponent(uniqueText)}`
  );
  assert.equal(search.status, 200);
  assert.equal(search.body.results.some((result) => result.id === imported.body.manifest_entry.id), true);

  const replay = await requestJson<{ replay_events: Array<{ event_type: string }> }>('/api/replay/recent?limit=50');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replay_events.some((event) => event.event_type === 'drive_file_extraction_completed'), true);
});

test('Drive import lifecycle emits replay events', async () => {
  const imported = await requestJson<DriveImportResponse>('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-replay-001',
      file_name: 'menu.pdf',
      mime_type: 'application/pdf',
      folder_path: 'Merlin OR Storage/01_Processed/contracts',
      web_url: 'https://drive.google.com/file/d/file-replay-001',
      entity_id: 'business-drive-replay',
      observed_at: '2026-05-24T12:06:00.000Z'
    })
  });
  assert.equal(imported.status, 200);

  const replay = await requestJson<{ replay_events: Array<{ event_type: string }> }>('/api/replay/recent?limit=50');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replay_events.some((event) => event.event_type === 'drive_import_received'), true);
  assert.equal(replay.body.replay_events.some((event) => event.event_type === 'drive_import_processed'), true);
});

test('reset clears import state', async () => {
  const first = await requestJson<DriveImportResponse>('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'file-reset-001',
      file_name: 'receipt.pdf',
      mime_type: 'application/pdf',
      folder_path: 'Merlin OR Storage/01_Processed/contracts',
      web_url: 'https://drive.google.com/file/d/file-reset-001',
      entity_id: 'business-drive-reset',
      observed_at: '2026-05-24T12:07:00.000Z'
    })
  });
  assert.equal(first.status, 200);

  const manifestBeforeReset = await requestJson<{ manifest_entries: unknown[] }>('/api/drive/manifest');
  assert.equal(manifestBeforeReset.body.manifest_entries.length >= 1, true);

  const resetResponse = await requestJson<{ status: string }>('/api/demo/reset', { method: 'POST' });
  assert.equal(resetResponse.status, 200);
  assert.equal(resetResponse.body.status, 'ok');

  const manifestAfterReset = await requestJson<{ manifest_entries: unknown[] }>('/api/drive/manifest');
  assert.equal(manifestAfterReset.body.manifest_entries.length, 0);

  const replayAfterReset = await requestJson<{ replay_events: unknown[] }>('/api/replay/recent');
  assert.equal(replayAfterReset.body.replay_events.length, 0);
});
