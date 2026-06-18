import { createHash } from 'node:crypto';
import type {
  MerlinPacketEvidenceReference,
  MerlinPacketSourceActor
} from './universalProductUpdatePacket.js';

export type MealScoutScreenshotEvidencePacketSourceSurface =
  | 'upload_intent'
  | 'drive_file'
  | 'manual_file';

export type MealScoutScreenshotEvidencePacketRequiredNextStep = 'extraction_required';

type ForbiddenMealScoutScreenshotEvidencePacketFields = {
  extractedText?: never;
  visualLabels?: never;
  detectedType?: never;
  confidence?: never;
  targetEntityName?: never;
  targetEntityId?: never;
  updateType?: never;
  missingFields?: never;
  menuItems?: never;
};

export type MealScoutScreenshotEvidencePacket = {
  packetId: string;
  packetSubtype: 'MealScoutScreenshotEvidencePacket';
  targetProduct: 'MealScout';
  sourceActor: MerlinPacketSourceActor;
  sourceSurface: MealScoutScreenshotEvidencePacketSourceSurface;
  sourceFolderReference?: string;
  evidenceReferences: MerlinPacketEvidenceReference[];
  ownerSubmittedEquivalent: boolean;
  safetyFlags: ['preserve_source_evidence', 'pre_extraction_evidence_only'];
  requiredNextStep: MealScoutScreenshotEvidencePacketRequiredNextStep;
  productionApplied: false;
  mutationAllowed: false;
  implementationAllowed: false;
  applyEligible: false;
};

export type CreateMealScoutScreenshotEvidencePacketInput = ForbiddenMealScoutScreenshotEvidencePacketFields & {
  sourceActor: MerlinPacketSourceActor;
  sourceSurface: MealScoutScreenshotEvidencePacketSourceSurface;
  sourceFolderReference?: string;
  evidenceReferences: MerlinPacketEvidenceReference[];
};

const FORBIDDEN_PACKET_FIELDS = [
  'extractedText',
  'visualLabels',
  'detectedType',
  'confidence',
  'targetEntityName',
  'targetEntityId',
  'updateType',
  'missingFields',
  'menuItems'
] as const;

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeEvidenceReference(value: unknown): MerlinPacketEvidenceReference {
  if (typeof value !== 'object' || value === null) {
    throw new Error('invalid_mealscout_screenshot_evidence_reference');
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.sourceFileName !== 'string' ||
    typeof candidate.sourceMimeType !== 'string' ||
    typeof candidate.sourceReference !== 'string'
  ) {
    throw new Error('invalid_mealscout_screenshot_evidence_reference');
  }

  if (candidate.sourceFolderReference !== undefined && typeof candidate.sourceFolderReference !== 'string') {
    throw new Error('invalid_mealscout_screenshot_evidence_reference');
  }

  if (candidate.sourcePage !== undefined && typeof candidate.sourcePage !== 'number') {
    throw new Error('invalid_mealscout_screenshot_evidence_reference');
  }

  const normalized: MerlinPacketEvidenceReference = {
    sourceFileName: candidate.sourceFileName,
    sourceMimeType: candidate.sourceMimeType,
    sourceReference: candidate.sourceReference
  };

  if (hasText(candidate.sourceFolderReference as string | undefined)) {
    normalized.sourceFolderReference = (candidate.sourceFolderReference as string).trim();
  }

  if (candidate.sourcePage !== undefined) {
    normalized.sourcePage = candidate.sourcePage as number;
  }

  return normalized;
}

function normalizeEvidenceReferences(evidenceReferences: MerlinPacketEvidenceReference[]): MerlinPacketEvidenceReference[] {
  if (!Array.isArray(evidenceReferences) || evidenceReferences.length === 0) {
    throw new Error('mealscout_screenshot_evidence_references_required');
  }

  return evidenceReferences.map((reference) => normalizeEvidenceReference(reference));
}

function collectSharedSourceFolderReference(evidenceReferences: MerlinPacketEvidenceReference[]): string | undefined {
  const uniqueFolderReferences = Array.from(
    new Set(evidenceReferences.map((reference) => reference.sourceFolderReference).filter(hasText))
  );
  return uniqueFolderReferences.length === 1 ? uniqueFolderReferences[0] : undefined;
}

function resolveSourceFolderReference(input: {
  sourceFolderReference?: string;
  evidenceReferences: MerlinPacketEvidenceReference[];
}): string | undefined {
  const explicitSourceFolderReference = hasText(input.sourceFolderReference)
    ? input.sourceFolderReference.trim()
    : undefined;
  const sharedSourceFolderReference = collectSharedSourceFolderReference(input.evidenceReferences);

  if (!explicitSourceFolderReference) {
    return sharedSourceFolderReference;
  }

  const conflictingEvidenceReference = input.evidenceReferences.some((reference) => {
    return hasText(reference.sourceFolderReference) && reference.sourceFolderReference !== explicitSourceFolderReference;
  });

  if (conflictingEvidenceReference) {
    return undefined;
  }

  return explicitSourceFolderReference;
}

function ownerSubmittedEquivalent(sourceActor: MerlinPacketSourceActor): boolean {
  return (
    sourceActor.actorScope === 'owner' ||
    sourceActor.actorScope === 'homeowner' ||
    sourceActor.actorScope === 'contractor' ||
    sourceActor.actorScope === 'rep'
  );
}

function assertNoForbiddenPacketFields(input: CreateMealScoutScreenshotEvidencePacketInput): void {
  const forbiddenFields = FORBIDDEN_PACKET_FIELDS.filter((field) => field in (input as Record<string, unknown>));
  if (forbiddenFields.length > 0) {
    throw new Error(`forbidden_mealscout_screenshot_packet_fields:${forbiddenFields.join(',')}`);
  }
}

export function buildMealScoutScreenshotEvidencePacketId(input: {
  sourceActor: MerlinPacketSourceActor;
  sourceSurface: MealScoutScreenshotEvidencePacketSourceSurface;
  sourceFolderReference?: string;
  evidenceReferences: MerlinPacketEvidenceReference[];
}): string {
  const digest = createHash('sha1')
    .update(
      JSON.stringify({
        packetSubtype: 'MealScoutScreenshotEvidencePacket',
        targetProduct: 'MealScout',
        sourceActor: input.sourceActor,
        sourceSurface: input.sourceSurface,
        sourceFolderReference: input.sourceFolderReference || null,
        evidenceReferences: input.evidenceReferences
      })
    )
    .digest('hex')
    .slice(0, 16);

  return `merlin-mealscout-screenshot-evidence:${digest}`;
}

export function createMealScoutScreenshotEvidencePacket(
  input: CreateMealScoutScreenshotEvidencePacketInput
): MealScoutScreenshotEvidencePacket {
  assertNoForbiddenPacketFields(input);

  const evidenceReferences = normalizeEvidenceReferences(input.evidenceReferences);
  const sourceFolderReference = resolveSourceFolderReference({
    sourceFolderReference: input.sourceFolderReference,
    evidenceReferences
  });

  return {
    packetId: buildMealScoutScreenshotEvidencePacketId({
      sourceActor: input.sourceActor,
      sourceSurface: input.sourceSurface,
      sourceFolderReference,
      evidenceReferences
    }),
    packetSubtype: 'MealScoutScreenshotEvidencePacket',
    targetProduct: 'MealScout',
    sourceActor: input.sourceActor,
    sourceSurface: input.sourceSurface,
    sourceFolderReference,
    evidenceReferences,
    ownerSubmittedEquivalent: ownerSubmittedEquivalent(input.sourceActor),
    safetyFlags: ['preserve_source_evidence', 'pre_extraction_evidence_only'],
    requiredNextStep: 'extraction_required',
    productionApplied: false,
    mutationAllowed: false,
    implementationAllowed: false,
    applyEligible: false
  };
}

export function isMealScoutScreenshotEvidencePacket(value: unknown): value is MealScoutScreenshotEvidencePacket {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.packetId !== 'string' ||
    candidate.packetSubtype !== 'MealScoutScreenshotEvidencePacket' ||
    candidate.targetProduct !== 'MealScout' ||
    typeof candidate.sourceActor !== 'object' ||
    candidate.sourceActor === null ||
    !Array.isArray(candidate.evidenceReferences) ||
    candidate.evidenceReferences.length === 0 ||
    typeof candidate.ownerSubmittedEquivalent !== 'boolean' ||
    !Array.isArray(candidate.safetyFlags) ||
    candidate.requiredNextStep !== 'extraction_required' ||
    candidate.productionApplied !== false ||
    candidate.mutationAllowed !== false ||
    candidate.implementationAllowed !== false ||
    candidate.applyEligible !== false
  ) {
    return false;
  }

  if (candidate.sourceFolderReference !== undefined && typeof candidate.sourceFolderReference !== 'string') {
    return false;
  }

  if (
    candidate.sourceSurface !== 'upload_intent' &&
    candidate.sourceSurface !== 'drive_file' &&
    candidate.sourceSurface !== 'manual_file'
  ) {
    return false;
  }

  if ((candidate.safetyFlags as unknown[]).length !== 2) {
    return false;
  }

  const expectedSafetyFlags = new Set(['preserve_source_evidence', 'pre_extraction_evidence_only']);
  for (const flag of candidate.safetyFlags as unknown[]) {
    if (typeof flag !== 'string' || !expectedSafetyFlags.has(flag)) {
      return false;
    }
  }

  for (const field of FORBIDDEN_PACKET_FIELDS) {
    if (field in candidate) {
      return false;
    }
  }

  try {
    normalizeEvidenceReferences(candidate.evidenceReferences as MerlinPacketEvidenceReference[]);
  } catch {
    return false;
  }

  return true;
}
