import {
  type DriveFileRecord,
  type DriveProcessingStatus,
  type DriveRawFileInput,
  type DriveSourceMetadata
} from './driveTypes.js';

const PROCESSING_STATUS_BY_PATH: ReadonlyArray<{ marker: string; status: DriveProcessingStatus }> = [
  { marker: '/01_Processed/', status: 'processed' },
  { marker: '01_Processed', status: 'processed' },
  { marker: '/02_Needs_Review/', status: 'needs_review' },
  { marker: '02_Needs_Review', status: 'needs_review' },
  { marker: '/03_Archived_Sources/', status: 'archived' },
  { marker: '03_Archived_Sources', status: 'archived' },
  { marker: '/00_Inbox/', status: 'pending' },
  { marker: '00_Inbox', status: 'pending' },
  { marker: '/04_Entity_Files/', status: 'processed' },
  { marker: '04_Entity_Files', status: 'processed' }
];

const SUPPORTED_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'message/rfc822'
]);

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.txt', '.csv', '.json', '.md', '.docx', '.doc', '.png', '.jpg', '.jpeg', '.eml']);

function normalizePath(value: string): string {
  return value.toLowerCase();
}

function extractExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot < 0) return '';
  return fileName.slice(lastDot).toLowerCase();
}

function pickStatus(path: string): DriveProcessingStatus {
  const normalized = normalizePath(path);
  const hit = PROCESSING_STATUS_BY_PATH.find((entry) => normalized.includes(entry.marker.toLowerCase()));
  return hit ? hit.status : 'inbox';
}

function nowIso(): string {
  return new Date().toISOString();
}

export function classifyDriveFolderPath(path: string): DriveProcessingStatus {
  if (!path) {
    return 'inbox';
  }
  return pickStatus(path);
}

export function createDriveFileRecord(input: DriveRawFileInput): DriveFileRecord {
  const status = classifyDriveFolderPath(input.folder_path);
  const now = input.observed_at || nowIso();
  const includeProcessedAt = status === 'processed' || status === 'needs_review' || status === 'archived';
  return {
    drive_file_id: input.drive_file_id,
    file_name: input.file_name,
    mime_type: input.mime_type,
    folder_id: input.folder_id || `${normalizePath(input.folder_path).split('/').filter(Boolean).slice(-1)[0] || 'unknown-folder'}`,
    folder_path: input.folder_path,
    web_url: input.web_url,
    source_type: 'google_drive_file',
    processing_status: status,
    observed_at: now,
    processed_at: includeProcessedAt ? now : undefined,
    extracted_summary: input.extracted_summary,
    extracted_fields: input.extracted_fields,
    confidence: input.confidence,
    entity_id: input.entity_id
  };
}

export function mapDriveFileToSourceRecord(file: DriveFileRecord): DriveSourceMetadata {
  return {
    drive_file_id: file.drive_file_id,
    file_name: file.file_name,
    mime_type: file.mime_type,
    folder_id: file.folder_id,
    web_url: file.web_url,
    source_type: 'google_drive_file'
  };
}

function isSupportedFile(file: DriveFileRecord): boolean {
  const hasSupportedType = SUPPORTED_MIME_TYPES.has(file.mime_type.toLowerCase());
  const hasSupportedExtension = SUPPORTED_EXTENSIONS.has(extractExtension(file.file_name));
  return hasSupportedType || hasSupportedExtension;
}

export function shouldCreate4dataEvent(fileRecord: DriveFileRecord): boolean {
  if (
    fileRecord.processing_status === 'needs_review' ||
    fileRecord.processing_status === 'inbox' ||
    fileRecord.processing_status === 'pending'
  ) {
    return false;
  }
  if (!isSupportedFile(fileRecord)) {
    return false;
  }
  if (fileRecord.confidence !== undefined && fileRecord.confidence < 0.3) {
    return false;
  }
  return true;
}
