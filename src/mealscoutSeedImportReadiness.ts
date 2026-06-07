import type { MealScoutExistingProfile } from './mealscoutProfileImport.js';
import { createHash } from 'node:crypto';

export type MealScoutSeedExportRow = {
  export_schema_version?: string;
  brand_lane?: string;
  target_profile_type?: string;
  profile_action?: string;
  profile_name?: string | null;
  profile_email?: string | null;
  phone?: string | null;
  website?: string | null;
  socials?: {
    facebook?: string | null;
    instagram?: string | null;
  } | null;
  source_file_id?: string;
  source_file_name?: string;
  source_file_path?: string;
  source_refs?: string[];
  extracted_fields?: Record<string, unknown>;
  seeded_from_evidence?: boolean;
  profile_origin?: string;
  onboarding_source?: string;
  claim_status?: string;
  email_verified?: boolean;
  insurance_verified?: boolean;
  owner_user_id?: string | null;
  attribution_method?: string;
  submission_flow?: string;
  verification_email_status?: string;
  import_decision?: string;
};

export type MealScoutSeedCopyAuditRow = {
  batch_id?: string;
  source_file_id?: string;
  source_file_name?: string;
  copied_file_id?: string;
  destination_project?: string;
  destination_folder_name?: string;
  seed_action?: string;
  safety_gate?: string;
  copy_status?: string;
};

export type MealScoutSeedImportFieldWrites = Partial<{
  truckName: string;
  phone: string;
  email: string;
  website: string;
  cityArea: string;
  facebook: string;
  instagram: string;
}>;

export type MealScoutSeedImportOmittedField = {
  field: keyof MealScoutSeedImportFieldWrites;
  reason: 'blank_or_null';
};

export type MealScoutSeedImportPlanRow = {
  source_file_id: string;
  evidence_file_id: string;
  original_source_file_id?: string;
  source_file_name?: string;
  planned_action: 'create' | 'update';
  existing_profile_id?: string;
  existing_profile_name?: string;
  profile_name?: string;
  field_writes: MealScoutSeedImportFieldWrites;
  omitted_fields: MealScoutSeedImportOmittedField[];
  source_refs: string[];
  provenance: {
    copied_evidence_file_id: string;
    original_source_file_id?: string;
    source_batch_id: 'BATCH-001-MEALSCOUT-MERLIN-SEED';
    original_source_is_audit_only: true;
  };
  safety_notes: string[];
};

export type MealScoutSeedImportBlockedRow = {
  source_file_id?: string;
  source_file_name?: string;
  reason: string;
};

export type MealScoutSeedImportReadinessPlan = {
  status: 'ok';
  mode: 'dry_run' | 'live_apply_allowed';
  mutationAllowed: boolean;
  eligibleRowCount: number;
  blockedRowCount: number;
  plannedImports: MealScoutSeedImportPlanRow[];
  blockedRows: MealScoutSeedImportBlockedRow[];
  safetyRules: string[];
};

export type MealScoutSeedExportChecksum = {
  algorithm: 'sha256';
  value: string;
};

export type MealScoutSeedImportDryRunReviewArtifact = {
  batchId: 'BATCH-001-MEALSCOUT-MERLIN-SEED';
  generatedAt: string;
  status: 'ok';
  mode: 'dry_run';
  mutationAllowed: false;
  seedExportChecksum: MealScoutSeedExportChecksum;
  eligibleRowCount: number;
  blockedRowCount: number;
  plannedImports: Array<{
    source_file_name?: string;
    proposed_action: 'create' | 'update';
    matched_existing_profile?: {
      id: string;
      name?: string;
    };
    field_writes: MealScoutSeedImportFieldWrites;
    omitted_fields: MealScoutSeedImportOmittedField[];
    evidence: {
      copied_evidence_file_id: string;
    };
    provenance: {
      original_source_file_id?: string;
      original_source_is_audit_only: true;
    };
  }>;
  blockedRows: MealScoutSeedImportBlockedRow[];
  safetyStatus: {
    no_live_apply_path_ran: true;
    review_artifact_only: true;
    mutationAllowed: false;
  };
  safetyRules: string[];
};

export type MealScoutSeedApplyAuthorizationBlockedReason =
  | 'allow_live_apply_required'
  | 'dry_run_review_artifact_required'
  | 'dry_run_review_artifact_batch_mismatch'
  | 'dry_run_review_artifact_not_dry_run'
  | 'dry_run_review_artifact_checksum_missing'
  | 'seed_export_checksum_mismatch'
  | 'post_apply_report_path_required'
  | 'readiness_plan_has_blocked_rows';

export type MealScoutSeedApplyAuthorizationPlan = {
  status: 'authorized' | 'blocked';
  mode: 'dry_run' | 'live_apply_authorized';
  mutationAllowed: boolean;
  blockedReasons: MealScoutSeedApplyAuthorizationBlockedReason[];
  seedExportChecksum: MealScoutSeedExportChecksum;
  dryRunArtifactChecksum?: MealScoutSeedExportChecksum;
  postApplyReportPath?: string;
  readinessPlan: MealScoutSeedImportReadinessPlan;
  applyPlan: MealScoutSeedImportPlanRow[];
  safetyRules: string[];
};

export type MealScoutSeedApplySimulationReport = {
  batchId: 'BATCH-001-MEALSCOUT-MERLIN-SEED';
  generatedAt: string;
  status: 'simulated';
  mode: 'simulation';
  mutationExecuted: false;
  eligibleRowCount: number;
  blockedRowCount: number;
  seedExportChecksum: MealScoutSeedExportChecksum;
  authorization: {
    status: 'authorized';
    allowLiveApply: true;
    dryRunArtifactFresh: true;
    postApplyReportPath: string;
  };
  rows: Array<{
    source_file_name?: string;
    simulated_action: 'create' | 'update';
    matched_existing_profile?: {
      id: string;
      name?: string;
    };
    field_writes: MealScoutSeedImportFieldWrites;
    omitted_fields: MealScoutSeedImportOmittedField[];
    evidence: {
      copied_evidence_file_id: string;
    };
    provenance: {
      original_source_file_id?: string;
      original_source_is_audit_only: true;
    };
    post_apply_status: 'simulated_noop';
  }>;
  blockedRows: MealScoutSeedImportBlockedRow[];
  safetyStatus: {
    no_live_mutation_executor_called: true;
    mutationExecuted: false;
    copied_evidence_identity_preserved: true;
    original_source_audit_only: true;
    blank_null_fields_omitted: true;
  };
};

const SEED_BATCH_ID = 'BATCH-001-MEALSCOUT-MERLIN-SEED';
const IMPORT_FIELDS = ['truckName', 'phone', 'email', 'website', 'cityArea', 'facebook', 'instagram'] as const;

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizePhone(value: unknown): string {
  return typeof value === 'string' ? value.replace(/[^0-9]/g, '') : '';
}

function copiedBatch001ByEvidenceId(rows: MealScoutSeedCopyAuditRow[]): Map<string, MealScoutSeedCopyAuditRow> {
  const out = new Map<string, MealScoutSeedCopyAuditRow>();
  for (const row of rows) {
    if (
      row.batch_id === SEED_BATCH_ID &&
      row.copy_status === 'copied' &&
      row.seed_action === 'seed_to_merlin_evidence' &&
      row.safety_gate === 'merlin_export_contract_required' &&
      cleanString(row.copied_file_id)
    ) {
      out.set(row.copied_file_id as string, row);
    }
  }
  return out;
}

function extractedString(row: MealScoutSeedExportRow, key: string): string | undefined {
  return cleanString(row.extracted_fields?.[key]);
}

function fieldWritesFromRow(row: MealScoutSeedExportRow): MealScoutSeedImportFieldWrites {
  const writes: MealScoutSeedImportFieldWrites = {};
  const truckName = cleanString(row.profile_name) || extractedString(row, 'truckName');
  const phone = cleanString(row.phone) || extractedString(row, 'phone');
  const email = cleanString(row.profile_email) || extractedString(row, 'email');
  const website = cleanString(row.website) || extractedString(row, 'website');
  const cityArea = extractedString(row, 'cityArea');
  const facebook = cleanString(row.socials?.facebook) || extractedString(row, 'facebook');
  const instagram = cleanString(row.socials?.instagram) || extractedString(row, 'instagram');

  if (truckName) writes.truckName = truckName;
  if (phone) writes.phone = phone;
  if (email) writes.email = email;
  if (website) writes.website = website;
  if (cityArea) writes.cityArea = cityArea;
  if (facebook) writes.facebook = facebook;
  if (instagram) writes.instagram = instagram;
  return writes;
}

function omittedFieldsFromRow(row: MealScoutSeedExportRow): MealScoutSeedImportOmittedField[] {
  const writes = fieldWritesFromRow(row);
  return IMPORT_FIELDS.filter((field) => writes[field] === undefined).map((field) => ({
    field,
    reason: 'blank_or_null'
  }));
}

function findExistingProfile(
  writes: MealScoutSeedImportFieldWrites,
  existingProfiles: MealScoutExistingProfile[]
): MealScoutExistingProfile | undefined {
  const email = normalizeText(writes.email);
  const phone = normalizePhone(writes.phone);
  const name = normalizeText(writes.truckName);
  return existingProfiles.find((profile) => {
    if (email && normalizeText(profile.email) === email) return true;
    if (phone && normalizePhone(profile.phone) === phone) return true;
    return Boolean(name && normalizeText(profile.truckName) === name);
  });
}

function validateExportRow(row: MealScoutSeedExportRow, copiedRows: Map<string, MealScoutSeedCopyAuditRow>): string | undefined {
  if (row.export_schema_version !== 'merlin_profile_seed_export_v1') return 'unsupported_seed_export_schema';
  if (row.brand_lane !== 'MEALSCOUT') return 'non_mealscout_row_not_importable';
  if (row.target_profile_type !== 'food_truck') return 'non_food_truck_row_not_importable';
  if (row.import_decision !== 'importable') return 'row_not_marked_importable';
  if (row.seeded_from_evidence !== true || row.profile_origin !== 'evidence_seed') return 'not_evidence_seed_export_row';
  if (row.claim_status !== 'unclaimed' || row.email_verified !== false || row.insurance_verified !== false || row.owner_user_id !== null) {
    return 'unsafe_profile_verification_or_claim_state';
  }
  const evidenceFileId = cleanString(row.source_file_id);
  if (!evidenceFileId) return 'missing_copied_evidence_file_id';
  if (!copiedRows.has(evidenceFileId)) return 'source_file_id_not_copied_batch001_evidence';
  if (!Array.isArray(row.source_refs) || !row.source_refs.includes(evidenceFileId)) return 'source_refs_must_include_copied_evidence_file_id';
  return undefined;
}

export function computeMealScoutSeedExportChecksum(seedExportContent: string): MealScoutSeedExportChecksum {
  return {
    algorithm: 'sha256',
    value: createHash('sha256').update(seedExportContent, 'utf8').digest('hex')
  };
}

export function planMealScoutSeedImportReadiness(input: {
  seedExportRows: MealScoutSeedExportRow[];
  copyAuditRows: MealScoutSeedCopyAuditRow[];
  existingProfiles?: MealScoutExistingProfile[];
  allowLiveApply?: boolean;
}): MealScoutSeedImportReadinessPlan {
  const copiedRows = copiedBatch001ByEvidenceId(input.copyAuditRows);
  const existingProfiles = input.existingProfiles || [];
  const plannedImports: MealScoutSeedImportPlanRow[] = [];
  const blockedRows: MealScoutSeedImportBlockedRow[] = [];

  for (const row of input.seedExportRows) {
    const reason = validateExportRow(row, copiedRows);
    if (reason) {
      blockedRows.push({ source_file_id: row.source_file_id, source_file_name: row.source_file_name, reason });
      continue;
    }

    const evidenceFileId = row.source_file_id as string;
    const copyAudit = copiedRows.get(evidenceFileId);
    const writes = fieldWritesFromRow(row);
    const existing = findExistingProfile(writes, existingProfiles);

    plannedImports.push({
      source_file_id: evidenceFileId,
      evidence_file_id: evidenceFileId,
      original_source_file_id: copyAudit?.source_file_id,
      source_file_name: row.source_file_name,
      planned_action: existing ? 'update' : 'create',
      existing_profile_id: existing?.id,
      existing_profile_name: existing?.truckName,
      profile_name: writes.truckName,
      field_writes: writes,
      omitted_fields: omittedFieldsFromRow(row),
      source_refs: Array.from(new Set(row.source_refs || [evidenceFileId])),
      provenance: {
        copied_evidence_file_id: evidenceFileId,
        original_source_file_id: copyAudit?.source_file_id,
        source_batch_id: SEED_BATCH_ID,
        original_source_is_audit_only: true
      },
      safety_notes: [
        'dry-run preview by default',
        'copied evidence file id is the import evidence identity',
        'original source file id is provenance only',
        'blank export fields are omitted from field writes'
      ]
    });
  }

  return {
    status: 'ok',
    mode: input.allowLiveApply === true ? 'live_apply_allowed' : 'dry_run',
    mutationAllowed: input.allowLiveApply === true,
    eligibleRowCount: plannedImports.length,
    blockedRowCount: blockedRows.length,
    plannedImports,
    blockedRows,
    safetyRules: [
      'only copied BATCH-001-MEALSCOUT-MERLIN-SEED rows are eligible',
      'source_file_id is treated as copied evidence_file_id',
      'copy audit source_file_id is preserved as original_source_file_id provenance only',
      'existing profile matches are staged as update',
      'blank and null export values are not included in field writes',
      'dry-run is the default mode',
      'live apply requires allowLiveApply=true'
    ]
  };
}

export function buildMealScoutSeedImportDryRunReviewArtifact(
  plan: MealScoutSeedImportReadinessPlan,
  generatedAt: string = new Date().toISOString(),
  seedExportChecksum: MealScoutSeedExportChecksum = computeMealScoutSeedExportChecksum(JSON.stringify(plan.plannedImports))
): MealScoutSeedImportDryRunReviewArtifact {
  return {
    batchId: SEED_BATCH_ID,
    generatedAt,
    status: plan.status,
    mode: 'dry_run',
    mutationAllowed: false,
    seedExportChecksum,
    eligibleRowCount: plan.eligibleRowCount,
    blockedRowCount: plan.blockedRowCount,
    plannedImports: plan.plannedImports.map((row) => ({
      source_file_name: row.source_file_name,
      proposed_action: row.planned_action,
      matched_existing_profile: row.existing_profile_id
        ? {
            id: row.existing_profile_id,
            name: row.existing_profile_name
          }
        : undefined,
      field_writes: row.field_writes,
      omitted_fields: row.omitted_fields,
      evidence: {
        copied_evidence_file_id: row.evidence_file_id
      },
      provenance: {
        original_source_file_id: row.original_source_file_id,
        original_source_is_audit_only: true
      }
    })),
    blockedRows: plan.blockedRows,
    safetyStatus: {
      no_live_apply_path_ran: true,
      review_artifact_only: true,
      mutationAllowed: false
    },
    safetyRules: plan.safetyRules
  };
}

export function authorizeMealScoutSeedApply(input: {
  seedExportRows: MealScoutSeedExportRow[];
  copyAuditRows: MealScoutSeedCopyAuditRow[];
  seedExportChecksum: MealScoutSeedExportChecksum;
  dryRunReviewArtifact?: MealScoutSeedImportDryRunReviewArtifact;
  existingProfiles?: MealScoutExistingProfile[];
  allowLiveApply?: boolean;
  postApplyReportPath?: string;
}): MealScoutSeedApplyAuthorizationPlan {
  const readinessPlan = planMealScoutSeedImportReadiness({
    seedExportRows: input.seedExportRows,
    copyAuditRows: input.copyAuditRows,
    existingProfiles: input.existingProfiles
  });
  const blockedReasons: MealScoutSeedApplyAuthorizationBlockedReason[] = [];
  const artifact = input.dryRunReviewArtifact;

  if (input.allowLiveApply !== true) blockedReasons.push('allow_live_apply_required');
  if (!artifact) {
    blockedReasons.push('dry_run_review_artifact_required');
  } else {
    if (artifact.batchId !== SEED_BATCH_ID) blockedReasons.push('dry_run_review_artifact_batch_mismatch');
    if (artifact.mode !== 'dry_run' || artifact.mutationAllowed !== false) blockedReasons.push('dry_run_review_artifact_not_dry_run');
    if (!artifact.seedExportChecksum?.value) blockedReasons.push('dry_run_review_artifact_checksum_missing');
    else if (
      artifact.seedExportChecksum.algorithm !== input.seedExportChecksum.algorithm ||
      artifact.seedExportChecksum.value !== input.seedExportChecksum.value
    ) {
      blockedReasons.push('seed_export_checksum_mismatch');
    }
  }
  if (!cleanString(input.postApplyReportPath)) blockedReasons.push('post_apply_report_path_required');
  if (readinessPlan.blockedRowCount > 0) blockedReasons.push('readiness_plan_has_blocked_rows');

  const authorized = blockedReasons.length === 0;
  return {
    status: authorized ? 'authorized' : 'blocked',
    mode: authorized ? 'live_apply_authorized' : 'dry_run',
    mutationAllowed: authorized,
    blockedReasons,
    seedExportChecksum: input.seedExportChecksum,
    dryRunArtifactChecksum: artifact?.seedExportChecksum,
    postApplyReportPath: cleanString(input.postApplyReportPath),
    readinessPlan,
    applyPlan: authorized ? readinessPlan.plannedImports : [],
    safetyRules: [
      'default behavior is dry-run only',
      'live apply requires allowLiveApply=true',
      'live apply requires an existing dry-run review artifact',
      'seed export checksum must match the dry-run artifact checksum',
      'only BATCH-001-MEALSCOUT-MERLIN-SEED rows are eligible',
      'copied evidence file id remains the import evidence identity',
      'original source file id remains audit-only provenance',
      'blank and null export values cannot overwrite populated profile fields',
      'post-apply report path is required before apply success',
      'no live mutation is executed by the authorization planner'
    ]
  };
}

export function buildMealScoutSeedApplySimulationReport(
  authorization: MealScoutSeedApplyAuthorizationPlan,
  generatedAt: string = new Date().toISOString()
): MealScoutSeedApplySimulationReport {
  if (authorization.status !== 'authorized' || !authorization.postApplyReportPath) {
    throw new Error('mealscout_seed_apply_simulation_requires_authorized_plan');
  }
  return {
    batchId: SEED_BATCH_ID,
    generatedAt,
    status: 'simulated',
    mode: 'simulation',
    mutationExecuted: false,
    eligibleRowCount: authorization.readinessPlan.eligibleRowCount,
    blockedRowCount: authorization.readinessPlan.blockedRowCount,
    seedExportChecksum: authorization.seedExportChecksum,
    authorization: {
      status: 'authorized',
      allowLiveApply: true,
      dryRunArtifactFresh: true,
      postApplyReportPath: authorization.postApplyReportPath
    },
    rows: authorization.applyPlan.map((row) => ({
      source_file_name: row.source_file_name,
      simulated_action: row.planned_action,
      matched_existing_profile: row.existing_profile_id
        ? {
            id: row.existing_profile_id,
            name: row.existing_profile_name
          }
        : undefined,
      field_writes: row.field_writes,
      omitted_fields: row.omitted_fields,
      evidence: {
        copied_evidence_file_id: row.evidence_file_id
      },
      provenance: {
        original_source_file_id: row.original_source_file_id,
        original_source_is_audit_only: true
      },
      post_apply_status: 'simulated_noop'
    })),
    blockedRows: authorization.readinessPlan.blockedRows,
    safetyStatus: {
      no_live_mutation_executor_called: true,
      mutationExecuted: false,
      copied_evidence_identity_preserved: true,
      original_source_audit_only: true,
      blank_null_fields_omitted: true
    }
  };
}

export function simulateMealScoutSeedApply(input: {
  authorization: MealScoutSeedApplyAuthorizationPlan;
  generatedAt?: string;
  liveMutationExecutor?: (rows: MealScoutSeedImportPlanRow[]) => unknown;
}): MealScoutSeedApplySimulationReport {
  return buildMealScoutSeedApplySimulationReport(input.authorization, input.generatedAt);
}

function formatFieldWrites(writes: MealScoutSeedImportFieldWrites): string {
  const entries = Object.entries(writes);
  if (entries.length === 0) return '- none';
  return entries.map(([field, value]) => `- ${field}: ${value}`).join('\n');
}

function formatOmittedFields(fields: MealScoutSeedImportOmittedField[]): string {
  if (fields.length === 0) return '- none';
  return fields.map((field) => `- ${field.field}: ${field.reason}`).join('\n');
}

export function renderMealScoutSeedImportDryRunReviewMarkdown(
  artifact: MealScoutSeedImportDryRunReviewArtifact
): string {
  const lines: string[] = [
    '# MealScout Seed Dry-Run Review',
    '',
    '## Summary',
    '',
    `- Batch ID: ${artifact.batchId}`,
    `- Run mode: ${artifact.mode}`,
    `- Mutation allowed: ${artifact.mutationAllowed}`,
    `- Seed export checksum: ${artifact.seedExportChecksum.algorithm}:${artifact.seedExportChecksum.value}`,
    `- Eligible row count: ${artifact.eligibleRowCount}`,
    `- Blocked row count: ${artifact.blockedRowCount}`,
    `- No live apply path ran: ${artifact.safetyStatus.no_live_apply_path_ran}`,
    '',
    '## Planned Imports'
  ];

  artifact.plannedImports.forEach((row, index) => {
    lines.push(
      '',
      `### Row ${index + 1}: ${row.source_file_name || row.evidence.copied_evidence_file_id}`,
      '',
      `- Proposed action: ${row.proposed_action}`,
      `- Matched existing profile: ${
        row.matched_existing_profile
          ? `${row.matched_existing_profile.id}${row.matched_existing_profile.name ? ` (${row.matched_existing_profile.name})` : ''}`
          : 'none'
      }`,
      `- Copied evidence file ID: ${row.evidence.copied_evidence_file_id}`,
      `- Original source file ID: ${row.provenance.original_source_file_id || 'unknown'}`,
      `- Original source is audit-only provenance: ${row.provenance.original_source_is_audit_only}`,
      '',
      'Field writes:',
      '',
      formatFieldWrites(row.field_writes),
      '',
      'Omitted blank/null fields:',
      '',
      formatOmittedFields(row.omitted_fields)
    );
  });

  lines.push('', '## Blocked Rows');
  if (artifact.blockedRows.length === 0) {
    lines.push('', '- none');
  } else {
    for (const row of artifact.blockedRows) {
      lines.push('', `- ${row.source_file_name || row.source_file_id || 'unknown'}: ${row.reason}`);
    }
  }

  lines.push(
    '',
    '## Safety Status',
    '',
    '- Report generated from dry-run readiness plan only.',
    '- No live import or apply path was executed.',
    '- mutationAllowed: false'
  );

  return `${lines.join('\n')}\n`;
}

export function renderMealScoutSeedApplySimulationMarkdown(report: MealScoutSeedApplySimulationReport): string {
  const lines: string[] = [
    '# MealScout Seed Apply Simulation Report',
    '',
    '## Summary',
    '',
    `- Batch ID: ${report.batchId}`,
    `- Run mode: ${report.mode}`,
    `- Mutation executed: ${report.mutationExecuted}`,
    `- Eligible row count: ${report.eligibleRowCount}`,
    `- Blocked row count: ${report.blockedRowCount}`,
    `- Seed export checksum: ${report.seedExportChecksum.algorithm}:${report.seedExportChecksum.value}`,
    '',
    '## Simulated Rows'
  ];

  report.rows.forEach((row, index) => {
    lines.push(
      '',
      `### Row ${index + 1}: ${row.source_file_name || row.evidence.copied_evidence_file_id}`,
      '',
      `- Simulated action: ${row.simulated_action}`,
      `- Post-apply status: ${row.post_apply_status}`,
      `- Matched existing profile: ${
        row.matched_existing_profile
          ? `${row.matched_existing_profile.id}${row.matched_existing_profile.name ? ` (${row.matched_existing_profile.name})` : ''}`
          : 'none'
      }`,
      `- Copied evidence file ID: ${row.evidence.copied_evidence_file_id}`,
      `- Original source file ID: ${row.provenance.original_source_file_id || 'unknown'}`,
      `- Original source is audit-only provenance: ${row.provenance.original_source_is_audit_only}`,
      '',
      'Field writes:',
      '',
      formatFieldWrites(row.field_writes),
      '',
      'Omitted blank/null fields:',
      '',
      formatOmittedFields(row.omitted_fields)
    );
  });

  lines.push(
    '',
    '## Safety Status',
    '',
    `- No live mutation executor called: ${report.safetyStatus.no_live_mutation_executor_called}`,
    `- Mutation executed: ${report.safetyStatus.mutationExecuted}`,
    `- Copied evidence identity preserved: ${report.safetyStatus.copied_evidence_identity_preserved}`,
    `- Original source audit-only: ${report.safetyStatus.original_source_audit_only}`,
    `- Blank/null fields omitted: ${report.safetyStatus.blank_null_fields_omitted}`
  );

  return `${lines.join('\n')}\n`;
}
