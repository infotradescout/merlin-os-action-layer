import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-drive-upload-'));
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
const { closeDriveBufferLifecycleStore } = await import('../src/driveBufferLifecycle.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');
const { setDriveClientFactory, resetDriveClientFactory } = await import('../src/driveClient.ts');
const { closeMerlinThreadRuntime } = await import('../src/merlin/threadRuntime.ts');
const { closeMerlinWorkspaceRuntime } = await import('../src/merlin/workspaceRuntime.ts');

let server: Server;
let baseUrl = '';

type FolderRecord = { id: string; name: string; parentId: string };
const folders = new Map<string, FolderRecord>();
const folderIndex = new Map<string, string>();
const uploadedFiles = new Map<string, { fileName: string; mimeType: string; folderId: string; content: Buffer }>();
let uploadSequence = 0;

function folderKey(parentId: string, name: string): string {
  return `${parentId}::${name}`;
}

function addFolder(id: string, name: string, parentId: string): void {
  folders.set(id, { id, name, parentId });
  folderIndex.set(folderKey(parentId, name), id);
}

function seedFolders(): void {
  folders.clear();
  folderIndex.clear();
  uploadedFiles.clear();
  uploadSequence = 0;

  addFolder('root-merlin', 'Merlin OR Storage', 'root');
  addFolder('folder-inbox', '00_Inbox', 'root-merlin');
  addFolder('folder-processed', '01_Processed', 'root-merlin');
  addFolder('folder-needs-review', '02_Needs_Review', 'root-merlin');
  addFolder('folder-archived', '03_Archived_Sources', 'root-merlin');
  addFolder('folder-entity-files', '04_Entity_Files', 'root-merlin');
  addFolder('folder-exports', '05_Exports', 'root-merlin');
  addFolder('folder-audit', '06_Audit', 'root-merlin');
  addFolder('folder-system', '07_System', 'root-merlin');

  addFolder('mealscout-intake-root', 'MealScout Intake', 'root-merlin');
  addFolder('ms-incoming', 'incoming', 'mealscout-intake-root');
  addFolder('ms-incoming-unknown', 'unknown', 'ms-incoming');
  addFolder('ms-incoming-screenshots', 'screenshots', 'ms-incoming');
}

function installMockDriveClient(): void {
  seedFolders();
  setDriveClientFactory(() => ({
    async listFilesInFolder(folderId: string) {
      return Array.from(uploadedFiles.entries())
        .filter(([, file]) => file.folderId === folderId)
        .map(([driveFileId, file]) => ({
          drive_file_id: driveFileId,
          file_name: file.fileName,
          mime_type: file.mimeType,
          folder_id: file.folderId,
          web_url: `https://drive.google.com/file/d/${driveFileId}`
        }));
    },
    async getFileMetadata(fileId: string) {
      const file = uploadedFiles.get(fileId);
      if (!file) throw new Error('file_not_found');
      return {
        drive_file_id: fileId,
        file_name: file.fileName,
        mime_type: file.mimeType,
        folder_id: file.folderId,
        web_url: `https://drive.google.com/file/d/${fileId}`
      };
    },
    async downloadFileContent(fileId: string) {
      const file = uploadedFiles.get(fileId);
      return file ? file.content.toString('utf8') : undefined;
    },
    async downloadFileBinary(fileId: string) {
      return uploadedFiles.get(fileId)?.content;
    },
    async uploadFileToFolder(input) {
      uploadSequence += 1;
      const driveFileId = `uploaded-file-${uploadSequence}`;
      uploadedFiles.set(driveFileId, {
        fileName: input.fileName,
        mimeType: input.mimeType,
        folderId: input.parentFolderId,
        content: input.content
      });
      return {
        drive_file_id: driveFileId,
        file_name: input.fileName,
        mime_type: input.mimeType,
        folder_id: input.parentFolderId,
        web_url: `https://drive.google.com/file/d/${driveFileId}`
      };
    },
    async copyFileToFolder() {
      throw new Error('not_implemented');
    },
    async moveFileToFolder() {
      return true;
    },
    async trashFile() {
      return true;
    },
    async findFolderByName(name: string, parentFolderId: string) {
      const id = folderIndex.get(folderKey(parentFolderId, name));
      return id ? { id, name } : undefined;
    },
    async listFoldersByName(name: string, parentFolderId: string) {
      const matches = Array.from(folders.values()).filter((folder) => folder.parentId === parentFolderId && folder.name === name);
      return matches.map((folder) => ({ id: folder.id, name: folder.name }));
    },
    async createFolderIfMissing(name: string, parentFolderId: string) {
      const existing = folderIndex.get(folderKey(parentFolderId, name));
      if (existing) return { id: existing, name };
      const id = `created-folder-${folders.size + 1}`;
      addFolder(id, name, parentFolderId);
      return { id, name };
    }
  }));
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-operator-id': 'drive-upload-test-user',
      'x-operator-role': 'admin',
      ...(init.headers || {})
    },
    ...init
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T };
}

before(async () => {
  installMockDriveClient();
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
  await new Promise<void>((resolveStop) => server.close(() => resolveStop()));
  resetDriveClientFactory();
  closeDriveManifestStore();
  closeDriveBufferLifecycleStore();
  closeLisaStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
  closeMerlinThreadRuntime();
  closeMerlinWorkspaceRuntime();
});

beforeEach(async () => {
  installMockDriveClient();
  await requestJson('/api/demo/reset', { method: 'POST' });
});

test('browser-uploaded files enter the drive buffer, manifest, and lifecycle flow', async () => {
  const uploaded = await requestJson<{
    status: string;
    driveFolder: { id: string; path: string };
    uploadedFiles: Array<{ drive_file_id: string; file_name: string; manifest_id: string }>;
    threadAttachments: Array<{ fileId: string; driveFolderId: string }>;
  }>('/api/merlin/drive-buffer/upload', {
    method: 'POST',
    body: JSON.stringify({
      folder_label: 'browser-buffer-accounts',
      files: [
        {
          fileName: 'account-notes.txt',
          mimeType: 'text/plain',
          textContent: 'Sweet Heat Tacos\nNew Orleans, LA',
          base64Content: Buffer.from('Sweet Heat Tacos\nNew Orleans, LA', 'utf8').toString('base64')
        }
      ]
    })
  });

  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.status, 'ok');
  assert.equal(uploaded.body.driveFolder.path.includes('MealScout Intake/incoming/unknown/browser-buffer-accounts'), true);
  assert.equal(uploaded.body.uploadedFiles.length, 1);
  assert.equal(uploaded.body.threadAttachments[0].driveFolderId, uploaded.body.driveFolder.id);

  const driveFileId = uploaded.body.uploadedFiles[0].drive_file_id;
  const manifest = await requestJson<{ manifest_entry: { drive_file_id: string; file_name: string } }>(
    `/api/drive/manifest/${encodeURIComponent(driveFileId)}`
  );
  assert.equal(manifest.status, 200);
  assert.equal(manifest.body.manifest_entry.drive_file_id, driveFileId);
  assert.equal(manifest.body.manifest_entry.file_name, 'account-notes.txt');

  const lifecycle = await requestJson<{ lifecycle: { drive_file_id: string; lifecycle_state: string } }>(
    `/api/drive/buffer-lifecycle/${encodeURIComponent(driveFileId)}`
  );
  assert.equal(lifecycle.status, 200);
  assert.equal(lifecycle.body.lifecycle.drive_file_id, driveFileId);
  assert.equal(lifecycle.body.lifecycle.lifecycle_state, 'buffered');
});
