import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-v2-1-'));
process.env.MERLIN_DB_PATH = resolve(tempDir, 'merlin-or.sqlite');
process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeRecommendationsStore } = await import('../src/recommendations.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');

let server: Server;
let baseUrl: string;

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...init
  });
  const body = (await response.json()) as T;
  return { status: response.status, body };
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
  await new Promise<void>((resolveStop) => {
    server.close(() => resolveStop());
  });
  closeLisaStore();
  closeDriveManifestStore();
  closeRecommendationsStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
});

async function seedNeedsReviewFile(driveFileId: string): Promise<void> {
  const imported = await requestJson<{ manifest_entry: { processing_status: string } }>('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: driveFileId,
      file_name: 'needs-review.png',
      mime_type: 'image/png',
      folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: `https://drive.google.com/file/d/${driveFileId}`,
      entity_id: 'business-unassigned',
      observed_at: '2026-05-25T13:00:00.000Z'
    })
  });
  assert.equal(imported.status, 200);
  assert.equal(imported.body.manifest_entry.processing_status, 'needs_review');
}

test('attach needs_review file to entity', async () => {
  await seedNeedsReviewFile('file-v2-attach-001');

  const attached = await requestJson<{ status: string; manifest_entry: { entity_id?: string; processing_status: string } }>(
    '/api/drive/review/file-v2-attach-001/attach-entity',
    {
      method: 'POST',
      body: JSON.stringify({
        entity_id: 'business_001',
        entity_type: 'business',
        note: 'Insurance document for business profile'
      })
    }
  );
  assert.equal(attached.status, 200);
  assert.equal(attached.body.status, 'ok');
  assert.equal(attached.body.manifest_entry.entity_id, 'business_001');
  assert.equal(attached.body.manifest_entry.processing_status, 'processed');
});

test('entity timeline includes attachment and LISA search finds attached file', async () => {
  await seedNeedsReviewFile('file-v2-attach-002');

  await requestJson('/api/drive/review/file-v2-attach-002/attach-entity', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: 'business_attach_001',
      note: 'Attach for timeline test'
    })
  });

  const timeline = await requestJson<{ timeline: Array<{ title: string; summary: string }> }>(
    '/api/entities/business_attach_001/timeline?limit=20'
  );
  assert.equal(timeline.status, 200);
  assert.equal(timeline.body.timeline.some((row) => row.title.includes('Drive file attached')), true);

  const searchByEntity = await requestJson<{ results: Array<{ entity_id?: string; type: string }> }>(
    '/api/lisa/search?q=business_attach_001&limit=40'
  );
  assert.equal(searchByEntity.status, 200);
  assert.equal(searchByEntity.body.results.some((item) => item.entity_id === 'business_attach_001'), true);
});

test('outcome and replay are recorded for attachment', async () => {
  await seedNeedsReviewFile('file-v2-attach-003');

  await requestJson('/api/drive/review/file-v2-attach-003/attach-entity', {
    method: 'POST',
    body: JSON.stringify({
      entity_id: 'business_attach_002'
    })
  });

  const replay = await requestJson<{ replay_events: Array<{ event_type: string }> }>('/api/replay/recent?limit=80');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replay_events.some((event) => event.event_type === 'drive_file_attached_to_entity'), true);
  assert.equal(replay.body.replay_events.some((event) => event.event_type === 'outcome_recorded'), true);
});

test('missing drive_file_id returns 404', async () => {
  const response = await requestJson<{ error: string }>(
    '/api/drive/review/file-v2-attach-missing/attach-entity',
    {
      method: 'POST',
      body: JSON.stringify({ entity_id: 'business_001' })
    }
  );
  assert.equal(response.status, 404);
});

test('missing entity_id returns 400', async () => {
  await seedNeedsReviewFile('file-v2-attach-004');

  const response = await requestJson<{ error: string }>(
    '/api/drive/review/file-v2-attach-004/attach-entity',
    {
      method: 'POST',
      body: JSON.stringify({ note: 'missing id' })
    }
  );
  assert.equal(response.status, 400);
});

test('attached file leaves needs-review queue', async () => {
  await seedNeedsReviewFile('file-v2-attach-005');
  await requestJson('/api/drive/review/file-v2-attach-005/attach-entity', {
    method: 'POST',
    body: JSON.stringify({ entity_id: 'business_attach_003' })
  });

  const needsReview = await requestJson<{ manifest_entries: Array<{ drive_file_id: string }> }>('/api/drive/needs-review');
  assert.equal(needsReview.status, 200);
  assert.equal(needsReview.body.manifest_entries.some((entry) => entry.drive_file_id === 'file-v2-attach-005'), false);
});
