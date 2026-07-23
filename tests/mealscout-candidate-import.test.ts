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
          drive_file_id: 'f-traci-profile',
          file_name: 'Screenshot_20260527_115713_Facebook.jpg',
          mime_type: 'image/jpeg',
          folder_id: folderId,
          web_url: 'https://example.com/traci-profile',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { extracted_text: "Traci's Cherished Creations LLC\nPhone: 850-255-8396\nPensacola, FL\n@tracischerishedcreations" }
        },
        {
          drive_file_id: 'f-traci-menu',
          file_name: 'Messenger_creation.jpeg',
          mime_type: 'image/jpeg',
          folder_id: folderId,
          web_url: 'https://example.com/traci-menu',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { extracted_text: "TRACI'S CHERISHED CREATIONS\nPH. 850-255-8396\nWings 10.00" }
        },
        {
          drive_file_id: 'f-other',
          file_name: 'other.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/other',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { extracted_text: 'Random truck without birrieria info' }
        }
      ];
    },
    async getFileMetadata() { throw new Error('not used'); },
    async downloadFileContent() { return undefined; },
    async moveFileToFolder() { throw new Error('must not move'); },
    async findFolderByName() { return undefined; },
    async listFoldersByName(name: string, parentId: string) {
      if (parentId === 'root' && name === 'Merlin OR Storage') return [{ id: 'folder-merlin-storage', name }];
      if (parentId === 'folder-merlin-storage' && name === 'MealScout Intake') return [{ id: 'folder-intake', name }];
      if (parentId === 'folder-intake' && name === 'incoming') return [{ id: 'folder-incoming', name }];
      if (parentId === 'folder-incoming' && name === 'unknown') return [{ id: 'folder-intake-unknown', name }];
      return [];
    },
    async createFolderIfMissing() { throw new Error('not used'); }
  };
}

test('gemini candidate import parses vendors and matches Traci evidence while keeping unmatched as candidate only', async () => {
  setDriveClientFactory(() => buildDriveClient());
  const markdown = `
## Traci's Cherished Creations LLC
Phone: 850-255-8396
Location: Pensacola, FL
Menu:
- Wings 10.00

## Birrieria Spot
Phone: 850-111-2222
Location: Mobile, AL
Menu:
- Birria Taco 4.00
`;
  const response = await requestJson<{
    mutationAllowed: boolean;
    parsedCandidateCount: number;
    matchedCandidateCount: number;
    unmatchedCandidateCount: number;
    candidates: Array<{ businessName?: string; evidenceStatus: string; matches: Array<{ fileId: string }> }>;
  }>('/api/mealscout/intake/candidate-import', {
    method: 'POST',
    body: JSON.stringify({ markdownText: markdown, sourceLabel: 'gemini_drive_summary' })
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.parsedCandidateCount >= 2, true);
  assert.equal(response.body.matchedCandidateCount >= 1, true);
  const traci = response.body.candidates.find((c) => (c.businessName || '').toLowerCase().includes("traci"));
  assert.ok(traci);
  assert.equal(['matched', 'partially_matched'].includes(traci?.evidenceStatus || ''), true);
  assert.equal((traci?.matches || []).length >= 1, true);
  const birrieria = response.body.candidates.find((c) => (c.businessName || '').toLowerCase().includes('birrieria'));
  assert.ok(birrieria);
  assert.equal(birrieria?.evidenceStatus === 'unmatched' || birrieria?.evidenceStatus === 'partially_matched', true);
});

