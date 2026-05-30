import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-ms-review-corrections-'));
process.env.MERLIN_DB_PATH = resolve(tempDir, 'merlin-or.sqlite');
process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');

let server: Server;
let baseUrl: string;

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

test('operator corrections replace/remove fields and stale prior signature', async () => {
  const preview = await requestJson<{
    publishPlan: {
      planId: string;
      signature: string;
      records: Array<{ recordId: string; draftIds: string[]; profileFields: Record<string, { value: string }>; blockedReasons?: string[] }>;
    };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'p1',
          fileName: 'profile.jpg',
          sourceFolder: '/incoming/unknown',
          extractedText:
            "Traci's Cherished Creations LLC\nFood Truck\nPhone: 850-255-8396\nLocation: Pensacola, FL\nfacebook: DINNERS\ninstagram: @tracischerishedcreations"
        },
        {
          fileId: 'm1',
          fileName: 'menu.jpg',
          sourceFolder: '/incoming/unknown',
          extractedText: "TRACI'S CHERISHED CREATIONS\nDINNERS\nWings $12\nBBQ"
        }
      ]
    })
  });

  const record = preview.body.publishPlan.records.find((row) => row.profileFields?.truckName?.value);
  assert.ok(record);
  const recordId = record!.recordId;

  const rejectFacebook = await requestJson<{ correction: { action: string } }>('/api/mealscout/review-corrections', {
    method: 'POST',
    body: JSON.stringify({
      recordId,
      draftIds: record!.draftIds,
      fieldName: 'facebook',
      action: 'reject_field',
      originalValue: 'DINNERS',
      reason: 'menu_text_not_social',
      operatorId: 'MANUAL_OPERATOR'
    })
  });
  assert.equal(rejectFacebook.status, 201);
  assert.equal(rejectFacebook.body.correction.action, 'reject_field');

  const replaceName = await requestJson<{ correction: { action: string } }>('/api/mealscout/review-corrections', {
    method: 'POST',
    body: JSON.stringify({
      recordId,
      draftIds: record!.draftIds,
      fieldName: 'truckName',
      action: 'replace_field',
      correctedValue: "Traci's Cherished Creations LLC",
      reason: 'full_business_name_from_profile',
      evidenceRef: 'profile screenshot title',
      sourceFileId: 'p1',
      operatorId: 'MANUAL_OPERATOR'
    })
  });
  assert.equal(replaceName.status, 201);

  const addSocial = await requestJson<{ correction: { action: string } }>('/api/mealscout/review-corrections', {
    method: 'POST',
    body: JSON.stringify({
      recordId,
      draftIds: record!.draftIds,
      fieldName: 'instagram',
      action: 'add_field_with_evidence_note',
      correctedValue: '@tracischerishedcreations',
      reason: 'profile screenshot handle',
      evidenceRef: 'instagram line',
      sourceFileId: 'p1',
      operatorId: 'MANUAL_OPERATOR'
    })
  });
  assert.equal(addSocial.status, 201);

  const refreshed = await requestJson<{
    publishPlan: { signature: string; records: Array<{ recordId: string; profileFields: Record<string, { value: string }> }> };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'p1',
          fileName: 'profile.jpg',
          sourceFolder: '/incoming/unknown',
          extractedText:
            "Traci's Cherished Creations LLC\nFood Truck\nPhone: 850-255-8396\nLocation: Pensacola, FL\nfacebook: DINNERS\ninstagram: @tracischerishedcreations"
        },
        {
          fileId: 'm1',
          fileName: 'menu.jpg',
          sourceFolder: '/incoming/unknown',
          extractedText: "TRACI'S CHERISHED CREATIONS\nDINNERS\nWings $12\nBBQ"
        }
      ]
    })
  });
  const next = refreshed.body.publishPlan.records.find((row) => row.recordId === recordId);
  assert.ok(next);
  assert.equal(next!.profileFields.facebook?.value, undefined);
  assert.equal(next!.profileFields.truckName?.value, "Traci's Cherished Creations LLC");
  assert.equal(next!.profileFields.instagram?.value, '@tracischerishedcreations');
  assert.notEqual(preview.body.publishPlan.signature, refreshed.body.publishPlan.signature);
});

test('manual menu attachment satisfies menu requirement without inventing menu items', async () => {
  const preview = await requestJson<{
    drafts: Array<{ draftId: string }>;
    unattachedMedia: Array<{ sourceFileId: string }>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'p2',
          fileName: 'profile2.jpg',
          sourceFolder: '/incoming/unknown',
          extractedText: "Big Mike's BBQ\nPhone: 850-111-2222\nPensacola, FL\ninstagram: @bigmikesbbq"
        },
        {
          fileId: 'logo2',
          fileName: 'logo2.jpg',
          sourceFolder: '/incoming/unknown',
          extractedText: ''
        }
      ]
    })
  });
  assert.equal(preview.body.unattachedMedia.length > 0, true);
  const draftId = preview.body.drafts[0].draftId;
  const sourceFileId = preview.body.unattachedMedia[0].sourceFileId;

  const attach = await requestJson<{ attachmentDecision: { action: string } }>('/api/mealscout/attachment-decisions', {
    method: 'POST',
    body: JSON.stringify({
      draftId,
      sourceFileId,
      sourceFileName: 'logo2.jpg',
      action: 'mark_as_menu',
      mediaType: 'menu',
      reason: 'manual_menu_evidence',
      operatorId: 'MANUAL_OPERATOR'
    })
  });
  assert.equal(attach.status, 201);
  assert.equal(attach.body.attachmentDecision.action, 'mark_as_menu');

  const refreshed = await requestJson<{
    publishPlan: {
      records: Array<{
        draftIds: string[];
        publishReady: boolean;
        menuItems: Array<{ name: string }>;
        blockedReasons?: string[];
        menuEvidenceAttached?: boolean;
        menuEvidenceSourceFileIds?: string[];
        menuEvidenceRefs?: string[];
        attachedMedia?: Array<{ sourceFileId: string; mediaType: string }>;
      }>;
    };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'p2',
          fileName: 'profile2.jpg',
          sourceFolder: '/incoming/unknown',
          extractedText: "Big Mike's BBQ\nPhone: 850-111-2222\nPensacola, FL\ninstagram: @bigmikesbbq"
        },
        {
          fileId: 'logo2',
          fileName: 'logo2.jpg',
          sourceFolder: '/incoming/unknown',
          extractedText: ''
        }
      ]
    })
  });
  const record = refreshed.body.publishPlan.records.find((row) => row.draftIds.includes(draftId));
  assert.ok(record);
  assert.equal((record!.attachedMedia || []).some((item) => item.sourceFileId === sourceFileId && item.mediaType === 'menu'), true);
  assert.equal(record!.menuEvidenceAttached, true);
  assert.equal((record!.menuEvidenceSourceFileIds || []).includes(sourceFileId), true);
  assert.equal((record!.menuEvidenceRefs || []).includes('manual_menu_evidence'), true);
  assert.equal((record!.blockedReasons || []).includes('missing_menu_or_menu_deferred'), false);
  assert.equal(record!.publishReady, true);
  assert.equal(record!.menuItems.length, 0);
});

test('logo candidate alone does not satisfy menu requirement', async () => {
  const preview = await requestJson<{
    drafts: Array<{ draftId: string }>;
    unattachedMedia: Array<{ sourceFileId: string }>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'p3',
          fileName: 'profile3.jpg',
          sourceFolder: '/incoming/unknown',
          extractedText: "Wing King Mobile Kitchen\nPhone: 850-999-1111\nPensacola, FL\ninstagram: @wingking"
        },
        {
          fileId: 'logo3',
          fileName: 'logo3.jpg',
          sourceFolder: '/incoming/unknown',
          extractedText: ''
        }
      ]
    })
  });
  const draftId = preview.body.drafts[0].draftId;
  const sourceFileId = preview.body.unattachedMedia[0].sourceFileId;
  await requestJson('/api/mealscout/attachment-decisions', {
    method: 'POST',
    body: JSON.stringify({
      draftId,
      sourceFileId,
      sourceFileName: 'logo3.jpg',
      action: 'mark_as_logo_candidate',
      mediaType: 'logo',
      reason: 'manual_logo_candidate',
      operatorId: 'MANUAL_OPERATOR'
    })
  });
  const refreshed = await requestJson<{
    publishPlan: { records: Array<{ draftIds: string[]; publishReady: boolean; blockedReasons?: string[]; menuEvidenceAttached?: boolean }> };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'p3',
          fileName: 'profile3.jpg',
          sourceFolder: '/incoming/unknown',
          extractedText: "Wing King Mobile Kitchen\nPhone: 850-999-1111\nPensacola, FL\ninstagram: @wingking"
        },
        {
          fileId: 'logo3',
          fileName: 'logo3.jpg',
          sourceFolder: '/incoming/unknown',
          extractedText: ''
        }
      ]
    })
  });
  const record = refreshed.body.publishPlan.records.find((row) => row.draftIds.includes(draftId));
  assert.ok(record);
  assert.equal(record!.menuEvidenceAttached, undefined);
  assert.equal(record!.publishReady, false);
  assert.equal((record!.blockedReasons || []).includes('missing_menu_or_menu_deferred'), true);
});
