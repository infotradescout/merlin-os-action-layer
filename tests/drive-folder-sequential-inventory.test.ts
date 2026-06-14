import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DriveClient, DriveFileInfo, DriveFolderInfo } from '../src/driveClient.ts';
import {
  createDriveSequentialRenameInventory,
  driveSequentialManifestRowsToCsv
} from '../src/driveFolderSequentialInventory.ts';

function file(overrides: Partial<DriveFileInfo>): DriveFileInfo {
  return {
    drive_file_id: overrides.drive_file_id || 'file-1',
    file_name: overrides.file_name || 'image.png',
    mime_type: overrides.mime_type || 'image/png',
    folder_id: overrides.folder_id || 'folder-1',
    web_url: overrides.web_url || `https://drive.test/${overrides.drive_file_id || 'file-1'}`,
    modified_time: overrides.modified_time || '2026-06-14T00:00:00.000Z',
    size: overrides.size || '123',
    raw_metadata: overrides.raw_metadata
  };
}

function client(files: DriveFileInfo[], renameCalls: Array<{ fileId: string; newName: string }> = []): DriveClient {
  return {
    async listFilesInFolder() {
      return files;
    },
    async getFileMetadata(fileId: string) {
      return files.find((entry) => entry.drive_file_id === fileId) || file({ drive_file_id: fileId });
    },
    async downloadFileContent() {
      return undefined;
    },
    async renameFile(fileId: string, newName: string) {
      renameCalls.push({ fileId, newName });
      const existing = files.find((entry) => entry.drive_file_id === fileId) || file({ drive_file_id: fileId });
      existing.file_name = newName;
      return existing;
    },
    async moveFileToFolder() {
      return true;
    },
    async findFolderByName(): Promise<DriveFolderInfo | undefined> {
      return undefined;
    },
    async listFoldersByName(): Promise<DriveFolderInfo[]> {
      return [];
    },
    async createFolderIfMissing(name: string): Promise<DriveFolderInfo> {
      return { id: `${name}-id`, name };
    }
  };
}

test('dry-run builds deterministic zero-padded manifest without renaming', async () => {
  const renameCalls: Array<{ fileId: string; newName: string }> = [];
  const result = await createDriveSequentialRenameInventory({
    folderId: 'folder-1',
    client: client(
      [
        file({ drive_file_id: 'b-id', file_name: 'b.JPG', mime_type: 'image/jpeg', size: '20' }),
        file({ drive_file_id: 'doc-id', file_name: 'notes.txt', mime_type: 'text/plain', size: '5' }),
        file({ drive_file_id: 'a-id', file_name: 'a.png', mime_type: 'image/png', size: '10' }),
        file({ drive_file_id: 'skip-id', file_name: 'archive.zip', mime_type: 'application/zip' })
      ],
      renameCalls
    )
  });

  assert.equal(result.mode, 'dry-run');
  assert.equal(result.mutationAllowed, false);
  assert.equal(result.totalFilesFound, 4);
  assert.equal(result.totalManifestRows, 3);
  assert.equal(result.totalPlannedRenames, 3);
  assert.deepEqual(result.manifestRows.map((row) => row.drive_file_id), ['a-id', 'b-id', 'doc-id']);
  assert.deepEqual(result.manifestRows.map((row) => row.new_filename), ['001.png', '002.JPG', '003.txt']);
  assert.equal(result.skippedFiles[0].drive_file_id, 'skip-id');
  assert.equal(result.validation.sequenceHasNoGaps, true);
  assert.equal(result.validation.everyManifestRowHasOriginalFilenameAndDriveFileId, true);
  assert.equal(renameCalls.length, 0);
});

test('manifest CSV contains required processing and extraction tracking columns', async () => {
  const result = await createDriveSequentialRenameInventory({
    folderId: 'folder-1',
    client: client([file({ drive_file_id: 'a-id', file_name: 'a.png' })])
  });
  const csv = driveSequentialManifestRowsToCsv(result.manifestRows);

  assert.match(csv, /sequence_number,drive_file_id,original_filename,new_filename,mime_type,size,modified_time,parent_folder_id,processed_status,extraction_status,duplicate_group,notes/);
  assert.match(csv, /false,pending/);
});

test('target filename conflicts stop before rename', async () => {
  await assert.rejects(
    createDriveSequentialRenameInventory({
      folderId: 'folder-1',
      client: client([
        file({ drive_file_id: 'a-id', file_name: 'b.png' }),
        file({ drive_file_id: 'b-id', file_name: '002.png' })
      ])
    }),
    /target_name_conflicts:002\.png/
  );
});

test('expected total file count mismatch stops as access issue', async () => {
  await assert.rejects(
    createDriveSequentialRenameInventory({
      folderId: 'folder-1',
      client: client([file({ drive_file_id: 'a-id', file_name: 'a.png' })]),
      expectedTotalFileCount: 2
    }),
    /drive_folder_count_mismatch:expected=2:actual=1/
  );
});

test('execute mode requires explicit rename confirmation', async () => {
  await assert.rejects(
    createDriveSequentialRenameInventory({
      folderId: 'folder-1',
      client: client([file({ drive_file_id: 'a-id', file_name: 'a.png' })]),
      mode: 'execute'
    }),
    /rename_execute_requires_confirm_rename/
  );
});

test('execute mode renames each planned file after confirmation', async () => {
  const renameCalls: Array<{ fileId: string; newName: string }> = [];
  const result = await createDriveSequentialRenameInventory({
    folderId: 'folder-1',
    client: client(
      [
        file({ drive_file_id: 'b-id', file_name: 'b.jpg' }),
        file({ drive_file_id: 'a-id', file_name: 'a.jpg' })
      ],
      renameCalls
    ),
    mode: 'execute',
    confirmRename: true
  });

  assert.equal(result.mutationAllowed, true);
  assert.deepEqual(renameCalls, [
    { fileId: 'a-id', newName: '001.jpg' },
    { fileId: 'b-id', newName: '002.jpg' }
  ]);
  assert.equal(result.validation.everyRenamedFileHasManifestRow, true);
});
