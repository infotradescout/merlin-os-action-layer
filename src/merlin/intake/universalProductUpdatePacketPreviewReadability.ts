import type {
  MerlinPacketEvidenceReference,
  MerlinRequiredVerificationStep
} from './universalProductUpdatePacket.js';

export type MerlinUniversalPacketPreviewNextRequiredAction =
  | 'review_only'
  | 'product_preview_required'
  | 'unsupported_packet_review_required'
  | 'invalid_packet_review_required';

export type ReadabilityFields = {
  displayTitle: string;
  operatorSummary: string;
  updateTypeLabel: string;
  targetDisplay: string;
  evidenceSummary: string;
  missingFieldSummary: string;
  verificationSummary: string;
  safetySummary: string;
  applyStatusLabel: 'Preview only — no production apply';
  nextRequiredAction: MerlinUniversalPacketPreviewNextRequiredAction;
};

type SupportedPreviewReadabilityInput = {
  kind: 'universal_product_update_packet_preview';
  status: 'supported';
  targetProduct: 'MealScout';
  targetBusinessName: string;
  targetProfileId: string | null;
  updateType: 'menu_update' | 'logo_update' | 'schedule_update';
  sourceEvidenceReferences: MerlinPacketEvidenceReference[];
  sourceFolderReference?: string;
  extractedStructuredData: Record<string, unknown>;
  missingFields: string[];
  confidence: number;
  requiredVerificationSteps: MerlinRequiredVerificationStep[];
  safetyFlags: string[];
  ownerSubmittedEquivalent: boolean;
  productionApplied: false;
  mutationAllowed: false;
  implementationAllowed: false;
  applyEligible: false;
};

type UnsupportedPreviewReadabilityInput = {
  kind: 'universal_product_update_packet_preview';
  status: 'unsupported';
  reason: 'invalid_universal_product_update_packet' | 'unsupported_target_product_or_update_type';
  targetProduct?: string;
  targetBusinessName?: string;
  targetProfileId?: string | null;
  updateType?: string;
  sourceEvidenceReferences: MerlinPacketEvidenceReference[];
  sourceFolderReference?: string;
  mutationAllowed: false;
  implementationAllowed: false;
  applyEligible: false;
  productionApplied: false;
};

type PreviewReadabilityInput = SupportedPreviewReadabilityInput | UnsupportedPreviewReadabilityInput;

const APPLY_STATUS_LABEL = 'Preview only — no production apply';

function formatCountLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatEvidenceSummary(
  evidenceReferences: MerlinPacketEvidenceReference[],
  sourceFolderReference?: string
): string {
  if (evidenceReferences.length === 0) {
    return 'No source evidence references were attached to this preview.';
  }

  const fileNames = evidenceReferences.slice(0, 3).map((reference) => reference.sourceFileName);
  const countLabel = formatCountLabel(evidenceReferences.length, 'evidence file', 'evidence files');
  const fileSummary = fileNames.join(', ');
  const truncated = evidenceReferences.length > fileNames.length ? ', ...' : '';
  const folderSummary = sourceFolderReference ? ` in folder ${sourceFolderReference}` : '';
  return `${countLabel}${folderSummary}: ${fileSummary}${truncated}`;
}

function humanizeMissingField(field: string): string {
  switch (field) {
    case 'menu.items.price':
      return 'menu item prices';
    case 'schedule.entries.date':
      return 'schedule dates';
    case 'schedule.entries.startTime':
      return 'schedule start times';
    case 'schedule.entries.endTime':
      return 'schedule end times';
    case 'schedule.entries.timezone':
      return 'schedule timezones';
    case 'schedule.entries.address':
      return 'schedule addresses';
    case 'logo.sourceEvidence.mediaTypeReview':
      return 'logo media type review';
    default:
      return field;
  }
}

function formatMissingFieldSummary(missingFields: string[]): string {
  if (missingFields.length === 0) {
    return 'No missing structured fields in preview.';
  }

  const labels = Array.from(new Set(missingFields.map(humanizeMissingField)));
  return `Missing fields require review: ${labels.join(', ')}`;
}

function humanizeVerificationStep(step: MerlinRequiredVerificationStep): string {
  switch (step) {
    case 'no_fake_prices':
      return 'do not invent prices';
    case 'no_fake_schedules':
      return 'do not invent schedules';
    case 'no_media_apply_without_review':
      return 'do not apply media without review';
    case 'no_inferred_recurring_schedule':
      return 'do not infer recurring schedules';
    case 'preview_before_apply':
      return 'preview before any apply';
    case 'exact_target_id_required_for_production_apply':
      return 'require exact target id before production apply';
    case 'fail_closed_on_ambiguous_target':
      return 'fail closed on ambiguous target';
    case 'owner_or_operator_must_verify_missing_prices':
      return 'verify missing prices with owner or operator';
    case 'recurring_schedule_must_be_explicit':
      return 'require explicit recurring schedule evidence';
    case 'timezone_must_be_explicit':
      return 'require explicit timezone evidence';
    case 'preserve_source_evidence':
      return 'preserve source evidence';
    default:
      return step;
  }
}

function formatVerificationSummary(requiredVerificationSteps: MerlinRequiredVerificationStep[]): string {
  if (requiredVerificationSteps.length === 0) {
    return 'No explicit verification steps were attached to this preview.';
  }

  return `Verification: ${requiredVerificationSteps.map(humanizeVerificationStep).join('; ')}`;
}

function humanizeSafetyFlag(flag: string): string {
  switch (flag) {
    case 'preserve_source_evidence':
      return 'preserve source evidence';
    case 'missing_menu_prices':
      return 'missing menu prices';
    case 'missing_schedule_fields':
      return 'missing schedule fields';
    case 'no_inferred_recurring_schedule':
      return 'no inferred recurring schedule';
    case 'ambiguous_target':
      return 'ambiguous target';
    case 'ambiguous_logo_media_type':
      return 'ambiguous logo media type';
    default:
      return flag;
  }
}

function formatSafetySummary(input: {
  status: PreviewReadabilityInput['status'];
  reason?: string;
  updateType?: string;
  safetyFlags?: string[];
}): string {
  if (input.status === 'unsupported') {
    if (input.reason === 'invalid_universal_product_update_packet') {
      return 'Fail-closed preview: invalid universal product update packet JSON. Hold for operator review.';
    }
    return 'Fail-closed preview: unsupported packet type. Hold for operator review.';
  }

  const flags = input.safetyFlags || [];
  const labels = flags.map(humanizeSafetyFlag);

  if (input.updateType === 'logo_update') {
    labels.push('logo or media evidence requires manual review before any future apply');
  }

  if (labels.length === 0) {
    return 'No additional safety flags were attached to this preview.';
  }

  return `Safety: ${Array.from(new Set(labels)).join('; ')}`;
}

function formatTargetDisplay(targetBusinessName?: string, targetProfileId?: string | null): string {
  if (!targetBusinessName && !targetProfileId) {
    return 'Unknown MealScout target';
  }
  if (targetBusinessName && targetProfileId) {
    return `${targetBusinessName} (${targetProfileId})`;
  }
  return targetBusinessName || targetProfileId || 'Unknown MealScout target';
}

function getUpdateTypeLabel(preview: PreviewReadabilityInput): string {
  if (preview.status === 'unsupported') {
    return preview.reason === 'invalid_universal_product_update_packet'
      ? 'Invalid MealScout packet preview'
      : 'Unsupported MealScout packet preview';
  }

  switch (preview.updateType) {
    case 'menu_update':
      return 'MealScout menu preview';
    case 'logo_update':
      return 'MealScout logo preview';
    case 'schedule_update':
      return 'MealScout schedule preview';
    default:
      return 'MealScout packet preview';
  }
}

function formatRecurrence(value: unknown): string {
  switch (value) {
    case 'explicit_recurring':
      return 'explicit recurring';
    case 'current_week_only':
      return 'current week only';
    case 'unknown':
      return 'unknown recurrence';
    default:
      return 'unspecified recurrence';
  }
}

function formatScheduleOperatorSummary(
  preview: SupportedPreviewReadabilityInput & { updateType: 'schedule_update' }
): string {
  const entries = Array.isArray((preview.extractedStructuredData as { schedule?: unknown[] }).schedule)
    ? ((preview.extractedStructuredData as { schedule: Array<Record<string, unknown>> }).schedule)
    : [];
  const firstEntry = entries[0];
  const recurrence = formatRecurrence(firstEntry?.recurrence);
  const timezone = typeof firstEntry?.timezone === 'string' ? firstEntry.timezone : 'timezone missing';
  const mapEligible = firstEntry?.mapEligible === true ? 'map eligible' : 'not map eligible';
  const liveFeedEligible = firstEntry?.liveFeedEligible === true ? 'live-feed eligible' : 'not live-feed eligible';
  return `MealScout schedule preview for ${preview.targetBusinessName} with ${recurrence}, ${timezone}, ${mapEligible}, and ${liveFeedEligible}.`;
}

function formatSupportedOperatorSummary(
  preview: SupportedPreviewReadabilityInput
): string {
  switch (preview.updateType) {
    case 'menu_update':
      return preview.missingFields.includes('menu.items.price')
        ? `MealScout menu preview for ${preview.targetBusinessName} with missing menu prices that require operator review.`
        : `MealScout menu preview for ${preview.targetBusinessName} with structured menu data ready for review.`;
    case 'logo_update':
      return `MealScout logo preview for ${preview.targetBusinessName} backed by ${formatCountLabel(preview.sourceEvidenceReferences.length, 'source file', 'source files')}. Media evidence review is required before any future apply.`;
    case 'schedule_update':
      return formatScheduleOperatorSummary(preview as SupportedPreviewReadabilityInput & { updateType: 'schedule_update' });
    default:
      return `MealScout packet preview for ${preview.targetBusinessName}.`;
  }
}

function buildSupportedReadability(
  preview: SupportedPreviewReadabilityInput
): ReadabilityFields {
  return {
    displayTitle: `${getUpdateTypeLabel(preview)} - ${preview.targetBusinessName}`,
    operatorSummary: formatSupportedOperatorSummary(preview),
    updateTypeLabel: getUpdateTypeLabel(preview),
    targetDisplay: formatTargetDisplay(preview.targetBusinessName, preview.targetProfileId),
    evidenceSummary: formatEvidenceSummary(preview.sourceEvidenceReferences, preview.sourceFolderReference),
    missingFieldSummary: formatMissingFieldSummary(preview.missingFields),
    verificationSummary: formatVerificationSummary(preview.requiredVerificationSteps),
    safetySummary: formatSafetySummary({
      status: preview.status,
      updateType: preview.updateType,
      safetyFlags: preview.safetyFlags
    }),
    applyStatusLabel: APPLY_STATUS_LABEL,
    nextRequiredAction: 'review_only'
  };
}

function buildUnsupportedReadability(
  preview: UnsupportedPreviewReadabilityInput
): ReadabilityFields {
  const invalid = preview.reason === 'invalid_universal_product_update_packet';
  return {
    displayTitle: invalid ? 'Invalid MealScout packet preview - hold' : 'Unsupported MealScout packet preview - hold',
    operatorSummary: invalid
      ? 'Structured packet JSON is invalid. Preview is fail-closed and requires operator review.'
      : 'Packet type is unsupported for MealScout preview. Preview is fail-closed and requires operator review.',
    updateTypeLabel: getUpdateTypeLabel(preview),
    targetDisplay: formatTargetDisplay(preview.targetBusinessName, preview.targetProfileId),
    evidenceSummary: formatEvidenceSummary(preview.sourceEvidenceReferences, preview.sourceFolderReference),
    missingFieldSummary: invalid
      ? 'Structured packet fields are incomplete or malformed.'
      : 'Packet type is outside the supported MealScout preview set.',
    verificationSummary: invalid
      ? 'Verification: inspect structured packet JSON before reuse.'
      : 'Verification: confirm whether the packet should remain held outside this preview path.',
    safetySummary: formatSafetySummary({ status: preview.status, reason: preview.reason }),
    applyStatusLabel: APPLY_STATUS_LABEL,
    nextRequiredAction: invalid ? 'invalid_packet_review_required' : 'unsupported_packet_review_required'
  };
}

export function buildUniversalProductUpdatePacketPreviewReadability(
  preview: PreviewReadabilityInput
): ReadabilityFields {
  if (preview.status === 'unsupported') {
    return buildUnsupportedReadability(preview);
  }

  return buildSupportedReadability(preview);
}
