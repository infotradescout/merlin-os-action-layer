import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.MERLIN_RUNTIME = 'test';
process.env.MERLIN_INTAKE_ENABLED = 'true';
process.env.MERLIN_SEARCH_ENABLED = 'true';
process.env.MERLIN_INTAKE_MEALSCOUT_ENABLED = 'true';
process.env.MERLIN_INTAKE_TRADESCOUT_ENABLED = 'true';
process.env.MERLIN_INTAKE_HOMEID_ENABLED = 'true';

const { createMerlinServer } = await import('../src/server.ts');
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
  await new Promise<void>((resolveStop) => server.close(() => resolveStop()));
  closeLisaStore();
  closeDriveManifestStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
});

beforeEach(async () => {
  process.env.MERLIN_INTAKE_ENABLED = 'true';
  process.env.MERLIN_SEARCH_ENABLED = 'true';
  process.env.MERLIN_INTAKE_MEALSCOUT_ENABLED = 'true';
  await requestJson('/api/demo/reset', { method: 'POST' });
});

async function createIntentWithFile(brand: 'MEALSCOUT' | 'TRADESCOUT', actionId: string, fileId: string, fileName: string, text: string) {
  const created = await requestJson<{ intent: { uploadId: string } }>('/api/merlin/intake/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'u-1',
      accountId: 'a-1',
      brand,
      actorScope: 'owner',
      entityType: brand === 'MEALSCOUT' ? 'food_truck' : 'contractor',
      entityId: `${brand.toLowerCase()}-entity-1`,
      actionId
    })
  });
  assert.equal(created.status, 201);
  const uploadId = created.body.intent.uploadId;
  await requestJson(`/api/merlin/intake/upload-intents/${uploadId}/files`, {
    method: 'POST',
    body: JSON.stringify({ files: [{ fileId, fileName, mimeType: 'image/jpeg', extractedText: text }] })
  });
  const routed = await requestJson<{ evidenceRecords: unknown[] }>(`/api/merlin/intake/upload-intents/${uploadId}/route`, { method: 'POST' });
  assert.equal(routed.status, 200);
  assert.equal(Array.isArray(routed.body.evidenceRecords), true);
  return uploadId;
}

test('Search disabled blocks search endpoint', async () => {
  process.env.MERLIN_SEARCH_ENABLED = 'false';
  const res = await requestJson<{ error: string }>('/api/merlin/search?brand=MEALSCOUT&q=menu');
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'MERLIN_SEARCH_DISABLED');
});

test('Routing/indexing creates evidence records and preview links evidence IDs', async () => {
  const uploadId = await createIntentWithFile('MEALSCOUT', 'update_menu', 'f-1', 'menu.jpg', 'Lunch menu tacos');
  const preview = await requestJson<{ intent: { preview: { linkedEvidenceIds: string[]; mutationAllowed: boolean; implementationAllowed: boolean } } }>(
    `/api/merlin/intake/upload-intents/${uploadId}/preview`,
    { method: 'POST' }
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.body.intent.preview.linkedEvidenceIds.length >= 1, true);
  assert.equal(preview.body.intent.preview.mutationAllowed, false);
  assert.equal(preview.body.intent.preview.implementationAllowed, false);
});

test('Search returns product-scoped evidence and source references only for requested brand', async () => {
  await createIntentWithFile('MEALSCOUT', 'update_menu', 'meal-file-1', 'traci-menu.jpg', 'Traci menu wings combo');

  const mealscoutSearch = await requestJson<{
    resultCount: number;
    results: Array<{ brand: string; sourceFileRefs: Array<{ fileId: string }> }>;
    mutationAllowed: boolean;
    implementationAllowed: boolean;
  }>('/api/merlin/search?brand=MEALSCOUT&q=traci');

  assert.equal(mealscoutSearch.status, 200);
  assert.equal(mealscoutSearch.body.resultCount >= 1, true);
  assert.equal(mealscoutSearch.body.results.every((row) => row.brand === 'MEALSCOUT'), true);
  assert.equal(mealscoutSearch.body.results[0].sourceFileRefs.length >= 1, true);
  assert.equal(mealscoutSearch.body.mutationAllowed, false);
  assert.equal(mealscoutSearch.body.implementationAllowed, false);

  const tradescoutSearch = await requestJson<{ resultCount: number; results: Array<{ brand: string }> }>(
    '/api/merlin/search?brand=TRADESCOUT&q=traci'
  );
  assert.equal(tradescoutSearch.status, 200);
  assert.equal(tradescoutSearch.body.resultCount, 0);
});
