import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import type { DriveClient } from '../src/driveClient.ts';

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

const { discoverMealScoutIntakeFolders } = await import('../src/mealscoutDriveIntake.ts');

type FolderRecord = {
  id: string;
  name: string;
  parent: string;
};

type RootFolderLookup = `${string}:${string}`;

function makeFolderLookupKey(parent: string, name: string): RootFolderLookup {
  return `${parent}:${name.toLowerCase()}`;
}

function createMockDriveClient(initialFolders: FolderRecord[]): { client: DriveClient; createdFolders: string[] } {
  const foldersById = new Map<string, FolderRecord>(initialFolders.map((folder) => [folder.id, folder]));
  const foldersByParentAndName = new Map<string, string>();
  const createdFolders: string[] = [];
  let folderCounter = 1000;

  for (const folder of initialFolders) {
    foldersByParentAndName.set(makeFolderLookupKey(folder.parent, folder.name), folder.id);
  }

  function nextFolderId(): string {
    folderCounter += 1;
    return `folder-${folderCounter}`;
  }

  const client: DriveClient = {
    async listFilesInFolder() {
      return [];
    },
    async getFileMetadata() {
      throw new Error('not used');
    },
    async downloadFileContent() {
      return undefined;
    },
    async moveFileToFolder() {
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
      const key = makeFolderLookupKey(parentFolderId, name);
      const existingId = foldersByParentAndName.get(key);
      if (existingId) {
        const existing = foldersById.get(existingId);
        return { id: existingId, name: existing?.name || name };
      }
      const id = nextFolderId();
      foldersById.set(id, { id, name, parent: parentFolderId });
      foldersByParentAndName.set(key, id);
      createdFolders.push(`${parentFolderId}/${name}`);
      return { id, name };
    }
  };

  return { client, createdFolders };
}

beforeEach(() => {
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';
});

test('read-only discovery reports missing folders without creating them', async () => {
  const { client, createdFolders } = createMockDriveClient([{ id: 'root', name: 'root', parent: '' }]);
  const result = await discoverMealScoutIntakeFolders({ client, createMissing: false });

  assert.equal(result.status, 'error');
  assert.equal(result.mode, 'read_only');
  assert.equal(result.summary.required, 17);
  assert.equal(result.summary.present, 0);
  assert.equal(result.summary.missing, 17);
  assert.equal(result.root.merlin.path, 'Merlin OR Storage');
  assert.equal(createdFolders.length, 0);
});

test('provisioning creates canonical MealScout intake tree and returns stable ids', async () => {
  const { client, createdFolders } = createMockDriveClient([{ id: 'root', name: 'root', parent: '' }]);
  const result = await discoverMealScoutIntakeFolders({ client, createMissing: true });

  assert.equal(result.status, 'ready');
  assert.equal(result.mode, 'provisioned');
  assert.equal(result.summary.missing, 0);
  assert.equal(result.folders['incoming/screenshots'].id.length > 0, true);
  assert.equal(result.folders['review-needed/logo-unmatched'].id.length > 0, true);
  assert.equal(result.folders.archive.id.length > 0, true);
  assert.equal(createdFolders.length >= 19, true);
});

test('discovery marks duplicate folders as conflict', async () => {
  const { client } = createMockDriveClient([
    { id: 'root', name: 'root', parent: '' },
    { id: 'merlin-storage', name: 'Merlin OR Storage', parent: 'root' },
    { id: 'intake', name: 'MealScout Intake', parent: 'merlin-storage' },
    { id: 'incoming-a', name: 'incoming', parent: 'intake' },
    { id: 'incoming-b', name: 'incoming', parent: 'intake' }
  ]);
  const result = await discoverMealScoutIntakeFolders({ client, createMissing: true });

  assert.equal(result.status, 'error');
  assert.equal(result.reason, 'folder_conflict');
  assert.equal(Array.isArray(result.duplicates.incoming), true);
  assert.equal((result.duplicates.incoming || []).length, 2);
});
