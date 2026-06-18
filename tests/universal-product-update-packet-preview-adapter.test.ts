import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMealScoutMixedEvidenceProofPacket,
  createUniversalProductUpdatePacket,
  type MerlinUniversalProductUpdatePacket
} from '../src/merlin/intake/universalProductUpdatePacket.ts';
import { buildUniversalProductUpdatePacketPreview } from '../src/merlin/intake/universalProductUpdatePacketPreview.ts';

test('represents a MealScout menu_update packet in preview output with pricesMissing and hard-false flags preserved', () => {
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
  if (preview.status !== 'supported') {
    assert.fail('expected supported preview');
  }
  assert.equal(preview.targetProduct, 'MealScout');
  assert.equal(preview.targetBusinessName, 'Sweet Love');
  assert.equal(preview.targetProfileId, 'ms-test-sweet-love-profile');
  assert.equal(preview.updateType, 'menu_update');
  assert.equal((preview.extractedStructuredData as { menu: { pricesMissing: boolean } }).menu.pricesMissing, true);
  assert.equal(preview.missingFields.includes('menu.items.price'), true);
  assert.equal(preview.sourceEvidenceReferences[0].sourceReference, 'drive://sweet-love-menu-pdf');
  assert.equal(preview.ownerSubmittedEquivalent, true);
  assert.equal(preview.productionApplied, false);
  assert.equal(preview.mutationAllowed, false);
  assert.equal(preview.implementationAllowed, false);
  assert.equal(preview.applyEligible, false);
});

test('represents a MealScout logo_update packet in preview output with sourceFolderReference and media review step preserved', () => {
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
  if (preview.status !== 'supported') {
    assert.fail('expected supported preview');
  }
  assert.equal(preview.updateType, 'logo_update');
  assert.equal(preview.sourceFolderReference, sourceFolderReference);
  assert.deepEqual(preview.sourceEvidenceReferences, evidenceReferences);
  assert.equal(preview.requiredVerificationSteps.includes('no_media_apply_without_review'), true);
  assert.equal(preview.productionApplied, false);
  assert.equal(preview.mutationAllowed, false);
  assert.equal(preview.implementationAllowed, false);
  assert.equal(preview.applyEligible, false);
});

test('represents a MealScout schedule_update packet in preview output with recurrence, eligibility, timezone verification, and hard-false flags preserved', () => {
  const packet = createUniversalProductUpdatePacket({
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

  const preview = buildUniversalProductUpdatePacketPreview(packet);

  assert.equal(preview.status, 'supported');
  if (preview.status !== 'supported') {
    assert.fail('expected supported preview');
  }
  assert.equal(preview.updateType, 'schedule_update');
  assert.deepEqual((preview.extractedStructuredData as { schedule: Array<Record<string, unknown>> }).schedule[0], {
    date: '2026-06-21',
    startTime: '11:00',
    endTime: '15:00',
    timezone: 'America/Chicago',
    locationName: 'Sweet Love at Riverwalk',
    address: '123 Riverwalk Ave, Austin, TX',
    closed: false,
    recurrence: 'explicit_recurring',
    mapEligible: true,
    liveFeedEligible: true,
    sourceEvidence: [
      {
        sourceFileName: 'sweet-love-schedule.png',
        sourceMimeType: 'image/png',
        sourceReference: 'drive://sweet-love-schedule'
      }
    ]
  });
  assert.equal(preview.requiredVerificationSteps.includes('timezone_must_be_explicit'), true);
  assert.equal(preview.productionApplied, false);
  assert.equal(preview.mutationAllowed, false);
  assert.equal(preview.implementationAllowed, false);
  assert.equal(preview.applyEligible, false);
});

test('fails closed on unsupported packet types without mutation', () => {
  const packet = createMealScoutMixedEvidenceProofPacket({
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
  });

  const preview = buildUniversalProductUpdatePacketPreview(packet);

  assert.equal(preview.status, 'unsupported');
  if (preview.status !== 'unsupported') {
    assert.fail('expected unsupported preview');
  }
  assert.equal(preview.reason, 'unsupported_target_product_or_update_type');
  assert.equal(preview.targetProduct, 'MealScout');
  assert.equal(preview.updateType, 'proof_update');
  assert.equal(preview.productionApplied, false);
  assert.equal(preview.mutationAllowed, false);
  assert.equal(preview.implementationAllowed, false);
  assert.equal(preview.applyEligible, false);
});
