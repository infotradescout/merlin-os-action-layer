import { randomUUID } from 'node:crypto';

export type MealScoutCorrectionAction =
  | 'confirm_field'
  | 'reject_field'
  | 'remove_field'
  | 'replace_field'
  | 'add_field_with_evidence_note';

export type MealScoutFieldCorrectionRecord = {
  correctionId: string;
  recordId: string;
  draftIds: string[];
  fieldName: string;
  action: MealScoutCorrectionAction;
  originalValue?: string;
  correctedValue?: string;
  reason: string;
  evidenceRef?: string;
  sourceFileId?: string;
  operatorId?: string;
  correctedAt: string;
  attribution?: {
    attributionSource?: 'drive_metadata' | 'request_context' | 'unknown';
    repId?: string;
    affiliateCode?: string;
    sourceChannel?: 'drive_upload' | 'manual_upload' | 'admin_import';
  };
  mutationAllowed: false;
};

const corrections = new Map<string, MealScoutFieldCorrectionRecord>();
let correctionVersion = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

export function listMealScoutFieldCorrections(filters?: {
  recordId?: string;
  draftId?: string;
}): MealScoutFieldCorrectionRecord[] {
  return Array.from(corrections.values())
    .filter((row) => {
      if (filters?.recordId && row.recordId !== filters.recordId) return false;
      if (filters?.draftId && !row.draftIds.includes(filters.draftId)) return false;
      return true;
    })
    .sort((a, b) => b.correctedAt.localeCompare(a.correctedAt));
}

export function createMealScoutFieldCorrection(input: {
  recordId: string;
  draftIds?: string[];
  fieldName: string;
  action: MealScoutCorrectionAction;
  originalValue?: string;
  correctedValue?: string;
  reason?: string;
  evidenceRef?: string;
  sourceFileId?: string;
  operatorId?: string;
  attribution?: MealScoutFieldCorrectionRecord['attribution'];
}): MealScoutFieldCorrectionRecord {
  const row: MealScoutFieldCorrectionRecord = {
    correctionId: `ms-correction-${randomUUID()}`,
    recordId: input.recordId.trim(),
    draftIds: uniq(input.draftIds || []),
    fieldName: input.fieldName.trim(),
    action: input.action,
    originalValue: input.originalValue?.trim() || undefined,
    correctedValue: input.correctedValue?.trim() || undefined,
    reason: input.reason?.trim() || 'operator_correction',
    evidenceRef: input.evidenceRef?.trim() || undefined,
    sourceFileId: input.sourceFileId?.trim() || undefined,
    operatorId: input.operatorId?.trim() || undefined,
    correctedAt: nowIso(),
    attribution: input.attribution,
    mutationAllowed: false
  };
  corrections.set(row.correctionId, row);
  correctionVersion += 1;
  return row;
}

export function getMealScoutFieldCorrectionVersion(): number {
  return correctionVersion;
}

export function resetMealScoutFieldCorrectionsForTest(): void {
  corrections.clear();
  correctionVersion = 0;
}

