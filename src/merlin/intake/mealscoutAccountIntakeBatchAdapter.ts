import { buildPreviewPacket } from './previewBuilder.js';
import type {
  MealScoutAccountIntakeDetectedChange,
  PreviewPacket,
  RoutingDecision,
  UploadIntent,
  UploadIntentFileRef
} from './intakeTypes.js';
import {
  createUniversalProductUpdatePacket,
  type MealScoutAccountIntakeSocialLink,
  type MerlinPacketEvidenceReference,
  type MerlinPacketSourceActor,
  type MerlinTargetResolutionStatus,
  type MerlinUniversalProductUpdatePacket
} from './universalProductUpdatePacket.js';
import {
  buildUniversalProductUpdatePacketPreview,
  type MerlinUniversalProductUpdatePacketPreview
} from './universalProductUpdatePacketPreview.js';

const FORBIDDEN_ROW_FIELDS = new Set([
  'logo',
  'logoUrl',
  'logoUrls',
  'coverImage',
  'coverImageUrl',
  'coverImageUrls',
  'menu',
  'menuItems',
  'menuSections',
  'price',
  'prices',
  'itemPrices',
  'items'
]);

const IGNORED_EXTRACTION_ONLY_FIELDS = new Set([
  'extractedText',
  'visualLabels',
  'ocrText',
  'ocrBlocks',
  'raw_metadata',
  'rawMetadata',
  'candidateImport',
  'candidateImportOutput',
  'parsedCandidateOutput',
  'screenshotLabels'
]);

export type MealScoutAccountIntakeBatchRow = {
  rowId: string;
  targetBusinessName: string;
  targetProfileId?: string;
  targetResolutionStatus?: MerlinTargetResolutionStatus;
  accountType: 'food_truck' | 'restaurant' | 'host_location' | 'other';
  cuisineType?: string;
  phone?: string;
  email?: string;
  website?: string;
  socialLinks?: MealScoutAccountIntakeSocialLink[];
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  serviceArea?: string;
  requiredNextStep: string;
  safetyFlags?: string[];
  evidenceReferences: MerlinPacketEvidenceReference[];
  sourceFolderReference?: string;
};

export type MealScoutAccountIntakeBatchAdapterInput = {
  sourceActor: MerlinPacketSourceActor;
  rows: MealScoutAccountIntakeBatchRow[];
};

export type MealScoutAccountIntakeBatchRowResult = {
  rowId: string;
  packet: MerlinUniversalProductUpdatePacket;
  preview: MerlinUniversalProductUpdatePacketPreview;
  previewPacket: PreviewPacket;
  detectedChange?: MealScoutAccountIntakeDetectedChange;
  warnings: string[];
  productionApplied: false;
  mutationAllowed: false;
  implementationAllowed: false;
  applyEligible: false;
};

export type MealScoutAccountIntakeBatchAdapterResult = {
  rows: MealScoutAccountIntakeBatchRowResult[];
  productionApplied: false;
  mutationAllowed: false;
  implementationAllowed: false;
  applyEligible: false;
};

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function assertNoForbiddenRowFields(row: Record<string, unknown>): void {
  const forbiddenFields = Array.from(FORBIDDEN_ROW_FIELDS).filter((field) => field in row);
  if (forbiddenFields.length > 0) {
    throw new Error(`forbidden_mealscout_account_intake_batch_fields:${forbiddenFields.join(',')}`);
  }
}

function sanitizeIgnoredFields<T extends Record<string, unknown>>(row: T): T {
  const sanitized = { ...row };
  for (const field of IGNORED_EXTRACTION_ONLY_FIELDS) {
    if (field in sanitized) {
      delete sanitized[field];
    }
  }
  return sanitized;
}

function normalizeEvidenceReference(reference: MerlinPacketEvidenceReference): MerlinPacketEvidenceReference {
  if (
    typeof reference !== 'object' ||
    reference === null ||
    !hasText(reference.sourceFileName) ||
    !hasText(reference.sourceMimeType) ||
    !hasText(reference.sourceReference)
  ) {
    throw new Error('invalid_mealscout_account_intake_evidence_reference');
  }

  if (reference.sourcePage !== undefined && typeof reference.sourcePage !== 'number') {
    throw new Error('invalid_mealscout_account_intake_evidence_reference');
  }

  return {
    sourceFileName: reference.sourceFileName.trim(),
    sourceMimeType: reference.sourceMimeType.trim(),
    sourceReference: reference.sourceReference.trim(),
    ...(hasText(reference.sourceFolderReference) ? { sourceFolderReference: reference.sourceFolderReference.trim() } : {}),
    ...(reference.sourcePage !== undefined ? { sourcePage: reference.sourcePage } : {})
  };
}

function mapAccountTypeToEntityType(
  accountType: MealScoutAccountIntakeBatchRow['accountType']
): UploadIntent['entityType'] {
  switch (accountType) {
    case 'food_truck':
      return 'food_truck';
    case 'restaurant':
      return 'restaurant';
    case 'host_location':
      return 'host_location';
    default:
      return 'unknown';
  }
}

function normalizeEvidenceReferencesForRow(
  row: MealScoutAccountIntakeBatchRow
): { evidenceReferences: MerlinPacketEvidenceReference[]; warnings: string[] } {
  if (!Array.isArray(row.evidenceReferences) || row.evidenceReferences.length === 0) {
    throw new Error(`mealscout_account_intake_batch_evidence_references_required:${row.rowId}`);
  }

  const normalizedReferences = row.evidenceReferences.map((reference) => normalizeEvidenceReference(reference));
  const warnings: string[] = [];
  const explicitFolderReference = hasText(row.sourceFolderReference) ? row.sourceFolderReference.trim() : undefined;
  const referencedFolders = Array.from(
    new Set(normalizedReferences.map((reference) => reference.sourceFolderReference).filter(hasText))
  );

  if (!explicitFolderReference) {
    return {
      evidenceReferences: normalizedReferences,
      warnings
    };
  }

  if (referencedFolders.length > 0 && referencedFolders.some((folderReference) => folderReference !== explicitFolderReference)) {
    warnings.push('source_folder_reference_conflict');
    return {
      evidenceReferences: normalizedReferences,
      warnings
    };
  }

  return {
    evidenceReferences: normalizedReferences.map((reference) => ({
      ...reference,
      sourceFolderReference: explicitFolderReference
    })),
    warnings
  };
}

function buildSyntheticFiles(
  row: MealScoutAccountIntakeBatchRow,
  packet: MerlinUniversalProductUpdatePacket
): UploadIntentFileRef[] {
  return packet.evidenceReferences.map((reference, index) => ({
    fileId: `${row.rowId}:evidence:${index + 1}`,
    fileName: reference.sourceFileName,
    mimeType: reference.sourceMimeType,
    driveFolderId: reference.sourceFolderReference,
    metadata: index === 0 ? { universalProductUpdatePacket: packet } : undefined
  }));
}

function buildSyntheticRouting(packet: MerlinUniversalProductUpdatePacket, row: MealScoutAccountIntakeBatchRow): RoutingDecision[] {
  return packet.evidenceReferences.map((reference, index) => ({
    fileId: `${row.rowId}:evidence:${index + 1}`,
    fileName: reference.sourceFileName,
    mimeType: reference.sourceMimeType,
    driveFolderId: reference.sourceFolderReference,
    routedType: 'document',
    confidence: 1,
    reasons: ['account_intake_batch_adapter_evidence_only']
  }));
}

function buildSyntheticUploadIntent(
  sourceActor: MerlinPacketSourceActor,
  row: MealScoutAccountIntakeBatchRow,
  packet: MerlinUniversalProductUpdatePacket
): UploadIntent {
  return {
    uploadId: `mealscout-account-intake-batch:${row.rowId}`,
    userId: sourceActor.actorId || 'mealscout-account-intake-batch-adapter',
    accountId: row.targetProfileId || `mealscout-account-intake:${row.rowId}`,
    brand: 'MEALSCOUT',
    actorScope: sourceActor.actorScope,
    entityType: mapAccountTypeToEntityType(row.accountType),
    entityId: row.targetProfileId,
    actionId: 'account_intake_batch_adapter',
    actionSnapshot: {
      actionId: 'account_intake_batch_adapter',
      brand: 'MEALSCOUT',
      actorScope: sourceActor.actorScope,
      label: 'MealScout account intake batch adapter',
      description: 'Pure read-only account intake batch adapter preview',
      entityTypesAllowed: ['food_truck', 'restaurant', 'host_location', 'unknown'],
      expectedFileTypes: ['application/pdf', 'image/*', 'text/*'],
      allowedOutputTypes: ['account_intake'],
      allowedFieldPaths: ['accountIntake'],
      forbiddenFieldPaths: ['logo', 'menu', 'prices'],
      requiresEntityContext: false,
      requiresUserHint: false,
      previewRequired: true,
      approvalRequired: true,
      implementationMode: 'admin_review_required',
      riskLevel: 'medium'
    },
    files: buildSyntheticFiles(row, packet),
    routing: buildSyntheticRouting(packet, row),
    status: 'PREVIEW_READY',
    implementationAllowed: false,
    mutationAllowed: false,
    previewRequired: true,
    approvalRequired: true,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z'
  };
}

function buildWarnings(packet: MerlinUniversalProductUpdatePacket, warnings: string[]): string[] {
  const combined = [...warnings];
  for (const field of packet.missingFields) {
    combined.push(`missing_field:${field}`);
  }
  return Array.from(new Set(combined));
}

export function createMealScoutAccountIntakeBatchAdapter(
  input: MealScoutAccountIntakeBatchAdapterInput
): MealScoutAccountIntakeBatchAdapterResult {
  if (!Array.isArray(input.rows)) {
    throw new Error('mealscout_account_intake_batch_rows_invalid');
  }

  const rows = input.rows.map((rawRow) => {
    const sanitizedRow = sanitizeIgnoredFields(rawRow as unknown as Record<string, unknown>) as unknown as MealScoutAccountIntakeBatchRow;

    if (!hasText(sanitizedRow.rowId)) {
      throw new Error('mealscout_account_intake_batch_row_id_required');
    }
    if (!hasText(sanitizedRow.targetBusinessName)) {
      throw new Error(`mealscout_account_intake_batch_target_business_name_required:${sanitizedRow.rowId}`);
    }
    if (!hasText(sanitizedRow.requiredNextStep)) {
      throw new Error(`mealscout_account_intake_batch_required_next_step_required:${sanitizedRow.rowId}`);
    }

    assertNoForbiddenRowFields(sanitizedRow as unknown as Record<string, unknown>);

    const { evidenceReferences, warnings } = normalizeEvidenceReferencesForRow(sanitizedRow);
    const packet = createUniversalProductUpdatePacket({
      sourceActor: input.sourceActor,
      targetProduct: 'MealScout',
      targetBusinessName: sanitizedRow.targetBusinessName.trim(),
      targetProfileId: hasText(sanitizedRow.targetProfileId) ? sanitizedRow.targetProfileId.trim() : undefined,
      targetResolutionStatus: sanitizedRow.targetResolutionStatus,
      updateType: 'account_intake',
      evidenceReferences,
      accountIntake: {
        accountType: sanitizedRow.accountType,
        cuisineType: sanitizedRow.cuisineType,
        phone: sanitizedRow.phone,
        email: sanitizedRow.email,
        website: sanitizedRow.website,
        socialLinks: sanitizedRow.socialLinks,
        address: sanitizedRow.address,
        city: sanitizedRow.city,
        state: sanitizedRow.state,
        postalCode: sanitizedRow.postalCode,
        serviceArea: sanitizedRow.serviceArea,
        requiredNextStep: sanitizedRow.requiredNextStep.trim(),
        safetyFlags: sanitizedRow.safetyFlags
      }
    });
    const preview = buildUniversalProductUpdatePacketPreview(packet);
    const previewPacket = buildPreviewPacket(
      buildSyntheticUploadIntent(input.sourceActor, sanitizedRow, packet),
      buildSyntheticRouting(packet, sanitizedRow)
    );
    const detectedChange = previewPacket.detectedChanges.accountIntake as MealScoutAccountIntakeDetectedChange | undefined;

    return {
      rowId: sanitizedRow.rowId.trim(),
      packet,
      preview,
      previewPacket,
      detectedChange,
      warnings: buildWarnings(packet, warnings),
      productionApplied: false as const,
      mutationAllowed: false as const,
      implementationAllowed: false as const,
      applyEligible: false as const
    };
  });

  return {
    rows,
    productionApplied: false as const,
    mutationAllowed: false as const,
    implementationAllowed: false as const,
    applyEligible: false as const
  };
}
