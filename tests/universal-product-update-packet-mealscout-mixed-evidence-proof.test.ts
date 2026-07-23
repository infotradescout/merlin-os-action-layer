import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMealScoutMixedEvidenceProofPacket } from '../src/merlin/intake/universalProductUpdatePacket.ts';

test('builds a MealScout mixed-evidence proof packet with shared folder evidence for menu and logo', () => {
  const sourceFolderReference = 'drive://mealscout/sweet-love/evidence-folder';
  const packet = createMealScoutMixedEvidenceProofPacket({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test',
      actorLabel: 'Sweet Love Owner'
    },
    targetProduct: 'MealScout',
    targetBusinessName: 'Sweet Love',
    targetProfileId: 'ms-test-sweet-love-profile',
    sourceFolderReference,
    confidence: 0.91,
    menuEvidenceReferences: [
      {
        sourceFileName: 'sweet-love-menu.pdf',
        sourceMimeType: 'application/pdf',
        sourceReference: 'drive://sweet-love/evidence-folder/menu.pdf',
        sourceFolderReference,
        sourcePage: 1
      }
    ],
    logoEvidenceReferences: [
      {
        sourceFileName: 'sweet-love-logo.png',
        sourceMimeType: 'image/png',
        sourceReference: 'drive://sweet-love/evidence-folder/logo.png',
        sourceFolderReference
      }
    ],
    menuSections: [
      {
        sectionName: 'Signature Drinks',
        items: [
          {
            name: 'Strawberry Lemonade',
            description: 'Fresh strawberries with lemon and cane sugar',
            sourcePage: 1,
            sourceFileName: 'sweet-love-menu.pdf'
          }
        ]
      }
    ]
  });

  assert.equal(packet.targetProduct, 'MealScout');
  assert.equal(packet.targetEntityName, 'Sweet Love');
  assert.equal(packet.targetEntityId, 'ms-test-sweet-love-profile');
  assert.equal(packet.sourceFolderReference, sourceFolderReference);
  assert.equal(packet.updateType, 'proof_update');
  assert.equal(packet.productionApplied, false);
  assert.equal(packet.mutationAllowed, false);
  assert.equal(packet.implementationAllowed, false);
  assert.equal(packet.applyEligible, false);
  assert.equal(packet.ownerSubmittedEquivalent, true);
  assert.equal(packet.evidenceReferences.length, 2);
  assert.equal(packet.evidenceReferences[0].sourceFolderReference, sourceFolderReference);
  assert.equal(packet.evidenceReferences[1].sourceFolderReference, sourceFolderReference);

  assert.equal(packet.productSpecificPayload.updateType, 'proof_update');
  assert.equal(packet.productSpecificPayload.sourceFolderReference, sourceFolderReference);
  assert.equal(packet.productSpecificPayload.menuUpdate.updateType, 'menu_update');
  assert.equal(packet.productSpecificPayload.logoUpdate.updateType, 'logo_update');
  assert.equal(
    packet.productSpecificPayload.menuUpdate.sourceEvidence[0].sourceReference,
    'drive://sweet-love/evidence-folder/menu.pdf'
  );
  assert.equal(
    packet.productSpecificPayload.logoUpdate.sourceEvidence[0].sourceReference,
    'drive://sweet-love/evidence-folder/logo.png'
  );
  assert.equal(packet.productSpecificPayload.menuUpdate.pricesMissing, true);
  assert.equal(packet.productSpecificPayload.menuUpdate.sections[0].items[0].pricesMissing, true);
  assert.equal(packet.missingFields.includes('menu.items.price'), true);
  assert.equal(packet.requiredVerificationSteps.includes('preview_before_apply'), true);
  assert.equal(packet.requiredVerificationSteps.includes('exact_target_id_required_for_production_apply'), true);
  assert.equal(packet.requiredVerificationSteps.includes('no_fake_prices'), true);
  assert.equal(packet.requiredVerificationSteps.includes('no_media_apply_without_review'), true);
});

test('fails closed on ambiguous logo media and does not infer owner approval from file presence alone', () => {
  const sourceFolderReference = 'drive://mealscout/sweet-love/evidence-folder';
  const packet = createMealScoutMixedEvidenceProofPacket({
    sourceActor: {
      actorScope: 'staff',
      actorId: 'merlin-staff-test'
    },
    targetProduct: 'MealScout',
    targetBusinessName: 'Sweet Love',
    targetProfileId: 'ms-test-sweet-love-profile',
    sourceFolderReference,
    confidence: 0.73,
    menuEvidenceReferences: [
      {
        sourceFileName: 'sweet-love-menu.pdf',
        sourceMimeType: 'application/pdf',
        sourceReference: 'drive://sweet-love/evidence-folder/menu.pdf',
        sourceFolderReference,
        sourcePage: 1
      }
    ],
    logoEvidenceReferences: [
      {
        sourceFileName: 'sweet-love-logo.bin',
        sourceMimeType: 'application/octet-stream',
        sourceReference: 'drive://sweet-love/evidence-folder/logo.bin',
        sourceFolderReference
      }
    ],
    menuSections: [
      {
        sectionName: 'Signature Drinks',
        items: [{ name: 'Strawberry Lemonade', sourceFileName: 'sweet-love-menu.pdf' }]
      }
    ]
  });

  assert.equal(packet.ownerSubmittedEquivalent, false);
  assert.equal(packet.productionApplied, false);
  assert.equal(packet.mutationAllowed, false);
  assert.equal(packet.implementationAllowed, false);
  assert.equal(packet.applyEligible, false);
  assert.equal(packet.missingFields.includes('logo.sourceEvidence.mediaTypeReview'), true);
  assert.equal(packet.safetyFlags.includes('ambiguous_logo_media_type'), true);
  assert.equal(packet.requiredVerificationSteps.includes('no_media_apply_without_review'), true);
  assert.equal(packet.productSpecificPayload.logoUpdate.sourceEvidence[0].sourceMimeType, 'application/octet-stream');
});
