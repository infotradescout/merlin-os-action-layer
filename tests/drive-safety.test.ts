import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-v2-4-'));
process.env.MERLIN_DB_PATH = resolve(tempDir, 'merlin-or.sqlite');
process.env.MERLIN_RUNTIME = 'test';
process.env.MERLIN_DRIVE_MODE = 'oauth';
process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
process.env.MERLIN_DRIVE_ROOT_MODE = 'dedicated_drive';
process.env.MERLIN_DRIVE_ROOT_FOLDER_NAME = 'Merlin OR Storage';
process.env.MERLIN_DRIVE_SYNC_MODE = 'manual';
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://127.0.0.1:8765';
process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';

const { createMerlinServer } = await import('../src/server.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { resetReplayForTest, closeReplayStore } = await import('../src/replay.ts');
const { setDriveClientFactory, resetDriveClientFactory } = await import('../src/driveClient.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeRecommendationsStore } = await import('../src/recommendations.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');

let server: Server;
let baseUrl: string;

const managedDriveFolders = new Map<string, string>([
  ['Merlin OR Storage', 'folder-root'],
  ['00_Inbox', 'folder-inbox'],
  ['01_Processed', 'folder-processed'],
  ['02_Needs_Review', 'folder-needs-review'],
  ['03_Archived_Sources', 'folder-archived'],
  ['04_Entity_Files', 'folder-entity-files'],
  ['05_Exports', 'folder-exports'],
  ['06_Audit', 'folder-audit'],
  ['07_System', 'folder-system']
]);

const mockDriveFilesByFolderId = new Map<string, Array<{ file_name: string; drive_file_id: string; mime_type: string; folder_id: string; web_url: string }>>();

function clearMockDriveFiles(): void {
  for (const folderId of managedDriveFolders.values()) {
    mockDriveFilesByFolderId.set(folderId, []);
  }
}

function setMockDriveFileInFolder(
  fileId: string,
  folderAlias: string,
  fileName: string,
  mimeType = 'text/plain'
): void {
  const folderId = managedDriveFolders.get(folderAlias);
  if (!folderId) return;
  const existing = mockDriveFilesByFolderId.get(folderId) ?? [];
  existing.push({
    file_name: fileName,
    drive_file_id: fileId,
    mime_type: mimeType,
    folder_id: folderId,
    web_url: `https://drive.google.com/file/d/${fileId}`
  });
  mockDriveFilesByFolderId.set(folderId, existing);
}

function createDriveHealthMockClient(): void {
  clearMockDriveFiles();

  setDriveClientFactory(() => ({
    async listFilesInFolder(folderId) {
      return mockDriveFilesByFolderId.get(folderId) ?? [];
    },
    async getFileMetadata(fileId) {
      return {
        drive_file_id: fileId,
        file_name: `file-${fileId}.txt`,
        mime_type: 'text/plain',
        folder_id: 'folder-needs-review',
        web_url: `https://drive.google.com/file/d/${fileId}`
      };
    },
    async downloadFileContent() {
      return 'mock';
    },
    async moveFileToFolder() {
      return true;
    },
    async findFolderByName(name) {
      const id = managedDriveFolders.get(name);
      if (!id) return undefined;
      return { id, name };
    },
    async listFoldersByName(name, parentFolderId) {
      if (parentFolderId === 'root' && name === 'Merlin OR Storage') {
        return [{ id: managedDriveFolders.get('Merlin OR Storage')!, name }];
      }
      const folderId = managedDriveFolders.get(name);
      if (!folderId || parentFolderId !== managedDriveFolders.get('Merlin OR Storage')) {
        return [];
      }
      return [{ id: folderId, name }];
    },
    async createFolderIfMissing(name) {
      const id = managedDriveFolders.get(name) || `folder-${name.toLowerCase()}`;
      managedDriveFolders.set(name, id);
      if (!mockDriveFilesByFolderId.has(id)) {
        mockDriveFilesByFolderId.set(id, []);
      }
      return { id, name };
    }
  }));
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  });
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

before(async () => {
  server = createMerlinServer();
  createDriveHealthMockClient();
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
  await new Promise<void>((resolveStop) => server.close(() => resolveStop()));
  resetDriveClientFactory();
  closeLisaStore();
  closeDriveManifestStore();
  closeRecommendationsStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  createDriveHealthMockClient();
  resetReplayForTest();
  process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
  await requestJson('/api/demo/reset', { method: 'POST' });
});

test('returns ready health with auth and managed folder readiness', async () => {
  const response = await requestJson<{
    status: 'ready' | 'disabled';
    auth: { ready: boolean; configured: boolean; reason: string | null; checkedAt: string };
    managedFolders: { ready: boolean; missing: string[] };
  }>('/api/drive/auth-health');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ready');
  assert.equal(response.body.auth.ready, true);
  assert.equal(response.body.auth.configured, true);
  assert.equal(response.body.managedFolders.ready, true);
  assert.deepEqual(response.body.managedFolders.missing, []);
  assert.equal(typeof response.body.auth.checkedAt, 'string');
});

test('returns disabled health when OAuth credentials are incomplete', async () => {
  process.env.GOOGLE_REFRESH_TOKEN = '';

  const response = await requestJson<{
    status: 'ready' | 'disabled';
    auth: { ready: boolean; configured: boolean; reason?: string; checkedAt: string };
    managedFolders: { ready: boolean; missing: string[] };
  }>('/api/drive/auth-health');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'disabled');
  assert.equal(response.body.auth.ready, false);
  assert.equal(response.body.managedFolders.ready, false);
  assert.equal(response.body.auth.reason, 'OAuth credentials are incomplete');
});

test('emits drive_auth_health_checked replay event', async () => {
  const response = await requestJson<{
    status: string;
    auth: { ready: boolean; configured: boolean; checkedAt: string };
  }>('/api/drive/auth-health');
  assert.equal(response.status, 200);

  const replay = await requestJson<{ replay_events: Array<{ event_type: string }> }>( '/api/replay/recent?limit=50');
  assert.equal(replay.status, 200);
  assert.equal(
    replay.body.replay_events.some((event) => event.event_type === 'drive_auth_health_checked'),
    true
  );
});

test('returns read-only reconciliation envelope', async () => {
  const response = await requestJson<{
    status: 'ok';
    mode: 'read_only';
    checkedAt: string;
    summary: { checked: number; driftCount: number; blockingCount: number; warningCount: number };
    drift: Array<{ drive_file_id: string; type: string }>;
  }>('/api/drive/reconciliation');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mode, 'read_only');
  assert.equal(response.body.summary.driftCount, 0);
  assert.equal(response.body.drift.length, 0);
});

test('detects wrong_folder drift from manifest and Drive mismatch', async () => {
  await requestJson('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'recon-wrong-folder-001',
      file_name: 'needs_review.pdf',
      mime_type: 'text/plain',
      folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: 'https://drive.google.com/file/d/recon-wrong-folder-001',
      observed_at: '2026-05-25T16:00:00.000Z'
    })
  });

  setMockDriveFileInFolder('recon-wrong-folder-001', '01_Processed', 'needs_review.pdf');
  const response = await requestJson<{ drift: Array<{ drive_file_id: string; type: string }> }>(
    '/api/drive/reconciliation'
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.drift.some((drift) => drift.drive_file_id === 'recon-wrong-folder-001'), true);
  assert.equal(response.body.drift.some((drift) => drift.type === 'wrong_folder'), true);
});

test('detects missing_drive_file drift and keeps manifest stable', async () => {
  const before = await requestJson<{ manifest_entry: { folder_path: string } }>(
    '/api/drive/import-file',
    {
      method: 'POST',
      body: JSON.stringify({
        drive_file_id: 'recon-missing-drive-001',
        file_name: 'missing.txt',
        mime_type: 'text/plain',
        folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
        web_url: 'https://drive.google.com/file/d/recon-missing-drive-001',
        observed_at: '2026-05-25T16:01:00.000Z'
      })
    }
  );
  assert.equal(before.status, 200);

  const response = await requestJson<{ drift: Array<{ drive_file_id: string; type: string }> }>(
    '/api/drive/reconciliation'
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.drift.some((drift) => drift.drive_file_id === 'recon-missing-drive-001'), true);
  assert.equal(response.body.drift.some((drift) => drift.type === 'missing_drive_file'), true);

  const manifest = await requestJson<{ manifest_entry: { folder_path: string; processing_status: string } }>(
    '/api/drive/manifest/recon-missing-drive-001'
  );
  assert.equal(manifest.status, 200);
  assert.equal(manifest.body.manifest_entry.folder_path, 'Merlin OR Storage/02_Needs_Review/2026-05');
});
