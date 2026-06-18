import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RoutingDecision, UploadIntent } from '../src/merlin/intake/intakeTypes.ts';
import {
  createMealScoutMixedEvidenceProofPacket,
  createUniversalProductUpdatePacket
} from '../src/merlin/intake/universalProductUpdatePacket.ts';
import { buildPreviewPacket } from '../src/merlin/intake/previewBuilder.ts';
import { buildUniversalProductUpdatePacketPreviewBridge } from '../src/merlin/intake/universalProductUpdatePacketPreviewBridge.ts';

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

function buildMenuPacket() {
  return createUniversalProductUpdatePacket({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
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
        sourceReference: 'drive://sweet-love-menu-pdf',
        sourcePage: 1
      }
    ],
    menuSections: [
      {
        sectionName: 'Signature Drinks',
        items: [{ name: 'Strawberry Lemonade' }]
      }
    ]
  });
}

function buildSchedulePacket() {
  return createUniversalProductUpdatePacket({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    targetProduct: 'MealScout',
    targetBusinessName: 'Sweet Love',
    targetProfileId: 'ms-test-sweet-love-profile',
    updateType: 'schedule_update',
    confidence: 0.91,
    evidenceReferences: [
      {
        sourceFileName: 'sweet-love-schedule.png',
        sourceMimeType: 'image/png',
        sourceReference: 'drive://sweet-love-schedule'
      }
    ],
    scheduleEntries: [
      {
        date: '2026-06-21',
        startTime: '11:00',
        endTime: '15:00',
        timezone: 'America/Chicago',
        locationName: 'Sweet Love at Riverwalk',
        address: '123 Riverwalk Ave, Austin, TX',
        recurrence: 'explicit_recurring'
      }
    ]
  });
}

function buildBaseUploadIntent(files: UploadIntent['files']): UploadIntent {
  return {
    uploadId: 'upload-preview-bridge-test',
    userId: 'u-1',
    accountId: 'a-1',
    brand: 'MEALSCOUT',
    actorScope: 'owner',
    entityType: 'food_truck',
    entityId: 'truck-1',
    actionId: 'update_menu',
    actionSnapshot: {
      actionId: 'update_menu',
      brand: 'MEALSCOUT',
      actorScope: 'owner',
      label: 'Update Menu',
      description: 'Menu preview test',
      entityTypesAllowed: ['food_truck'],
      expectedFileTypes: ['image/jpeg'],
      allowedOutputTypes: ['menu'],
      allowedFieldPaths: ['menu.items'],
      forbiddenFieldPaths: ['businessName'],
      requiresEntityContext: true,
      requiresUserHint: false,
      previewRequired: true,
      approvalRequired: true,
      implementationMode: 'approval_required',
      riskLevel: 'medium'
    },
    files,
    routing: [],
    status: 'FILES_ATTACHED',
    implementationAllowed: false,
    mutationAllowed: false,
    previewRequired: true,
    approvalRequired: true,
    createdAt: '2026-06-17T00:00:00.000Z',
    updatedAt: '2026-06-17T00:00:00.000Z'
  };
}

function buildRoutingDecision(): RoutingDecision[] {
  return [
    {
      fileId: 'menu-1',
      fileName: 'menu-specials.jpg',
      mimeType: 'image/jpeg',
      extractedText: "TRACI'S CHERISHED CREATIONS\nMENU\nWings 10.00",
      routedType: 'menu',
      confidence: 0.92,
      reasons: ['menu_signal_detected', 'action_bias_update_menu']
    }
  ];
}

test('MealScout upload-intent preview route includes a universal packet preview for menu_update when structured packet-ready data is present', async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });

  const created = await requestJson<{ intent: { uploadId: string } }>('/api/merlin/intake/upload-intents', {
    method: 'POST',
    body: JSON.stringify({
      userId: 'u-1',
      accountId: 'a-1',
      brand: 'MEALSCOUT',
      actorScope: 'owner',
      entityType: 'food_truck',
      entityId: 'truck-1',
      actionId: 'update_menu'
    })
  });
  assert.equal(created.status, 201);

  const packet = buildMenuPacket();
  await requestJson(`/api/merlin/intake/upload-intents/${created.body.intent.uploadId}/files`, {
    method: 'POST',
    body: JSON.stringify({
      files: [
        {
          fileId: 'menu-1',
          fileName: 'menu-specials.jpg',
          mimeType: 'image/jpeg',
          extractedText: "TRACI'S CHERISHED CREATIONS\nMENU\nWings 10.00",
          metadata: {
            universalProductUpdatePacket: packet
          }
        }
      ]
    })
  });

  await requestJson(`/api/merlin/intake/upload-intents/${created.body.intent.uploadId}/route`, { method: 'POST' });
  const preview = await requestJson<{
    intent: {
      preview: {
        sourceFiles: Array<{ fileId: string }>;
        universalProductUpdatePacketPreview?: {
          status: string;
          updateType?: string;
          targetProduct?: string;
          productionApplied: false;
          mutationAllowed: false;
          implementationAllowed: false;
          applyEligible: false;
          missingFields?: string[];
        };
      };
      implementationAllowed: false;
    };
    mutationAllowed: false;
  }>(`/api/merlin/intake/upload-intents/${created.body.intent.uploadId}/preview`, { method: 'POST' });

  assert.equal(preview.status, 200);
  assert.equal(preview.body.mutationAllowed, false);
  assert.equal(preview.body.intent.implementationAllowed, false);
  assert.equal(preview.body.intent.preview.sourceFiles[0].fileId, 'menu-1');
  assert.equal(preview.body.intent.preview.universalProductUpdatePacketPreview?.status, 'supported');
  assert.equal(preview.body.intent.preview.universalProductUpdatePacketPreview?.targetProduct, 'MealScout');
  assert.equal(preview.body.intent.preview.universalProductUpdatePacketPreview?.updateType, 'menu_update');
  assert.equal(preview.body.intent.preview.universalProductUpdatePacketPreview?.missingFields?.includes('menu.items.price'), true);
  assert.equal(preview.body.intent.preview.universalProductUpdatePacketPreview?.productionApplied, false);
  assert.equal(preview.body.intent.preview.universalProductUpdatePacketPreview?.mutationAllowed, false);
  assert.equal(preview.body.intent.preview.universalProductUpdatePacketPreview?.implementationAllowed, false);
  assert.equal(preview.body.intent.preview.universalProductUpdatePacketPreview?.applyEligible, false);
});

test('buildPreviewPacket preserves existing preview behavior while attaching a universal packet preview for schedule_update data', () => {
  const packet = buildSchedulePacket();
  const intent = buildBaseUploadIntent([
    {
      fileId: 'menu-1',
      fileName: 'schedule.png',
      mimeType: 'image/png',
      extractedText: 'Monday 11:00 AM - 3:00 PM',
      metadata: {
        universalProductUpdatePacket: packet
      }
    }
  ]);

  const preview = buildPreviewPacket(intent, buildRoutingDecision(), ['evidence-1']);

  assert.equal(preview.sourceFiles[0].fileId, 'menu-1');
  assert.equal(preview.linkedEvidenceIds[0], 'evidence-1');
  assert.equal(preview.mutationAllowed, false);
  assert.equal(preview.implementationAllowed, false);
  assert.equal(preview.universalProductUpdatePacketPreview?.status, 'supported');
  if (preview.universalProductUpdatePacketPreview?.status !== 'supported') {
    assert.fail('expected supported bridge preview');
  }
  assert.equal(preview.universalProductUpdatePacketPreview.updateType, 'schedule_update');
  assert.equal(preview.universalProductUpdatePacketPreview.requiredVerificationSteps.includes('timezone_must_be_explicit'), true);
  assert.equal(preview.universalProductUpdatePacketPreview.productionApplied, false);
  assert.equal(preview.universalProductUpdatePacketPreview.mutationAllowed, false);
  assert.equal(preview.universalProductUpdatePacketPreview.implementationAllowed, false);
  assert.equal(preview.universalProductUpdatePacketPreview.applyEligible, false);
});

test('unsupported packet input fails closed without mutation', () => {
  const preview = buildUniversalProductUpdatePacketPreviewBridge({
    brand: 'MEALSCOUT',
    files: [],
    explicitPreviewInput: createMealScoutMixedEvidenceProofPacket({
      sourceActor: {
        actorScope: 'owner',
        actorId: 'sweet-love-owner-test'
      },
      targetProduct: 'MealScout',
      targetBusinessName: 'Sweet Love',
      targetProfileId: 'ms-test-sweet-love-profile',
      sourceFolderReference: 'drive://mealscout/sweet-love/evidence-folder',
      menuEvidenceReferences: [
        {
          sourceFileName: 'sweet-love-menu.pdf',
          sourceMimeType: 'application/pdf',
          sourceReference: 'drive://sweet-love/evidence-folder/menu.pdf',
          sourcePage: 1
        }
      ],
      logoEvidenceReferences: [
        {
          sourceFileName: 'sweet-love-logo.png',
          sourceMimeType: 'image/png',
          sourceReference: 'drive://sweet-love/evidence-folder/logo.png'
        }
      ],
      menuSections: [
        {
          sectionName: 'Signature Drinks',
          items: [{ name: 'Strawberry Lemonade' }]
        }
      ]
    })
  });

  assert.equal(preview?.status, 'unsupported');
  if (preview?.status !== 'unsupported') {
    assert.fail('expected unsupported preview');
  }
  assert.equal(preview.reason, 'unsupported_target_product_or_update_type');
  assert.equal(preview.productionApplied, false);
  assert.equal(preview.mutationAllowed, false);
  assert.equal(preview.implementationAllowed, false);
  assert.equal(preview.applyEligible, false);
});

test('invalid packet JSON fails closed without mutation', () => {
  const preview = buildUniversalProductUpdatePacketPreviewBridge({
    brand: 'MEALSCOUT',
    files: [],
    explicitPreviewInput: {
      packetId: 'not-a-valid-packet',
      updateType: 'menu_update'
    }
  });

  assert.equal(preview?.status, 'unsupported');
  if (preview?.status !== 'unsupported') {
    assert.fail('expected unsupported preview');
  }
  assert.equal(preview.reason, 'invalid_universal_product_update_packet');
  assert.equal(preview.productionApplied, false);
  assert.equal(preview.mutationAllowed, false);
  assert.equal(preview.implementationAllowed, false);
  assert.equal(preview.applyEligible, false);
});

test('non-MealScout previews remain compatible and do not attach a universal packet preview', () => {
  const intent = {
    ...buildBaseUploadIntent([
      {
        fileId: 'menu-1',
        fileName: 'menu-specials.jpg',
        mimeType: 'image/jpeg',
        extractedText: "TRACI'S CHERISHED CREATIONS\nMENU\nWings 10.00",
        metadata: {
          universalProductUpdatePacket: buildMenuPacket()
        }
      }
    ]),
    brand: 'MERLIN'
  } as const satisfies UploadIntent;

  const preview = buildPreviewPacket(intent, buildRoutingDecision(), []);

  assert.equal(preview.mutationAllowed, false);
  assert.equal(preview.implementationAllowed, false);
  assert.equal(preview.sourceFiles.length, 1);
  assert.equal(preview.universalProductUpdatePacketPreview, undefined);
});
