import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
process.env.MERLIN_DB_PATH = join(tmpdir(), `merlin-incremental-intake-${process.pid}-${Date.now()}.sqlite`);

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

function buildDriveClient(): DriveClient {
  return {
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'inc-profile-1',
          file_name: 'profile-1.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/profile-1',
          modified_time: '2026-06-01T01:00:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown',
            extracted_text: 'Orbit Tacos\nPhone: 504-333-9090\nCity: Metairie'
          }
        },
        {
          drive_file_id: 'inc-menu-1',
          file_name: 'menu-1.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/menu-1',
          modified_time: '2026-06-01T01:01:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown',
            extracted_text: 'Quesadilla $10.00\nBirria Taco $4.25'
          }
        },
        {
          drive_file_id: 'inc-profile-2',
          file_name: 'profile-2.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/profile-2',
          modified_time: '2026-06-01T01:02:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown',
            extracted_text: 'Delta Bites\nPhone: 504-444-9191\nCity: Kenner'
          }
        },
        {
          drive_file_id: 'inc-profile-3',
          file_name: 'profile-3.pdf',
          mime_type: 'application/pdf',
          folder_id: folderId,
          web_url: 'https://example.com/profile-3',
          modified_time: '2026-06-01T01:03:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown',
            extracted_text: 'Bayou Bowls\nPhone: 504-555-2222\nCity: New Orleans'
          }
        },
        {
          drive_file_id: 'inc-unsupported-1',
          file_name: 'notes.txt',
          mime_type: 'text/plain',
          folder_id: folderId,
          web_url: 'https://example.com/notes',
          modified_time: '2026-06-01T01:04:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown',
            extracted_text: 'ignore me'
          }
        }
      ];
    },
    async getFileMetadata() {
      throw new Error('not used');
    },
    async downloadFileContent(fileId: string) {
      if (fileId === 'inc-profile-1') return 'Orbit Tacos\nPhone: 504-333-9090\nCity: Metairie';
      if (fileId === 'inc-menu-1') return 'Quesadilla $10.00\nBirria Taco $4.25';
      if (fileId === 'inc-profile-2') return 'Delta Bites\nPhone: 504-444-9191\nCity: Kenner';
      if (fileId === 'inc-profile-3') return 'Bayou Bowls\nPhone: 504-555-2222\nCity: New Orleans';
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
  setDriveClientFactory(() => buildDriveClient());
  await requestJson('/api/demo/reset', { method: 'POST' });
});

test('unauthorized incremental intake request is rejected', async () => {
  const response = await requestJson<{ error: string; mutationAllowed: boolean }>('/api/mealscout/intake/incremental/next', {
    method: 'POST',
    headers: { 'x-operator-role': 'viewer' },
    body: JSON.stringify({ chunkSize: 2 })
  });
  assert.equal(response.status, 403);
  assert.equal(response.body.mutationAllowed, false);
});

test('incremental intake processes the next chunk and resumes by queue id', async () => {
  const first = await requestJson<{
    mutationAllowed: boolean;
    queue: { id: string; status: string; processed_count: number; last_cursor_file_id?: string };
    processedThisChunkCount: number;
    remainingEligibleCount: number;
    listedSupportedCount: number;
    done: boolean;
    processedFiles: Array<{ fileId: string; classification: string }>;
  }>('/api/mealscout/intake/incremental/next', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ chunkSize: 2 })
  });

  assert.equal(first.status, 200);
  assert.equal(first.body.mutationAllowed, false);
  assert.equal(first.body.listedSupportedCount, 4);
  assert.equal(first.body.processedThisChunkCount, 2);
  assert.equal(first.body.remainingEligibleCount, 2);
  assert.equal(first.body.done, false);
  assert.equal(first.body.queue.processed_count, 2);
  assert.deepEqual(
    first.body.processedFiles.map((row) => row.fileId),
    ['inc-profile-1', 'inc-menu-1']
  );

  const second = await requestJson<{
    queue: { id: string; status: string; processed_count: number; last_cursor_file_id?: string };
    processedThisChunkCount: number;
    remainingEligibleCount: number;
    done: boolean;
    processedFiles: Array<{ fileId: string }>;
  }>('/api/mealscout/intake/incremental/next', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ queueId: first.body.queue.id, chunkSize: 2 })
  });

  assert.equal(second.status, 200);
  assert.equal(second.body.queue.id, first.body.queue.id);
  assert.equal(second.body.processedThisChunkCount, 2);
  assert.equal(second.body.remainingEligibleCount, 0);
  assert.equal(second.body.done, true);
  assert.equal(second.body.queue.processed_count, 4);
  assert.equal(second.body.queue.status, 'completed');
  assert.equal(second.body.queue.last_cursor_file_id, 'inc-profile-3');
  assert.deepEqual(
    second.body.processedFiles.map((row) => row.fileId),
    ['inc-profile-2', 'inc-profile-3']
  );

  const detail = await requestJson<{
    mutationAllowed: boolean;
    queue: { id: string; processed_count: number; status: string; last_batch_id?: string };
  }>(`/api/mealscout/intake/incremental/queues/${first.body.queue.id}`, {
    headers: { 'x-operator-role': 'admin' }
  });

  assert.equal(detail.status, 200);
  assert.equal(detail.body.mutationAllowed, false);
  assert.equal(detail.body.queue.id, first.body.queue.id);
  assert.equal(detail.body.queue.processed_count, 4);
  assert.equal(detail.body.queue.status, 'completed');
  assert.ok(detail.body.queue.last_batch_id);

  const list = await requestJson<{
    mutationAllowed: boolean;
    queues: Array<{ id: string; processed_count: number; status: string }>;
  }>('/api/mealscout/intake/incremental/queues', {
    headers: { 'x-operator-role': 'admin' }
  });

  assert.equal(list.status, 200);
  assert.equal(list.body.mutationAllowed, false);
  assert.equal(list.body.queues.some((row) => row.id === first.body.queue.id && row.processed_count === 4 && row.status === 'completed'), true);
});
