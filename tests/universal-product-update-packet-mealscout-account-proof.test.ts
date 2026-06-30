import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPreviewPacket } from '../src/merlin/intake/previewBuilder.ts';
import type { UploadIntent } from '../src/merlin/intake/intakeTypes.ts';
import {
  createUniversalProductUpdatePacket,
  parseMealScoutAccountIntakePacket,
  parseUniversalProductUpdatePacket
} from '../src/merlin/intake/universalProductUpdatePacket.ts';
import { buildUniversalProductUpdatePacketPreview } from '../src/merlin/intake/universalProductUpdatePacketPreview.ts';

function buildAccountPacket(overrides?: Partial<Parameters<typeof createUniversalProductUpdatePacket>[0]>) {
  return createUniversalProductUpdatePacket({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'sweet-love-owner-test',
      actorLabel: 'Sweet Love Owner'
    },
    targetProduct: 'MealScout',
    targetBusinessName: 'Sweet Love',
    targetProfileId: 'ms-test-sweet-love-profile',
    updateType: 'account_intake',
    confidence: 0.91,
    evidenceReferences: [
      {
        sourceFileName: 'sweet-love-account-form.pdf',
        sourceMimeType: 'application/pdf',
        sourceReference: 'drive://sweet-love-account-form',
        sourceFolderReference: 'drive://mealscout/sweet-love/account-intake'
      }
    ],
    accountIntake: {
      accountType: 'food_truck',
      cuisineType: 'Southern comfort',
      phone: '512-555-0100',
      email: 'hello@sweetlove.example',
      website: 'https://sweetlove.example',
      socialLinks: [
        {
          platform: 'instagram',
          url: 'https://instagram.com/sweetlove'
        }
      ],
      address: '123 Riverwalk Ave',
      city: 'Austin',
      state: 'TX',
      postalCode: '78701',
      serviceArea: 'Austin Metro',
      requiredNextStep: 'Operator review before any future account creation'
    },
    ...overrides
  });
}

function buildAccountUploadIntent(packet: ReturnType<typeof buildAccountPacket>): UploadIntent {
  return {
    uploadId: 'upload-account-intake-preview-test',
    userId: 'u-1',
    accountId: 'a-1',
    brand: 'MEALSCOUT',
    actorScope: 'owner',
    entityType: 'food_truck',
    entityId: 'truck-1',
    actionId: 'account_intake_review',
    actionSnapshot: {
      actionId: 'account_intake_review',
      brand: 'MEALSCOUT',
      actorScope: 'owner',
      label: 'Account intake review',
      description: 'Account-only preview readability test',
      entityTypesAllowed: ['food_truck', 'restaurant', 'host_location'],
      expectedFileTypes: ['application/pdf'],
      allowedOutputTypes: ['account_intake'],
      allowedFieldPaths: ['accountIntake'],
      forbiddenFieldPaths: ['menu', 'logo', 'prices'],
      requiresEntityContext: false,
      requiresUserHint: false,
      previewRequired: true,
      approvalRequired: true,
      implementationMode: 'admin_review_required',
      riskLevel: 'medium'
    },
    files: [
      {
        fileId: 'account-1',
        fileName: 'sweet-love-account-form.pdf',
        mimeType: 'application/pdf',
        metadata: {
          universalProductUpdatePacket: packet
        }
      }
    ],
    routing: [],
    status: 'PREVIEW_READY',
    implementationAllowed: false,
    mutationAllowed: false,
    previewRequired: true,
    approvalRequired: true,
    createdAt: '2026-06-30T00:00:00.000Z',
    updatedAt: '2026-06-30T00:00:00.000Z'
  };
}

test('account_intake packet parses cleanly and preserves business identity, contact, location, and evidence fields', () => {
  const packet = buildAccountPacket();
  const parsedPacket = parseUniversalProductUpdatePacket(packet);
  const parsedPayload = parseMealScoutAccountIntakePacket(packet.productSpecificPayload);

  assert.equal(parsedPacket.updateType, 'account_intake');
  assert.equal(parsedPayload.businessName, 'Sweet Love');
  assert.equal(parsedPayload.accountType, 'food_truck');
  assert.equal(parsedPayload.phone, '512-555-0100');
  assert.equal(parsedPayload.email, 'hello@sweetlove.example');
  assert.equal(parsedPayload.website, 'https://sweetlove.example');
  assert.equal(parsedPayload.address, '123 Riverwalk Ave');
  assert.equal(parsedPayload.city, 'Austin');
  assert.equal(parsedPayload.state, 'TX');
  assert.equal(parsedPayload.postalCode, '78701');
  assert.equal(parsedPayload.serviceArea, 'Austin Metro');
  assert.equal(parsedPayload.sourceEvidenceReferences[0].sourceReference, 'drive://sweet-love-account-form');
  assert.equal(parsedPayload.sourceFolderReference, 'drive://mealscout/sweet-love/account-intake');
  assert.deepEqual(parsedPayload.socialLinks, [
    {
      platform: 'instagram',
      url: 'https://instagram.com/sweetlove'
    }
  ]);
  assert.equal(parsedPayload.requiredNextStep, 'Operator review before any future account creation');
  assert.deepEqual(parsedPayload.missingFields, []);
  assert.equal(parsedPayload.productionApplied, false);
  assert.equal(parsedPayload.mutationAllowed, false);
  assert.equal(parsedPayload.implementationAllowed, false);
  assert.equal(parsedPayload.applyEligible, false);
});

test('account_intake packet surfaces missing core fields for contact and location review', () => {
  const packet = buildAccountPacket({
    targetBusinessName: 'Nomad Eats',
    accountIntake: {
      accountType: 'food_truck',
      requiredNextStep: 'Operator outreach required'
    }
  });

  assert.equal(packet.updateType, 'account_intake');
  assert.equal(packet.missingFields.includes('accountIntake.contact'), true);
  assert.equal(packet.missingFields.includes('accountIntake.location'), true);
  assert.equal(packet.productSpecificPayload.missingFields.includes('accountIntake.contact'), true);
  assert.equal(packet.productSpecificPayload.missingFields.includes('accountIntake.location'), true);
  assert.equal(packet.safetyFlags.includes('missing_account_intake_fields'), true);
});

test('account_intake schema fails closed when logo, menu, or price injection is attempted', () => {
  const packet = buildAccountPacket();

  assert.throws(
    () => parseMealScoutAccountIntakePacket({
      ...packet.productSpecificPayload,
      logoUrl: 'https://example.com/logo.png'
    }),
    /Unrecognized key/
  );

  assert.throws(
    () => parseMealScoutAccountIntakePacket({
      ...packet.productSpecificPayload,
      menuItems: [{ name: 'Wings' }]
    }),
    /Unrecognized key/
  );

  assert.throws(
    () => parseUniversalProductUpdatePacket({
      ...packet,
      extractedStructuredData: {
        accountIntake: {
          ...packet.productSpecificPayload,
          prices: ['10.00']
        }
      }
    }),
    /Unrecognized key/
  );
});

test('account_intake preview stays read-only and surfaces readable account review output', () => {
  const packet = buildAccountPacket();
  const preview = buildUniversalProductUpdatePacketPreview(packet);

  assert.equal(preview.status, 'supported');
  if (preview.status !== 'supported') assert.fail('expected supported preview');
  assert.equal(preview.updateType, 'account_intake');
  assert.equal(preview.displayTitle, 'MealScout account intake preview - Sweet Love');
  assert.equal(preview.operatorSummary.includes('Operator review before any future account creation'), true);
  assert.equal(preview.missingFieldSummary, 'No missing account intake fields in preview.');
  assert.equal(preview.applyStatusLabel, 'Preview only — no production apply');
  assert.equal(preview.nextRequiredAction, 'review_only');
  assert.equal(preview.productionApplied, false);
  assert.equal(preview.mutationAllowed, false);
  assert.equal(preview.implementationAllowed, false);
  assert.equal(preview.applyEligible, false);
});

test('buildPreviewPacket surfaces detectedChanges.accountIntake without implying apply authority', () => {
  const packet = buildAccountPacket();
  const previewPacket = buildPreviewPacket(buildAccountUploadIntent(packet), [], ['evidence-1']);
  const accountIntake = previewPacket.detectedChanges.accountIntake as {
    kind: string;
    businessName: string;
    accountType: string;
    sourceEvidenceReferences: string[];
    requiredNextStep: string;
    mutationAllowed: boolean;
    implementationAllowed: boolean;
    applyEligible: boolean;
    productionApplied: boolean;
  };

  assert.equal(accountIntake.kind, 'account_intake');
  assert.equal(accountIntake.businessName, 'Sweet Love');
  assert.equal(accountIntake.accountType, 'food_truck');
  assert.deepEqual(accountIntake.sourceEvidenceReferences, ['drive://sweet-love-account-form']);
  assert.equal(accountIntake.requiredNextStep, 'Operator review before any future account creation');
  assert.equal(accountIntake.productionApplied, false);
  assert.equal(accountIntake.mutationAllowed, false);
  assert.equal(accountIntake.implementationAllowed, false);
  assert.equal(accountIntake.applyEligible, false);
  assert.equal(previewPacket.universalProductUpdatePacketPreview?.applyStatusLabel, 'Preview only — no production apply');
});
