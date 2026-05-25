import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
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

const { closeLisaStore, resetLisaStore } = await import('../src/lisa.ts');
const { closeDriveManifestStore, createManifestEntry, getManifestEntriesByStatus, getManifestEntryByDriveFileId, resetDriveManifestForTest } = await import('../src/driveManifest.ts');
const { closeReplayStore, getRecentReplayEvents, resetReplayForTest } = await import('../src/replay.ts');
const { closeRecommendationsStore, resetRecommendationsForTest } = await import('../src/recommendations.ts');
const { closeOutcomesStore, resetOutcomesForTest } = await import('../src/outcomes.ts');
const { closeApprovalQueueStore, resetApprovalQueueForTest } = await import('../src/approvalQueue.ts');
const { discoverManagedFolders, importDriveFile, routeImportedFile, syncDriveInbox } = await import('../src/driveSync.ts');
const { setDriveClientFactory, resetDriveClientFactory } = await import('../src/driveClient.ts');
const { createDriveBootstrapPlan } = await import('../src/driveManager.ts');

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
    { id: 'system', name: '07_System', parent: 'dedicated-root' }
  );
  return folders;
}

beforeEach(() => {
  resetLisaStore();
  resetDriveManifestForTest();
  resetReplayForTest();
  resetRecommendationsForTest();
  resetOutcomesForTest();
  resetApprovalQueueForTest();
});

after(async () => {
  closeLisaStore();
  closeDriveManifestStore();
  closeReplayStore();
  closeRecommendationsStore();
  closeOutcomesStore();
  closeApprovalQueueStore();
  resetDriveClientFactory();
  rmSync(tempDir, { recursive: true, force: true });
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
