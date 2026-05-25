import { google, type drive_v3 } from 'googleapis';
import { randomUUID } from 'node:crypto';
import { getDriveAuthConfig, getDriveAuthProfile, type DriveAuthConfig } from './driveAuth.js';

export interface DriveFolderInfo {
  id: string;
  name: string;
}

export interface DriveFileInfo {
  drive_file_id: string;
  file_name: string;
  mime_type: string;
  folder_id: string;
  web_url: string;
  modified_time?: string;
  entity_id?: string;
  raw_metadata?: Record<string, unknown>;
}

export interface DriveClient {
  listFilesInFolder(folderId: string): Promise<DriveFileInfo[]>;
  getFileMetadata(fileId: string): Promise<DriveFileInfo>;
  downloadFileContent(fileId: string): Promise<string | undefined>;
  moveFileToFolder(fileId: string, targetFolderId: string): Promise<boolean>;
  findFolderByName(name: string, parentFolderId: string): Promise<DriveFolderInfo | undefined>;
  listFoldersByName(name: string, parentFolderId: string): Promise<DriveFolderInfo[]>;
  createFolderIfMissing(name: string, parentFolderId: string): Promise<DriveFolderInfo>;
}

type DriveClientFactory = (config: DriveAuthConfig) => DriveClient;

class GoogleDriveClient implements DriveClient {
  private readonly drive;

  constructor(config: DriveAuthConfig) {
    const oauth = config.oauth;
    const auth = new google.auth.OAuth2(oauth.clientId, oauth.clientSecret, oauth.redirectUri);
    if (oauth.refreshToken) {
      auth.setCredentials({ refresh_token: oauth.refreshToken });
    }
    this.drive = google.drive({ version: 'v3', auth });
  }

  async getFileMetadata(fileId: string): Promise<DriveFileInfo> {
    const response = await this.drive.files.get({
      fileId,
      fields: 'id,name,mimeType,modifiedTime,webViewLink,parents'
    });
    const file = response.data as drive_v3.Schema$File;
    return mapDriveFileInfo(file);
  }

  async listFilesInFolder(folderId: string): Promise<DriveFileInfo[]> {
    const response = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`,
      fields: 'files(id,name,mimeType,modifiedTime,webViewLink,parents)',
      pageSize: 200,
      pageToken: undefined
    });
    const files = (response.data.files ?? []) as drive_v3.Schema$File[];
    return files
      .filter((file) => Boolean(file.id) && Boolean(file.name))
      .map(mapDriveFileInfo);
  }

  async downloadFileContent(fileId: string): Promise<string | undefined> {
    const file = await this.getFileMetadata(fileId);
    const lowered = file.mime_type.toLowerCase();
    const safeText = new Set([
      'application/pdf',
      'text/plain',
      'text/csv',
      'text/markdown',
      'application/json',
      'message/rfc822'
    ]);
    const supported = safeText.has(lowered) || /\.(pdf|txt|csv|json|md|eml)$/i.test(file.file_name);

    if (!supported) {
      return undefined;
    }

    const response = await this.drive.files.get({
      fileId,
      alt: 'media'
    });
    const payload = response.data;
    if (typeof payload === 'string') return payload;
    if (Buffer.isBuffer(payload)) return payload.toString('utf8');
    if (ArrayBuffer.isView(payload)) return Buffer.from(payload.buffer).toString('utf8');
    return undefined;
  }

  async moveFileToFolder(fileId: string, targetFolderId: string): Promise<boolean> {
    const file = await this.drive.files.get({
      fileId,
      fields: 'parents,id'
    });
    const parentList = (file.data.parents ?? []).filter((parent: string | null | undefined): parent is string => parent !== undefined && parent !== null);
    const removeParents = parentList.filter((parent: string) => parent !== targetFolderId).join(',');
    await this.drive.files.update({
      fileId,
      addParents: targetFolderId,
      removeParents,
      fields: 'id, parents'
    });
    return true;
  }

  async findFolderByName(name: string, parentFolderId: string): Promise<DriveFolderInfo | undefined> {
    const matches = await this.listFoldersByName(name, parentFolderId);
    return matches[0];
  }

  async listFoldersByName(name: string, parentFolderId: string): Promise<DriveFolderInfo[]> {
    const response = await this.drive.files.list({
      q: `name = '${name.replace(/'/g, "\\'")}' and '${parentFolderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'files(id,name)',
      pageSize: 10
    });
    const matches = (response.data.files ?? [])
      .filter((file) => Boolean(file.id && file.name))
      .map((file) => ({ id: String(file.id), name: String(file.name) }));
    return matches;
  }

  async createFolderIfMissing(name: string, parentFolderId: string): Promise<DriveFolderInfo> {
    const created = await this.drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId]
      },
      fields: 'id,name'
    });
    const folderId = created.data.id || `drive-folder-${randomUUID()}`;
    return {
      id: folderId,
      name: created.data.name || name
    };
  }
}

function mapDriveFileInfo(file: drive_v3.Schema$File): DriveFileInfo {
  const id = file.id || '';
  const name = file.name || '';
  const mimeType = file.mimeType || 'application/octet-stream';
  const folderId = (file.parents?.[0] || '').trim();
  const webUrl = file.webViewLink || '';
  const modifiedTime = file.modifiedTime || undefined;

  return {
    drive_file_id: id,
    file_name: name,
    mime_type: mimeType,
    folder_id: folderId,
    web_url: webUrl,
    modified_time: modifiedTime,
    raw_metadata: undefined
  };
}

let clientFactory: DriveClientFactory = (config) => new GoogleDriveClient(config);

export function setDriveClientFactory(factory: DriveClientFactory): void {
  clientFactory = factory;
}

export function resetDriveClientFactory(): void {
  clientFactory = (config) => new GoogleDriveClient(config);
}

export function getDriveClient(config: DriveAuthConfig = getDriveAuthConfig()): DriveClient {
  const profile = getDriveAuthProfile(config);
  if (!profile.ready) {
    throw new Error(profile.reason || 'Drive client unavailable');
  }
  return clientFactory(config);
}
