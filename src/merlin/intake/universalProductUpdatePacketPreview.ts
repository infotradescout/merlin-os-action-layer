import type {
  MerlinPacketEvidenceReference,
  MerlinRequiredVerificationStep,
  MerlinUniversalProductUpdatePacket,
  MerlinUniversalUpdateType
} from './universalProductUpdatePacket.js';

type SupportedMealScoutPreviewUpdateType = Extract<
  MerlinUniversalUpdateType,
  'menu_update' | 'logo_update' | 'schedule_update'
>;

type UnsupportedPreviewReason =
  | 'invalid_universal_product_update_packet'
  | 'unsupported_target_product_or_update_type';

export type MerlinUniversalProductUpdatePacketPreview =
  | {
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
    }
  | {
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

const SUPPORTED_MEALSCOUT_UPDATE_TYPES = new Set<SupportedMealScoutPreviewUpdateType>([
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
  return {
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

  return {
    kind: 'universal_product_update_packet_preview',
    status: 'supported',
    targetProduct: packet.targetProduct,
    targetBusinessName: packet.targetEntityName,
    targetProfileId: packet.targetEntityId,
    updateType: packet.updateType as SupportedMealScoutPreviewUpdateType,
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
}
