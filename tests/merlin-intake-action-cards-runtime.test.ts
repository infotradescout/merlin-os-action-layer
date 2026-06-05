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
  await requestJson('/api/demo/reset', { method: 'POST' });
});

test('menu + logo + profile screenshots consolidate into one action card', async () => {
  const response = await requestJson<{
    drafts: Array<{ draftId: string }>;
    actionCards: Array<{ id: string; sourceFileIds: string[]; type: string; mutationAllowed: boolean }>;
    mutationAllowed: boolean;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'profile-1',
          fileName: 'Screenshot_20260527_115713_Facebook.jpg',
          drivePath: '/incoming/profile.jpg',
          sourceFolder: '/incoming',
          extractedText: "Traci's Cherished Creations LLC\nFood Truck\n850-255-8396\nPensacola, FL"
        },
        {
          fileId: 'menu-1',
          fileName: 'Messenger_creation_9527970.jpeg',
          drivePath: '/incoming/menu.jpg',
          sourceFolder: '/incoming',
          extractedText: "TRACI'S CHERISHED CREATIONS\nPH. 850-255-8396\nMenu"
        },
        {
          fileId: 'logo-1',
          fileName: 'FB_IMG_1779901042554.jpg',
          drivePath: '/incoming/logo.jpg',
          sourceFolder: '/incoming',
          extractedText: "Traci's Cherished Creations"
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.drafts.length, 1);
  assert.equal(response.body.actionCards.length, 1);
  assert.equal(response.body.actionCards[0].sourceFileIds.length, 3);
  assert.equal(response.body.actionCards[0].mutationAllowed, false);
});

test('existing truck match prefers update_existing_profile', async () => {
  const response = await requestJson<{
    actionCards: Array<{ type: string; existingEntityMatch: { entityId: string } | null }>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      existingProfiles: [
        {
          id: 'existing-traci-profile',
          truckName: "Traci's Cherished Creations LLC",
          phone: '850-255-8396',
          cityArea: 'Pensacola, FL'
        }
      ],
      inputs: [
        {
          fileId: 'profile-existing',
          fileName: 'Screenshot_20260527_115713_Facebook.jpg',
          drivePath: '/incoming/profile.jpg',
          sourceFolder: '/incoming',
          extractedText: "Traci's Cherished Creations LLC\n850-255-8396\nPensacola, FL"
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.actionCards.length >= 1, true);
  assert.equal(response.body.actionCards[0].type, 'update_existing_profile');
  assert.equal(response.body.actionCards[0].existingEntityMatch?.entityId, 'existing-traci-profile');
});

test('profile/contact screenshot keeps missing menu warning without inventing menu items', async () => {
  const response = await requestJson<{
    actionCards: Array<{ type: string; missingFields: string[]; extractedFields: { menuItems?: unknown[] } }>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'profile-no-menu',
          fileName: 'profile.jpg',
          drivePath: '/incoming/profile.jpg',
          sourceFolder: '/incoming',
          extractedText: "Traci's Cherished Creations LLC\n850-255-8396\nPensacola, FL"
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.actionCards.length >= 1, true);
  assert.equal(response.body.actionCards[0].missingFields.some((field) => field.toLowerCase().includes('menu')), true);
  assert.equal(Array.isArray(response.body.actionCards[0].extractedFields.menuItems), true);
  assert.equal((response.body.actionCards[0].extractedFields.menuItems || []).length, 0);
});

test('unknown screenshot returns defer_unclassified', async () => {
  const response = await requestJson<{
    actionCards: Array<{ type: string; mutationAllowed: boolean }>;
    drafts: unknown[];
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'unknown-1',
          fileName: 'random.png',
          drivePath: '/incoming/random.png',
          sourceFolder: '/incoming',
          extractedText: ''
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.actionCards.length >= 1, true);
  assert.equal(response.body.actionCards[0].type, 'defer_unclassified');
  assert.equal(response.body.actionCards[0].mutationAllowed, false);
});

test('action card exposes extraction debug snippets for operator review', async () => {
  const response = await requestJson<{
    actionCards: Array<{
      extractedFields: { extractionDebug?: { sourceTextSnippets?: Array<{ sourceFileId: string; snippet: string }> } };
    }>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'debug-1',
          fileName: 'profile.jpg',
          drivePath: '/incoming/profile.jpg',
          sourceFolder: '/incoming',
          extractedText: "Traci's Cherished Creations LLC\nPensacola, FL\nInstagram: @tracis"
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.actionCards.length >= 1, true);
  const snippets = response.body.actionCards[0].extractedFields.extractionDebug?.sourceTextSnippets || [];
  assert.equal(Array.isArray(snippets), true);
});

test('cross-file phone/email hydrate onto matching card from non-profile screenshots', async () => {
  const response = await requestJson<{
    actionCards: Array<{
      type: string;
      extractedFields: {
        truckName?: string;
        phone?: string;
        email?: string;
        contactCandidates?: Array<{ type: string; value: string }>;
      };
    }>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'profile-identity',
          fileName: 'profile.jpg',
          drivePath: '/incoming/profile.jpg',
          sourceFolder: '/incoming',
          extractedText: 'Lettys Backyard\nEast Milton, FL\nall authentic fresh filipino',
          sourceFileAttribution: {
            attributionSource: 'request_context',
            sourceChannel: 'admin_import',
            intakeSubmittedBy: 'MANUAL_OPERATOR'
          }
        },
        {
          fileId: 'schedule-contact',
          fileName: 'schedule.jpg',
          drivePath: '/incoming/schedule.jpg',
          sourceFolder: '/incoming',
          extractedText: 'Lettys Backyard Friday 5-9\nCall/Text (850) 255-8396\nEmail: letty@example.com'
        }
      ]
    })
  });
  assert.equal(response.status, 200);
  const card = response.body.actionCards.find((row) => row.type === 'create_profile_draft');
  assert.ok(card);
  assert.equal(typeof card?.extractedFields.phone, 'string');
  assert.equal(String(card?.extractedFields.phone || '').replace(/[^0-9]/g, '').endsWith('8502558396'), true);
  assert.equal(card?.extractedFields.email, 'letty@example.com');
  assert.equal(Array.isArray(card?.extractedFields.contactCandidates), true);
  assert.equal((card?.extractedFields.contactCandidates || []).some((row) => row.type === 'phone'), true);
  assert.equal((card?.extractedFields.contactCandidates || []).some((row) => row.type === 'email'), true);
});

test('unrelated contact candidate stays unassigned and is not auto-attached', async () => {
  const response = await requestJson<{
    actionCards: Array<{
      type: string;
      extractedFields: {
        truckName?: string;
        phone?: string;
        unassignedContactCandidates?: Array<{ value: string; sourceFileId: string }>;
      };
    }>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'profile-identity-2',
          fileName: 'profile.jpg',
          drivePath: '/incoming/profile.jpg',
          sourceFolder: '/incoming',
          extractedText: 'Lettys Backyard\nEast Milton, FL',
          sourceFileAttribution: {
            attributionSource: 'request_context',
            sourceChannel: 'admin_import',
            intakeSubmittedBy: 'MANUAL_OPERATOR'
          }
        },
        {
          fileId: 'unrelated-contact',
          fileName: 'random-contact.jpg',
          drivePath: '/incoming/random-contact.jpg',
          sourceFolder: '/incoming',
          extractedText: 'Call us now 555-444-3333'
        }
      ]
    })
  });
  assert.equal(response.status, 200);
  const card = response.body.actionCards.find((row) => row.extractedFields?.truckName === 'Lettys Backyard');
  assert.ok(card);
  assert.equal(typeof card?.extractedFields.phone === 'string' && card.extractedFields.phone.includes('555-444-3333'), false);
  assert.equal((card?.extractedFields.contactCandidates || []).some((row) => row.value === '555-444-3333'), false);
});

test('operator upload can create unpublished draft card without phone email when other identity evidence is strong', async () => {
  const response = await requestJson<{
    actionCards: Array<{ id: string; type: string; missingFields: string[]; extractedFields: { truckName?: string; cuisine?: string; cityArea?: string } }>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'operator-identity-1',
          fileName: 'profile.jpg',
          drivePath: '/incoming/profile.jpg',
          sourceFolder: '/incoming',
          extractedText: "Lettys Backyard\nPensacola, FL\nall authentic fresh filipino",
          sourceFileAttribution: {
            attributionSource: 'request_context',
            sourceChannel: 'admin_import',
            intakeSubmittedBy: 'MANUAL_OPERATOR'
          }
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.actionCards.length >= 1, true);
  assert.equal(response.body.actionCards[0].type, 'create_profile_draft');
  assert.equal(response.body.actionCards[0].missingFields.includes('menu'), true);
  assert.equal(response.body.actionCards[0].missingFields.includes('phone_or_email'), false);

  const dryRun = await requestJson<{ mutationAllowed: boolean; wouldCreate: unknown; skippedReason: string | null }>(
    `/api/mealscout/intake/action-cards/${encodeURIComponent(response.body.actionCards[0].id)}/dry-run`,
    {
      method: 'POST',
      headers: { 'x-operator-role': 'admin' },
      body: JSON.stringify({})
    }
  );
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.mutationAllowed, false);
  assert.equal(Boolean(dryRun.body.wouldCreate), true);
  assert.equal(dryRun.body.skippedReason, null);
});
