import type { UploadIntentFileRef } from './intakeTypes.js';
import {
  createMealScoutScreenshotEvidencePacket,
  type MealScoutScreenshotEvidencePacket
} from './mealscoutScreenshotEvidencePacket.js';
import type { MerlinPacketSourceActor } from './universalProductUpdatePacket.js';

export type MealScoutScreenshotEvidencePacketUploadIntentAdapterInput = {
  sourceActor: MerlinPacketSourceActor;
  files: UploadIntentFileRef[];
  sourceReferencesByFileId?: Record<string, string | undefined>;
  sourceReferenceBuilder?: (file: UploadIntentFileRef) => string | undefined;
  sourceFolderReference?: string;
  driveFolderReferenceBuilder?: (driveFolderId: string) => string | undefined;
};

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireFiles(files: UploadIntentFileRef[]): UploadIntentFileRef[] {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('mealscout_upload_intent_files_required');
  }

  return files;
}

function requireFileId(file: UploadIntentFileRef): string {
  if (!hasText(file.fileId)) {
    throw new Error('mealscout_upload_intent_file_id_required');
  }

  return file.fileId.trim();
}

function requireFileName(file: UploadIntentFileRef): string {
  if (!hasText(file.fileName)) {
    throw new Error(`mealscout_upload_intent_file_name_required:${requireFileId(file)}`);
  }

  return file.fileName.trim();
}

function requireMimeType(file: UploadIntentFileRef): string {
  if (!hasText(file.mimeType)) {
    throw new Error(`mealscout_upload_intent_mime_type_required:${requireFileId(file)}`);
  }

  return file.mimeType.trim();
}

function resolveSourceReference(
  file: UploadIntentFileRef,
  input: MealScoutScreenshotEvidencePacketUploadIntentAdapterInput
): string {
  const builtSourceReference = input.sourceReferenceBuilder?.(file);
  if (hasText(builtSourceReference)) {
    return builtSourceReference.trim();
  }

  const mappedSourceReference = input.sourceReferencesByFileId?.[requireFileId(file)];
  if (hasText(mappedSourceReference)) {
    return mappedSourceReference.trim();
  }

  throw new Error(`mealscout_upload_intent_source_reference_required:${requireFileId(file)}`);
}

function deriveFolderReferenceFromFiles(
  files: UploadIntentFileRef[],
  builder?: (driveFolderId: string) => string | undefined
): string | undefined {
  if (!builder) {
    return undefined;
  }

  const resolvedFolderReferences: string[] = [];
  for (const file of files) {
    if (!hasText(file.driveFolderId)) {
      return undefined;
    }
    const folderReference = builder(file.driveFolderId.trim());
    if (!hasText(folderReference)) {
      return undefined;
    }
    resolvedFolderReferences.push(folderReference.trim());
  }

  const uniqueFolderReferences = Array.from(new Set(resolvedFolderReferences));
  return uniqueFolderReferences.length === 1 ? uniqueFolderReferences[0] : undefined;
}

function resolvePacketLevelSourceFolderReference(
  input: MealScoutScreenshotEvidencePacketUploadIntentAdapterInput
): string | undefined {
  const explicitSourceFolderReference = hasText(input.sourceFolderReference)
    ? input.sourceFolderReference.trim()
    : undefined;
  const derivedFolderReference = deriveFolderReferenceFromFiles(input.files, input.driveFolderReferenceBuilder);

  if (explicitSourceFolderReference && derivedFolderReference) {
    return explicitSourceFolderReference === derivedFolderReference ? explicitSourceFolderReference : undefined;
  }

  return explicitSourceFolderReference || derivedFolderReference;
}

export function createMealScoutScreenshotEvidencePacketFromUploadIntent(
  input: MealScoutScreenshotEvidencePacketUploadIntentAdapterInput
): MealScoutScreenshotEvidencePacket {
  const files = requireFiles(input.files);
  const sourceFolderReference = resolvePacketLevelSourceFolderReference({
    ...input,
    files
  });

  const evidenceReferences = files.map((file) => {
    const evidenceReference = {
      sourceFileName: requireFileName(file),
      sourceMimeType: requireMimeType(file),
      sourceReference: resolveSourceReference(file, input)
    };

    if (sourceFolderReference) {
      return {
        ...evidenceReference,
        sourceFolderReference
      };
    }

    return evidenceReference;
  });

  return createMealScoutScreenshotEvidencePacket({
    sourceActor: input.sourceActor,
    sourceSurface: 'upload_intent',
    sourceFolderReference,
    evidenceReferences
  });
}
