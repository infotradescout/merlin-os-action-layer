import { classifyDriveManagedPath } from './driveFolders.js';
import { discoverManagedFolders } from './driveSync.js';
import { getDriveClient } from './driveClient.js';
import { getDriveAuthConfig, getDriveAuthProfile } from './driveAuth.js';
import { getRecentManifestEntries } from './driveManifest.js';

export interface DriveAuthHealthAuth {
  ready: boolean;
  configured: boolean;
  reason: string | null;
  checkedAt: string;
}

export interface DriveAuthHealthManagedFolders {
  ready: boolean;
  missing: string[];
}

export interface DriveAuthHealthResponse {
  status: 'ready' | 'disabled';
  auth: DriveAuthHealthAuth;
  managedFolders: DriveAuthHealthManagedFolders;
}

export type DriveDriftType =
  | 'missing_drive_file'
  | 'wrong_folder'
  | 'duplicate_location'
  | 'manifest_without_drive_file'
  | 'drive_file_without_manifest'
  | 'stale_folder_path'
  | 'unknown_managed_folder';

export type DriveDriftSeverity = 'blocking' | 'warning';

export interface DriveDriftObservedState {
  folder_path?: string;
}

export interface DriveReconciliationDrift {
  drive_file_id: string;
  type: DriveDriftType;
  severity: DriveDriftSeverity;
  expected: DriveDriftObservedState;
  actual: DriveDriftObservedState;
  message: string;
  detectedAt: string;
}

export interface DriveReconciliationSummary {
  checked: number;
  driftCount: number;
  blockingCount: number;
  warningCount: number;
}

export interface DriveReconciliationResponse {
  status: 'ok';
  mode: 'read_only';
  checkedAt: string;
  summary: DriveReconciliationSummary;
  drift: DriveReconciliationDrift[];
}

interface FolderIdentity {
  id: string;
  path: string;
}

interface ObservedDriveFile {
  driveFileId: string;
  folderId: string;
  folderPath: string;
}

type FolderAlias = keyof typeof DISCOVERED_FOLDER_ALIAS_TO_CANONICAL_PATH;

const DISCOVERED_FOLDER_ALIAS_TO_CANONICAL_PATH = {
  '00_Inbox': '00_Inbox',
  '01_Processed': '01_Processed',
  '02_Needs_Review': '02_Needs_Review',
  '03_Archived_Sources': '03_Archived_Sources',
  '04_Entity_Files': '04_Entity_Files',
  '05_Exports': '05_Exports',
  '06_Audit': '06_Audit',
  '07_System': '07_System'
} as const;

function toMissingFolderName(folderPath: string): string {
  const basename = folderPath.split('/').pop() || folderPath;
  return basename.replace(/^\d+_/, '').replace(/\s+/g, '_').toLowerCase();
}

function isManagedFoldersReady(
  authReady: boolean,
  discoveryStatus: 'ready' | 'disabled' | 'error',
  syncBlocked: boolean
): boolean {
  return authReady && discoveryStatus === 'ready' && !syncBlocked;
}

export function severityFromDriftType(type: DriveDriftType): DriveDriftSeverity {
  if (type === 'wrong_folder' || type === 'missing_drive_file' || type === 'duplicate_location') {
    return 'blocking';
  }
  return 'warning';
}

function isManagedFolderAlias(folderAlias: string): folderAlias is FolderAlias {
  return folderAlias in DISCOVERED_FOLDER_ALIAS_TO_CANONICAL_PATH;
}

function normalizeFolderPath(value: string | undefined): string {
  return (value || '').toLowerCase().replace(/\\/g, '/').replace(/\/+/g, '/');
}

function makeExpectedPath(file: Omit<ObservedDriveFile, 'driveFileId'>): string {
  return file.folderPath;
}

function makeDrivePathFromAlias(folderAlias: FolderAlias, managedFolders: Record<string, FolderIdentity>): string {
  return managedFolders[folderAlias]?.path || '';
}

function toReconciliationDrift(
  driveFileId: string,
  type: DriveDriftType,
  expectedPath: string,
  actualPath: string,
  message: string
): DriveReconciliationDrift {
  const now = new Date().toISOString();
  return {
    drive_file_id: driveFileId,
    type,
    severity: severityFromDriftType(type),
    expected: {
      folder_path: expectedPath || undefined
    },
    actual: {
      folder_path: actualPath || undefined
    },
    message,
    detectedAt: now
  };
}

function getDriveFoldersIndex(managedFolders: Record<string, FolderIdentity>): {
  byId: Map<string, FolderAlias>;
  byAlias: Map<FolderAlias, string>;
} {
  const byId = new Map<string, FolderAlias>();
  const byAlias = new Map<FolderAlias, string>();

  for (const [folderAlias, folder] of Object.entries(managedFolders)) {
    if (!isManagedFolderAlias(folderAlias)) {
      continue;
    }
    const alias = folderAlias;
    const folderId = folder.id;
    const path = folder.path;
    if (!folderId) continue;
    byId.set(folderId, alias);
    byAlias.set(alias, path);
  }

  return { byId, byAlias };
}

function detectPathDrift(
  manifestFolderPath: string,
  expectedFolderAlias: FolderAlias,
  actualFolderPath: string
): DriveDriftType | null {
  const normalizedExpected = normalizeFolderPath(actualFolderPath);
  const normalizedManifest = normalizeFolderPath(manifestFolderPath);
  const exactManagedAliasPath = makeDrivePathFromAlias(expectedFolderAlias, {
    ...Object.fromEntries(
      Object.entries(DISCOVERED_FOLDER_ALIAS_TO_CANONICAL_PATH).map(([alias, canonical]) => [alias, { id: alias, path: canonical }])
    )
  } as never);

  if (normalizedManifest.startsWith(normalizedExpected)) {
    return null;
  }

  if (classifyDriveManagedPath(manifestFolderPath) !== 'unknown' && classifyDriveManagedPath(actualFolderPath) !== 'unknown') {
    return 'wrong_folder';
  }

  return 'stale_folder_path';
}

async function discoverDriveFilesByFolder(
  managedFolders: Record<string, FolderIdentity>
): Promise<Map<string, ObservedDriveFile>> {
  const files = new Map<string, ObservedDriveFile>();
  const authConfig = getDriveAuthConfig();
  const client = getDriveClient(authConfig);

  for (const [alias, folder] of Object.entries(managedFolders)) {
    if (!folder.id || !alias) continue;
    const folderFiles = await client.listFilesInFolder(folder.id);
    for (const file of folderFiles) {
      const existing = files.get(file.drive_file_id);
      if (existing) {
        continue;
      }
      files.set(file.drive_file_id, {
        driveFileId: file.drive_file_id,
        folderId: folder.id,
        folderPath: folder.path
      });
    }
  }

  return files;
}

export async function runDriveReconciliation(): Promise<DriveReconciliationResponse> {
  const checkedAt = new Date().toISOString();
  const drift: DriveReconciliationDrift[] = [];
  const discovery = await discoverManagedFolders();
  const checkedManifestEntries = getRecentManifestEntries(10000);
  const manifestDriveFileIds = new Map<string, number>();
  const folderIndex = getDriveFoldersIndex(discovery.managed_folders);
  const canObserveDrive = discovery.status === 'ready' && !discovery.sync_blocked;
  const driveFileIndex = canObserveDrive ? await discoverDriveFilesByFolder(discovery.managed_folders) : new Map<string, ObservedDriveFile>();
  const totalChecked = checkedManifestEntries.length + driveFileIndex.size;

  for (const manifestEntry of checkedManifestEntries) {
    const fileId = manifestEntry.drive_file_id;
    manifestDriveFileIds.set(fileId, (manifestDriveFileIds.get(fileId) ?? 0) + 1);

    const observedDriveFile = driveFileIndex.get(fileId);
    if (!canObserveDrive) {
      continue;
    }

    if (!observedDriveFile) {
      const detectedPathType = classifyDriveManagedPath(manifestEntry.folder_path);
      drift.push(
        toReconciliationDrift(
          fileId,
          detectedPathType === 'unknown' ? 'manifest_without_drive_file' : 'missing_drive_file',
          '',
          manifestEntry.folder_path,
          `Drive file ${fileId} is missing from observed managed folders`
        )
      );
      continue;
    }

    const expectedAlias = folderIndex.byId.get(observedDriveFile.folderId);
    if (!expectedAlias) {
      drift.push(
        toReconciliationDrift(
          fileId,
          'unknown_managed_folder',
          makeDrivePathFromAlias('00_Inbox', discovery.managed_folders),
          observedDriveFile.folderPath,
          `Drive file ${fileId} is in an unknown managed folder`
        )
      );
      continue;
    }

    const expectedPath = makeDrivePathFromAlias(expectedAlias, discovery.managed_folders);
    const driftType = detectPathDrift(manifestEntry.folder_path, expectedAlias, observedDriveFile.folderPath);
    if (driftType) {
      drift.push(
        toReconciliationDrift(
          fileId,
          driftType,
          expectedPath,
          manifestEntry.folder_path,
          `Manifest folder path does not match Drive location for ${fileId}`
        )
      );
    }
  }

  for (const [fileId, observedFile] of driveFileIndex.entries()) {
    if (!manifestDriveFileIds.has(fileId)) {
      drift.push(
        toReconciliationDrift(
          fileId,
          'drive_file_without_manifest',
          observedFile.folderPath,
          '',
          `Drive file ${fileId} has no manifest entry`
        )
      );
    }
  }

  for (const [fileId, count] of manifestDriveFileIds.entries()) {
    if (count > 1) {
      drift.push(
        toReconciliationDrift(
          fileId,
          'duplicate_location',
          '',
          '',
          `Drive file ${fileId} has duplicate manifest entries`
        )
      );
    }
  }

  const blockingCount = drift.filter((entry) => entry.severity === 'blocking').length;
  const warningCount = drift.filter((entry) => entry.severity === 'warning').length;

  return {
    status: 'ok',
    mode: 'read_only',
    checkedAt,
    summary: {
      checked: totalChecked,
      driftCount: drift.length,
      blockingCount,
      warningCount
    },
    drift
  };
}

export async function getDriveAuthHealth(): Promise<DriveAuthHealthResponse> {
  const checkedAt = new Date().toISOString();
  const authConfig = getDriveAuthConfig();
  const authProfile = getDriveAuthProfile(authConfig);

  const discovery = await discoverManagedFolders();
  const managedFoldersReady = isManagedFoldersReady(authProfile.ready, discovery.status, discovery.sync_blocked);
  const missingFolders = managedFoldersReady
    ? []
    : discovery.bootstrap_plan.missing_folders.map((folderPath) => toMissingFolderName(folderPath));

  return {
    status: managedFoldersReady ? 'ready' : 'disabled',
    auth: {
      ready: authProfile.ready,
      configured: authProfile.configured,
      reason: authProfile.reason ?? null,
      checkedAt
    },
    managedFolders: {
      ready: managedFoldersReady,
      missing: missingFolders
    }
  };
}
