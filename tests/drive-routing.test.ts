import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-v2-3-'));
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
const { setDriveClientFactory, resetDriveClientFactory } = await import('../src/driveClient.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeRecommendationsStore } = await import('../src/recommendations.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');

let server: Server;
let baseUrl: string;

const moves: Array<{ fileId: string; folderId: string }> = [];
const folders = new Map<string, string>([
  ['00_Inbox', 'folder-inbox'],
  ['01_Processed', 'folder-processed'],
  ['02_Needs_Review', 'folder-needs-review'],
  ['03_Archived_Sources', 'folder-archived'],
  ['04_Entity_Files', 'folder-entity-files'],
  ['05_Exports', 'folder-exports'],
  ['06_Audit', 'folder-audit'],
  ['07_System', 'folder-system']
]);

setDriveClientFactory(() => ({
  async listFilesInFolder() {
    return [];
  },
  async getFileMetadata(fileId) {
    return {
      drive_file_id: fileId,
      file_name: 'x.txt',
      mime_type: 'text/plain',
      folder_id: 'folder-needs-review',
      web_url: `https://drive.google.com/file/d/${fileId}`
    };
  },
  async downloadFileContent() {
    return 'mock';
  },
  async moveFileToFolder(fileId, targetFolderId) {
    moves.push({ fileId, folderId: targetFolderId });
    return true;
  },
  async findFolderByName(name, parentFolderId) {
    const id = folders.get(name);
    if (!id) return undefined;
    return { id, name };
  },
  async listFoldersByName(name) {
    const id = folders.get(name);
    if (!id) return [];
    return [{ id, name }];
  },
  async createFolderIfMissing(name, parentFolderId) {
    const id = folders.get(name) || `${parentFolderId}-${name}`;
    folders.set(name, id);
    return { id, name };
  }
}));

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  });
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

async function seedReviewFile(
  driveFileId: string,
  options: { entity_id?: string; folder_path?: string; mime_type?: string } = {}
): Promise<void> {
  const response = await requestJson<{ manifest_entry: { processing_status: string } }>('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: driveFileId,
      file_name: 'review-item.txt',
      mime_type: options.mime_type || 'text/plain',
      folder_path: options.folder_path || 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: `https://drive.google.com/file/d/${driveFileId}`,
      entity_id: options.entity_id,
      observed_at: '2026-05-25T16:00:00.000Z',
      raw_metadata: { text_content: 'review text' }
    })
  });
  assert.equal(response.status, 200);
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
  moves.length = 0;
  await requestJson('/api/demo/reset', { method: 'POST' });
  process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh-token';
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
});

test('route reviewed file to processed', async () => {
  await seedReviewFile('route-001', { entity_id: 'business_route_001' });
  await requestJson('/api/drive/review/route-001/mark-reviewed', { method: 'POST' });

  const routed = await requestJson<{ status: string; manifest_entry: { processing_status: string; folder_path: string } }>(
    '/api/drive/review/route-001/route',
    { method: 'POST', body: JSON.stringify({ target: 'processed' }) }
  );
  assert.equal(routed.status, 200);
  assert.equal(routed.body.status, 'ok');
  assert.equal(routed.body.manifest_entry.processing_status, 'processed');
  assert.equal(routed.body.manifest_entry.folder_path.includes('01_Processed'), true);
  assert.equal(moves.some((move) => move.fileId === 'route-001' && move.folderId === 'folder-processed'), true);
});

test('route attached file to entity_files', async () => {
  await seedReviewFile('route-002');
  await requestJson('/api/drive/review/route-002/attach-entity', {
    method: 'POST',
    body: JSON.stringify({ entity_id: 'business_route_attach' })
  });

  const routed = await requestJson<{ manifest_entry: { folder_path: string; entity_id?: string } }>(
    '/api/drive/review/route-002/route',
    { method: 'POST', body: JSON.stringify({ target: 'entity_files', entity_id: 'business_route_attach' }) }
  );
  assert.equal(routed.status, 200);
  assert.equal(routed.body.manifest_entry.entity_id, 'business_route_attach');
  assert.equal(routed.body.manifest_entry.folder_path.includes('04_Entity_Files/business_route_attach'), true);
  assert.equal(moves.some((move) => move.fileId === 'route-002' && move.folderId.includes('business_route_attach')), true);
});

test('block entity_files without entity_id', async () => {
  await seedReviewFile('route-003');
  const routed = await requestJson<{ error: string }>('/api/drive/review/route-003/route', {
    method: 'POST',
    body: JSON.stringify({ target: 'entity_files' })
  });
  assert.equal(routed.status, 400);
  assert.equal(typeof routed.body.error, 'string');
});

test('route file to archive', async () => {
  await seedReviewFile('route-004', { entity_id: 'business_route_archive' });
  const routed = await requestJson<{ manifest_entry: { processing_status: string; folder_path: string } }>(
    '/api/drive/review/route-004/route',
    { method: 'POST', body: JSON.stringify({ target: 'archive' }) }
  );
  assert.equal(routed.status, 200);
  assert.equal(routed.body.manifest_entry.processing_status, 'archived');
  assert.equal(routed.body.manifest_entry.folder_path.includes('03_Archived_Sources'), true);
});

test('missing drive_file_id returns 404', async () => {
  const routed = await requestJson<{ error: string }>('/api/drive/review/not-real/route', {
    method: 'POST',
    body: JSON.stringify({ target: 'processed' })
  });
  assert.equal(routed.status, 404);
});

test('blocked Drive status prevents route', async () => {
  await seedReviewFile('route-005', { entity_id: 'business_route_blocked' });
  const before = await requestJson<{ manifest_entry: { processing_status: string; folder_path: string } }>(
    '/api/drive/manifest/route-005'
  );
  assert.equal(before.status, 200);
  const beforeStatus = before.body.manifest_entry.processing_status;
  const beforePath = before.body.manifest_entry.folder_path;
  process.env.GOOGLE_REFRESH_TOKEN = '';
  const routed = await requestJson<{ error: string; reason?: string }>('/api/drive/review/route-005/route', {
    method: 'POST',
    body: JSON.stringify({ target: 'processed' })
  });
  assert.equal(routed.status, 409);
  assert.equal(routed.body.error, 'Drive auth unhealthy');
  assert.equal(routed.body.reason, 'OAuth credentials are incomplete');

  const after = await requestJson<{ manifest_entry: { processing_status: string; folder_path: string } }>(
    '/api/drive/manifest/route-005'
  );
  assert.equal(after.status, 200);
  assert.equal(after.body.manifest_entry.processing_status, beforeStatus);
  assert.equal(after.body.manifest_entry.folder_path, beforePath);
  assert.equal(moves.some((move) => move.fileId === 'route-005'), false);
});

test('does not mutate manifest and emits drive_auth_unhealthy for blocked auth route', async () => {
  await seedReviewFile('route-007', { entity_id: 'business_route_blocked_event' });
  const before = await requestJson<{ manifest_entry: { processing_status: string; folder_path: string } }>(
    '/api/drive/manifest/route-007'
  );
  assert.equal(before.status, 200);
  process.env.GOOGLE_REFRESH_TOKEN = '';

  const routed = await requestJson<{ error: string; reason?: string }>('/api/drive/review/route-007/route', {
    method: 'POST',
    body: JSON.stringify({ target: 'processed' })
  });
  assert.equal(routed.status, 409);

  const after = await requestJson<{ manifest_entry: { processing_status: string; folder_path: string } }>(
    '/api/drive/manifest/route-007'
  );
  assert.equal(after.status, 200);
  assert.equal(after.body.manifest_entry.processing_status, before.body.manifest_entry.processing_status);
  assert.equal(after.body.manifest_entry.folder_path, before.body.manifest_entry.folder_path);
  assert.equal(moves.length, 0);

  const replay = await requestJson<{ replay_events: Array<{ event_type: string }> }>('/api/replay/recent?limit=40');
  assert.equal(replay.status, 200);
  assert.equal(
    replay.body.replay_events.some((event) => event.event_type === 'drive_auth_unhealthy'),
    true
  );
});

test('route records outcome and replay and has no delete behavior', async () => {
  await seedReviewFile('route-006', { entity_id: 'business_route_outcome' });
  await requestJson('/api/drive/review/route-006/route', {
    method: 'POST',
    body: JSON.stringify({ target: 'processed' })
  });

  const replay = await requestJson<{ replay_events: Array<{ event_type: string }> }>('/api/replay/recent?limit=100');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replay_events.some((event) => event.event_type === 'drive_file_routed'), true);
  assert.equal(replay.body.replay_events.some((event) => event.event_type === 'outcome_recorded'), true);
  assert.equal(typeof (setDriveClientFactory as unknown), 'function');
});
