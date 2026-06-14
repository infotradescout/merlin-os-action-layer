import type { DriveClient, DriveFileInfo } from './driveClient.js';
import { toCsv } from './mealscoutScreenshotProcessingValidation.js';

export type DriveSequentialInventoryMode = 'dry-run' | 'execute';

export type DriveSequentialInventoryManifestRow = {
  sequence_number: number;
  drive_file_id: string;
  original_filename: string;
  new_filename: string;
  mime_type: string;
  size: string | null;
  modified_time: string | null;
  parent_folder_id: string;
  processed_status: false;
  extraction_status: 'pending';
  duplicate_group: null;
  notes: null;
};

export type DriveSequentialInventorySkippedFile = {
  drive_file_id: string;
  original_filename: string;
  mime_type: string;
  reason: string;
};

export type DriveSequentialInventoryResult = {
  status: 'ok';
  mode: DriveSequentialInventoryMode;
  folderId: string;
  mutationAllowed: boolean;
  totalFilesFound: number;
  totalManifestRows: number;
  totalPlannedRenames: number;
  skippedFiles: DriveSequentialInventorySkippedFile[];
  manifestRows: DriveSequentialInventoryManifestRow[];
  renamedFiles: Array<{ drive_file_id: string; original_filename: string; new_filename: string }>;
  validation: {
    sequenceHasNoGaps: boolean;
    everyManifestRowHasOriginalFilenameAndDriveFileId: boolean;
    everyRenamedFileHasManifestRow: boolean;
    duplicateTargetNames: string[];
    targetNameConflicts: Array<{ target_filename: string; existing_drive_file_id: string; planned_drive_file_id: string }>;
  };
};

export type DriveSequentialInventoryOptions = {
  folderId: string;
  client: DriveClient;
  mode?: DriveSequentialInventoryMode;
  includeAllFiles?: boolean;
  expectedTotalFileCount?: number;
  confirmRename?: boolean;
};

const ALLOWED_MIME_PREFIXES = ['image/'];
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
  'application/vnd.google-apps.drawing',
  'text/plain',
  'text/csv',
  'application/json'
]);
const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.heic', '.heif', '.pdf', '.txt', '.csv', '.json']);

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function extensionOf(fileName: string): string {
  const match = clean(fileName).match(/(\.[^./\\]+)$/);
  return match?.[1] || '';
}

function isAllowedFile(file: DriveFileInfo, includeAllFiles: boolean): boolean {
  if (includeAllFiles) return true;
  const mime = clean(file.mime_type).toLowerCase();
  const ext = extensionOf(file.file_name).toLowerCase();
  return ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix)) || ALLOWED_MIME_TYPES.has(mime) || ALLOWED_EXTENSIONS.has(ext);
}

function sortFiles(files: DriveFileInfo[]): DriveFileInfo[] {
  return [...files].sort((a, b) => {
    const byName = a.file_name.localeCompare(b.file_name, undefined, { sensitivity: 'base', numeric: true });
    if (byName !== 0) return byName;
    return a.drive_file_id.localeCompare(b.drive_file_id);
  });
}

function sequenceName(index: number, total: number, originalFilename: string): string {
  const width = Math.max(3, String(total).length);
  return `${String(index + 1).padStart(width, '0')}${extensionOf(originalFilename)}`;
}

function duplicateValues(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1);
  return Array.from(counts.entries()).filter(([, count]) => count > 1).map(([value]) => value);
}

function targetNameConflicts(allFiles: DriveFileInfo[], manifestRows: DriveSequentialInventoryManifestRow[]) {
  const plannedByTarget = new Map(manifestRows.map((row) => [row.new_filename.toLowerCase(), row.drive_file_id]));
  return allFiles
    .map((file) => {
      const plannedDriveFileId = plannedByTarget.get(file.file_name.toLowerCase());
      if (!plannedDriveFileId || plannedDriveFileId === file.drive_file_id) return undefined;
      return {
        target_filename: file.file_name,
        existing_drive_file_id: file.drive_file_id,
        planned_drive_file_id: plannedDriveFileId
      };
    })
    .filter(Boolean) as Array<{ target_filename: string; existing_drive_file_id: string; planned_drive_file_id: string }>;
}

function validateRows(rows: DriveSequentialInventoryManifestRow[], renamedFiles: Array<{ drive_file_id: string }>, allFiles: DriveFileInfo[]) {
  const sequenceHasNoGaps = rows.every((row, index) => row.sequence_number === index + 1);
  const everyManifestRowHasOriginalFilenameAndDriveFileId = rows.every((row) => Boolean(row.original_filename && row.drive_file_id));
  const manifestIds = new Set(rows.map((row) => row.drive_file_id));
  const everyRenamedFileHasManifestRow = renamedFiles.every((row) => manifestIds.has(row.drive_file_id));
  const duplicateTargetNames = duplicateValues(rows.map((row) => row.new_filename.toLowerCase()));
  return {
    sequenceHasNoGaps,
    everyManifestRowHasOriginalFilenameAndDriveFileId,
    everyRenamedFileHasManifestRow,
    duplicateTargetNames,
    targetNameConflicts: targetNameConflicts(allFiles, rows)
  };
}

export async function createDriveSequentialRenameInventory(
  options: DriveSequentialInventoryOptions
): Promise<DriveSequentialInventoryResult> {
  const mode = options.mode || 'dry-run';
  const allFiles = await options.client.listFilesInFolder(options.folderId);
  if (typeof options.expectedTotalFileCount === 'number' && allFiles.length !== options.expectedTotalFileCount) {
    throw new Error(`drive_folder_count_mismatch:expected=${options.expectedTotalFileCount}:actual=${allFiles.length}`);
  }

  const includedFiles: DriveFileInfo[] = [];
  const skippedFiles: DriveSequentialInventorySkippedFile[] = [];
  for (const file of allFiles) {
    if (isAllowedFile(file, Boolean(options.includeAllFiles))) {
      includedFiles.push(file);
    } else {
      skippedFiles.push({
        drive_file_id: file.drive_file_id,
        original_filename: file.file_name,
        mime_type: file.mime_type,
        reason: 'unsupported_file_type'
      });
    }
  }

  const sortedFiles = sortFiles(includedFiles);
  const manifestRows = sortedFiles.map((file, index) => ({
    sequence_number: index + 1,
    drive_file_id: file.drive_file_id,
    original_filename: file.file_name,
    new_filename: sequenceName(index, sortedFiles.length, file.file_name),
    mime_type: file.mime_type,
    size: file.size || null,
    modified_time: file.modified_time || null,
    parent_folder_id: file.folder_id || options.folderId,
    processed_status: false as const,
    extraction_status: 'pending' as const,
    duplicate_group: null,
    notes: null
  }));

  const preValidation = validateRows(manifestRows, [], allFiles);
  if (preValidation.duplicateTargetNames.length > 0) {
    throw new Error(`duplicate_target_names:${preValidation.duplicateTargetNames.join('|')}`);
  }
  if (preValidation.targetNameConflicts.length > 0) {
    throw new Error(`target_name_conflicts:${preValidation.targetNameConflicts.map((conflict) => conflict.target_filename).join('|')}`);
  }

  const renamedFiles: Array<{ drive_file_id: string; original_filename: string; new_filename: string }> = [];
  if (mode === 'execute') {
    if (!options.confirmRename) {
      throw new Error('rename_execute_requires_confirm_rename');
    }
    if (!options.client.renameFile) {
      throw new Error('drive_client_rename_unavailable');
    }
    for (const row of manifestRows) {
      if (row.original_filename === row.new_filename) continue;
      await options.client.renameFile(row.drive_file_id, row.new_filename);
      renamedFiles.push({
        drive_file_id: row.drive_file_id,
        original_filename: row.original_filename,
        new_filename: row.new_filename
      });
    }
  }

  return {
    status: 'ok',
    mode,
    folderId: options.folderId,
    mutationAllowed: mode === 'execute',
    totalFilesFound: allFiles.length,
    totalManifestRows: manifestRows.length,
    totalPlannedRenames: manifestRows.filter((row) => row.original_filename !== row.new_filename).length,
    skippedFiles,
    manifestRows,
    renamedFiles,
    validation: validateRows(manifestRows, renamedFiles, allFiles)
  };
}

export function driveSequentialManifestRowsToCsv(rows: DriveSequentialInventoryManifestRow[]): string {
  return toCsv(
    rows.map((row) => ({
      sequence_number: row.sequence_number,
      drive_file_id: row.drive_file_id,
      original_filename: row.original_filename,
      new_filename: row.new_filename,
      mime_type: row.mime_type,
      size: row.size || '',
      modified_time: row.modified_time || '',
      parent_folder_id: row.parent_folder_id,
      processed_status: row.processed_status,
      extraction_status: row.extraction_status,
      duplicate_group: '',
      notes: ''
    })),
    [
      'sequence_number',
      'drive_file_id',
      'original_filename',
      'new_filename',
      'mime_type',
      'size',
      'modified_time',
      'parent_folder_id',
      'processed_status',
      'extraction_status',
      'duplicate_group',
      'notes'
    ]
  );
}
