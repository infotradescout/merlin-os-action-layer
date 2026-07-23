import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createUniversalProductUpdatePacket } from '../src/merlin/intake/universalProductUpdatePacket.ts';

process.env.MERLIN_RUNTIME = 'test';
process.env.MERLIN_INTAKE_ENABLED = 'true';
process.env.MERLIN_INTAKE_MEALSCOUT_ENABLED = 'true';
process.env.MERLIN_INTAKE_APPLY_ENABLED = 'false';
process.env.MERLIN_INTAKE_CLEANUP_ENABLED = 'false';

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
    headers: { 'Content-Type': 'application/json', 'x-operator-role': 'admin', ...(init.headers || {}) },
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
  process.env.MERLIN_INTAKE_MEALSCOUT_ENABLED = 'true';
  process.env.MERLIN_INTAKE_APPLY_ENABLED = 'false';
  process.env.MERLIN_INTAKE_CLEANUP_ENABLED = 'false';
  await requestJson('/api/demo/reset', { method: 'POST' });
});

test('Sweet Love menu_update structured packet flows through upload-intent preview into readable universal packet preview output', async () => {
  const sourceFolderReference = 'drive://mealscout/sweet-love/evidence-folder';
  const packet = createUniversalProductUpdatePacket({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test',
      actorLabel: 'Sweet Love Owner'
    },
    targetProduct: 'MealScout',
    targetBusinessName: 'Sweet Love',
    targetProfileId: 'ms-test-sweet-love-profile',
    updateType: 'menu_update',
    confidence: 0.86,
    evidenceReferences: [
      {
        sourceFileName: 'sweet-love-menu.pdf',
        sourceMimeType: 'application/pdf',
        sourceReference: 'drive://sweet-love/evidence-folder/menu.pdf',
        sourceFolderReference,
        sourcePage: 1
      }
    ],
    menuSections: [
      {
        sectionName: 'Signature Drinks',
        items: [
          {
            name: 'Strawberry Lemonade',
            description: 'Fresh strawberries with lemon and cane sugar',
            availabilityNotes: ['served chilled'],
            sourcePage: 1,
            sourceFileName: 'sweet-love-menu.pdf'
          }
        ]
      }
    ]
  });

  const created = await requestJson<{ intent: { uploadId: string } }>('/api/merlin/intake/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'sweet-love-owner-test',
      accountId: 'sweet-love-account',
      brand: 'MEALSCOUT',
      actorScope: 'owner',
      entityType: 'food_truck',
      entityId: 'truck-sweet-love',
      actionId: 'update_menu'
    })
  });
  assert.equal(created.status, 201);

  const attached = await requestJson<{ intent: { files: Array<{ fileId: string }> } }>(
    `/api/merlin/intake/upload-intents/${created.body.intent.uploadId}/files`,
    {
      method: 'POST',
      body: JSON.stringify({
        files: [
          {
            fileId: 'sweet-love-menu-1',
            fileName: 'sweet-love-menu.pdf',
            mimeType: 'application/pdf',
            extractedText: 'Sweet Love Menu Strawberry Lemonade',
            metadata: {
              universalProductUpdatePacket: packet
            }
          }
        ]
      })
    }
  );
  assert.equal(attached.status, 200);
  assert.equal(attached.body.intent.files[0].fileId, 'sweet-love-menu-1');

  const preview = await requestJson<{
    mutationAllowed: false;
    implementationAllowed: false;
    applyEnabled: false;
    cleanupEnabled: false;
    intent: {
      status: string;
      implementationAllowed: false;
      mutationAllowed: false;
      preview: {
        sourceFiles: Array<{ fileId: string; fileName?: string }>;
        linkedEvidenceIds: string[];
        universalProductUpdatePacketPreview?: {
          status: string;
          targetProduct: string;
          targetBusinessName: string;
          targetProfileId: string | null;
          updateType: string;
          displayTitle: string;
          operatorSummary: string;
          updateTypeLabel: string;
          targetDisplay: string;
          evidenceSummary: string;
          missingFieldSummary: string;
          verificationSummary: string;
          safetySummary: string;
          applyStatusLabel: string;
          nextRequiredAction: string;
          sourceEvidenceReferences: Array<{
            sourceFileName: string;
            sourceReference: string;
            sourceFolderReference?: string;
          }>;
          sourceFolderReference?: string;
          extractedStructuredData: {
            menu: {
              sections: Array<{
                sectionName: string;
                items: Array<Record<string, unknown>>;
              }>;
              pricesMissing: boolean;
            };
          };
          missingFields: string[];
          confidence: number;
          requiredVerificationSteps: string[];
          safetyFlags: string[];
          ownerSubmittedEquivalent: boolean;
          productionApplied: false;
          mutationAllowed: false;
          implementationAllowed: false;
          applyEligible: false;
        };
      };
    };
  }>(`/api/merlin/intake/upload-intents/${created.body.intent.uploadId}/preview`, { method: 'POST' });

  assert.equal(preview.status, 200);
  assert.equal(preview.body.mutationAllowed, false);
  assert.equal(preview.body.implementationAllowed, false);
  assert.equal(preview.body.applyEnabled, false);
  assert.equal(preview.body.cleanupEnabled, false);
  assert.equal(['PREVIEW_READY', 'HELD_FOR_REVIEW'].includes(preview.body.intent.status), true);
  assert.equal(preview.body.intent.implementationAllowed, false);
  assert.equal(preview.body.intent.mutationAllowed, false);
  assert.equal(preview.body.intent.preview.sourceFiles[0].fileId, 'sweet-love-menu-1');

  const universalPreview = preview.body.intent.preview.universalProductUpdatePacketPreview;
  assert.equal(universalPreview?.status, 'supported');
  assert.equal(universalPreview?.targetProduct, 'MealScout');
  assert.equal(universalPreview?.targetBusinessName, 'Sweet Love');
  assert.equal(universalPreview?.targetProfileId, 'ms-test-sweet-love-profile');
  assert.equal(universalPreview?.updateType, 'menu_update');

  assert.equal(universalPreview?.displayTitle, 'MealScout menu preview - Sweet Love');
  assert.equal(universalPreview?.operatorSummary.includes('missing menu prices'), true);
  assert.equal(universalPreview?.updateTypeLabel, 'MealScout menu preview');
  assert.equal(universalPreview?.targetDisplay, 'Sweet Love (ms-test-sweet-love-profile)');
  assert.equal(universalPreview?.missingFieldSummary.includes('menu item prices'), true);
  assert.equal(universalPreview?.verificationSummary.includes('do not invent prices'), true);
  assert.equal(universalPreview?.applyStatusLabel, 'Preview only — no production apply');
  assert.equal(universalPreview?.nextRequiredAction, 'review_only');

  assert.equal(universalPreview?.sourceFolderReference, sourceFolderReference);
  assert.equal(universalPreview?.sourceEvidenceReferences[0].sourceReference, 'drive://sweet-love/evidence-folder/menu.pdf');
  assert.equal(universalPreview?.sourceEvidenceReferences[0].sourceFolderReference, sourceFolderReference);
  assert.equal(universalPreview?.missingFields.includes('menu.items.price'), true);
  assert.equal(universalPreview?.confidence, 0.86);
  assert.equal(universalPreview?.requiredVerificationSteps.includes('preview_before_apply'), true);
  assert.equal(universalPreview?.requiredVerificationSteps.includes('owner_or_operator_must_verify_missing_prices'), true);
  assert.equal(universalPreview?.safetyFlags.includes('missing_menu_prices'), true);
  assert.equal(universalPreview?.ownerSubmittedEquivalent, true);

  const menu = universalPreview?.extractedStructuredData.menu;
  assert.equal(menu?.pricesMissing, true);
  assert.equal(menu?.sections[0].sectionName, 'Signature Drinks');
  assert.equal(menu?.sections[0].items[0].name, 'Strawberry Lemonade');
  assert.equal(Object.prototype.hasOwnProperty.call(menu?.sections[0].items[0] || {}, 'price'), false);

  assert.equal(universalPreview?.productionApplied, false);
  assert.equal(universalPreview?.mutationAllowed, false);
  assert.equal(universalPreview?.implementationAllowed, false);
  assert.equal(universalPreview?.applyEligible, false);
  assert.equal(universalPreview?.status === 'unsupported', false);

  const executionAudit = await requestJson<{ records: unknown[] }>('/api/mealscout/intake/publish-plan/audit');
  assert.equal(executionAudit.status, 200);
  assert.equal(executionAudit.body.records.length, 0);
});
