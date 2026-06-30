import type {
  MerlinPacketEvidenceReference,
  MerlinRequiredVerificationStep,
  MerlinUniversalProductUpdatePacket,
  MerlinUniversalUpdateType
} from './universalProductUpdatePacket.js';
import {
  buildUniversalProductUpdatePacketPreviewReadability,
  type MerlinUniversalPacketPreviewNextRequiredAction
} from './universalProductUpdatePacketPreviewReadability.js';

type SupportedMealScoutPreviewUpdateType = Extract<
  MerlinUniversalUpdateType,
  'account_intake' | 'menu_update' | 'logo_update' | 'schedule_update'
>;

type UnsupportedPreviewReason =
  | 'invalid_universal_product_update_packet'
  | 'unsupported_target_product_or_update_type';

type SupportedPreviewBase = {
  kind: 'universal_product_update_packet_preview';
  status: 'supported';
  targetProduct: 'MealScout';
  targetBusinessName: string;
  targetProfileId: string | null;
  updateType: SupportedMealScoutPreviewUpdateType;
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

type UnsupportedPreviewBase = {
  kind: 'universal_product_update_packet_preview';
  status: 'unsupported';
  reason: UnsupportedPreviewReason;
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

type MerlinUniversalProductUpdatePacketPreviewReadability = {
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

export type MerlinUniversalProductUpdatePacketPreview =
  | (SupportedPreviewBase & MerlinUniversalProductUpdatePacketPreviewReadability)
  | (UnsupportedPreviewBase & MerlinUniversalProductUpdatePacketPreviewReadability);

const SUPPORTED_MEALSCOUT_UPDATE_TYPES = new Set<SupportedMealScoutPreviewUpdateType>([
  'account_intake',
  'menu_update',
  'logo_update',
  'schedule_update'
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEvidenceReference(value: unknown): value is MerlinPacketEvidenceReference {
  return (
    isObject(value) &&
    typeof value.sourceFileName === 'string' &&
    typeof value.sourceMimeType === 'string' &&
    typeof value.sourceReference === 'string' &&
    (value.sourceFolderReference === undefined || typeof value.sourceFolderReference === 'string') &&
    (value.sourcePage === undefined || typeof value.sourcePage === 'number')
  );
}

function isUniversalProductUpdatePacket(value: unknown): value is MerlinUniversalProductUpdatePacket {
  return (
    isObject(value) &&
    typeof value.targetProduct === 'string' &&
    typeof value.targetEntityName === 'string' &&
    (value.targetEntityId === null || typeof value.targetEntityId === 'string') &&
    typeof value.updateType === 'string' &&
    Array.isArray(value.evidenceReferences) &&
    value.evidenceReferences.every(isEvidenceReference) &&
    isObject(value.extractedStructuredData) &&
    Array.isArray(value.missingFields) &&
    typeof value.confidence === 'number' &&
    Array.isArray(value.requiredVerificationSteps) &&
    Array.isArray(value.safetyFlags) &&
    typeof value.ownerSubmittedEquivalent === 'boolean' &&
    value.productionApplied === false &&
    value.mutationAllowed === false &&
    value.implementationAllowed === false &&
    value.applyEligible === false
  );
}

function buildUnsupportedPreview(
  reason: UnsupportedPreviewReason,
  packet?: Partial<MerlinUniversalProductUpdatePacket>
): MerlinUniversalProductUpdatePacketPreview {
  const previewBase: UnsupportedPreviewBase = {
    kind: 'universal_product_update_packet_preview',
    status: 'unsupported',
    reason,
    targetProduct: packet?.targetProduct,
    targetBusinessName: packet?.targetEntityName,
    targetProfileId: packet?.targetEntityId,
    updateType: packet?.updateType,
    sourceEvidenceReferences: packet?.evidenceReferences ? [...packet.evidenceReferences] : [],
    sourceFolderReference: packet?.sourceFolderReference,
    mutationAllowed: false,
    implementationAllowed: false,
    applyEligible: false,
    productionApplied: false
  };

  return {
    ...previewBase,
    ...buildUniversalProductUpdatePacketPreviewReadability(previewBase)
  };
}

function humanizeAccountMissingField(field: string): string {
  switch (field) {
    case 'accountIntake.businessName':
      return 'business name';
    case 'accountIntake.contact':
      return 'contact details';
    case 'accountIntake.location':
      return 'location or service area';
    default:
      return field;
  }
}

function buildAccountIntakePreview(
  packet: MerlinUniversalProductUpdatePacket & { updateType: 'account_intake' }
): MerlinUniversalProductUpdatePacketPreview {
  const previewBase: SupportedPreviewBase = {
    kind: 'universal_product_update_packet_preview',
    status: 'supported',
    targetProduct: 'MealScout',
    targetBusinessName: packet.targetEntityName,
    targetProfileId: packet.targetEntityId,
    updateType: 'account_intake',
    sourceEvidenceReferences: [...packet.evidenceReferences],
    sourceFolderReference: packet.sourceFolderReference,
    extractedStructuredData: packet.extractedStructuredData,
    missingFields: [...packet.missingFields],
    confidence: packet.confidence,
    requiredVerificationSteps: [...packet.requiredVerificationSteps],
    safetyFlags: [...packet.safetyFlags],
    ownerSubmittedEquivalent: packet.ownerSubmittedEquivalent,
    productionApplied: packet.productionApplied,
    mutationAllowed: packet.mutationAllowed,
    implementationAllowed: packet.implementationAllowed,
    applyEligible: packet.applyEligible
  };
  const accountIntake = (packet.extractedStructuredData as { accountIntake?: Record<string, unknown> }).accountIntake || {};
  const accountType = typeof accountIntake.accountType === 'string' ? accountIntake.accountType : 'other';
  const requiredNextStep = typeof accountIntake.requiredNextStep === 'string'
    ? accountIntake.requiredNextStep
    : 'operator review required';
  const missingSummary = previewBase.missingFields.length === 0
    ? 'No missing account intake fields in preview.'
    : `Missing fields require review: ${Array.from(new Set(previewBase.missingFields.map(humanizeAccountMissingField))).join(', ')}`;
  const detailParts = [
    typeof accountIntake.phone === 'string' ? `phone ${accountIntake.phone}` : undefined,
    typeof accountIntake.email === 'string' ? `email ${accountIntake.email}` : undefined,
    typeof accountIntake.website === 'string' ? `website ${accountIntake.website}` : undefined,
    typeof accountIntake.address === 'string' ? `address ${accountIntake.address}` : undefined,
    typeof accountIntake.serviceArea === 'string' ? `service area ${accountIntake.serviceArea}` : undefined
  ].filter((value): value is string => typeof value === 'string');

  return {
    ...previewBase,
    displayTitle: `MealScout account intake preview - ${packet.targetEntityName}`,
    operatorSummary: `MealScout account intake preview for ${packet.targetEntityName} (${accountType}) with ${detailParts.length > 0 ? detailParts.join(', ') : 'identity-only details'}. Next step: ${requiredNextStep}.`,
    updateTypeLabel: 'MealScout account intake preview',
    targetDisplay: packet.targetEntityId
      ? `${packet.targetEntityName} (${packet.targetEntityId})`
      : packet.targetEntityName,
    evidenceSummary: previewBase.sourceEvidenceReferences.length === 0
      ? 'No source evidence references were attached to this preview.'
      : `${previewBase.sourceEvidenceReferences.length} evidence ${previewBase.sourceEvidenceReferences.length === 1 ? 'file' : 'files'}${previewBase.sourceFolderReference ? ` in folder ${previewBase.sourceFolderReference}` : ''}: ${previewBase.sourceEvidenceReferences.slice(0, 3).map((reference) => reference.sourceFileName).join(', ')}${previewBase.sourceEvidenceReferences.length > 3 ? ', ...' : ''}`,
    missingFieldSummary: missingSummary,
    verificationSummary: `Verification: preview before any apply; require exact target id before production apply; preserve source evidence`,
    safetySummary: previewBase.safetyFlags.length === 0
      ? 'No additional safety flags were attached to this preview.'
      : `Safety: ${Array.from(new Set(previewBase.safetyFlags)).join('; ')}`,
    applyStatusLabel: 'Preview only — no production apply',
    nextRequiredAction: 'review_only'
  };
}

export function buildUniversalProductUpdatePacketPreview(
  packet: unknown
): MerlinUniversalProductUpdatePacketPreview {
  if (!isUniversalProductUpdatePacket(packet)) {
    return buildUnsupportedPreview('invalid_universal_product_update_packet');
  }

  if (
    packet.targetProduct !== 'MealScout' ||
    !SUPPORTED_MEALSCOUT_UPDATE_TYPES.has(packet.updateType as SupportedMealScoutPreviewUpdateType)
  ) {
    return buildUnsupportedPreview('unsupported_target_product_or_update_type', packet);
  }

  if (packet.updateType === 'account_intake') {
    return buildAccountIntakePreview(packet as MerlinUniversalProductUpdatePacket & { updateType: 'account_intake' });
  }

  const previewBase: SupportedPreviewBase = {
    kind: 'universal_product_update_packet_preview',
    status: 'supported',
    targetProduct: 'MealScout',
    targetBusinessName: packet.targetEntityName,
    targetProfileId: packet.targetEntityId,
    updateType: packet.updateType as Extract<SupportedMealScoutPreviewUpdateType, 'menu_update' | 'logo_update' | 'schedule_update'>,
    sourceEvidenceReferences: [...packet.evidenceReferences],
    sourceFolderReference: packet.sourceFolderReference,
    extractedStructuredData: packet.extractedStructuredData,
    missingFields: [...packet.missingFields],
    confidence: packet.confidence,
    requiredVerificationSteps: [...packet.requiredVerificationSteps],
    safetyFlags: [...packet.safetyFlags],
    ownerSubmittedEquivalent: packet.ownerSubmittedEquivalent,
    productionApplied: packet.productionApplied,
    mutationAllowed: packet.mutationAllowed,
    implementationAllowed: packet.implementationAllowed,
    applyEligible: packet.applyEligible
  };

  return {
    ...previewBase,
    ...buildUniversalProductUpdatePacketPreviewReadability(previewBase as SupportedPreviewBase & {
      updateType: 'menu_update' | 'logo_update' | 'schedule_update'
    })
  };
}
