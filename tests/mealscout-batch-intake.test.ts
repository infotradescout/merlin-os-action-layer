import assert from 'node:assert/strict';
import { before, after, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DriveClient } from '../src/driveClient.ts';

process.env.MERLIN_RUNTIME = 'test';
process.env.MERLIN_DRIVE_MODE = 'oauth';
process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
process.env.MERLIN_DRIVE_SYNC_MODE = 'manual';
process.env.MERLIN_DRIVE_ROOT_FOLDER_NAME = 'Merlin OR Storage';
process.env.GOOGLE_CLIENT_ID = 'test-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback';
process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';

const { createMerlinServer } = await import('../src/server.ts');
const { setDriveClientFactory, resetDriveClientFactory } = await import('../src/driveClient.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');

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
  resetDriveClientFactory();
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

function buildDriveClient(): DriveClient {
  return {
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'batch-profile-1',
          file_name: 'profile-1.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/profile-1',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown',
            extracted_text: 'Orbit Tacos\nPhone: 504-333-9090\nCity: Metairie',
            owner_email: 'rep1@example.com',
            owner_name: 'Rep One'
          }
        },
        {
          drive_file_id: 'batch-menu-1',
          file_name: 'menu-1.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/menu-1',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown',
            extracted_text: 'Quesadilla $10.00\nBirria Taco $4.25'
          }
        },
        {
          drive_file_id: 'batch-empty-1',
          file_name: 'empty-1.jpg',
          mime_type: 'image/jpeg',
          folder_id: folderId,
          web_url: 'https://example.com/empty-1',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown' }
        },
        {
          drive_file_id: 'batch-unsupported-1',
          file_name: 'notes.txt',
          mime_type: 'text/plain',
          folder_id: folderId,
          web_url: 'https://example.com/notes',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown' }
        }
      ];
    },
    async getFileMetadata() {
      throw new Error('not used');
    },
    async downloadFileContent(fileId: string) {
      if (fileId === 'batch-profile-1') return 'Orbit Tacos\nPhone: 504-333-9090\nCity: Metairie';
      if (fileId === 'batch-menu-1') return 'Quesadilla $10.00\nBirria Taco $4.25';
      return undefined;
    },
    async downloadFileBinary(fileId: string) {
      if (fileId === 'batch-empty-1') return Buffer.alloc(0);
      return undefined;
    },
    async moveFileToFolder() {
      throw new Error('moveFileToFolder must not be called');
    },
    async findFolderByName() {
      return undefined;
    },
    async listFoldersByName(name: string, parentId: string) {
      if (parentId === 'root' && name === 'Merlin OR Storage') return [{ id: 'folder-merlin-storage', name }];
      if (parentId === 'folder-merlin-storage' && name === 'MealScout Intake') return [{ id: 'folder-intake', name }];
      if (parentId === 'folder-intake' && name === 'incoming') return [{ id: 'folder-incoming', name }];
      if (parentId === 'folder-incoming' && name === 'unknown') return [{ id: 'folder-intake-unknown', name }];
      return [];
    },
    async createFolderIfMissing() {
      throw new Error('createFolderIfMissing must not be called');
    }
  };
}

test('unauthorized batch run is rejected', async () => {
  setDriveClientFactory(() => buildDriveClient());
  const response = await requestJson<{ error: string; mutationAllowed: boolean }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'viewer' },
    body: JSON.stringify({ mode: 'process', maxFiles: 3 })
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.mutationAllowed, false);
});

test('authorized batch run processes eligible files and reports skips with attribution', async () => {
  setDriveClientFactory(() => buildDriveClient());
  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    scannedFileCount: number;
    eligibleFileCount: number;
    processedFileCount: number;
    skippedFileCount: number;
    processedFiles: Array<{ fileId: string; classification: string; sourceFileAttribution?: { attributionSource: string; driveUploaderEmail?: string } }>;
    skippedFiles: Array<{ fileId: string; reason: string }>;
    draftCount: number;
  }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', maxFiles: 10 })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.scannedFileCount, 4);
  assert.equal(response.body.eligibleFileCount, 3);
  assert.equal(response.body.processedFileCount >= 2, true);
  assert.equal(response.body.skippedFiles.some((row) => row.reason === 'unsupported_type'), true);
  assert.equal(response.body.skippedFiles.some((row) => row.reason === 'empty_bytes'), true);
  assert.equal(response.body.processedFiles.some((row) => row.classification !== 'unknown'), true);
  assert.equal(
    response.body.processedFiles.some(
      (row) => row.sourceFileAttribution?.attributionSource === 'drive_metadata' && row.sourceFileAttribution?.driveUploaderEmail === 'rep1@example.com'
    ),
    true
  );
  assert.equal(response.body.draftCount >= 1, true);
});

test('batch run uses request-level attribution fallback when drive metadata is missing', async () => {
  setDriveClientFactory(() => buildDriveClient());
  const response = await requestJson<{
    processedFiles: Array<{ sourceFileAttribution?: { attributionSource: string; repId?: string; affiliateCode?: string } }>;
  }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', maxFiles: 1, repId: 'rep-fallback-1', affiliateCode: 'AFF-1', sourceChannel: 'manual_upload' })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.processedFiles.length >= 1, true);
  const attr = response.body.processedFiles[0].sourceFileAttribution;
  assert.ok(attr);
  assert.equal(['drive_metadata', 'request_context'].includes(attr.attributionSource), true);
});

test('second run skips already processed unless reprocess true', async () => {
  setDriveClientFactory(() => buildDriveClient());
  const first = await requestJson<{ processedFileCount: number }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', maxFiles: 2 })
  });
  assert.equal(first.status, 200);

  const second = await requestJson<{ skippedFiles: Array<{ reason: string }> }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', maxFiles: 2 })
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.skippedFiles.some((row) => row.reason === 'already_processed'), true);

  const third = await requestJson<{ processedFileCount: number }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', maxFiles: 2, reprocess: true })
  });
  assert.equal(third.status, 200);
  assert.equal(third.body.processedFileCount >= 1, true);
});
