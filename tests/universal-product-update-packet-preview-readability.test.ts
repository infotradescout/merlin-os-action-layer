import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMealScoutMixedEvidenceProofPacket,
  createUniversalProductUpdatePacket,
  type MerlinUniversalProductUpdatePacket
} from '../src/merlin/intake/universalProductUpdatePacket.ts';
import { buildPreviewPacket } from '../src/merlin/intake/previewBuilder.ts';
import type { RoutingDecision, UploadIntent } from '../src/merlin/intake/intakeTypes.ts';
import { buildUniversalProductUpdatePacketPreview } from '../src/merlin/intake/universalProductUpdatePacketPreview.ts';

function buildBaseUploadIntent(files: UploadIntent['files']): UploadIntent {
  return {
    uploadId: 'upload-preview-readability-test',
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
      description: 'Menu preview readability test',
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
    createdAt: '2026-06-18T00:00:00.000Z',
    updatedAt: '2026-06-18T00:00:00.000Z'
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

test('menu_update preview includes readable title, missing price summary, preserved raw fields, and hard-false flags', () => {
  const packet = createUniversalProductUpdatePacket({
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

  const preview = buildUniversalProductUpdatePacketPreview(packet);

  assert.equal(preview.status, 'supported');
  if (preview.status !== 'supported') assert.fail('expected supported preview');
  assert.equal(preview.displayTitle, 'MealScout menu preview - Sweet Love');
  assert.equal(preview.operatorSummary.includes('missing menu prices'), true);
  assert.equal(preview.missingFieldSummary.includes('menu item prices'), true);
  assert.equal(preview.targetDisplay, 'Sweet Love (ms-test-sweet-love-profile)');
  assert.equal(preview.applyStatusLabel, 'Preview only — no production apply');
  assert.equal(preview.nextRequiredAction, 'review_only');
  assert.equal((preview.extractedStructuredData as { menu: { pricesMissing: boolean } }).menu.pricesMissing, true);
  assert.equal(preview.sourceEvidenceReferences[0].sourceReference, 'drive://sweet-love-menu-pdf');
  assert.equal(preview.productionApplied, false);
  assert.equal(preview.mutationAllowed, false);
  assert.equal(preview.implementationAllowed, false);
  assert.equal(preview.applyEligible, false);
});

test('logo_update preview includes readable media evidence summary and no-media-apply warning', () => {
  const sourceFolderReference = 'drive://mealscout/sweet-love/evidence-folder';
  const evidenceReferences = [
    {
      sourceFileName: 'sweet-love-logo.png',
      sourceMimeType: 'image/png',
      sourceReference: 'drive://sweet-love/evidence-folder/logo.png',
      sourceFolderReference
    }
  ];
  const packet = {
    packetId: 'merlin-universal-product-update:logo-preview-fixture',
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    targetProduct: 'MealScout',
    targetEntityName: 'Sweet Love',
    targetEntityId: 'ms-test-sweet-love-profile',
    targetResolutionStatus: 'resolved_exact_target_id',
    updateType: 'logo_update',
    sourceFolderReference,
    evidenceReferences,
    extractedStructuredData: {
      assetEvidence: evidenceReferences
    },
    missingFields: [],
    confidence: 0.77,
    safetyFlags: ['preserve_source_evidence'],
    ownerSubmittedEquivalent: true,
    productionApplied: false,
    mutationAllowed: false,
    implementationAllowed: false,
    applyEligible: false,
    requiredVerificationSteps: [
      'preview_before_apply',
      'exact_target_id_required_for_production_apply',
      'no_media_apply_without_review',
      'preserve_source_evidence'
    ],
    productSpecificPayload: {
      packetSubtype: 'MealScoutOwnerProfileUpdatePacket',
      updateType: 'logo_update',
      sourceEvidence: evidenceReferences
    }
  } as const satisfies MerlinUniversalProductUpdatePacket;

  const preview = buildUniversalProductUpdatePacketPreview(packet);

  assert.equal(preview.status, 'supported');
  if (preview.status !== 'supported') assert.fail('expected supported preview');
  assert.equal(preview.displayTitle, 'MealScout logo preview - Sweet Love');
  assert.equal(preview.operatorSummary.includes('Media evidence review is required'), true);
  assert.equal(preview.evidenceSummary.includes('sweet-love-logo.png'), true);
  assert.equal(preview.safetySummary.includes('manual review before any future apply'), true);
  assert.equal(preview.verificationSummary.includes('do not apply media without review'), true);
});

test('schedule_update preview includes readable recurrence, timezone, location eligibility, and missing schedule field summary', () => {
  const packet = createUniversalProductUpdatePacket({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test'
    },
    targetProduct: 'MealScout',
    targetBusinessName: 'Sweet Love',
    targetProfileId: 'ms-test-sweet-love-profile',
    updateType: 'schedule_update',
    confidence: 0.62,
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
        recurrence: 'current_week_only'
      }
    ]
  });

  const preview = buildUniversalProductUpdatePacketPreview(packet);

  assert.equal(preview.status, 'supported');
  if (preview.status !== 'supported') assert.fail('expected supported preview');
  assert.equal(preview.displayTitle, 'MealScout schedule preview - Sweet Love');
  assert.equal(preview.operatorSummary.includes('current week only'), true);
  assert.equal(preview.operatorSummary.includes('timezone missing'), true);
  assert.equal(preview.operatorSummary.includes('not map eligible'), true);
  assert.equal(preview.operatorSummary.includes('not live-feed eligible'), true);
  assert.equal(preview.missingFieldSummary.includes('schedule timezones'), true);
  assert.equal(preview.missingFieldSummary.includes('schedule addresses'), true);
  assert.equal((preview.extractedStructuredData as { schedule: Array<Record<string, unknown>> }).schedule[0].mapEligible, false);
});

test('unsupported and invalid packet previews include readable hold labels', () => {
  const unsupported = buildUniversalProductUpdatePacketPreview(
    createMealScoutMixedEvidenceProofPacket({
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
  );
  const invalid = buildUniversalProductUpdatePacketPreview({
    packetId: 'not-a-valid-packet',
    updateType: 'menu_update'
  });

  assert.equal(unsupported.status, 'unsupported');
  if (unsupported.status !== 'unsupported') assert.fail('expected unsupported preview');
  assert.equal(unsupported.displayTitle, 'Unsupported MealScout packet preview - hold');
  assert.equal(unsupported.nextRequiredAction, 'unsupported_packet_review_required');
  assert.equal(unsupported.safetySummary.includes('unsupported packet type'), true);

  assert.equal(invalid.status, 'unsupported');
  if (invalid.status !== 'unsupported') assert.fail('expected invalid preview');
  assert.equal(invalid.displayTitle, 'Invalid MealScout packet preview - hold');
  assert.equal(invalid.nextRequiredAction, 'invalid_packet_review_required');
  assert.equal(invalid.safetySummary.includes('invalid universal product update packet JSON'), true);
  assert.equal(invalid.productionApplied, false);
  assert.equal(invalid.mutationAllowed, false);
  assert.equal(invalid.implementationAllowed, false);
  assert.equal(invalid.applyEligible, false);
});

test('buildPreviewPacket carries readability fields into upload-intent preview output while preserving raw fields', () => {
  const packet = createUniversalProductUpdatePacket({
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

  const previewPacket = buildPreviewPacket(
    buildBaseUploadIntent([
      {
        fileId: 'menu-1',
        fileName: 'menu-specials.jpg',
        mimeType: 'image/jpeg',
        extractedText: "TRACI'S CHERISHED CREATIONS\nMENU\nWings 10.00",
        metadata: {
          universalProductUpdatePacket: packet
        }
      }
    ]),
    buildRoutingDecision(),
    ['evidence-1']
  );

  assert.equal(previewPacket.universalProductUpdatePacketPreview?.displayTitle, 'MealScout menu preview - Sweet Love');
  assert.equal(previewPacket.universalProductUpdatePacketPreview?.applyStatusLabel, 'Preview only — no production apply');
  assert.equal(
    (previewPacket.universalProductUpdatePacketPreview?.extractedStructuredData as { menu: { pricesMissing: boolean } }).menu.pricesMissing,
    true
  );
  assert.equal(previewPacket.universalProductUpdatePacketPreview?.sourceEvidenceReferences[0].sourceReference, 'drive://sweet-love-menu-pdf');
});
