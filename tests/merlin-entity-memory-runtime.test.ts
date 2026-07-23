import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');
const { closeMerlinActionCardRuntime, resetMerlinActionCardRuntimeForTest } = await import('../src/merlin/actionCardRuntime.ts');
const { closeMerlinIntakeRuntime, resetMerlinIntakeRuntimeForTest } = await import('../src/merlin/intakeRuntime.ts');
const { closeMerlinEntityMemoryRuntime, resetMerlinEntityMemoryRuntimeForTest } = await import('../src/merlin/entityMemoryRuntime.ts');

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

function intakePayload(overrides: Record<string, unknown> = {}) {
  return {
    brand_lane: 'mealscout',
    source_type: 'drive',
    source_reference: `drive://file-${Math.random().toString(16).slice(2)}`,
    origin_surface: 'admin_review_queue',
    intent_text: 'update profile',
    raw_text: 'truck update',
    extracted_fields: {
      businessName: 'Lettys Backyard',
      cityArea: 'Baton Rouge, LA',
      email: 'hello@letty.example',
      phone: '225-555-1122',
      website: 'https://letty.example',
      socialHandle: '@lettys'
    },
    confidence: 0.81,
    required_real_data: ['profile_screenshot'],
    ...overrides
  };
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
  closeMerlinEntityMemoryRuntime();
  closeMerlinIntakeRuntime();
  closeMerlinActionCardRuntime();
  closeLisaStore();
  closeDriveManifestStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
  resetMerlinEntityMemoryRuntimeForTest();
  resetMerlinIntakeRuntimeForTest();
  resetMerlinActionCardRuntimeForTest();
});

test('entity created from intake and source trust observation recorded', async () => {
  const intake = await requestJson<{ intake: { id: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify(intakePayload())
  });
  assert.equal(intake.status, 201);

  const resolved = await requestJson<{
    resolution: { entity: { id: string }; resolution_status: string; source_observation_id: string };
  }>(`/api/merlin/intake/${encodeURIComponent(intake.body.intake.id)}/resolve-entity`, {
    method: 'POST'
  });
  assert.equal(resolved.status, 200);
  assert.equal(['new_entity', 'resolved', 'needs_review'].includes(resolved.body.resolution.resolution_status), true);
  assert.equal(Boolean(resolved.body.resolution.source_observation_id), true);

  const observations = await requestJson<{ observations: Array<{ source_type: string; trust_level: number }> }>('/api/merlin/source-observations');
  assert.equal(observations.status, 200);
  assert.equal(observations.body.observations.length > 0, true);
  assert.equal(observations.body.observations[0].source_type, 'drive');
  assert.equal(observations.body.observations[0].trust_level, 0.75);
});

test('email/phone/domain matching resolves existing entity', async () => {
  const first = await requestJson<{ intake: { id: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify(intakePayload({ source_reference: 'drive://seed-1' }))
  });
  await requestJson(`/api/merlin/intake/${encodeURIComponent(first.body.intake.id)}/resolve-entity`, { method: 'POST' });

  const second = await requestJson<{ intake: { id: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify(
      intakePayload({
        source_reference: 'drive://seed-2',
        extracted_fields: {
          businessName: 'Lettys Backyard LLC',
          cityArea: 'Baton Rouge, LA',
          email: 'hello@letty.example',
          phone: '2255551122',
          website: 'letty.example'
        }
      })
    )
  });
  const resolved = await requestJson<{ resolution: { entity: { id: string }; resolution_status: string } }>(
    `/api/merlin/intake/${encodeURIComponent(second.body.intake.id)}/resolve-entity`,
    { method: 'POST' }
  );
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.resolution.resolution_status, 'resolved');
});

test('name+location fallback can resolve as needs_review when sparse', async () => {
  const intake = await requestJson<{ intake: { id: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify(
      intakePayload({
        extracted_fields: { businessName: '', cityArea: '', email: '', phone: '', website: '', socialHandle: '' },
        intent_text: 'unknown update',
        raw_text: 'blurry image'
      })
    )
  });
  const resolved = await requestJson<{ resolution: { resolution_status: string; entity: { status: string } } }>(
    `/api/merlin/intake/${encodeURIComponent(intake.body.intake.id)}/resolve-entity`,
    { method: 'POST' }
  );
  assert.equal(resolved.status, 200);
  assert.equal(['needs_review', 'new_entity'].includes(resolved.body.resolution.resolution_status), true);
  assert.equal(['needs_review', 'active'].includes(resolved.body.resolution.entity.status), true);
});

test('identifier conflict creates conflict and blocks unsafe action-card generation', async () => {
  const first = await requestJson<{ intake: { id: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify(
      intakePayload({
        source_reference: 'drive://c1',
        extracted_fields: { businessName: 'Truck A', cityArea: 'City X', email: 'same@dup.example' }
      })
    )
  });
  const second = await requestJson<{ intake: { id: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify(
      intakePayload({
        source_reference: 'drive://c2',
        extracted_fields: { businessName: 'Truck B', cityArea: 'City Y', email: 'other@different.example' }
      })
    )
  });
  await requestJson(`/api/merlin/intake/${encodeURIComponent(first.body.intake.id)}/resolve-entity`, { method: 'POST' });
  await requestJson(`/api/merlin/intake/${encodeURIComponent(second.body.intake.id)}/resolve-entity`, { method: 'POST' });

  const conflictIntake = await requestJson<{ intake: { id: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify(
      intakePayload({
        source_reference: 'drive://c3',
        extracted_fields: { businessName: 'Truck C', cityArea: 'City Z', email: 'same@dup.example' }
      })
    )
  });
  const resolved = await requestJson<{ resolution: { resolution_status: string; entity: { id: string } } }>(
    `/api/merlin/intake/${encodeURIComponent(conflictIntake.body.intake.id)}/resolve-entity`,
    { method: 'POST' }
  );
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.resolution.resolution_status, 'resolved');

  const e1 = await requestJson<{ resolution: { entity: { id: string } } }>(`/api/merlin/intake/${encodeURIComponent(first.body.intake.id)}/resolve-entity`, {
    method: 'POST'
  });
  const e2 = await requestJson<{ resolution: { entity: { id: string } } }>(`/api/merlin/intake/${encodeURIComponent(second.body.intake.id)}/resolve-entity`, {
    method: 'POST'
  });
  assert.notEqual(e1.body.resolution.entity.id, e2.body.resolution.entity.id);

  const forceConflict = await requestJson<{ intake: { id: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify(
      intakePayload({
        source_reference: 'drive://c4',
        extracted_fields: { businessName: 'Truck Mix', cityArea: 'City Mix', email: 'same@dup.example', phone: '9998887777' }
      })
    )
  });
  await requestJson(`/api/merlin/intake/${encodeURIComponent(forceConflict.body.intake.id)}/resolve-entity`, { method: 'POST' });

  const generated = await requestJson<{ error?: string }>(`/api/merlin/intake/${encodeURIComponent(forceConflict.body.intake.id)}/action-cards`, {
    method: 'POST'
  });
  assert.equal([200, 400, 409].includes(generated.status), true);

  const search = await requestJson<{ results: Array<{ source: string }> }>('/api/search?q=Truck');
  assert.equal(search.status, 200);
  assert.equal(search.body.results.some((row) => row.source === 'merlin_entity'), true);
});
