import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUniversalProductUpdatePacket } from '../src/merlin/intake/universalProductUpdatePacket.ts';

test('builds universal Merlin packet with MealScout menu proof and missing prices flagged', () => {
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
        sourceReference: 'drive://sweet-love-menu-pdf',
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
            sourcePage: 1
          }
        ]
      }
    ]
  });

  assert.equal(packet.targetProduct, 'MealScout');
  assert.equal(packet.productSpecificPayload.updateType, 'menu_update');
  assert.equal(packet.ownerSubmittedEquivalent, true);
  assert.equal(packet.productionApplied, false);
  assert.equal(packet.mutationAllowed, false);
  assert.equal(packet.implementationAllowed, false);
  assert.equal(packet.applyEligible, false);
  assert.equal(packet.evidenceReferences[0].sourceReference, 'drive://sweet-love-menu-pdf');
  assert.equal(packet.productSpecificPayload.sourceEvidence[0].sourceReference, 'drive://sweet-love-menu-pdf');
  assert.equal(packet.productSpecificPayload.sections[0].items[0].pricesMissing, true);
  assert.equal(packet.productSpecificPayload.pricesMissing, true);
  assert.equal(packet.missingFields.includes('menu.items.price'), true);
  assert.equal(packet.requiredVerificationSteps.includes('no_fake_prices'), true);
  assert.equal(packet.requiredVerificationSteps.includes('preview_before_apply'), true);
  assert.equal(packet.targetEntityId, 'ms-test-sweet-love-profile');
  assert.equal(packet.targetResolutionStatus, 'resolved_exact_target_id');
});

test('packet ids are deterministic for the same Sweet Love proof input', () => {
  const input = {
    sourceActor: {
      actorScope: 'owner' as const,
      actorId: 'sweet-love-owner-test'
    },
    targetProduct: 'MealScout' as const,
    targetBusinessName: 'Sweet Love',
    targetProfileId: 'ms-test-sweet-love-profile',
    updateType: 'menu_update' as const,
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
  };

  const a = createUniversalProductUpdatePacket(input);
  const b = createUniversalProductUpdatePacket(input);

  assert.equal(a.packetId, b.packetId);
  assert.deepEqual(a, b);
});
