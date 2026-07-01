import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createMealScoutAccountIntakeBatchAdapter,
  type MealScoutAccountIntakeBatchRow
} from '../src/merlin/intake/mealscoutAccountIntakeBatchAdapter.ts';

function buildRow(overrides?: Partial<MealScoutAccountIntakeBatchRow>): MealScoutAccountIntakeBatchRow {
  return {
    rowId: 'row-1',
    targetBusinessName: 'Sweet Heat Tacos',
    targetProfileId: 'ms-sweet-heat',
    targetResolutionStatus: 'resolved_exact_target_id',
    accountType: 'food_truck',
    cuisineType: 'Tacos',
    phone: '504-555-0123',
    email: 'hello@sweetheat.example',
    website: 'https://sweetheat.example',
    socialLinks: [
      {
        platform: 'instagram',
        url: 'https://instagram.com/sweetheat'
      }
    ],
    address: '123 Canal St',
    city: 'New Orleans',
    state: 'LA',
    postalCode: '70112',
    serviceArea: 'New Orleans Metro',
    requiredNextStep: 'Operator review before any future account creation',
    safetyFlags: ['operator_review_required'],
    sourceFolderReference: 'drive://mealscout/sweet-heat/account-intake',
    evidenceReferences: [
      {
        sourceFileName: 'sweet-heat-account.pdf',
        sourceMimeType: 'application/pdf',
        sourceReference: 'drive://files/sweet-heat-account.pdf'
      }
    ],
    ...overrides
  };
}

function buildBatch(rows: MealScoutAccountIntakeBatchRow[]) {
  return createMealScoutAccountIntakeBatchAdapter({
    sourceActor: {
      actorScope: 'owner',
      actorId: 'owner-1',
      actorLabel: 'Owner One'
    },
    rows
  });
}

test('builds one account_intake packet from an explicit row and preserves evidence references verbatim', () => {
  const result = buildBatch([buildRow()]);
  const row = result.rows[0];

  assert.equal(result.rows.length, 1);
  assert.equal(row.packet.updateType, 'account_intake');
  assert.equal(row.packet.targetEntityName, 'Sweet Heat Tacos');
  assert.equal(row.packet.productSpecificPayload.packetSubtype, 'MealScoutAccountIntakePacket');
  assert.equal(row.packet.evidenceReferences[0].sourceReference, 'drive://files/sweet-heat-account.pdf');
  assert.equal(row.packet.evidenceReferences[0].sourceFolderReference, 'drive://mealscout/sweet-heat/account-intake');
  assert.equal(row.packet.sourceFolderReference, 'drive://mealscout/sweet-heat/account-intake');
  assert.equal(row.preview.status, 'supported');
  assert.equal(row.detectedChange?.kind, 'account_intake');
  assert.equal(row.detectedChange?.businessName, 'Sweet Heat Tacos');
  assert.equal(row.detectedChange?.requiredNextStep, 'Operator review before any future account creation');
});

test('builds multiple packets with deterministic IDs and no cross-row leakage', () => {
  const firstRow = buildRow();
  const secondRow = buildRow({
    rowId: 'row-2',
    targetBusinessName: 'Bayou Bowls',
    targetProfileId: 'ms-bayou-bowls',
    phone: '504-555-0777',
    city: 'Metairie',
    evidenceReferences: [
      {
        sourceFileName: 'bayou-bowls-account.pdf',
        sourceMimeType: 'application/pdf',
        sourceReference: 'drive://files/bayou-bowls-account.pdf',
        sourceFolderReference: 'drive://mealscout/bayou-bowls/account-intake'
      }
    ]
  });

  const resultA = buildBatch([firstRow, secondRow]);
  const resultB = buildBatch([firstRow, secondRow]);

  assert.equal(resultA.rows.length, 2);
  assert.equal(resultA.rows[0].packet.packetId, resultB.rows[0].packet.packetId);
  assert.equal(resultA.rows[1].packet.packetId, resultB.rows[1].packet.packetId);
  assert.notEqual(resultA.rows[0].packet.packetId, resultA.rows[1].packet.packetId);
  assert.equal(resultA.rows[0].packet.targetEntityName, 'Sweet Heat Tacos');
  assert.equal(resultA.rows[1].packet.targetEntityName, 'Bayou Bowls');
  assert.equal(resultA.rows[1].detectedChange?.businessName, 'Bayou Bowls');
  assert.equal(resultA.rows[0].detectedChange?.businessName, 'Sweet Heat Tacos');
});

test('surfaces preview-ready metadata and detectedChanges.accountIntake without upload-intent registration', () => {
  const row = buildBatch([buildRow()]).rows[0];

  assert.equal(row.previewPacket.universalProductUpdatePacketPreview?.status, 'supported');
  assert.equal(row.previewPacket.universalProductUpdatePacketPreview?.updateType, 'account_intake');
  assert.equal(row.previewPacket.universalProductUpdatePacketPreview?.applyStatusLabel, 'Preview only — no production apply');
  assert.equal(row.previewPacket.detectedChanges.accountIntake !== undefined, true);
  assert.deepEqual(row.detectedChange?.sourceEvidenceReferences, ['drive://files/sweet-heat-account.pdf']);
});

test('fails closed when a row omits evidence references', () => {
  assert.throws(
    () =>
      buildBatch([
        buildRow({
          rowId: 'row-missing-evidence',
          evidenceReferences: []
        })
      ]),
    /mealscout_account_intake_batch_evidence_references_required:row-missing-evidence/
  );
});

test('fails closed when forbidden logo menu or price fields are passed', () => {
  assert.throws(
    () =>
      buildBatch([
        {
          ...(buildRow() as unknown as Record<string, unknown>),
          logoUrl: 'https://example.com/logo.png'
        } as unknown as MealScoutAccountIntakeBatchRow
      ]),
    /forbidden_mealscout_account_intake_batch_fields:logoUrl/
  );

  assert.throws(
    () =>
      buildBatch([
        {
          ...(buildRow() as unknown as Record<string, unknown>),
          menuItems: [{ name: 'Taco' }]
        } as unknown as MealScoutAccountIntakeBatchRow
      ]),
    /forbidden_mealscout_account_intake_batch_fields:menuItems/
  );

  assert.throws(
    () =>
      buildBatch([
        {
          ...(buildRow() as unknown as Record<string, unknown>),
          prices: ['10.00']
        } as unknown as MealScoutAccountIntakeBatchRow
      ]),
    /forbidden_mealscout_account_intake_batch_fields:prices/
  );
});

test('preserves hard-false authority flags on every batch result', () => {
  const result = buildBatch([buildRow(), buildRow({ rowId: 'row-2', targetBusinessName: 'Bayou Bowls' })]);

  assert.equal(result.productionApplied, false);
  assert.equal(result.mutationAllowed, false);
  assert.equal(result.implementationAllowed, false);
  assert.equal(result.applyEligible, false);

  for (const row of result.rows) {
    assert.equal(row.productionApplied, false);
    assert.equal(row.mutationAllowed, false);
    assert.equal(row.implementationAllowed, false);
    assert.equal(row.applyEligible, false);
    assert.equal(row.packet.productionApplied, false);
    assert.equal(row.packet.mutationAllowed, false);
    assert.equal(row.packet.implementationAllowed, false);
    assert.equal(row.packet.applyEligible, false);
  }
});

test('keeps sourceFolderReference only when evidence rows agree or explicit row folder is valid', () => {
  const explicit = buildBatch([buildRow()]).rows[0];
  assert.equal(explicit.packet.sourceFolderReference, 'drive://mealscout/sweet-heat/account-intake');

  const inferred = buildBatch([
    buildRow({
      rowId: 'row-inferred-folder',
      sourceFolderReference: undefined,
      evidenceReferences: [
        {
          sourceFileName: 'one.pdf',
          sourceMimeType: 'application/pdf',
          sourceReference: 'drive://files/one.pdf',
          sourceFolderReference: 'drive://folder/shared'
        },
        {
          sourceFileName: 'two.pdf',
          sourceMimeType: 'application/pdf',
          sourceReference: 'drive://files/two.pdf',
          sourceFolderReference: 'drive://folder/shared'
        }
      ]
    })
  ]).rows[0];
  assert.equal(inferred.packet.sourceFolderReference, 'drive://folder/shared');

  const conflicting = buildBatch([
    buildRow({
      rowId: 'row-conflict-folder',
      sourceFolderReference: 'drive://folder/explicit',
      evidenceReferences: [
        {
          sourceFileName: 'one.pdf',
          sourceMimeType: 'application/pdf',
          sourceReference: 'drive://files/one.pdf',
          sourceFolderReference: 'drive://folder/a'
        },
        {
          sourceFileName: 'two.pdf',
          sourceMimeType: 'application/pdf',
          sourceReference: 'drive://files/two.pdf',
          sourceFolderReference: 'drive://folder/b'
        }
      ]
    })
  ]).rows[0];
  assert.equal(conflicting.packet.sourceFolderReference, undefined);
  assert.equal(conflicting.warnings.includes('source_folder_reference_conflict'), true);
});

test('ignores extractedText visualLabels raw_metadata.extracted_text and other extraction-only metadata', () => {
  const row = buildBatch([
    {
      ...(buildRow() as unknown as Record<string, unknown>),
      extractedText: 'ignore me',
      visualLabels: ['menu'],
      raw_metadata: {
        extracted_text: 'ignore this too'
      },
      candidateImportOutput: {
        businessName: 'Wrong Name'
      }
    } as unknown as MealScoutAccountIntakeBatchRow
  ]).rows[0];

  assert.equal(row.packet.targetEntityName, 'Sweet Heat Tacos');
  assert.equal(row.packet.productSpecificPayload.businessName, 'Sweet Heat Tacos');
  assert.equal(row.packet.productSpecificPayload.phone, '504-555-0123');
});

test('proves no route server Drive DB product API apply or deploy behavior is involved', () => {
  const row = buildBatch([buildRow()]).rows[0] as unknown as Record<string, unknown>;

  for (const field of [
    'driveActions',
    'movedFiles',
    'appliedMutations',
    'dbWrites',
    'productApiWrites',
    'deployStatus',
    'publishPlan',
    'routeChange'
  ]) {
    assert.equal(field in row, false);
  }
});
