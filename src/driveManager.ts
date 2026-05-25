import type { DriveFileRecord } from './driveTypes.js';
import { classifyDriveManagedPath, type DriveManagedPathType } from './driveFolders.js';

export interface DriveManagerConfig {
  mode: 'oauth' | 'service_account' | 'manual';
  syncEnabled: boolean;
  rootMode: 'dedicated_drive';
  rootFolderName: string;
  syncMode: 'manual' | 'scheduled';
}

export interface DriveBootstrapPlan {
  root_folder_name: string;
  required_folders: string[];
  reusable_folders: string[];
  missing_folders: string[];
}

export interface DriveRoutingPlan {
  route: 'processed' | 'needs_review' | 'skipped' | 'pending';
  reason: string;
  shouldCreate4dataEvent: boolean;
  shouldArchiveOriginal: boolean;
  shouldMoveToNeedsReview: boolean;
  shouldMoveToProcessed: boolean;
}

function isSupportedFileType(file: Pick<DriveFileRecord, 'mime_type' | 'file_name'>): boolean {
  const mime = file.mime_type.toLowerCase();
  const extension = (file.file_name.slice(file.file_name.lastIndexOf('.')).toLowerCase());
  const supportedMimes = new Set([
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
  const supportedExtensions = new Set(['.pdf', '.txt', '.csv', '.json', '.md', '.docx', '.doc', '.png', '.jpg', '.jpeg', '.eml']);
  return supportedMimes.has(mime) || supportedExtensions.has(extension);
}

export function createDriveBootstrapPlan(existingFolders: string[], rootFolderName = 'Merlin OR Storage'): DriveBootstrapPlan {
  const requiredFolders = [
    `${rootFolderName}/00_Inbox`,
    `${rootFolderName}/01_Processed`,
    `${rootFolderName}/02_Needs_Review`,
    `${rootFolderName}/03_Archived_Sources`,
    `${rootFolderName}/04_Entity_Files`,
    `${rootFolderName}/05_Exports`,
    `${rootFolderName}/06_Audit`,
    `${rootFolderName}/07_System`
  ];
  const normalized = new Set(existingFolders.map((entry) => entry.toLowerCase().replace(/[\\]+/g, '/').trim()));
  const reusableFolders = requiredFolders.filter((folder) => normalized.has(folder.toLowerCase()));
  const missingFolders = requiredFolders.filter((folder) => !normalized.has(folder.toLowerCase()));
  return {
    root_folder_name: rootFolderName,
    required_folders: requiredFolders,
    reusable_folders: reusableFolders,
    missing_folders: missingFolders
  };
}

function planByPath(managedPath: DriveManagedPathType, file: DriveFileRecord): Omit<DriveRoutingPlan, 'shouldArchiveOriginal' | 'shouldMoveToNeedsReview' | 'shouldMoveToProcessed'> {
  if (managedPath === 'system' || managedPath === 'audit') {
    return {
      route: 'skipped',
      reason: `Files under ${managedPath} are reserved and should not create live signals`,
      shouldCreate4dataEvent: false
    };
  }

  if (managedPath === 'needs_review') {
    return {
      route: 'needs_review',
      reason: 'Drive file was placed into needs-review path',
      shouldCreate4dataEvent: false
    };
  }

  if (!file.entity_id) {
    return {
      route: 'needs_review',
      reason: 'Missing entity_id; file cannot be attached to a live entity context',
      shouldCreate4dataEvent: false
    };
  }

  if (managedPath === 'inbox') {
    return {
      route: 'pending',
      reason: 'File is in inbox; wait for processing',
      shouldCreate4dataEvent: false
    };
  }

  if (!isSupportedFileType(file)) {
    return {
      route: 'skipped',
      reason: 'Unsupported file format for 4data extraction',
      shouldCreate4dataEvent: false
    };
  }

  if (file.confidence !== undefined && file.confidence < 0.3) {
    return {
      route: 'needs_review',
      reason: 'Low-confidence extraction result',
      shouldCreate4dataEvent: false
    };
  }

  return {
    route: 'processed',
    reason: 'Supported file is in a routing path for LISA processing',
    shouldCreate4dataEvent: true
  };
}

export function createFileRoutingPlan(file: DriveFileRecord): DriveRoutingPlan {
  const managedPath = classifyDriveManagedPath(file.folder_path);
  const base = planByPath(managedPath, file);
  return {
    ...base,
    shouldArchiveOriginal: managedPath === 'archived',
    shouldMoveToNeedsReview: base.route === 'needs_review',
    shouldMoveToProcessed: base.route === 'processed'
  };
}

export function shouldMoveToProcessed(file: DriveFileRecord): boolean {
  return createFileRoutingPlan(file).shouldMoveToProcessed;
}

export function shouldMoveToNeedsReview(file: DriveFileRecord): boolean {
  return createFileRoutingPlan(file).shouldMoveToNeedsReview;
}

export function shouldArchiveOriginal(file: DriveFileRecord): boolean {
  return createFileRoutingPlan(file).shouldArchiveOriginal;
}

export function parseDriveManagerConfig(
  env: Record<string, string | undefined> = process.env
): DriveManagerConfig {
  const mode = env.MERLIN_DRIVE_MODE === 'oauth' || env.MERLIN_DRIVE_MODE === 'service_account' ? env.MERLIN_DRIVE_MODE : 'manual';
  const syncEnabled = (env.MERLIN_DRIVE_SYNC_ENABLED || 'false').toLowerCase() === 'true';
  const rootMode = env.MERLIN_DRIVE_ROOT_MODE === 'dedicated_drive' ? 'dedicated_drive' : 'dedicated_drive';
  const rootFolderName = env.MERLIN_DRIVE_ROOT_FOLDER_NAME || 'Merlin OR Storage';
  const syncMode = env.MERLIN_DRIVE_SYNC_MODE === 'scheduled' ? 'scheduled' : 'manual';
  return {
    mode,
    syncEnabled,
    rootMode,
    rootFolderName,
    syncMode
  };
}
