import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';

import {
  authorizeMealScoutSeedApply,
  buildMealScoutSeedApplySimulationReport,
  buildMealScoutSeedImportDryRunReviewArtifact,
  computeMealScoutSeedExportChecksum,
  planMealScoutSeedImportReadiness,
  renderMealScoutSeedApplySimulationMarkdown,
  renderMealScoutSeedImportDryRunReviewMarkdown,
  simulateMealScoutSeedApply,
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

function readGeneratedExportContent(): string {
  return readFileSync('screenshots-batch001-merlin-profile-seed-export.json', 'utf8');
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
    assert.equal(summary.seedExportChecksum.value, artifact.seedExportChecksum.value);
    assert.equal(artifact.seedExportChecksum.value, computeMealScoutSeedExportChecksum(readGeneratedExportContent()).value);
    assert.equal(artifact.plannedImports.length, 2);
    assert.equal(artifact.safetyStatus.no_live_apply_path_ran, true);
    assert.equal(markdown.includes('# MealScout Seed Dry-Run Review'), true);
    assert.equal(markdown.includes('Mutation allowed: false'), true);
    assert.equal(markdown.includes('Seed export checksum: sha256:'), true);
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

test('MealScout seed apply authorization defaults to dry-run and cannot mutate', () => {
  const seedExportContent = readGeneratedExportContent();
  const seedExportRows = JSON.parse(seedExportContent) as MealScoutSeedExportRow[];
  const copyAuditRows = readGeneratedCopyAudit();
  const checksum = computeMealScoutSeedExportChecksum(seedExportContent);
  const dryRunPlan = planMealScoutSeedImportReadiness({ seedExportRows, copyAuditRows });
  const artifact = buildMealScoutSeedImportDryRunReviewArtifact(dryRunPlan, '2026-06-07T00:00:00.000Z', checksum);

  const authorization = authorizeMealScoutSeedApply({
    seedExportRows,
    copyAuditRows,
    seedExportChecksum: checksum,
    dryRunReviewArtifact: artifact,
    postApplyReportPath: 'artifacts/mealscout-seed-import-readiness/batch001-post-apply-report.json'
  });

  assert.equal(authorization.status, 'blocked');
  assert.equal(authorization.mode, 'dry_run');
  assert.equal(authorization.mutationAllowed, false);
  assert.deepEqual(authorization.blockedReasons, ['allow_live_apply_required']);
  assert.equal(authorization.applyPlan.length, 0);
});

test('MealScout seed apply authorization requires allowLiveApply=true', () => {
  const seedExportContent = readGeneratedExportContent();
  const seedExportRows = JSON.parse(seedExportContent) as MealScoutSeedExportRow[];
  const copyAuditRows = readGeneratedCopyAudit();
  const checksum = computeMealScoutSeedExportChecksum(seedExportContent);
  const dryRunPlan = planMealScoutSeedImportReadiness({ seedExportRows, copyAuditRows });
  const artifact = buildMealScoutSeedImportDryRunReviewArtifact(dryRunPlan, '2026-06-07T00:00:00.000Z', checksum);

  const authorization = authorizeMealScoutSeedApply({
    seedExportRows,
    copyAuditRows,
    seedExportChecksum: checksum,
    dryRunReviewArtifact: artifact,
    allowLiveApply: false,
    postApplyReportPath: 'artifacts/mealscout-seed-import-readiness/batch001-post-apply-report.json'
  });

  assert.equal(authorization.status, 'blocked');
  assert.equal(authorization.blockedReasons.includes('allow_live_apply_required'), true);
  assert.equal(authorization.mutationAllowed, false);
});

test('MealScout seed apply authorization blocks missing review artifact', () => {
  const seedExportContent = readGeneratedExportContent();
  const authorization = authorizeMealScoutSeedApply({
    seedExportRows: JSON.parse(seedExportContent) as MealScoutSeedExportRow[],
    copyAuditRows: readGeneratedCopyAudit(),
    seedExportChecksum: computeMealScoutSeedExportChecksum(seedExportContent),
    allowLiveApply: true,
    postApplyReportPath: 'artifacts/mealscout-seed-import-readiness/batch001-post-apply-report.json'
  });

  assert.equal(authorization.status, 'blocked');
  assert.equal(authorization.blockedReasons.includes('dry_run_review_artifact_required'), true);
  assert.equal(authorization.mutationAllowed, false);
});

test('MealScout seed apply authorization blocks stale or mismatched review artifacts', () => {
  const seedExportContent = readGeneratedExportContent();
  const seedExportRows = JSON.parse(seedExportContent) as MealScoutSeedExportRow[];
  const copyAuditRows = readGeneratedCopyAudit();
  const checksum = computeMealScoutSeedExportChecksum(seedExportContent);
  const dryRunPlan = planMealScoutSeedImportReadiness({ seedExportRows, copyAuditRows });
  const staleArtifact = buildMealScoutSeedImportDryRunReviewArtifact(dryRunPlan, '2026-06-07T00:00:00.000Z', {
    algorithm: 'sha256',
    value: '0'.repeat(64)
  });

  const authorization = authorizeMealScoutSeedApply({
    seedExportRows,
    copyAuditRows,
    seedExportChecksum: checksum,
    dryRunReviewArtifact: staleArtifact,
    allowLiveApply: true,
    postApplyReportPath: 'artifacts/mealscout-seed-import-readiness/batch001-post-apply-report.json'
  });

  assert.equal(authorization.status, 'blocked');
  assert.equal(authorization.blockedReasons.includes('seed_export_checksum_mismatch'), true);
  assert.equal(authorization.mutationAllowed, false);
});

test('MealScout seed apply authorization reaches apply planning only with matching artifact and allow flag', () => {
  const seedExportContent = readGeneratedExportContent();
  const seedExportRows = JSON.parse(seedExportContent) as MealScoutSeedExportRow[];
  const copyAuditRows = readGeneratedCopyAudit();
  const checksum = computeMealScoutSeedExportChecksum(seedExportContent);
  const dryRunPlan = planMealScoutSeedImportReadiness({ seedExportRows, copyAuditRows });
  const artifact = buildMealScoutSeedImportDryRunReviewArtifact(dryRunPlan, '2026-06-07T00:00:00.000Z', checksum);

  const authorization = authorizeMealScoutSeedApply({
    seedExportRows,
    copyAuditRows,
    seedExportChecksum: checksum,
    dryRunReviewArtifact: artifact,
    allowLiveApply: true,
    postApplyReportPath: 'artifacts/mealscout-seed-import-readiness/batch001-post-apply-report.json'
  });

  assert.equal(authorization.status, 'authorized');
  assert.equal(authorization.mode, 'live_apply_authorized');
  assert.equal(authorization.mutationAllowed, true);
  assert.deepEqual(authorization.blockedReasons, []);
  assert.equal(authorization.applyPlan.length, 2);
  assert.equal(authorization.applyPlan.every((row) => row.provenance.source_batch_id === 'BATCH-001-MEALSCOUT-MERLIN-SEED'), true);
  assert.equal(authorization.applyPlan.every((row) => row.evidence_file_id === row.provenance.copied_evidence_file_id), true);
});

test('MealScout seed apply authorization requires post-apply report path before success', () => {
  const seedExportContent = readGeneratedExportContent();
  const seedExportRows = JSON.parse(seedExportContent) as MealScoutSeedExportRow[];
  const copyAuditRows = readGeneratedCopyAudit();
  const checksum = computeMealScoutSeedExportChecksum(seedExportContent);
  const dryRunPlan = planMealScoutSeedImportReadiness({ seedExportRows, copyAuditRows });
  const artifact = buildMealScoutSeedImportDryRunReviewArtifact(dryRunPlan, '2026-06-07T00:00:00.000Z', checksum);

  const authorization = authorizeMealScoutSeedApply({
    seedExportRows,
    copyAuditRows,
    seedExportChecksum: checksum,
    dryRunReviewArtifact: artifact,
    allowLiveApply: true
  });

  assert.equal(authorization.status, 'blocked');
  assert.equal(authorization.blockedReasons.includes('post_apply_report_path_required'), true);
  assert.equal(authorization.mutationAllowed, false);
  assert.equal(authorization.applyPlan.length, 0);
});

test('MealScout seed apply simulation writes report artifacts without live mutation', () => {
  const artifactDir = mkdtempSync(join(tmpdir(), 'mealscout-seed-simulation-'));
  try {
    const reviewOutput = execFileSync(
      process.execPath,
      ['node_modules/tsx/dist/cli.mjs', 'scripts/mealscout-seed-import-readiness.ts', '--artifact-dir', artifactDir],
      { encoding: 'utf8' }
    );
    const reviewSummary = JSON.parse(reviewOutput) as { seedExportChecksum: { value: string } };
    const simulationJsonPath = join(artifactDir, 'batch001-apply-simulation-report.json');
    const simulationMarkdownPath = join(artifactDir, 'batch001-apply-simulation-report.md');
    const simulationOutput = execFileSync(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        'scripts/mealscout-seed-import-readiness.ts',
        '--artifact-dir',
        artifactDir,
        '--simulate-apply',
        '--allow-live-apply',
        '--dry-run-review',
        join(artifactDir, 'batch001-dry-run-review.json'),
        '--apply-simulation-report-json',
        simulationJsonPath,
        '--apply-simulation-report-md',
        simulationMarkdownPath
      ],
      { encoding: 'utf8' }
    );
    const simulationSummary = JSON.parse(simulationOutput) as {
      applySimulation: {
        mutationExecuted: boolean;
        eligibleRowCount: number;
        blockedRowCount: number;
        artifacts: { json: string; markdown: string };
      };
    };
    const report = JSON.parse(readFileSync(simulationJsonPath, 'utf8')) as ReturnType<typeof buildMealScoutSeedApplySimulationReport>;
    const markdown = readFileSync(simulationMarkdownPath, 'utf8');

    assert.equal(existsSync(simulationJsonPath), true);
    assert.equal(existsSync(simulationMarkdownPath), true);
    assert.equal(simulationSummary.applySimulation.artifacts.json, simulationJsonPath);
    assert.equal(simulationSummary.applySimulation.artifacts.markdown, simulationMarkdownPath);
    assert.equal(report.mode, 'simulation');
    assert.equal(report.mutationExecuted, false);
    assert.equal(report.safetyStatus.no_live_mutation_executor_called, true);
    assert.equal(report.eligibleRowCount, 2);
    assert.equal(report.blockedRowCount, 0);
    assert.equal(report.rows.length, 2);
    assert.equal(report.seedExportChecksum.value, reviewSummary.seedExportChecksum.value);
    assert.equal(markdown.includes('# MealScout Seed Apply Simulation Report'), true);
    assert.equal(markdown.includes('Mutation executed: false'), true);
    assert.equal(markdown.includes('Post-apply status: simulated_noop'), true);
  } finally {
    rmSync(artifactDir, { recursive: true, force: true });
  }
});

test('MealScout seed apply simulation does not call a provided live mutation executor', () => {
  const seedExportContent = readGeneratedExportContent();
  const seedExportRows = JSON.parse(seedExportContent) as MealScoutSeedExportRow[];
  const copyAuditRows = readGeneratedCopyAudit();
  const checksum = computeMealScoutSeedExportChecksum(seedExportContent);
  const dryRunPlan = planMealScoutSeedImportReadiness({ seedExportRows, copyAuditRows });
  const artifact = buildMealScoutSeedImportDryRunReviewArtifact(dryRunPlan, '2026-06-07T00:00:00.000Z', checksum);
  const authorization = authorizeMealScoutSeedApply({
    seedExportRows,
    copyAuditRows,
    seedExportChecksum: checksum,
    dryRunReviewArtifact: artifact,
    allowLiveApply: true,
    postApplyReportPath: 'artifacts/mealscout-seed-import-readiness/batch001-apply-simulation-report.json'
  });
  let executorCalled = false;
  const report = simulateMealScoutSeedApply({
    authorization,
    generatedAt: '2026-06-07T00:00:00.000Z',
    liveMutationExecutor: () => {
      executorCalled = true;
    }
  });

  assert.equal(executorCalled, false);
  assert.equal(report.mutationExecuted, false);
  assert.equal(report.rows.every((row) => row.post_apply_status === 'simulated_noop'), true);
});

test('MealScout seed apply simulation is blocked by missing review artifact, stale checksum, or missing report path', () => {
  const seedExportContent = readGeneratedExportContent();
  const seedExportRows = JSON.parse(seedExportContent) as MealScoutSeedExportRow[];
  const copyAuditRows = readGeneratedCopyAudit();
  const checksum = computeMealScoutSeedExportChecksum(seedExportContent);
  const dryRunPlan = planMealScoutSeedImportReadiness({ seedExportRows, copyAuditRows });
  const staleArtifact = buildMealScoutSeedImportDryRunReviewArtifact(dryRunPlan, '2026-06-07T00:00:00.000Z', {
    algorithm: 'sha256',
    value: '1'.repeat(64)
  });
  const freshArtifact = buildMealScoutSeedImportDryRunReviewArtifact(dryRunPlan, '2026-06-07T00:00:00.000Z', checksum);

  const missingArtifact = authorizeMealScoutSeedApply({
    seedExportRows,
    copyAuditRows,
    seedExportChecksum: checksum,
    allowLiveApply: true,
    postApplyReportPath: 'artifacts/mealscout-seed-import-readiness/batch001-apply-simulation-report.json'
  });
  const stale = authorizeMealScoutSeedApply({
    seedExportRows,
    copyAuditRows,
    seedExportChecksum: checksum,
    dryRunReviewArtifact: staleArtifact,
    allowLiveApply: true,
    postApplyReportPath: 'artifacts/mealscout-seed-import-readiness/batch001-apply-simulation-report.json'
  });
  const missingReportPath = authorizeMealScoutSeedApply({
    seedExportRows,
    copyAuditRows,
    seedExportChecksum: checksum,
    dryRunReviewArtifact: freshArtifact,
    allowLiveApply: true
  });

  assert.equal(missingArtifact.blockedReasons.includes('dry_run_review_artifact_required'), true);
  assert.equal(stale.blockedReasons.includes('seed_export_checksum_mismatch'), true);
  assert.equal(missingReportPath.blockedReasons.includes('post_apply_report_path_required'), true);
  assert.equal(missingArtifact.mutationAllowed, false);
  assert.equal(stale.mutationAllowed, false);
  assert.equal(missingReportPath.mutationAllowed, false);
});

test('MealScout seed apply simulation report preserves row safety details', () => {
  const seedExportContent = readGeneratedExportContent();
  const seedExportRows = JSON.parse(seedExportContent) as MealScoutSeedExportRow[];
  const copyAuditRows = readGeneratedCopyAudit();
  const checksum = computeMealScoutSeedExportChecksum(seedExportContent);
  const dryRunPlan = planMealScoutSeedImportReadiness({ seedExportRows, copyAuditRows });
  const artifact = buildMealScoutSeedImportDryRunReviewArtifact(dryRunPlan, '2026-06-07T00:00:00.000Z', checksum);
  const authorization = authorizeMealScoutSeedApply({
    seedExportRows,
    copyAuditRows,
    seedExportChecksum: checksum,
    dryRunReviewArtifact: artifact,
    allowLiveApply: true,
    postApplyReportPath: 'artifacts/mealscout-seed-import-readiness/batch001-apply-simulation-report.json'
  });
  const report = buildMealScoutSeedApplySimulationReport(authorization, '2026-06-07T00:00:00.000Z');
  const markdown = renderMealScoutSeedApplySimulationMarkdown(report);

  assert.equal(report.rows.length, 2);
  assert.equal(report.rows.every((row) => row.simulated_action === 'create' || row.simulated_action === 'update'), true);
  assert.equal(report.rows.every((row) => row.evidence.copied_evidence_file_id), true);
  assert.equal(report.rows.every((row) => row.provenance.original_source_file_id), true);
  assert.equal(
    report.rows.every((row) => row.evidence.copied_evidence_file_id !== row.provenance.original_source_file_id),
    true
  );
  assert.equal(report.rows.every((row) => row.provenance.original_source_is_audit_only), true);
  assert.equal(report.rows.every((row) => !Object.prototype.hasOwnProperty.call(row.field_writes, 'email')), true);
  assert.equal(report.rows.every((row) => !Object.prototype.hasOwnProperty.call(row.field_writes, 'website')), true);
  assert.equal(report.rows.every((row) => row.omitted_fields.some((field) => field.field === 'email')), true);
  assert.equal(report.safetyStatus.blank_null_fields_omitted, true);
  assert.equal(markdown.includes('Omitted blank/null fields:'), true);
  assert.equal(markdown.includes('Copied evidence file ID:'), true);
  assert.equal(markdown.includes('Original source is audit-only provenance: true'), true);
});
