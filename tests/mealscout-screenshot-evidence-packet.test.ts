import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildMealScoutScreenshotEvidencePacketId,
  createMealScoutScreenshotEvidencePacket,
  isMealScoutScreenshotEvidencePacket
} from '../src/merlin/intake/mealscoutScreenshotEvidencePacket.ts';

test('deterministic packet id is stable for the same evidence references', () => {
  const input = {
    sourceActor: {
      actorScope: 'owner' as const,
      actorId: 'sweet-love-owner-test',
      actorLabel: 'Sweet Love Owner'
    },
    sourceSurface: 'upload_intent' as const,
    evidenceReferences: [
      {
        sourceFileName: 'sweet-love-menu.pdf',
        sourceMimeType: 'application/pdf',
        sourceReference: 'drive://sweet-love/menu.pdf',
        sourceFolderReference: 'drive://sweet-love',
        sourcePage: 1
      }
    ]
  };

  const packetA = createMealScoutScreenshotEvidencePacket(input);
  const packetB = createMealScoutScreenshotEvidencePacket(input);

  assert.equal(packetA.packetId, packetB.packetId);
  assert.equal(
    packetA.packetId,
    buildMealScoutScreenshotEvidencePacketId({
      sourceActor: input.sourceActor,
      sourceSurface: input.sourceSurface,
      sourceFolderReference: 'drive://sweet-love',
      evidenceReferences: input.evidenceReferences
    })
  );
});

test('mixed image and pdf evidence references are preserved verbatim', () => {
  const evidenceReferences = [
    {
      sourceFileName: 'sweet-love-menu.pdf',
      sourceMimeType: 'application/pdf',
      sourceReference: 'drive://sweet-love/menu.pdf',
      sourceFolderReference: 'drive://sweet-love',
      sourcePage: 2
    },
    {
      sourceFileName: 'sweet-love-logo.png',
      sourceMimeType: 'image/png',
      sourceReference: 'drive://sweet-love/logo.png',
      sourceFolderReference: 'drive://sweet-love'
    }
  ];

  const packet = createMealScoutScreenshotEvidencePacket({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    sourceSurface: 'drive_file',
    evidenceReferences
  });

  assert.deepEqual(packet.evidenceReferences, evidenceReferences);
  assert.equal(packet.targetProduct, 'MealScout');
  assert.equal(packet.packetSubtype, 'MealScoutScreenshotEvidencePacket');
});

test('shared sourceFolderReference is kept only when all evidence references agree', () => {
  const packet = createMealScoutScreenshotEvidencePacket({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    sourceSurface: 'upload_intent',
    evidenceReferences: [
      {
        sourceFileName: 'sweet-love-menu.pdf',
        sourceMimeType: 'application/pdf',
        sourceReference: 'drive://sweet-love/menu.pdf',
        sourceFolderReference: 'drive://sweet-love'
      },
      {
        sourceFileName: 'sweet-love-logo.png',
        sourceMimeType: 'image/png',
        sourceReference: 'drive://sweet-love/logo.png',
        sourceFolderReference: 'drive://sweet-love'
      }
    ]
  });

  assert.equal(packet.sourceFolderReference, 'drive://sweet-love');
});

test('conflicting evidence folder references do not invent a shared packet folder', () => {
  const packet = createMealScoutScreenshotEvidencePacket({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    sourceSurface: 'upload_intent',
    sourceFolderReference: 'drive://sweet-love/a',
    evidenceReferences: [
      {
        sourceFileName: 'sweet-love-menu.pdf',
        sourceMimeType: 'application/pdf',
        sourceReference: 'drive://sweet-love/a/menu.pdf',
        sourceFolderReference: 'drive://sweet-love/a'
      },
      {
        sourceFileName: 'sweet-love-logo.png',
        sourceMimeType: 'image/png',
        sourceReference: 'drive://sweet-love/b/logo.png',
        sourceFolderReference: 'drive://sweet-love/b'
      }
    ]
  });

  assert.equal(packet.sourceFolderReference, undefined);
});

test('ownerSubmittedEquivalent derives from sourceActor rather than file presence', () => {
  const evidenceReferences = [
    {
      sourceFileName: 'sweet-love-menu.pdf',
      sourceMimeType: 'application/pdf',
      sourceReference: 'drive://sweet-love/menu.pdf'
    }
  ];

  const ownerPacket = createMealScoutScreenshotEvidencePacket({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    sourceSurface: 'upload_intent',
    evidenceReferences
  });
  const staffPacket = createMealScoutScreenshotEvidencePacket({
    sourceActor: {
      actorScope: 'staff',
      actorId: 'merlin-staff-test'
    },
    sourceSurface: 'upload_intent',
    evidenceReferences
  });

  assert.equal(ownerPacket.ownerSubmittedEquivalent, true);
  assert.equal(staffPacket.ownerSubmittedEquivalent, false);
});

test('all authority flags remain hard false', () => {
  const packet = createMealScoutScreenshotEvidencePacket({
    sourceActor: {
      actorScope: 'rep',
      actorId: 'rep-1'
    },
    sourceSurface: 'manual_file',
    evidenceReferences: [
      {
        sourceFileName: 'sweet-love-menu.pdf',
        sourceMimeType: 'application/pdf',
        sourceReference: 'drive://sweet-love/menu.pdf'
      }
    ]
  });

  assert.equal(packet.productionApplied, false);
  assert.equal(packet.mutationAllowed, false);
  assert.equal(packet.implementationAllowed, false);
  assert.equal(packet.applyEligible, false);
  assert.equal(packet.requiredNextStep, 'extraction_required');
  assert.deepEqual(packet.safetyFlags, ['preserve_source_evidence', 'pre_extraction_evidence_only']);
  assert.equal(isMealScoutScreenshotEvidencePacket(packet), true);
});

test('packet rejects extracted or inferred fields and does not expose them on output', () => {
  assert.throws(
    () =>
      createMealScoutScreenshotEvidencePacket({
        sourceActor: {
          actorScope: 'owner',
          actorId: 'sweet-love-owner-test'
        },
        sourceSurface: 'upload_intent',
        evidenceReferences: [
          {
            sourceFileName: 'sweet-love-menu.pdf',
            sourceMimeType: 'application/pdf',
            sourceReference: 'drive://sweet-love/menu.pdf'
          }
        ],
        extractedText: 'forbidden text'
      } as unknown as Parameters<typeof createMealScoutScreenshotEvidencePacket>[0]),
    /forbidden_mealscout_screenshot_packet_fields:extractedText/
  );

  const packet = createMealScoutScreenshotEvidencePacket({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    sourceSurface: 'upload_intent',
    evidenceReferences: [
      {
        sourceFileName: 'sweet-love-menu.pdf',
        sourceMimeType: 'application/pdf',
        sourceReference: 'drive://sweet-love/menu.pdf'
      }
    ]
  });

  const packetRecord = packet as Record<string, unknown>;
  for (const forbiddenField of [
    'extractedText',
    'visualLabels',
    'detectedType',
    'confidence',
    'targetEntityName',
    'targetEntityId',
    'updateType',
    'missingFields',
    'menuItems'
  ]) {
    assert.equal(forbiddenField in packetRecord, false);
  }
});
