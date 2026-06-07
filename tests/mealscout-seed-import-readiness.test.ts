import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

import {
  buildMealScoutSeedImportDryRunReviewArtifact,
  planMealScoutSeedImportReadiness,
  renderMealScoutSeedImportDryRunReviewMarkdown,
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

test('MealScout seed import readiness writes stable dry-run review artifacts', () => {
  const artifactDir = mkdtempSync(join(tmpdir(), 'mealscout-seed-review-'));
  try {
    const output = execFileSync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/mealscout-seed-import-readiness.ts', '--artifact-dir', artifactDir],
      { encoding: 'utf8' }
    );
    const summary = JSON.parse(output) as {
      mutationAllowed: boolean;
      eligibleRowCount: number;
      blockedRowCount: number;
      artifacts: { json: string; markdown: string };
    };
    const jsonPath = join(artifactDir, 'batch001-dry-run-review.json');
    const markdownPath = join(artifactDir, 'batch001-dry-run-review.md');

    assert.equal(summary.mutationAllowed, false);
    assert.equal(summary.eligibleRowCount, 2);
    assert.equal(summary.blockedRowCount, 0);
    assert.equal(summary.artifacts.json, jsonPath);
    assert.equal(summary.artifacts.markdown, markdownPath);
    assert.equal(existsSync(jsonPath), true);
    assert.equal(existsSync(markdownPath), true);

    const artifact = JSON.parse(readFileSync(jsonPath, 'utf8')) as ReturnType<typeof buildMealScoutSeedImportDryRunReviewArtifact>;
    const markdown = readFileSync(markdownPath, 'utf8');
    assert.equal(artifact.batchId, 'BATCH-001-MEALSCOUT-MERLIN-SEED');
    assert.equal(artifact.mode, 'dry_run');
    assert.equal(artifact.mutationAllowed, false);
    assert.equal(artifact.plannedImports.length, 2);
    assert.equal(artifact.safetyStatus.no_live_apply_path_ran, true);
    assert.equal(markdown.includes('# MealScout Seed Dry-Run Review'), true);
    assert.equal(markdown.includes('Mutation allowed: false'), true);
    assert.equal(markdown.includes('No live import or apply path was executed.'), true);
  } finally {
    rmSync(artifactDir, { recursive: true, force: true });
  }
});

test('MealScout seed import dry-run artifact reports omitted blanks without adding them to writes', () => {
  const plan = planMealScoutSeedImportReadiness({
    seedExportRows: [
      {
        export_schema_version: 'merlin_profile_seed_export_v1',
        brand_lane: 'MEALSCOUT',
        target_profile_type: 'food_truck',
        profile_name: 'Existing Taco Truck',
        profile_email: null,
        phone: '504-111-2222',
        website: null,
        socials: { facebook: null, instagram: '' },
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
    ],
    copyAuditRows: [
      {
        batch_id: 'BATCH-001-MEALSCOUT-MERLIN-SEED',
        source_file_id: 'original-source-1',
        source_file_name: 'original.png',
        copied_file_id: 'copied-evidence-1',
        seed_action: 'seed_to_merlin_evidence',
        safety_gate: 'merlin_export_contract_required',
        copy_status: 'copied'
      }
    ],
    existingProfiles: [
      {
        id: 'existing-profile-1',
        truckName: 'Existing Taco Truck',
        phone: '5041112222'
      }
    ]
  });
  const artifact = buildMealScoutSeedImportDryRunReviewArtifact(plan, '2026-06-07T00:00:00.000Z');
  const markdown = renderMealScoutSeedImportDryRunReviewMarkdown(artifact);
  const row = artifact.plannedImports[0];

  assert.equal(artifact.mutationAllowed, false);
  assert.equal(row.proposed_action, 'update');
  assert.equal(row.matched_existing_profile?.id, 'existing-profile-1');
  assert.equal(row.matched_existing_profile?.name, 'Existing Taco Truck');
  assert.equal(row.field_writes.truckName, 'Existing Taco Truck');
  assert.equal(row.field_writes.phone, '504-111-2222');
  assert.equal(Object.prototype.hasOwnProperty.call(row.field_writes, 'email'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(row.field_writes, 'website'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(row.field_writes, 'cityArea'), false);
  assert.equal(row.omitted_fields.some((field) => field.field === 'email' && field.reason === 'blank_or_null'), true);
  assert.equal(row.omitted_fields.some((field) => field.field === 'website' && field.reason === 'blank_or_null'), true);
  assert.equal(row.omitted_fields.some((field) => field.field === 'cityArea' && field.reason === 'blank_or_null'), true);
  assert.equal(row.evidence.copied_evidence_file_id, 'copied-evidence-1');
  assert.equal(row.provenance.original_source_file_id, 'original-source-1');
  assert.notEqual(row.evidence.copied_evidence_file_id, row.provenance.original_source_file_id);
  assert.equal(markdown.includes('Matched existing profile: existing-profile-1 (Existing Taco Truck)'), true);
  assert.equal(markdown.includes('email: blank_or_null'), true);
  assert.equal(markdown.includes('Copied evidence file ID: copied-evidence-1'), true);
  assert.equal(markdown.includes('Original source file ID: original-source-1'), true);
});
