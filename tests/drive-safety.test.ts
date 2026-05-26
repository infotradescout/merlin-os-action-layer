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
const { resetDriveSafetyStoreForTest } = await import('../src/driveSafetyStore.ts');
const { resetDriveReviewQueueForTest } = await import('../src/driveReviewQueue.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeRecommendationsStore } = await import('../src/recommendations.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');
const { closeDriveReviewQueueStore, initializeDriveReviewQueueStore } = await import('../src/driveReviewQueueStore.ts');

let server: Server;
let baseUrl: string;
let mockDriveMoveFileCalls = 0;

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
      mockDriveMoveFileCalls += 1;
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

async function readReviewQueueItemIdByDriveFileId(driveFileId: string): Promise<string> {
  const response = await requestJson<{
    status: 'ok';
    mode: 'read_only';
    mutationAllowed: false;
    checkedAt: string;
    summary: { itemCount: number };
    items: Array<{ id: string; status: string; manifestPath?: string; summary: string; type?: string }>;
  }>('/api/drive/review-queue');
  assert.equal(response.status, 200);
  const item = response.body.items.find((entry) => {
    const decoded = Buffer.from(entry.id, 'base64url').toString('utf8');
    return decoded.startsWith(`${driveFileId}|`) || entry.summary.includes(driveFileId);
  });
  assert.ok(item);
  return item.id;
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
  closeDriveReviewQueueStore();
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  createDriveHealthMockClient();
  resetReplayForTest();
  resetDriveSafetyStoreForTest();
  resetDriveReviewQueueForTest();
  mockDriveMoveFileCalls = 0;
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

test('emits a deduped drive_drift_detected event for repeated drift checks', async () => {
  await requestJson('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'recon-dedup-001',
      file_name: 'dedupe.txt',
      mime_type: 'text/plain',
      folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: 'https://drive.google.com/file/d/recon-dedup-001',
      observed_at: '2026-05-25T16:02:00.000Z'
    })
  });

  setMockDriveFileInFolder('recon-dedup-001', '01_Processed', 'dedupe.txt');
  await requestJson('/api/drive/reconciliation');
  await requestJson('/api/drive/reconciliation');

  const replay = await requestJson<{ replay_events: Array<{ event_type: string; summary: string }> }>(
    '/api/replay/recent?limit=50'
  );
  const driftDetectedEvents = replay.body.replay_events.filter(
    (event) => event.event_type === 'drive_drift_detected' && event.summary.includes('recon-dedup-001')
  );
  assert.equal(driftDetectedEvents.length, 1);
});

test('emits separate drift events for different drift instances', async () => {
  await requestJson('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'recon-missing-for-separate-event',
      file_name: 'missing-drift.txt',
      mime_type: 'text/plain',
      folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: 'https://drive.google.com/file/d/recon-missing-for-separate-event',
      observed_at: '2026-05-25T16:03:00.000Z'
    })
  });

  setMockDriveFileInFolder('recon-drive-only-001', '01_Processed', 'orphan.txt');

  const response = await requestJson<{ drift: Array<{ drive_file_id: string; type: string }> }>(
    '/api/drive/reconciliation'
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.drift.some((item) => item.drive_file_id === 'recon-missing-for-separate-event'), true);
  assert.equal(response.body.drift.some((item) => item.drive_file_id === 'recon-drive-only-001'), true);

  const replay = await requestJson<{ replay_events: Array<{ event_type: string }> }>('/api/replay/recent?limit=50');
  const driftDetectedEvents = replay.body.replay_events.filter((event) => event.event_type === 'drive_drift_detected');
  assert.equal(driftDetectedEvents.length, 2);
});

test('review queue returns read-only envelope', async () => {
  const response = await requestJson<{
    status: 'ok';
    mode: 'read_only';
    mutationAllowed: false;
    checkedAt: string;
    summary: { itemCount: number; openCount: number };
    items: Array<{ id: string }>;
  }>('/api/drive/review-queue');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mode, 'read_only');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(typeof response.body.checkedAt, 'string');
  assert.equal(response.body.summary.itemCount, response.body.items.length);
});

test('review queue maps reconciliation drift into queue items', async () => {
  await requestJson('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'review-queue-mismatch-001',
      file_name: 'mismatch.txt',
      mime_type: 'text/plain',
      folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: 'https://drive.google.com/file/d/review-queue-mismatch-001',
      observed_at: '2026-05-25T16:10:00.000Z'
    })
  });
  setMockDriveFileInFolder('review-queue-mismatch-001', '01_Processed', 'mismatch.txt');

  const response = await requestJson<{
    status: 'ok';
    mode: 'read_only';
    mutationAllowed: false;
    items: Array<{
      id: string;
      type: 'missing_folder' | 'unexpected_folder' | 'permission_drift' | 'manifest_mismatch' | 'unknown';
      status: 'open' | 'acknowledged' | 'deferred' | 'resolved_externally' | 'false_positive';
      source: 'drive_reconciliation';
      readOnly: true;
      severity: 'info' | 'warning' | 'critical';
      recommendedHumanAction: string;
      summary: string;
    }>;
  }>('/api/drive/review-queue');
  assert.equal(response.status, 200);
  const mapped = response.body.items.find((item) => item.summary.includes('review-queue-mismatch-001'));
  assert.ok(mapped);
  assert.equal(mapped.type, 'manifest_mismatch');
  assert.equal(mapped.source, 'drive_reconciliation');
  assert.equal(mapped.readOnly, true);
  assert.equal(typeof mapped.recommendedHumanAction, 'string');
});

test('decision endpoint records workflow metadata without Drive mutation', async () => {
  await requestJson('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'review-queue-decision-001',
      file_name: 'decision.txt',
      mime_type: 'text/plain',
      folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: 'https://drive.google.com/file/d/review-queue-decision-001',
      observed_at: '2026-05-25T16:11:00.000Z'
    })
  });
  setMockDriveFileInFolder('review-queue-decision-001', '01_Processed', 'decision.txt');
  const itemId = await readReviewQueueItemIdByDriveFileId('review-queue-decision-001');

  const manifestBefore = await requestJson<{ manifest_entry: { folder_path: string } }>(
    '/api/drive/manifest/review-queue-decision-001'
  );
  assert.equal(manifestBefore.status, 200);

  const response = await requestJson<{
    status: 'ok';
    mode: 'read_only';
    mutationAllowed: false;
    item: {
      status: string;
      lastDecision?: { decision: string; note?: string; decidedAt: string; decidedBy?: string };
      decisionHistory?: Array<{ decision: string; note?: string; decidedAt: string; decidedBy?: string }>;
    };
  }>(`/api/drive/review-queue/${encodeURIComponent(itemId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({
      decision: 'resolved_externally',
      decided_by: 'qa-review',
      note: 'Reviewed manually outside Merlin'
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.mode, 'read_only');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.item.status, 'resolved_externally');
  assert.equal(response.body.item.lastDecision?.decision, 'resolved_externally');
  assert.equal(response.body.item.lastDecision?.decidedBy, 'qa-review');
  assert.equal(response.body.item.lastDecision?.note, 'Reviewed manually outside Merlin');
  assert.equal(Array.isArray(response.body.item.decisionHistory), true);
  assert.equal(response.body.item.decisionHistory?.length, 1);
  assert.equal(response.body.item.decisionHistory?.[0]?.decision, 'resolved_externally');
  assert.equal(response.body.item.decisionHistory?.[0]?.source, 'drive_review_queue');
  assert.equal(response.body.item.decisionHistory?.[0]?.mutationAllowed, false);

  const historyResponse = await requestJson<{
    status: 'ok';
    mode: 'read_only';
    mutationAllowed: false;
    itemId: string;
    history: Array<{ decision: string; source: string; mutationAllowed: boolean }>;
  }>(`/api/drive/review-queue/${encodeURIComponent(itemId)}/history`);
  assert.equal(historyResponse.status, 200);
  assert.equal(historyResponse.body.mode, 'read_only');
  assert.equal(historyResponse.body.mutationAllowed, false);
  assert.equal(historyResponse.body.history.length, 1);
  assert.equal(historyResponse.body.history[0].decision, 'resolved_externally');
  assert.equal(historyResponse.body.history[0].source, 'drive_review_queue');
  assert.equal(historyResponse.body.history[0].mutationAllowed, false);

  const auditResponse = await requestJson<{
    status: 'ok';
    mode: 'read_only';
    mutationAllowed: false;
    records: Array<{ itemId: string; decision: string; source: string; mutationAllowed: boolean }>;
  }>('/api/drive/review-queue/audit?limit=20');
  assert.equal(auditResponse.status, 200);
  assert.equal(auditResponse.body.mode, 'read_only');
  assert.equal(auditResponse.body.mutationAllowed, false);
  assert.equal(auditResponse.body.records.some((record) => record.itemId === itemId), true);
  const audited = auditResponse.body.records.find((record) => record.itemId === itemId);
  assert.equal(audited?.decision, 'resolved_externally');
  assert.equal(audited?.source, 'drive_review_queue');
  assert.equal(audited?.mutationAllowed, false);

  const manifestAfter = await requestJson<{ manifest_entry: { folder_path: string } }>(
    '/api/drive/manifest/review-queue-decision-001'
  );
  assert.equal(manifestAfter.status, 200);
  assert.equal(manifestAfter.body.manifest_entry.folder_path, manifestBefore.body.manifest_entry.folder_path);
  assert.equal(mockDriveMoveFileCalls, 0);
});

test('review queue decision history persists across store restart', async () => {
  await requestJson('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'review-queue-persist-001',
      file_name: 'persist.txt',
      mime_type: 'text/plain',
      folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: 'https://drive.google.com/file/d/review-queue-persist-001',
      observed_at: '2026-05-25T16:13:00.000Z'
    })
  });
  setMockDriveFileInFolder('review-queue-persist-001', '01_Processed', 'persist.txt');
  const itemId = await readReviewQueueItemIdByDriveFileId('review-queue-persist-001');

  const firstDecision = await requestJson<{ status: 'ok' }>(
    `/api/drive/review-queue/${encodeURIComponent(itemId)}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({
        decision: 'defer',
        decided_by: 'persist-checker',
        note: 'Needs follow-up'
      })
    }
  );
  assert.equal(firstDecision.status, 200);

  closeDriveReviewQueueStore();
  initializeDriveReviewQueueStore(process.env.MERLIN_DB_PATH);

  const historyResponse = await requestJson<{
    status: 'ok';
    history: Array<{ decision: string; note?: string; decidedBy?: string; source: string; mutationAllowed: boolean }>;
  }>(`/api/drive/review-queue/${encodeURIComponent(itemId)}/history`);
  assert.equal(historyResponse.status, 200);
  assert.equal(historyResponse.body.history.length, 1);
  assert.equal(historyResponse.body.history[0].decision, 'defer');
  assert.equal(historyResponse.body.history[0].note, 'Needs follow-up');
  assert.equal(historyResponse.body.history[0].decidedBy, 'persist-checker');
  assert.equal(historyResponse.body.history[0].source, 'drive_review_queue');
  assert.equal(historyResponse.body.history[0].mutationAllowed, false);
  assert.equal(mockDriveMoveFileCalls, 0);
});

test('decision endpoint blocks with auth unhealthy and does not call mutation helpers', async () => {
  await requestJson('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: 'review-queue-auth-block-001',
      file_name: 'auth-block.txt',
      mime_type: 'text/plain',
      folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: 'https://drive.google.com/file/d/review-queue-auth-block-001',
      observed_at: '2026-05-25T16:12:00.000Z'
    })
  });
  setMockDriveFileInFolder('review-queue-auth-block-001', '01_Processed', 'auth-block.txt');
  const itemId = await readReviewQueueItemIdByDriveFileId('review-queue-auth-block-001');

  process.env.GOOGLE_REFRESH_TOKEN = '';
  const response = await requestJson<{
    error: string;
    reason: string;
    auth: { ready: boolean; configured: boolean; checkedAt: string };
  }>(`/api/drive/review-queue/${encodeURIComponent(itemId)}/decision`, {
    method: 'POST',
    body: JSON.stringify({
      decision: 'acknowledged',
      note: 'Should not apply'
    })
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'Drive auth unhealthy');
  assert.equal(response.body.auth.ready, false);
  assert.equal(response.body.reason, 'OAuth credentials are incomplete');
  assert.equal(mockDriveMoveFileCalls, 0);
});
