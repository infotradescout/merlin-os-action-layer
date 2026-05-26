import { discoverManagedFolders } from './driveSync.js';
import { getDriveAuthConfig, getDriveAuthProfile } from './driveAuth.js';

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
