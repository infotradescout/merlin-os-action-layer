import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  planMealScoutSeedImportReadiness,
  type MealScoutSeedCopyAuditRow,
  type MealScoutSeedExportRow
} from '../src/mealscoutSeedImportReadiness.ts';

function parseCsv(content: string): MealScoutSeedCopyAuditRow[] {
  const lines = content.split(/\r?\n/).filter((line) => line.length > 0);
  const header = (lines[0] || '').split(',');
  return lines.slice(1).map((line) => {
    const cols = line.split(',');
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i += 1) {
      row[header[i]] = cols[i] || '';
    }
    return row;
  });
}

function readGeneratedExport(): MealScoutSeedExportRow[] {
  return JSON.parse(readFileSync('screenshots-batch001-merlin-profile-seed-export.json', 'utf8')) as MealScoutSeedExportRow[];
}

function readGeneratedCopyAudit(): MealScoutSeedCopyAuditRow[] {
  return parseCsv(readFileSync('screenshots-copy-audit-manifest.csv', 'utf8'));
}

test('MealScout seed import readiness gates the generated export to copied BATCH-001 evidence in dry-run mode', () => {
  const seedExportRows = readGeneratedExport();
  const copyAuditRows = readGeneratedCopyAudit();
  const plan = planMealScoutSeedImportReadiness({ seedExportRows, copyAuditRows });

  assert.equal(plan.status, 'ok');
  assert.equal(plan.mode, 'dry_run');
  assert.equal(plan.mutationAllowed, false);
  assert.equal(plan.blockedRowCount, 0);
  assert.equal(plan.eligibleRowCount, seedExportRows.length);
  assert.equal(plan.eligibleRowCount, 2);

  for (const row of plan.plannedImports) {
    const audit = copyAuditRows.find((auditRow) => auditRow.copied_file_id === row.evidence_file_id);
    assert.ok(audit);
    assert.equal(audit.batch_id, 'BATCH-001-MEALSCOUT-MERLIN-SEED');
    assert.equal(audit.seed_action, 'seed_to_merlin_evidence');
    assert.equal(audit.copy_status, 'copied');
    assert.equal(row.source_file_id, row.evidence_file_id);
    assert.equal(row.provenance.copied_evidence_file_id, row.evidence_file_id);
    assert.equal(row.provenance.original_source_file_id, audit.source_file_id);
    assert.notEqual(row.provenance.original_source_file_id, row.evidence_file_id);
    assert.equal(row.provenance.original_source_is_audit_only, true);
    assert.equal(row.source_refs.includes(row.evidence_file_id), true);
  }
});

test('MealScout seed import readiness blocks non-seed gated rows even when copied', () => {
  const seedExportRows = readGeneratedExport();
  const copyAuditRows = readGeneratedCopyAudit();
  const contractorCopy = copyAuditRows.find((row) => row.batch_id === 'BATCH-004-TRADESCOUT-CONTRACTORS');
  assert.ok(contractorCopy?.copied_file_id);

  const nonSeedRow: MealScoutSeedExportRow = {
    ...seedExportRows[0],
    brand_lane: 'TRADESCOUT',
    target_profile_type: 'contractor_business',
    source_file_id: contractorCopy.copied_file_id,
    source_refs: [contractorCopy.copied_file_id]
  };

  const plan = planMealScoutSeedImportReadiness({
    seedExportRows: [nonSeedRow],
    copyAuditRows
  });

  assert.equal(plan.eligibleRowCount, 0);
  assert.equal(plan.blockedRowCount, 1);
  assert.equal(plan.blockedRows[0].reason, 'non_mealscout_row_not_importable');
  assert.equal(plan.mutationAllowed, false);
});

test('MealScout seed import readiness stages existing profile matches as update and omits blank overwrites', () => {
  const copyAuditRows: MealScoutSeedCopyAuditRow[] = [
    {
      batch_id: 'BATCH-001-MEALSCOUT-MERLIN-SEED',
      source_file_id: 'original-source-1',
      source_file_name: 'original.png',
      copied_file_id: 'copied-evidence-1',
      seed_action: 'seed_to_merlin_evidence',
      safety_gate: 'merlin_export_contract_required',
      copy_status: 'copied'
    }
  ];
  const seedExportRows: MealScoutSeedExportRow[] = [
    {
      export_schema_version: 'merlin_profile_seed_export_v1',
      brand_lane: 'MEALSCOUT',
      target_profile_type: 'food_truck',
      profile_name: 'Existing Taco Truck',
      profile_email: null,
      phone: '504-111-2222',
      website: null,
      socials: { facebook: null, instagram: null },
      source_file_id: 'copied-evidence-1',
      source_file_name: 'copied.png',
      source_refs: ['copied-evidence-1'],
      extracted_fields: {
        truckName: 'Existing Taco Truck',
        phone: '504-111-2222',
        cityArea: ''
      },
      seeded_from_evidence: true,
      profile_origin: 'evidence_seed',
      onboarding_source: 'admin_seed',
      claim_status: 'unclaimed',
      email_verified: false,
      insurance_verified: false,
      owner_user_id: null,
      import_decision: 'importable'
    }
  ];

  const plan = planMealScoutSeedImportReadiness({
    seedExportRows,
    copyAuditRows,
    existingProfiles: [
      {
        id: 'existing-profile-1',
        truckName: 'Existing Taco Truck',
        phone: '5041112222',
        email: 'owner@example.com',
        website: 'https://existing.example',
        cityArea: 'New Orleans',
        socials: { facebook: '@existing' }
      }
    ]
  });

  assert.equal(plan.eligibleRowCount, 1);
  assert.equal(plan.plannedImports[0].planned_action, 'update');
  assert.equal(plan.plannedImports[0].existing_profile_id, 'existing-profile-1');
  assert.equal(plan.plannedImports[0].field_writes.truckName, 'Existing Taco Truck');
  assert.equal(plan.plannedImports[0].field_writes.phone, '504-111-2222');
  assert.equal(Object.prototype.hasOwnProperty.call(plan.plannedImports[0].field_writes, 'email'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(plan.plannedImports[0].field_writes, 'website'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(plan.plannedImports[0].field_writes, 'cityArea'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(plan.plannedImports[0].field_writes, 'facebook'), false);
});

test('MealScout seed import readiness requires an explicit allow flag before mutation is allowed', () => {
  const seedExportRows = readGeneratedExport();
  const copyAuditRows = readGeneratedCopyAudit();
  const dryRun = planMealScoutSeedImportReadiness({ seedExportRows, copyAuditRows });
  const allowed = planMealScoutSeedImportReadiness({ seedExportRows, copyAuditRows, allowLiveApply: true });

  assert.equal(dryRun.mode, 'dry_run');
  assert.equal(dryRun.mutationAllowed, false);
  assert.equal(allowed.mode, 'live_apply_allowed');
  assert.equal(allowed.mutationAllowed, true);
});
