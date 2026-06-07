import type { MealScoutExistingProfile } from './mealscoutProfileImport.js';

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

export type MealScoutSeedImportPlanRow = {
  source_file_id: string;
  evidence_file_id: string;
  original_source_file_id?: string;
  source_file_name?: string;
  planned_action: 'create' | 'update';
  existing_profile_id?: string;
  profile_name?: string;
  field_writes: MealScoutSeedImportFieldWrites;
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

const SEED_BATCH_ID = 'BATCH-001-MEALSCOUT-MERLIN-SEED';

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
      profile_name: writes.truckName,
      field_writes: writes,
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
