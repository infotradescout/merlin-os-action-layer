import { google, type drive_v3 } from 'googleapis';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
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
  listSubfoldersInFolder?(folderId: string): Promise<DriveFolderInfo[]>;
  getFileMetadata(fileId: string): Promise<DriveFileInfo>;
  downloadFileContent(fileId: string): Promise<string | undefined>;
  downloadFileBinary?(fileId: string): Promise<Buffer | undefined>;
  copyFileToFolder?(fileId: string, targetFolderId: string): Promise<DriveFileInfo>;
  moveFileToFolder(fileId: string, targetFolderId: string, currentParentId?: string): Promise<boolean>;
  trashFile?(fileId: string): Promise<boolean>;
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

  private async coerceMediaPayloadToBuffer(payload: unknown): Promise<Buffer | undefined> {
    if (Buffer.isBuffer(payload)) return payload;
    if (typeof payload === 'string') return Buffer.from(payload, 'utf8');
    if (payload instanceof ArrayBuffer) return Buffer.from(payload);
    if (ArrayBuffer.isView(payload)) return Buffer.from(payload.buffer);
    if (payload instanceof Readable) {
      const chunks: Buffer[] = [];
      for await (const chunk of payload) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      return Buffer.concat(chunks);
    }
    return undefined;
  }

  async getFileMetadata(fileId: string): Promise<DriveFileInfo> {
    const response = await this.drive.files.get({
      fileId,
      supportsAllDrives: true,
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

  async listSubfoldersInFolder(folderId: string): Promise<DriveFolderInfo[]> {
    const response = await this.drive.files.list({
      q: `'${folderId}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'files(id,name)',
      pageSize: 200
    });
    const folders = (response.data.files ?? []) as drive_v3.Schema$File[];
    return folders
      .filter((folder) => Boolean(folder.id) && Boolean(folder.name))
      .map((folder) => ({ id: String(folder.id), name: String(folder.name) }));
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
    const isImage = lowered.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|heif)$/i.test(file.file_name);
    const supported = safeText.has(lowered) || /\.(pdf|txt|csv|json|md|eml)$/i.test(file.file_name) || isImage;

    if (!supported) {
      return undefined;
    }

    const response = await this.drive.files.get(
      {
        fileId,
        supportsAllDrives: true,
        alt: 'media'
      },
      { responseType: 'arraybuffer' }
    );
    const payload = response.data;
    const maybeBuffer = await this.coerceMediaPayloadToBuffer(payload);

    if (maybeBuffer) {
      if (isImage) {
        return runImageOcrBestEffort(maybeBuffer, file.file_name);
      }
      return maybeBuffer.toString('utf8');
    }
    return undefined;
  }

  async downloadFileBinary(fileId: string): Promise<Buffer | undefined> {
    const response = await this.drive.files.get(
      {
        fileId,
        supportsAllDrives: true,
        alt: 'media'
      },
      { responseType: 'arraybuffer' }
    );
    const payload = response.data;
    return this.coerceMediaPayloadToBuffer(payload);
  }

  async copyFileToFolder(fileId: string, targetFolderId: string): Promise<DriveFileInfo> {
    const response = await this.drive.files.copy({
      fileId,
      requestBody: {
        parents: [targetFolderId]
      },
      fields: 'id,name,mimeType,modifiedTime,webViewLink,parents',
      supportsAllDrives: true
    });
    const file = response.data as drive_v3.Schema$File;
    return mapDriveFileInfo(file);
  }

  async moveFileToFolder(fileId: string, targetFolderId: string, currentParentId?: string): Promise<boolean> {
    const resolvedCurrentParent = (currentParentId || '').trim();
    if (resolvedCurrentParent === targetFolderId) {
      return true;
    }

    const updateParams: drive_v3.Params$Resource$Files$Update = {
      fileId,
      addParents: targetFolderId,
      fields: 'id, parents',
      supportsAllDrives: true,
      enforceSingleParent: true
    };

    if (resolvedCurrentParent) {
      updateParams.removeParents = resolvedCurrentParent;
    }

    await this.drive.files.update(updateParams);
    return true;
  }

  async trashFile(fileId: string): Promise<boolean> {
    await this.drive.files.update({
      fileId,
      requestBody: { trashed: true },
      fields: 'id, trashed'
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

function runImageOcrBestEffort(buffer: Buffer, fileName: string): string | undefined {
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '.png';
  const tempDir = mkdtempSync(join(tmpdir(), 'merlin-ocr-'));
  const inputPath = join(tempDir, `input${ext}`);
  try {
    writeFileSync(inputPath, buffer);
    const output = execFileSync(resolveTesseractBinary(), [inputPath, 'stdout', '-l', 'eng'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const trimmed = output.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function resolveTesseractBinary(): string {
  const explicit = process.env.TESSERACT_PATH;
  if (explicit && existsSync(explicit)) return explicit;
  const windowsDefault = 'C:\\Program Files\\Tesseract-OCR\\tesseract.exe';
  if (existsSync(windowsDefault)) return windowsDefault;
  const windowsLocalUser = 'C:\\Users\\flavo\\AppData\\Local\\Programs\\Tesseract-OCR\\tesseract.exe';
  if (existsSync(windowsLocalUser)) return windowsLocalUser;
  return 'tesseract';
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
