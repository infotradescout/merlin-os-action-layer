import { parseDriveManagerConfig, type DriveManagerConfig } from './driveManager.js';

export interface DriveOAuthCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
}

export interface DriveAuthConfig {
  mode: DriveManagerConfig['mode'];
  syncEnabled: DriveManagerConfig['syncEnabled'];
  rootMode: DriveManagerConfig['rootMode'];
  rootFolderName: DriveManagerConfig['rootFolderName'];
  rootFolderId: string | undefined;
  syncMode: DriveManagerConfig['syncMode'];
  oauth: DriveOAuthCredentials;
  serviceAccountKeyPath: string | undefined;
}

export interface DriveAuthProfile {
  configured: boolean;
  ready: boolean;
  reason?: string;
}

export function getDriveAuthConfig(env: Record<string, string | undefined> = process.env): DriveAuthConfig {
  const baseConfig = parseDriveManagerConfig(env);
  return {
    mode: baseConfig.mode,
    syncEnabled: baseConfig.syncEnabled,
    rootMode: baseConfig.rootMode,
    rootFolderName: baseConfig.rootFolderName,
    rootFolderId: env.MERLIN_DRIVE_ROOT_FOLDER_ID,
    syncMode: baseConfig.syncMode,
    oauth: {
      clientId: env.GOOGLE_CLIENT_ID || '',
      clientSecret: env.GOOGLE_CLIENT_SECRET || '',
      redirectUri: env.GOOGLE_REDIRECT_URI || '',
      refreshToken: env.GOOGLE_REFRESH_TOKEN || ''
    },
    serviceAccountKeyPath: env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
  };
}

function isOAuthConfigured(config: DriveAuthConfig): boolean {
  return Boolean(config.oauth.clientId && config.oauth.clientSecret && config.oauth.redirectUri && config.oauth.refreshToken);
}

function isServiceAccountConfigured(config: DriveAuthConfig): boolean {
  return Boolean(config.serviceAccountKeyPath);
}

export function getDriveAuthProfile(config: DriveAuthConfig = getDriveAuthConfig()): DriveAuthProfile {
  if (!config.syncEnabled) {
    return {
      configured: false,
      ready: false,
      reason: 'Drive sync is disabled'
    };
  }
  if (config.mode === 'manual') {
    return {
      configured: true,
      ready: false,
      reason: 'Drive sync is configured for manual mode'
    };
  }
  if (config.mode === 'oauth' && !isOAuthConfigured(config)) {
    return {
      configured: true,
      ready: false,
      reason: 'OAuth credentials are incomplete'
    };
  }
  if (config.mode === 'service_account' && !isServiceAccountConfigured(config)) {
    return {
      configured: true,
      ready: false,
      reason: 'Service account key is not configured'
    };
  }

  return {
    configured: true,
    ready: true
  };
}

