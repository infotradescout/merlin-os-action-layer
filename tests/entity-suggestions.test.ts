import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-v2-2-'));
process.env.MERLIN_DB_PATH = resolve(tempDir, 'merlin-or.sqlite');
process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeAllMerlinStoresForTest } = await import('./testSupport/closeAllStores.ts');

let server: Server;
let baseUrl: string;

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
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
  await new Promise<void>((resolveStop) => server.close(() => resolveStop()));
  closeAllMerlinStoresForTest();
  rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
});

async function seedEntity(entityId: string, payload: Record<string, unknown>): Promise<void> {
  const event = {
    entity_id: entityId,
    event_type: 'verification_document_uploaded',
    origin_surface: 'tradescout',
    observed_at: '2026-05-25T14:00:00.000Z',
    payload: {},
    ...payload
  };
  await requestJson('/api/events/tradescout', {
    method: 'POST',
    body: JSON.stringify(event)
  });
}

async function seedDriveFile(
  driveFileId: string,
  fileName: string,
  extractedText: string,
  extractedFields: Record<string, unknown> = {}
): Promise<void> {
  await requestJson('/api/drive/import-file', {
    method: 'POST',
    body: JSON.stringify({
      drive_file_id: driveFileId,
      file_name: fileName,
      mime_type: 'text/plain',
      folder_path: 'Merlin OR Storage/02_Needs_Review/2026-05',
      web_url: `https://drive.google.com/file/d/${driveFileId}`,
      observed_at: '2026-05-25T14:10:00.000Z',
      raw_metadata: {
        text_content: extractedText,
        ...extractedFields
      }
    })
  });
}

test('filename match suggests entity', async () => {
  await seedEntity('business_abc', { business_name: 'ABC Roofing' });
  await seedDriveFile('drive-suggest-001', 'abc roofing insurance.txt', 'policy notes');
  const response = await requestJson<{ suggestions: Array<{ entity_id: string }> }>(
    '/api/drive/review/drive-suggest-001/entity-suggestions'
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.suggestions.some((s) => s.entity_id === 'business_abc'), true);
});

test('extracted text match suggests entity', async () => {
  await seedEntity('business_bluepeak', { business_name: 'Blue Peak Roofing' });
  await seedDriveFile('drive-suggest-002', 'notes.txt', 'Blue Peak Roofing documents uploaded');
  const response = await requestJson<{ suggestions: Array<{ entity_id: string }> }>(
    '/api/drive/review/drive-suggest-002/entity-suggestions'
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.suggestions.some((s) => s.entity_id === 'business_bluepeak'), true);
});

test('email/phone/domain matches score high', async () => {
  await seedEntity('business_contact', {
    business_name: 'Contact Pros',
    email: 'owner@contactpros.com',
    phone: '(555) 111-2222',
    domain: 'contactpros.com'
  });
  await seedDriveFile(
    'drive-suggest-003',
    'contact.txt',
    'Reach owner@contactpros.com at 5551112222 via contactpros.com',
    { email: 'owner@contactpros.com', phone: '5551112222', domain: 'contactpros.com' }
  );
  const response = await requestJson<{ suggestions: Array<{ entity_id: string; confidence: number }> }>(
    '/api/drive/review/drive-suggest-003/entity-suggestions'
  );
  assert.equal(response.status, 200);
  const match = response.body.suggestions.find((s) => s.entity_id === 'business_contact');
  assert.equal(Boolean(match), true);
  assert.equal((match?.confidence || 0) >= 0.7, true);
});

test('unrelated file returns no high-confidence suggestion', async () => {
  await seedEntity('business_random', { business_name: 'Random Builders' });
  await seedDriveFile('drive-suggest-004', 'totally-unrelated.txt', 'nothing to match here');
  const response = await requestJson<{ suggestions: Array<{ confidence: number }> }>(
    '/api/drive/review/drive-suggest-004/entity-suggestions'
  );
  assert.equal(response.status, 200);
  assert.equal(response.body.suggestions.filter((s) => s.confidence >= 0.6).length, 0);
});

test('suggestion does not attach automatically and attach endpoint still works', async () => {
  await seedEntity('business_manual', { business_name: 'Manual Attach Co' });
  await seedDriveFile('drive-suggest-005', 'manual attach co.txt', 'Manual Attach Co review doc');

  const suggestions = await requestJson<{ suggestions: Array<{ entity_id: string }> }>(
    '/api/drive/review/drive-suggest-005/entity-suggestions'
  );
  assert.equal(suggestions.status, 200);
  assert.equal(suggestions.body.suggestions.length > 0, true);

  const manifestBefore = await requestJson<{ manifest_entry: { processing_status: string; entity_id?: string } }>(
    '/api/drive/manifest/drive-suggest-005'
  );
  assert.equal(manifestBefore.body.manifest_entry.processing_status, 'needs_review');

  const attach = await requestJson<{ status: string; manifest_entry: { entity_id?: string; processing_status: string } }>(
    '/api/drive/review/drive-suggest-005/attach-entity',
    {
      method: 'POST',
      body: JSON.stringify({ entity_id: 'business_manual' })
    }
  );
  assert.equal(attach.status, 200);
  assert.equal(attach.body.status, 'ok');
  assert.equal(attach.body.manifest_entry.entity_id, 'business_manual');
  assert.equal(attach.body.manifest_entry.processing_status, 'processed');
});
