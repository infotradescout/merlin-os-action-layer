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
process.env.MEALSCOUT_AFFILIATE_EMAIL_MAP = JSON.stringify([
  { affiliateId: 'aff-1', affiliateCode: 'AFF-1', repId: 'rep-1', affiliateEmail: 'rep1@example.com' },
  { affiliateId: 'aff-2', affiliateCode: 'AFF-2', repId: 'rep-2', affiliateEmail: 'rep2@example.com' },
  { affiliateId: 'aff-3a', affiliateCode: 'AFF-3A', repId: 'rep-3a', affiliateEmail: 'ambiguous@example.com' },
  { affiliateId: 'aff-3b', affiliateCode: 'AFF-3B', repId: 'rep-3b', affiliateEmail: 'ambiguous@example.com' }
]);

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
          drive_file_id: 'batch-profile-2',
          file_name: 'profile-2.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/profile-2',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown',
            extracted_text: 'Delta Bites\nPhone: 504-444-9191\nCity: Metairie',
            owner_email: 'rep2@example.com',
            owner_name: 'Rep Two'
          }
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
      if (fileId === 'batch-profile-2') return 'Delta Bites\nPhone: 504-444-9191\nCity: Metairie';
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
    skippedAlreadyProcessedCount: number;
    skippedNotSelectedCount: number;
    skippedUnsupportedCount: number;
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
  assert.equal(response.body.scannedFileCount, 5);
  assert.equal(response.body.eligibleFileCount, 4);
  assert.equal(response.body.processedFileCount >= 2, true);
  assert.equal(response.body.skippedUnsupportedCount, 1);
  assert.equal(response.body.skippedAlreadyProcessedCount, 0);
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

test('second run processes next unprocessed slice and reports skip breakdown unless reprocess true', async () => {
  setDriveClientFactory(() => buildDriveClient());
  const first = await requestJson<{ processedFileCount: number }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', maxFiles: 2 })
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.processedFileCount, 2);

  const second = await requestJson<{
    processedFileCount: number;
    skippedAlreadyProcessedCount: number;
    skippedNotSelectedCount: number;
    skippedFiles: Array<{ reason: string }>;
  }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', maxFiles: 2 })
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.processedFileCount >= 1, true);
  assert.equal(second.body.skippedAlreadyProcessedCount >= 2, true);
  assert.equal(second.body.skippedNotSelectedCount >= 0, true);
  assert.equal(second.body.skippedFiles.some((row) => row.reason === 'already_processed'), true);

  const third = await requestJson<{ processedFileCount: number }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', maxFiles: 2, reprocess: true })
  });
  assert.equal(third.status, 200);
  assert.equal(third.body.processedFileCount >= 1, true);
});

test('batch history and detail are role-gated and return summaries', async () => {
  setDriveClientFactory(() => buildDriveClient());
  const run = await requestJson<{ batchId: string }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', maxFiles: 2, repId: 'rep-1', affiliateCode: 'AFF-1' })
  });
  assert.equal(run.status, 200);

  const deniedHistory = await requestJson<{ error: string; mutationAllowed: boolean }>('/api/mealscout/intake/batches', {
    method: 'GET',
    headers: { 'x-operator-role': 'viewer' }
  });
  assert.equal(deniedHistory.status, 403);
  assert.equal(deniedHistory.body.mutationAllowed, false);

  const history = await requestJson<{ mutationAllowed: boolean; batches: Array<{ batchId: string; processedFileCount: number; repIds: string[] }> }>('/api/mealscout/intake/batches', {
    method: 'GET',
    headers: { 'x-operator-role': 'admin' }
  });
  assert.equal(history.status, 200);
  assert.equal(history.body.mutationAllowed, false);
  assert.equal(history.body.batches.length >= 1, true);
  assert.equal(history.body.batches.some((row) => row.batchId === run.body.batchId), true);

  const deniedDetail = await requestJson<{ error: string; mutationAllowed: boolean }>(`/api/mealscout/intake/batches/${encodeURIComponent(run.body.batchId)}`, {
    method: 'GET',
    headers: { 'x-operator-role': 'viewer' }
  });
  assert.equal(deniedDetail.status, 403);
  assert.equal(deniedDetail.body.mutationAllowed, false);

  const detail = await requestJson<{ mutationAllowed: boolean; batch: { batchId: string; processedFiles: unknown[]; skippedFiles: unknown[] } }>(
    `/api/mealscout/intake/batches/${encodeURIComponent(run.body.batchId)}`,
    {
      method: 'GET',
      headers: { 'x-operator-role': 'admin' }
    }
  );
  assert.equal(detail.status, 200);
  assert.equal(detail.body.mutationAllowed, false);
  assert.equal(detail.body.batch.batchId, run.body.batchId);
  assert.equal(Array.isArray(detail.body.batch.processedFiles), true);
  assert.equal(Array.isArray(detail.body.batch.skippedFiles), true);
});

test('safeMode defaults maxFiles to 5 and includes safe mode metadata', async () => {
  const manyClient: DriveClient = {
    ...buildDriveClient(),
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return Array.from({ length: 12 }).map((_, index) => ({
        drive_file_id: `safe-default-${index + 1}`,
        file_name: `safe-default-${index + 1}.png`,
        mime_type: 'image/png',
        folder_id: folderId,
        web_url: `https://example.com/safe-default-${index + 1}`,
        modified_time: '2026-05-29T01:00:00.000Z',
        raw_metadata: {
          folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown',
          extracted_text: `Truck ${index + 1}\nPhone: 504-333-90${String(index).padStart(2, '0')}\nCity: Metairie`
        }
      }));
    },
    async downloadFileContent(fileId: string) {
      return `Truck ${fileId}\nPhone: 504-333-9000\nCity: Metairie`;
    }
  };
  setDriveClientFactory(() => manyClient);
  const response = await requestJson<{
    safeMode: boolean;
    safeModeLimits: { defaultMaxFiles: number; hardMaxFiles: number; groupingMode: string };
    processedFileCount: number;
    skippedFiles: Array<{ reason: string }>;
  }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process' })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.safeMode, true);
  assert.equal(response.body.safeModeLimits.defaultMaxFiles, 5);
  assert.equal(response.body.safeModeLimits.hardMaxFiles, 8);
  assert.equal(response.body.safeModeLimits.groupingMode, 'strict');
  assert.equal(response.body.processedFileCount, 5);
  assert.equal(response.body.skippedFiles.some((row) => row.reason === 'not_selected'), true);
});

test('safeMode caps maxFiles above 8', async () => {
  const manyClient: DriveClient = {
    ...buildDriveClient(),
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return Array.from({ length: 12 }).map((_, index) => ({
        drive_file_id: `safe-cap-${index + 1}`,
        file_name: `safe-cap-${index + 1}.png`,
        mime_type: 'image/png',
        folder_id: folderId,
        web_url: `https://example.com/safe-cap-${index + 1}`,
        modified_time: '2026-05-29T01:00:00.000Z',
        raw_metadata: {
          folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown',
          extracted_text: `Truck Cap ${index + 1}\nPhone: 504-333-90${String(index).padStart(2, '0')}\nCity: Metairie`
        }
      }));
    },
    async downloadFileContent(fileId: string) {
      return `Truck ${fileId}\nPhone: 504-333-9000\nCity: Metairie`;
    }
  };
  setDriveClientFactory(() => manyClient);
  const response = await requestJson<{
    safeMode: boolean;
    warnings: string[];
    processedFileCount: number;
  }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', safeMode: true, maxFiles: 20 })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.safeMode, true);
  assert.equal(response.body.processedFileCount, 8);
  assert.equal(response.body.warnings.some((item) => item.includes('capped_to_8')), true);
});

test('safeMode strict grouping avoids merge-by-similar-name and weak OCR names become needs_review', async () => {
  const strictClient: DriveClient = {
    ...buildDriveClient(),
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'strict-1',
          file_name: 'strict-1.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/strict-1',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown',
            extracted_text: 'Title oO\nPhone: 504-333-9001\nCity: Metairie\nQuesadilla $10.00'
          }
        },
        {
          drive_file_id: 'strict-2',
          file_name: 'strict-2.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/strict-2',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown',
            extracted_text: 'Title oO\nPhone: 504-333-9001\nCity: Metairie\nTaco $4.00'
          }
        }
      ];
    },
    async downloadFileContent(fileId: string) {
      return fileId === 'strict-1'
        ? 'Title oO\nPhone: 504-333-9001\nCity: Metairie\nQuesadilla $10.00'
        : 'Title oO\nPhone: 504-333-9001\nCity: Metairie\nTaco $4.00';
    }
  };
  setDriveClientFactory(() => strictClient);
  const run = await requestJson<{ batchId: string; processedFileCount: number }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', safeMode: true, maxFiles: 8 })
  });
  assert.equal(run.status, 200);
  assert.equal(run.body.processedFileCount, 2);

  const detail = await requestJson<{
    batch: {
      draftCount: number;
      reviewStatusCounts: { needs_review: number; publish_ready: number };
      safeMode?: boolean;
    };
  }>(`/api/mealscout/intake/batches/${encodeURIComponent(run.body.batchId)}`, {
    method: 'GET',
    headers: { 'x-operator-role': 'admin' }
  });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.batch.safeMode, true);
  assert.equal(detail.body.batch.draftCount >= 1, true);
  assert.equal(detail.body.batch.reviewStatusCounts.needs_review >= 1, true);
  assert.equal(detail.body.batch.reviewStatusCounts.publish_ready, 0);
});

test('file audit returns duplicate groups for exact duplicate filenames', async () => {
  const dupClient: DriveClient = {
    ...buildDriveClient(),
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'dup-a',
          file_name: 'IMG_4645.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/dup-a',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown' }
        },
        {
          drive_file_id: 'dup-b',
          file_name: 'IMG_4645.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/dup-b',
          modified_time: '2026-05-29T01:01:00.000Z',
          raw_metadata: { folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown' }
        },
        {
          drive_file_id: 'dup-c',
          file_name: 'IMG_4594.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/dup-c',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown' }
        },
        {
          drive_file_id: 'dup-d',
          file_name: 'IMG_4594.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/dup-d',
          modified_time: '2026-05-29T01:01:00.000Z',
          raw_metadata: { folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown' }
        }
      ];
    },
    async downloadFileContent() {
      return undefined;
    }
  };
  setDriveClientFactory(() => dupClient);
  const response = await requestJson<{
    mutationAllowed: boolean;
    duplicateGroups: Array<{
      duplicateType: string;
      recommendedPrimaryFileId: string;
      files: Array<{ fileId: string; originalFileName: string; recommendedAction: string }>;
    }>;
    fileAssumptions: Array<{ fileId: string; proposedFileName: string }>;
  }>('/api/mealscout/intake/file-audit', {
    method: 'GET',
    headers: { 'x-operator-role': 'admin' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.duplicateGroups.length >= 2, true);
  assert.equal(response.body.duplicateGroups.every((g) => g.duplicateType === 'exact_filename_duplicate'), true);
  assert.equal(response.body.duplicateGroups.some((g) => g.files.some((f) => f.originalFileName === 'IMG_4645.PNG')), true);
  assert.equal(response.body.duplicateGroups.some((g) => g.files.some((f) => f.originalFileName === 'IMG_4594.PNG')), true);
  assert.equal(response.body.fileAssumptions.every((row) => row.proposedFileName.includes('__')), true);
});

test('safe mode skips duplicate candidates and reports duplicate skip counters', async () => {
  const dupClient: DriveClient = {
    ...buildDriveClient(),
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'dup-primary',
          file_name: 'IMG_4544.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/dup-primary',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { extracted_text: 'Truck A\nPhone: 504-000-0001\nCity: Metairie' }
        },
        {
          drive_file_id: 'dup-copy',
          file_name: 'IMG_4544.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/dup-copy',
          modified_time: '2026-05-29T01:01:00.000Z',
          raw_metadata: { extracted_text: 'Truck A\nPhone: 504-000-0001\nCity: Metairie' }
        },
        {
          drive_file_id: 'unique-1',
          file_name: 'unique-1.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/unique-1',
          modified_time: '2026-05-29T01:02:00.000Z',
          raw_metadata: { extracted_text: 'Truck B\nPhone: 504-000-0002\nCity: Metairie' }
        }
      ];
    },
    async downloadFileContent(fileId: string) {
      if (fileId === 'dup-primary') return 'Truck A\nPhone: 504-000-0001\nCity: Metairie';
      if (fileId === 'dup-copy') return 'Truck A\nPhone: 504-000-0001\nCity: Metairie';
      return 'Truck B\nPhone: 504-000-0002\nCity: Metairie';
    }
  };
  setDriveClientFactory(() => dupClient);
  const run = await requestJson<{
    mutationAllowed: boolean;
    processedFileCount: number;
    skippedDuplicateCount: number;
    skippedDuplicateReviewCount: number;
    skippedFiles: Array<{ fileId: string; reason: string }>;
  }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', safeMode: true, maxFiles: 5 })
  });
  assert.equal(run.status, 200);
  assert.equal(run.body.mutationAllowed, false);
  assert.equal(run.body.processedFileCount, 2);
  assert.equal(run.body.skippedDuplicateCount, 1);
  assert.equal(run.body.skippedDuplicateReviewCount, 0);
  assert.equal(run.body.skippedFiles.some((row) => row.fileId === 'dup-copy' && row.reason === 'already_duplicate'), true);
});

test('folder context endpoint is role-gated and returns probable truck clusters', async () => {
  const clusterClient: DriveClient = {
    ...buildDriveClient(),
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'traci-profile',
          file_name: 'Screenshot_20260527_115713_Facebook.jpg',
          mime_type: 'image/jpeg',
          folder_id: folderId,
          web_url: 'https://example.com/traci-profile',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: {
            extracted_text: "Traci's Cherished Creations LLC\nPhone: 850-255-8396\nPensacola, FL",
            owner_email: 'rep1@example.com'
          }
        },
        {
          drive_file_id: 'traci-menu',
          file_name: 'Messenger_creation_9527970C.jpeg',
          mime_type: 'image/jpeg',
          folder_id: folderId,
          web_url: 'https://example.com/traci-menu',
          modified_time: '2026-05-29T01:01:00.000Z',
          raw_metadata: {
            extracted_text: "TRACI'S CHERISHED CREATIONS\nPH. 850-255-8396\nDINNERS"
          }
        },
        {
          drive_file_id: 'traci-logo',
          file_name: 'FB_IMG_1779901042554.jpg',
          mime_type: 'image/jpeg',
          folder_id: folderId,
          web_url: 'https://example.com/traci-logo',
          modified_time: '2026-05-29T01:02:00.000Z',
          raw_metadata: {}
        }
      ];
    },
    async downloadFileContent(fileId: string) {
      if (fileId === 'traci-profile') return "Traci's Cherished Creations LLC\nPhone: 850-255-8396\nPensacola, FL";
      if (fileId === 'traci-menu') return "TRACI'S CHERISHED CREATIONS\nPH. 850-255-8396\nDINNERS";
      return undefined;
    }
  };
  setDriveClientFactory(() => clusterClient);

  const preview = await requestJson<{
    drafts: Array<{ draftId: string; sourceFiles?: Array<{ sourceFileId: string }> }>;
    publishPlan?: { records?: Array<{ recordId: string; draftIds?: string[]; profileFields?: Record<string, { sourceFileIds?: string[]; value?: string }> }> };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ loadFromDriveFolder: true, includeDebugOcr: true })
  });
  assert.equal(preview.status, 200);
  const traciDraft = (preview.body.drafts || []).find((draft) =>
    (draft.sourceFiles || []).some((file) => file.sourceFileId === 'traci-profile')
  );
  assert.ok(traciDraft);
  if (!traciDraft) throw new Error('expected Traci draft');
  await requestJson('/api/mealscout/attachment-decisions', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({
      draftId: traciDraft.draftId,
      sourceFileId: 'traci-menu',
      sourceFileName: 'Messenger_creation_9527970C.jpeg',
      action: 'mark_as_menu',
      mediaType: 'menu',
      reason: 'manual_menu_attachment',
      operatorId: 'MANUAL_OPERATOR'
    })
  });
  await requestJson('/api/mealscout/attachment-decisions', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({
      draftId: traciDraft.draftId,
      sourceFileId: 'traci-logo',
      sourceFileName: 'FB_IMG_1779901042554.jpg',
      action: 'mark_as_logo_candidate',
      mediaType: 'logo',
      reason: 'logo_candidate_attachment',
      operatorId: 'MANUAL_OPERATOR'
    })
  });
  const planRecord = (preview.body.publishPlan?.records || []).find((record) => (record.draftIds || []).includes(traciDraft.draftId));
  if (planRecord) {
    await requestJson('/api/mealscout/review-corrections', {
      method: 'POST',
      headers: { 'x-operator-role': 'admin' },
      body: JSON.stringify({
        recordId: planRecord.recordId,
        draftIds: [traciDraft.draftId],
        fieldName: 'truckName',
        action: 'replace_field',
        originalValue: planRecord.profileFields?.truckName?.value || "Traci's Cherished",
        correctedValue: "Traci's Cherished Creations LLC",
        reason: 'corrected_business_name',
        evidenceRef: 'facebook_profile_screenshot',
        sourceFileId: 'traci-profile',
        operatorId: 'MANUAL_OPERATOR'
      })
    });
  }

  const denied = await requestJson<{ mutationAllowed: boolean; error: string }>('/api/mealscout/intake/folder-context', {
    method: 'GET',
    headers: { 'x-operator-role': 'viewer' }
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.mutationAllowed, false);

  const ok = await requestJson<{
    mutationAllowed: boolean;
    probableTruckClusters: Array<{
      clusterId: string;
      sourceFileIds: string[];
      profileFiles: string[];
      menuFiles: string[];
      logoCandidates: string[];
      reasons: string[];
      status: string;
    }>;
  }>('/api/mealscout/intake/folder-context', {
    method: 'GET',
    headers: { 'x-operator-role': 'admin' }
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.mutationAllowed, false);
  assert.equal(ok.body.probableTruckClusters.length >= 1, true);
  const traciCluster = ok.body.probableTruckClusters.find((cluster) => cluster.sourceFileIds.includes('traci-profile'));
  assert.ok(traciCluster);
  assert.equal((traciCluster?.sourceFileIds || []).includes('traci-menu'), true);
  assert.equal((traciCluster?.sourceFileIds || []).includes('traci-logo'), true);
  assert.equal((traciCluster?.reasons || []).includes('manual_menu_attachment'), true);
  assert.equal((traciCluster?.reasons || []).includes('logo_candidate_attachment'), true);
  assert.equal((traciCluster?.reasons || []).includes('corrected_business_name'), true);
  assert.equal((traciCluster?.status || '') !== 'weak_cluster', true);
});

test('safe mode processByCluster selects cluster files instead of arbitrary next slice', async () => {
  const clusterClient: DriveClient = {
    ...buildDriveClient(),
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'other-1',
          file_name: 'aaa-other-1.jpg',
          mime_type: 'image/jpeg',
          folder_id: folderId,
          web_url: 'https://example.com/other-1',
          modified_time: '2026-05-29T00:00:00.000Z',
          raw_metadata: { extracted_text: 'Unrelated\nPhone: 111-111-1111\nCity: Elsewhere' }
        },
        {
          drive_file_id: 'other-2',
          file_name: 'aaa-other-2.jpg',
          mime_type: 'image/jpeg',
          folder_id: folderId,
          web_url: 'https://example.com/other-2',
          modified_time: '2026-05-29T00:00:10.000Z',
          raw_metadata: { extracted_text: 'Unrelated\nPhone: 111-111-1112\nCity: Elsewhere' }
        },
        {
          drive_file_id: 'traci-profile',
          file_name: 'Screenshot_20260527_115713_Facebook.jpg',
          mime_type: 'image/jpeg',
          folder_id: folderId,
          web_url: 'https://example.com/traci-profile',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { extracted_text: "Traci's Cherished Creations LLC\nPhone: 850-255-8396\nPensacola, FL" }
        },
        {
          drive_file_id: 'traci-menu',
          file_name: 'Messenger_creation_9527970C.jpeg',
          mime_type: 'image/jpeg',
          folder_id: folderId,
          web_url: 'https://example.com/traci-menu',
          modified_time: '2026-05-29T01:01:00.000Z',
          raw_metadata: { extracted_text: "TRACI'S CHERISHED CREATIONS\nPH. 850-255-8396\nDINNERS" }
        },
        {
          drive_file_id: 'traci-logo',
          file_name: 'FB_IMG_1779901042554.jpg',
          mime_type: 'image/jpeg',
          folder_id: folderId,
          web_url: 'https://example.com/traci-logo',
          modified_time: '2026-05-29T01:02:00.000Z',
          raw_metadata: {}
        },
        {
          drive_file_id: 'other-3',
          file_name: 'zzz-other-3.jpg',
          mime_type: 'image/jpeg',
          folder_id: folderId,
          web_url: 'https://example.com/other-3',
          modified_time: '2026-05-29T02:00:00.000Z',
          raw_metadata: { extracted_text: 'Unrelated\nPhone: 111-111-1113\nCity: Elsewhere' }
        }
      ];
    },
    async downloadFileContent(fileId: string) {
      if (fileId === 'traci-profile') return "Traci's Cherished Creations LLC\nPhone: 850-255-8396\nPensacola, FL";
      if (fileId === 'traci-menu') return "TRACI'S CHERISHED CREATIONS\nPH. 850-255-8396\nDINNERS";
      if (fileId === 'other-1') return 'Unrelated\nPhone: 111-111-1111\nCity: Elsewhere';
      if (fileId === 'other-2') return 'Unrelated\nPhone: 111-111-1112\nCity: Elsewhere';
      if (fileId === 'other-3') return 'Unrelated\nPhone: 111-111-1113\nCity: Elsewhere';
      return undefined;
    }
  };
  setDriveClientFactory(() => clusterClient);

  const context = await requestJson<{
    probableTruckClusters: Array<{ clusterId: string; sourceFileIds: string[] }>;
  }>('/api/mealscout/intake/folder-context', {
    method: 'GET',
    headers: { 'x-operator-role': 'admin' }
  });
  assert.equal(context.status, 200);
  const target = context.body.probableTruckClusters.find((cluster) => cluster.sourceFileIds.includes('traci-profile'));
  assert.ok(target);

  const run = await requestJson<{
    mutationAllowed: boolean;
    processedFiles: Array<{ fileId: string }>;
    warnings?: string[];
  }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({
      mode: 'process',
      safeMode: true,
      maxFiles: 5,
      reprocess: false,
      processByCluster: true,
      clusterId: target?.clusterId
    })
  });
  assert.equal(run.status, 200);
  assert.equal(run.body.mutationAllowed, false);
  const processedIds = new Set(run.body.processedFiles.map((row) => row.fileId));
  assert.equal(processedIds.has('traci-profile'), true);
  assert.equal(processedIds.has('traci-menu') || processedIds.has('traci-logo'), true);
  assert.equal(processedIds.has('other-1'), false);
  assert.equal((run.body.warnings || []).some((row) => row.includes('processing_cluster:')), true);
});

test('file audit matches uploader email to affiliate and flags ambiguous/unmatched attribution', async () => {
  const attributionClient: DriveClient = {
    ...buildDriveClient(),
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'attr-match-uploader',
          file_name: 'uploader-match.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/uploader-match',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { uploader_email: 'rep1@example.com', uploader_name: 'Rep One' }
        },
        {
          drive_file_id: 'attr-owner-fallback',
          file_name: 'owner-fallback.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/owner-fallback',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { owner_email: 'rep2@example.com', owner_name: 'Rep Two' }
        },
        {
          drive_file_id: 'attr-ambiguous',
          file_name: 'ambiguous.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/ambiguous',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { uploader_email: 'ambiguous@example.com' }
        },
        {
          drive_file_id: 'attr-unmatched',
          file_name: 'unmatched.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/unmatched',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { uploader_email: 'nomatch@example.com' }
        }
      ];
    }
  };
  setDriveClientFactory(() => attributionClient);
  const response = await requestJson<{
    fileAssumptions: Array<{
      fileId: string;
      attributionStatus?: string;
      affiliateCode?: string;
      repId?: string;
      needsAttributionReview?: boolean;
    }>;
  }>('/api/mealscout/intake/file-audit', {
    method: 'GET',
    headers: { 'x-operator-role': 'admin' }
  });
  assert.equal(response.status, 200);
  const byId = new Map(response.body.fileAssumptions.map((row) => [row.fileId, row]));
  assert.equal(byId.get('attr-match-uploader')?.attributionStatus, 'matched_affiliate');
  assert.equal(byId.get('attr-match-uploader')?.affiliateCode, 'AFF-1');
  assert.equal(byId.get('attr-owner-fallback')?.attributionStatus, 'matched_owner_affiliate');
  assert.equal(byId.get('attr-owner-fallback')?.affiliateCode, 'AFF-2');
  assert.equal(byId.get('attr-ambiguous')?.attributionStatus, 'ambiguous');
  assert.equal(byId.get('attr-ambiguous')?.needsAttributionReview, true);
  assert.equal(byId.get('attr-unmatched')?.attributionStatus, 'unmatched');
  assert.equal(byId.get('attr-unmatched')?.needsAttributionReview, true);
});

test('duplicate removal endpoint blocks primary removal and marks duplicate for safe-mode exclusion', async () => {
  const dupClient: DriveClient = {
    ...buildDriveClient(),
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'rm-primary',
          file_name: 'IMG_4544.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/rm-primary',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { extracted_text: 'Truck A\nPhone: 504-000-0001\nCity: Metairie' }
        },
        {
          drive_file_id: 'rm-dup',
          file_name: 'IMG_4544.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/rm-dup',
          modified_time: '2026-05-29T01:01:00.000Z',
          raw_metadata: { extracted_text: 'Truck A\nPhone: 504-000-0001\nCity: Metairie' }
        },
        {
          drive_file_id: 'rm-unique',
          file_name: 'unique.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/rm-unique',
          modified_time: '2026-05-29T01:02:00.000Z',
          raw_metadata: { extracted_text: 'Truck B\nPhone: 504-000-0002\nCity: Metairie' }
        }
      ];
    },
    async downloadFileContent(fileId: string) {
      if (fileId === 'rm-primary') return 'Truck A\nPhone: 504-000-0001\nCity: Metairie';
      if (fileId === 'rm-dup') return 'Truck A\nPhone: 504-000-0001\nCity: Metairie';
      return 'Truck B\nPhone: 504-000-0002\nCity: Metairie';
    },
    async moveFileToFolder() {
      return true;
    },
    async findFolderByName(name: string, parentFolderId: string) {
      return { id: `${parentFolderId}-${name}`, name };
    },
    async createFolderIfMissing(name: string, parentFolderId: string) {
      return { id: `${parentFolderId}-${name}`, name };
    }
  };
  setDriveClientFactory(() => dupClient);
  const audit = await requestJson<{
    duplicateGroups: Array<{ duplicateGroupId: string; recommendedPrimaryFileId: string; files: Array<{ fileId: string }> }>;
  }>('/api/mealscout/intake/file-audit', {
    method: 'GET',
    headers: { 'x-operator-role': 'admin' }
  });
  assert.equal(audit.status, 200);
  const group = audit.body.duplicateGroups.find((item) => item.files.some((f) => f.fileId === 'rm-dup'));
  assert.ok(group);
  if (!group) throw new Error('expected duplicate group');

  const removal = await requestJson<{
    mutationAllowed: boolean;
    results: Array<{ fileId: string; action: string; reason?: string }>;
  }>('/api/mealscout/intake/duplicates/remove', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({
      duplicateGroupIds: [group.duplicateGroupId],
      fileIds: ['rm-primary', 'rm-dup'],
      removalMode: 'mark_only',
      confirmation: true,
      operatorId: 'MANUAL_OPERATOR'
    })
  });
  assert.equal(removal.status, 200);
  assert.equal(removal.body.mutationAllowed, true);
  assert.equal(removal.body.results.some((row) => row.fileId === 'rm-primary' && row.action === 'skipped'), true);
  assert.equal(removal.body.results.some((row) => row.fileId === 'rm-dup' && row.action === 'marked_duplicate'), true);

  const run = await requestJson<{
    processedFileCount: number;
    skippedFiles: Array<{ fileId: string; reason: string }>;
  }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', safeMode: true, maxFiles: 5 })
  });
  assert.equal(run.status, 200);
  assert.equal(run.body.skippedFiles.some((row) => row.fileId === 'rm-dup' && row.reason === 'already_duplicate'), true);
});

test('duplicate removal rejects unauthorized caller', async () => {
  setDriveClientFactory(() => buildDriveClient());
  const res = await requestJson<{ error: string; mutationAllowed: boolean }>('/api/mealscout/intake/duplicates/remove', {
    method: 'POST',
    headers: { 'x-operator-role': 'viewer' },
    body: JSON.stringify({ confirmation: true, removalMode: 'mark_only', operatorId: 'MANUAL_OPERATOR' })
  });
  assert.equal(res.status, 403);
  assert.equal(res.body.mutationAllowed, false);
});

test('trash permission failure falls back to suppression mark_only behavior', async () => {
  process.env.MEALSCOUT_ENABLE_DANGEROUS_TRASH_MODE = 'true';
  const dupClient: DriveClient = {
    ...buildDriveClient(),
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'rm2-primary',
          file_name: 'IMG_4645.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/rm2-primary',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { extracted_text: 'Truck A\nPhone: 504-000-0001\nCity: Metairie' }
        },
        {
          drive_file_id: 'rm2-dup',
          file_name: 'IMG_4645.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/rm2-dup',
          modified_time: '2026-05-29T01:01:00.000Z',
          raw_metadata: { extracted_text: 'Truck A\nPhone: 504-000-0001\nCity: Metairie' }
        }
      ];
    },
    async trashFile() {
      throw new Error('The user does not have sufficient permissions for this file.');
    },
    async downloadFileContent(fileId: string) {
      return fileId === 'rm2-primary'
        ? 'Truck A\nPhone: 504-000-0001\nCity: Metairie'
        : 'Truck A\nPhone: 504-000-0001\nCity: Metairie';
    }
  };
  setDriveClientFactory(() => dupClient);
  const audit = await requestJson<{ duplicateGroups: Array<{ duplicateGroupId: string }> }>('/api/mealscout/intake/file-audit', {
    method: 'GET',
    headers: { 'x-operator-role': 'admin' }
  });
  assert.equal(audit.status, 200);
  const groupId = audit.body.duplicateGroups[0]?.duplicateGroupId;
  assert.ok(groupId);
  const remove = await requestJson<{
    mutationAllowed: boolean;
    trashFailedPermissionCount: number;
    markedSuppressedAfterPermissionFailureCount: number;
    results: Array<{ fileId: string; action: string; reason?: string; suppressionApplied?: boolean }>;
  }>('/api/mealscout/intake/duplicates/remove', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({
      duplicateGroupIds: [groupId],
      fileIds: ['rm2-dup'],
      removalMode: 'trash',
      confirmation: true,
      operatorId: 'MANUAL_OPERATOR',
      forceReviewApproved: true,
      attributionConflictApproval: true
    })
  });
  assert.equal(remove.status, 200);
  assert.equal(remove.body.mutationAllowed, true);
  assert.equal(remove.body.trashFailedPermissionCount, 1);
  assert.equal(remove.body.markedSuppressedAfterPermissionFailureCount, 1);
  assert.equal(
    remove.body.results.some((row) => row.fileId === 'rm2-dup' && row.action === 'marked_duplicate' && row.reason === 'duplicate_removal_blocked_permission' && row.suppressionApplied === true),
    true
  );
  const run = await requestJson<{ skippedFiles: Array<{ fileId: string; reason: string }> }>('/api/mealscout/intake/batches/run', {
    method: 'POST',
    headers: { 'x-operator-role': 'admin' },
    body: JSON.stringify({ mode: 'process', safeMode: true, maxFiles: 5 })
  });
  assert.equal(run.status, 200);
  assert.equal(run.body.skippedFiles.some((row) => row.fileId === 'rm2-dup' && row.reason === 'already_duplicate'), true);
});
