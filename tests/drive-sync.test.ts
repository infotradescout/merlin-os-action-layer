import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { DriveClient } from '../src/driveClient.ts';

import { createDriveFileRecord } from '../src/driveIngest.ts';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-v1-6-drive-sync-'));
process.env.MERLIN_DB_PATH = resolve(tempDir, 'merlin-or.sqlite');
process.env.MERLIN_RUNTIME = 'test';
process.env.MERLIN_DRIVE_MODE = 'oauth';
process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
process.env.MERLIN_DRIVE_ROOT_MODE = 'dedicated_drive';
process.env.MERLIN_DRIVE_ROOT_FOLDER_NAME = 'Merlin OR Storage';
process.env.MERLIN_DRIVE_SYNC_MODE = 'manual';
process.env.GOOGLE_CLIENT_ID = 'test-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback';
process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';
process.env.MERLIN_DRIVE_ALLOW_FOLDER_CREATE = 'false';
process.env.MERLIN_DRIVE_BOOTSTRAP_ENABLED = 'false';
process.env.MERLIN_DRIVE_CREATE_MISSING_FOLDERS = 'false';

const { closeLisaStore, getLisaEventsForBrowser, resetLisaStore } = await import('../src/lisa.ts');
const { closeDriveManifestStore, createManifestEntry, getManifestEntriesByStatus, getManifestEntryByDriveFileId, resetDriveManifestForTest } = await import('../src/driveManifest.ts');
const { closeReplayStore, getRecentReplayEvents, resetReplayForTest } = await import('../src/replay.ts');
const { closeRecommendationsStore, resetRecommendationsForTest } = await import('../src/recommendations.ts');
const { closeOutcomesStore, resetOutcomesForTest } = await import('../src/outcomes.ts');
const { closeApprovalQueueStore, getRecentApprovals, resetApprovalQueueForTest } = await import('../src/approvalQueue.ts');
const { discoverManagedFolders, importDriveFile, planDriveInboxScanTargets, routeImportedFile, syncDriveInbox } = await import('../src/driveSync.ts');
const { setDriveClientFactory, resetDriveClientFactory } = await import('../src/driveClient.ts');
const { createDriveBootstrapPlan } = await import('../src/driveManager.ts');
const { listMealScoutAutoOnboardedProfiles } = await import('../src/mealscoutProfileImport.ts');
const { createMerlinServer } = await import('../src/server.ts');

let server: Server;
let baseUrl: string;

type FolderRecord = {
  id: string;
  name: string;
  parent: string;
};

type FileRecord = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  webViewLink: string;
  parents: string[];
  entity_id?: string;
};

type RootFolderLookup = `${string}:${string}`;
const managedRootFolderName = 'Merlin OR Storage';
const inboxPath = '00_Inbox';
const processedPath = '01_Processed';
const needsReviewPath = '02_Needs_Review';

let mockClientCalls: {
  createdFolders: string[];
  moved: Array<{ fileId: string; targetFolderId: string }>;
} = { createdFolders: [], moved: [] };

function makeFolderLookupKey(parent: string, name: string): RootFolderLookup {
  return `${parent}:${name.toLowerCase()}`;
}

function createMockDriveClient(initialFolders: FolderRecord[], initialFiles: FileRecord[] = []): { client: DriveClient } {
  const files = new Map<string, FileRecord>(initialFiles.map((file) => [file.id, file]));
  const foldersById = new Map<string, FolderRecord>(initialFolders.map((folder) => [folder.id, folder]));
  const foldersByParentAndName = new Map<string, string>();
  let folderCounter = 1000;

  for (const folder of initialFolders) {
    foldersByParentAndName.set(makeFolderLookupKey(folder.parent, folder.name), folder.id);
  }

  function nextFolderId(): string {
    folderCounter += 1;
    return `folder-${folderCounter}`;
  }

  mockClientCalls = {
    createdFolders: [],
    moved: []
  };

  const client: DriveClient = {
    async listFilesInFolder(folderId) {
      return Array.from(files.values())
        .filter((file) => file.parents.includes(folderId))
        .map((file) => ({
          drive_file_id: file.id,
          file_name: file.name,
          mime_type: file.mimeType,
          folder_id: folderId,
          web_url: file.webViewLink,
          modified_time: file.modifiedTime,
          entity_id: file.entity_id
        }));
    },

    async listSubfoldersInFolder(folderId) {
      return Array.from(foldersById.values())
        .filter((folder) => folder.parent === folderId)
        .map((folder) => ({ id: folder.id, name: folder.name }));
    },

async getFileMetadata(fileId) {
      const file = files.get(fileId);
      if (!file) {
        throw new Error(`file not found: ${fileId}`);
      }
      return {
        drive_file_id: file.id,
        file_name: file.name,
        mime_type: file.mimeType,
        folder_id: file.parents[0],
        web_url: file.webViewLink,
        modified_time: file.modifiedTime,
        entity_id: file.entity_id
      };
    },

    async downloadFileContent() {
      return undefined;
    },

    async moveFileToFolder(fileId, targetFolderId) {
      const file = files.get(fileId);
      if (!file) return false;
      file.parents = [targetFolderId];
      mockClientCalls.moved.push({ fileId, targetFolderId });
      return true;
    },

    async findFolderByName(name, parentFolderId) {
      const folderId = foldersByParentAndName.get(makeFolderLookupKey(parentFolderId, name));
      if (!folderId) return undefined;
      const folder = foldersById.get(folderId);
      if (!folder) return undefined;
      return { id: folder.id, name: folder.name };
    },

    async listFoldersByName(name, parentFolderId) {
      const matches: Array<{ id: string; name: string }> = [];
      for (const folder of foldersById.values()) {
        if (folder.parent === parentFolderId && folder.name === name) {
          matches.push({ id: folder.id, name: folder.name });
        }
      }
      return matches;
    },

    async createFolderIfMissing(name, parentFolderId) {
      const parentKey = makeFolderLookupKey(parentFolderId, name);
      const existingId = foldersByParentAndName.get(parentKey);
      if (existingId) {
        const existing = foldersById.get(existingId);
        return { id: existingId, name: existing?.name ?? name };
      }
      const nextId = nextFolderId();
      const folder: FolderRecord = { id: nextId, name, parent: parentFolderId };
      foldersById.set(nextId, folder);
      foldersByParentAndName.set(parentKey, nextId);
      mockClientCalls.createdFolders.push(`${parentFolderId}/${name}`);
      return { id: nextId, name };
    }
  };

  return { client };
}

function createBaseFolders() {
  return [
    { id: 'root', name: 'root', parent: '' },
    { id: 'dedicated-root', name: managedRootFolderName, parent: 'root' }
  ];
}

function createSyncFolders(): FolderRecord[] {
  const folders = createBaseFolders();
  folders.push(
    { id: 'inbox', name: inboxPath, parent: 'dedicated-root' },
    { id: 'processed', name: processedPath, parent: 'dedicated-root' },
    { id: 'needs-review', name: needsReviewPath, parent: 'dedicated-root' },
    { id: 'archived', name: '03_Archived_Sources', parent: 'dedicated-root' },
    { id: 'entity-files', name: '04_Entity_Files', parent: 'dedicated-root' },
    { id: 'exports', name: '05_Exports', parent: 'dedicated-root' },
    { id: 'audit', name: '06_Audit', parent: 'dedicated-root' },
    { id: 'system', name: '07_System', parent: 'dedicated-root' },
    { id: 'mealscout-intake', name: 'MealScout Intake', parent: 'dedicated-root' },
    { id: 'mealscout-incoming', name: 'incoming', parent: 'mealscout-intake' },
    { id: 'mealscout-screenshots', name: 'screenshots', parent: 'mealscout-incoming' },
    { id: 'mealscout-legacy-screenshots', name: 'Legacy Screenshots', parent: 'dedicated-root' }
  );
  return folders;
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

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  });
  const body = (await response.json()) as T;
  return { status: response.status, body };
}

beforeEach(() => {
  resetLisaStore();
  resetDriveManifestForTest();
  resetReplayForTest();
  resetRecommendationsForTest();
  resetOutcomesForTest();
  resetApprovalQueueForTest();
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';
  delete process.env.MERLIN_MEALSCOUT_LEGACY_SCREENSHOTS_FOLDER_ID;
});

after(async () => {
  await new Promise<void>((resolveStop) => server.close(() => resolveStop()));
  closeLisaStore();
  closeDriveManifestStore();
  closeReplayStore();
  closeRecommendationsStore();
  closeOutcomesStore();
  closeApprovalQueueStore();
  resetDriveClientFactory();
  try {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // SQLite WAL handles can briefly outlive store closure on Windows test runners.
  }
});

test('discovers managed folders and reports missing folders before creation', async () => {
  process.env.MERLIN_DRIVE_BOOTSTRAP_ENABLED = 'true';
  process.env.MERLIN_DRIVE_CREATE_MISSING_FOLDERS = 'true';
  const { client } = createMockDriveClient(createBaseFolders());
  setDriveClientFactory(() => client);

  const discovery = await discoverManagedFolders({ client });
  assert.equal(discovery.status, 'ready');
  const expectedFolderCount = 8;
  assert.equal(discovery.folder_create_allowed, true);
  assert.equal(discovery.bootstrap_enabled, true);
  assert.equal(discovery.create_missing_folders, true);
  assert.equal(discovery.managed_folders['00_Inbox'].id.length > 0, true);
  assert.equal(discovery.managed_folders['01_Processed'].id.length > 0, true);
  assert.equal(mockClientCalls.createdFolders.length >= expectedFolderCount, true);
  process.env.MERLIN_DRIVE_BOOTSTRAP_ENABLED = 'false';
  process.env.MERLIN_DRIVE_CREATE_MISSING_FOLDERS = 'false';
});

test('discovery blocks sync when duplicate managed folders exist', async () => {
  const folders: FolderRecord[] = [
    ...createBaseFolders(),
    { id: 'inbox-a', name: inboxPath, parent: 'dedicated-root' },
    { id: 'inbox-b', name: inboxPath, parent: 'dedicated-root' },
    { id: 'processed', name: processedPath, parent: 'dedicated-root' },
    { id: 'needs-review', name: needsReviewPath, parent: 'dedicated-root' }
  ];
  const { client } = createMockDriveClient(folders);
  setDriveClientFactory(() => client);

  const discovery = await discoverManagedFolders({ client });
  assert.equal(discovery.status, 'error');
  assert.equal(discovery.sync_blocked, true);
  assert.equal(discovery.sync_block_reason, 'folder_conflict');
  assert.deepEqual(discovery.duplicate_managed_folders['00_Inbox'], ['inbox-a', 'inbox-b']);
});

test('discovery does not create missing folders unless explicitly allowed', async () => {
  process.env.MERLIN_DRIVE_ALLOW_FOLDER_CREATE = 'false';
  const { client } = createMockDriveClient(createBaseFolders());
  setDriveClientFactory(() => client);

  const discovery = await discoverManagedFolders({ client });
  assert.equal(discovery.status, 'error');
  assert.equal(discovery.sync_blocked, true);
  assert.equal(discovery.sync_block_reason, 'setup_required');
  assert.equal(discovery.folder_create_allowed, false);
  assert.equal(discovery.bootstrap_enabled, false);
  assert.equal(discovery.create_missing_folders, false);
  assert.equal(mockClientCalls.createdFolders.length, 0);
});

test('imports a supported PDF from inbox and marks processed', async () => {
  const mockFiles: FileRecord[] = [
    {
      id: 'file-supported-001',
      name: 'insurance.pdf',
      mimeType: 'application/pdf',
      modifiedTime: '2026-05-24T14:00:00.000Z',
      webViewLink: 'https://drive.google.com/file/d/file-supported-001',
      parents: ['inbox'],
      entity_id: 'business-001'
    }
  ];

  const { client } = createMockDriveClient(createSyncFolders(), mockFiles);
  setDriveClientFactory(() => client);

  const result = await syncDriveInbox({ client });

  assert.equal(result.status, 'ok');
  assert.equal(result.processed, 1);

  const processed = getManifestEntriesByStatus('processed');
  assert.equal(processed.length >= 1, true);
  assert.equal(processed[0].drive_file_id, 'file-supported-001');

  assert.equal(mockClientCalls.moved.some((entry) => entry.fileId === 'file-supported-001'), true);
});

test('skips already-seen files during sync', async () => {
  const fileRecord = createDriveFileRecord({
    drive_file_id: 'file-seen-001',
    file_name: 'contract.pdf',
    mime_type: 'application/pdf',
    folder_id: 'inbox',
    folder_path: inboxPath,
    web_url: 'https://drive.google.com/file/d/file-seen-001',
    entity_id: 'business-001',
    observed_at: '2026-05-24T14:01:00.000Z'
  });
  createManifestEntry(fileRecord);

  const { client } = createMockDriveClient(createSyncFolders(), [
    {
      id: 'file-seen-001',
      name: 'contract.pdf',
      mimeType: 'application/pdf',
      modifiedTime: '2026-05-24T14:01:00.000Z',
      webViewLink: 'https://drive.google.com/file/d/file-seen-001',
      parents: ['inbox']
    }
  ]);
  setDriveClientFactory(() => client);

  const result = await syncDriveInbox({ client });
  assert.equal(result.manifest_updates, 0);
  assert.equal(result.processed, 0);
});

test('unsupported inbox file goes to needs review and moves accordingly', async () => {
  const { client } = createMockDriveClient(createSyncFolders(), [
    {
      id: 'file-unsupported-001',
      name: 'image.bin',
      mimeType: 'application/octet-stream',
      modifiedTime: '2026-05-24T14:02:00.000Z',
      webViewLink: 'https://drive.google.com/file/d/file-unsupported-001',
      parents: ['inbox']
    }
  ]);
  setDriveClientFactory(() => client);

  const result = await syncDriveInbox({ client });
  assert.equal(result.status, 'ok');
  assert.equal(result.needs_review + result.skipped, 1);

  const needsReview = getManifestEntriesByStatus('needs_review');
  assert.equal(needsReview.some((entry) => entry.drive_file_id === 'file-unsupported-001'), true);
  assert.equal(mockClientCalls.moved.some((entry) => entry.fileId === 'file-unsupported-001'), true);
});

test('importDriveFile writes replay events for processed and needs-review file', async () => {
  const bootstrap = createDriveBootstrapPlan([], managedRootFolderName);
  assert.ok(bootstrap.required_folders.length === 8);

  const { client } = createMockDriveClient(createSyncFolders(), [
    {
      id: 'file-review-001',
      name: 'image.bin',
      mimeType: 'application/octet-stream',
      modifiedTime: '2026-05-24T14:03:00.000Z',
      webViewLink: 'https://drive.google.com/file/d/file-review-001',
      parents: ['inbox']
    },
    {
      id: 'file-processed-001',
      name: 'menu.pdf',
      mimeType: 'application/pdf',
      modifiedTime: '2026-05-24T14:04:00.000Z',
      webViewLink: 'https://drive.google.com/file/d/file-processed-001',
      parents: ['inbox']
    }
  ]);
  setDriveClientFactory(() => client);
  const folders = {
    '00_Inbox': { id: 'inbox', path: inboxPath },
    '01_Processed': { id: 'processed', path: processedPath },
    '02_Needs_Review': { id: 'needs-review', path: needsReviewPath },
    '03_Archived_Sources': { id: 'archived', path: '03_Archived_Sources' },
    '04_Entity_Files': { id: 'entities', path: '04_Entity_Files' },
    '05_Exports': { id: 'exports', path: '05_Exports' },
    '06_Audit': { id: 'audit', path: '06_Audit' },
    '07_System': { id: 'system', path: '07_System' }
  };

  await importDriveFile(
    {
      drive_file_id: 'file-review-001',
      file_name: 'image.bin',
      mime_type: 'application/octet-stream',
      folder_id: 'inbox',
      web_url: 'https://drive.google.com/file/d/file-review-001',
      modified_time: '2026-05-24T14:03:00.000Z',
      observed_at: '2026-05-24T14:03:00.000Z',
      entity_id: 'business-sync-review'
    },
    { client, folderPath: '00_Inbox', folderAlias: '00_Inbox', managedFolders: folders }
  );
  await importDriveFile(
    {
      drive_file_id: 'file-processed-001',
      file_name: 'menu.pdf',
      mime_type: 'application/pdf',
      folder_id: 'inbox',
      web_url: 'https://drive.google.com/file/d/file-processed-001',
      modified_time: '2026-05-24T14:04:00.000Z',
      observed_at: '2026-05-24T14:04:00.000Z',
      entity_id: 'business-sync-processed'
    },
    { client, folderPath: '00_Inbox', folderAlias: '00_Inbox', managedFolders: folders }
  );

  const replayEvents = getRecentReplayEvents(20);
  assert.equal(replayEvents.some((event) => event.event_type === 'drive_import_received'), true);
  assert.equal(replayEvents.some((event) => event.event_type === 'drive_import_processed'), true);
  assert.equal(replayEvents.some((event) => event.event_type === 'drive_import_needs_review'), true);
});

test('routeImportedFile returns expected behavior for supported and unsupported inbox files', () => {
  const withEntity = createDriveFileRecord({
    drive_file_id: 'route-001',
    file_name: 'agreement.pdf',
    mime_type: 'application/pdf',
    folder_id: 'inbox',
    folder_path: inboxPath,
    web_url: 'https://drive.google.com/file/d/route-001',
    entity_id: 'business-route-001',
    observed_at: '2026-05-24T14:05:00.000Z'
  });

  const unsupported = createDriveFileRecord({
    drive_file_id: 'route-002',
    file_name: 'unknown.bin',
    mime_type: 'application/octet-stream',
    folder_id: 'inbox',
    folder_path: inboxPath,
    web_url: 'https://drive.google.com/file/d/route-002',
    entity_id: 'business-route-002',
    observed_at: '2026-05-24T14:05:00.000Z'
  });

  assert.equal(routeImportedFile(withEntity).route, 'processed');
  assert.equal(routeImportedFile(unsupported).route === 'needs_review' || routeImportedFile(unsupported).route === 'skipped', true);
});

test('raw screenshot without entity_id is accepted for MealScout intake queue', () => {
  const rawScreenshot = createDriveFileRecord({
    drive_file_id: 'raw-screenshot-no-entity',
    file_name: 'facebook-profile.png',
    mime_type: 'image/png',
    folder_id: 'inbox',
    folder_path: inboxPath,
    web_url: 'https://drive.google.com/file/d/raw-screenshot-no-entity',
    observed_at: '2026-05-24T14:08:00.000Z'
  });

  const route = routeImportedFile(rawScreenshot);
  assert.equal(route.route, 'processed');
  assert.equal(route.moveTo, '01_Processed');
  assert.equal(route.reason.includes('Raw screenshot/PDF accepted'), true);
  assert.notEqual(route.reason, 'Missing entity_id for inbox file');
});

test('raw PDF without entity_id is accepted for MealScout intake queue', () => {
  const rawPdf = createDriveFileRecord({
    drive_file_id: 'raw-pdf-no-entity',
    file_name: 'facebook-profile.pdf',
    mime_type: 'application/pdf',
    folder_id: 'inbox',
    folder_path: inboxPath,
    web_url: 'https://drive.google.com/file/d/raw-pdf-no-entity',
    observed_at: '2026-05-24T14:09:00.000Z'
  });

  const route = routeImportedFile(rawPdf);
  assert.equal(route.route, 'processed');
  assert.equal(route.moveTo, '01_Processed');
});

test('managed non-raw inbox file without entity_id still requires review and does not queue screenshot intake', async () => {
  const textFile = createDriveFileRecord({
    drive_file_id: 'managed-text-no-entity',
    file_name: 'notes.txt',
    mime_type: 'text/plain',
    folder_id: 'inbox',
    folder_path: inboxPath,
    web_url: 'https://drive.google.com/file/d/managed-text-no-entity',
    observed_at: '2026-05-24T14:10:00.000Z'
  });

  const route = routeImportedFile(textFile);
  assert.equal(route.route, 'needs_review');
  assert.equal(route.reason, 'Missing entity_id for managed inbox file');

  const { client } = createMockDriveClient(createSyncFolders(), [
    {
      id: 'managed-text-no-entity',
      name: 'notes.txt',
      mimeType: 'text/plain',
      modifiedTime: '2026-05-24T14:10:00.000Z',
      webViewLink: 'https://drive.google.com/file/d/managed-text-no-entity',
      parents: ['inbox']
    }
  ]);

  await importDriveFile(
    {
      drive_file_id: 'managed-text-no-entity',
      file_name: 'notes.txt',
      mime_type: 'text/plain',
      folder_id: 'inbox',
      web_url: 'https://drive.google.com/file/d/managed-text-no-entity',
      modified_time: '2026-05-24T14:10:00.000Z'
    },
    {
      client,
      folderPath: inboxPath,
      folderAlias: '00_Inbox',
      managedFolders: {
        '00_Inbox': { id: 'inbox', path: inboxPath },
        '01_Processed': { id: 'processed', path: processedPath },
        '02_Needs_Review': { id: 'needs-review', path: needsReviewPath },
        '03_Archived_Sources': { id: 'archived', path: '03_Archived_Sources' },
        '04_Entity_Files': { id: 'entities', path: '04_Entity_Files' },
        '05_Exports': { id: 'exports', path: '05_Exports' },
        '06_Audit': { id: 'audit', path: '06_Audit' },
        '07_System': { id: 'system', path: '07_System' }
      }
    }
  );

  const replayEvents = getRecentReplayEvents(20);
  assert.equal(replayEvents.some((event) => event.event_type === 'screenshot_intake_queued'), false);
});

test('raw screenshot import records drive_file_imported before screenshot_intake_queued without auto-apply side effects', async () => {
  const beforeProfiles = listMealScoutAutoOnboardedProfiles().length;
  const { client } = createMockDriveClient(createSyncFolders(), [
    {
      id: 'raw-import-order-001',
      name: 'profile.png',
      mimeType: 'image/png',
      modifiedTime: '2026-05-24T14:11:00.000Z',
      webViewLink: 'https://drive.google.com/file/d/raw-import-order-001',
      parents: ['inbox']
    }
  ]);

  const result = await importDriveFile(
    {
      drive_file_id: 'raw-import-order-001',
      file_name: 'profile.png',
      mime_type: 'image/png',
      folder_id: 'inbox',
      web_url: 'https://drive.google.com/file/d/raw-import-order-001',
      modified_time: '2026-05-24T14:11:00.000Z'
    },
    {
      client,
      folderPath: inboxPath,
      folderAlias: '00_Inbox',
      managedFolders: {
        '00_Inbox': { id: 'inbox', path: inboxPath },
        '01_Processed': { id: 'processed', path: processedPath },
        '02_Needs_Review': { id: 'needs-review', path: needsReviewPath },
        '03_Archived_Sources': { id: 'archived', path: '03_Archived_Sources' },
        '04_Entity_Files': { id: 'entities', path: '04_Entity_Files' },
        '05_Exports': { id: 'exports', path: '05_Exports' },
        '06_Audit': { id: 'audit', path: '06_Audit' },
        '07_System': { id: 'system', path: '07_System' }
      }
    }
  );

  assert.equal(result.route, 'processed');
  assert.equal(result.reason.includes('Raw screenshot/PDF accepted'), true);

  const chronological = getRecentReplayEvents(30).reverse();
  const importedIndex = chronological.findIndex(
    (event) => event.event_type === 'drive_file_imported' && event.source_refs.includes('drive:raw-import-order-001')
  );
  const queuedIndex = chronological.findIndex(
    (event) => event.event_type === 'screenshot_intake_queued' && event.source_refs.includes('drive:raw-import-order-001')
  );
  assert.equal(importedIndex >= 0, true);
  assert.equal(queuedIndex > importedIndex, true);
  assert.equal(chronological.some((event) => event.event_type === 'business_profile_started'), false);
  assert.equal(chronological.some((event) => event.event_type === 'restaurant_onboarded'), false);
  assert.equal(getRecentApprovals().length, 0);
  assert.equal(listMealScoutAutoOnboardedProfiles().length, beforeProfiles);

  const lisaEvents = getLisaEventsForBrowser(20);
  assert.equal(lisaEvents.some((event) => event.title.includes('profile.png')), true);
});

test('syncDriveInbox scans canonical inbox, MealScout incoming screenshots, and configured legacy screenshots folder', async () => {
  process.env.MERLIN_MEALSCOUT_LEGACY_SCREENSHOTS_FOLDER_ID = 'mealscout-legacy-screenshots';
  const { client } = createMockDriveClient(createSyncFolders(), [
    {
      id: 'scan-inbox-001',
      name: 'inbox-profile.png',
      mimeType: 'image/png',
      modifiedTime: '2026-05-24T14:12:00.000Z',
      webViewLink: 'https://drive.google.com/file/d/scan-inbox-001',
      parents: ['inbox']
    },
    {
      id: 'scan-mealscout-001',
      name: 'mealscout-profile.png',
      mimeType: 'image/png',
      modifiedTime: '2026-05-24T14:13:00.000Z',
      webViewLink: 'https://drive.google.com/file/d/scan-mealscout-001',
      parents: ['mealscout-screenshots']
    },
    {
      id: 'scan-legacy-001',
      name: 'legacy-profile.pdf',
      mimeType: 'application/pdf',
      modifiedTime: '2026-05-24T14:14:00.000Z',
      webViewLink: 'https://drive.google.com/file/d/scan-legacy-001',
      parents: ['mealscout-legacy-screenshots']
    }
  ]);
  setDriveClientFactory(() => client);

  const discovery = await discoverManagedFolders({ client });
  const targets = await planDriveInboxScanTargets(discovery, client);
  assert.deepEqual(
    targets.map((target) => target.id),
    ['inbox', 'mealscout-screenshots', 'mealscout-legacy-screenshots']
  );

  const result = await syncDriveInbox({ client });
  assert.equal(result.status, 'ok');
  assert.equal(result.processed, 3);

  const queued = getRecentReplayEvents(50).filter((event) => event.event_type === 'screenshot_intake_queued');
  assert.equal(queued.length, 3);
});

test('POST /api/drive/sync returns 409 when auth is unhealthy', async () => {
  process.env.GOOGLE_REFRESH_TOKEN = '';
  const beforeSeen = getManifestEntriesByStatus('seen');
  const beforeCount = beforeSeen.length;
  const { client } = createMockDriveClient(createSyncFolders(), [
    {
      id: 'sync-unhealthy-file-001',
      name: 'invoice.pdf',
      mimeType: 'application/pdf',
      modifiedTime: '2026-05-24T14:06:00.000Z',
      webViewLink: 'https://drive.google.com/file/d/sync-unhealthy-file-001',
      parents: ['inbox']
    }
  ]);
  setDriveClientFactory(() => client);

  const response = await requestJson<{ error: string; reason?: string }>('/api/drive/sync', { method: 'POST' });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, 'Drive auth unhealthy');
  assert.equal(response.body.reason, 'OAuth credentials are incomplete');

  const afterSeen = getManifestEntriesByStatus('seen');
  assert.equal(afterSeen.length, beforeCount);
  assert.equal(mockClientCalls.moved.length, 0);

  const replay = getRecentReplayEvents(20);
  assert.equal(replay.some((event) => event.event_type === 'drive_auth_unhealthy'), true);
});

test('POST /api/drive/sync healthy auth executes sync endpoint behavior', async () => {
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';
  const { client } = createMockDriveClient(createSyncFolders(), [
    {
      id: 'sync-healthy-file-001',
      name: 'invoice.pdf',
      mimeType: 'application/pdf',
      modifiedTime: '2026-05-24T14:07:00.000Z',
      webViewLink: 'https://drive.google.com/file/d/sync-healthy-file-001',
      parents: ['inbox'],
      entity_id: 'business-sync-route'
    }
  ]);
  setDriveClientFactory(() => client);

  const response = await requestJson<{ status: string; result: { status: string; manifest_updates: number } }>(
    '/api/drive/sync',
    { method: 'POST' }
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.result.status, 'ok');
  assert.equal(response.body.result.manifest_updates >= 1, true);
});
