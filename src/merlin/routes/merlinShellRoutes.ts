import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolveOperatorIdentity, resolveOperatorRole } from '../../operatorIdentity.js';
import { connectMerlinSource, getMerlinShellPayload } from '../shellRuntime.js';
import { MERLIN_SYSTEM_WORKSPACE_ID } from '../workspaceRuntime.js';
import { registerProductAdapter } from '../intake/intentRegistry.js';
import { mealscoutAdapter } from '../adapters/mealscoutAdapter.js';
import { assertDriveHealthForMutation, buildDriveAuthUnhealthyPayload } from '../../driveSafety.js';
import { discoverMealScoutIntakeFolders } from '../../mealscoutDriveIntake.js';
import { getDriveClient } from '../../driveClient.js';
import { createDriveFileRecord } from '../../driveIngest.js';
import { createManifestEntry, updateManifestExtraction } from '../../driveManifest.js';

async function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        resolve({ __invalid_body: true });
      }
    });
    req.on('error', () => resolve({ __invalid_body: true }));
  });
}

function responseJson(res: ServerResponse, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function asText(input: unknown): string {
  return typeof input === 'string' ? input.trim() : '';
}

function invalidBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && '__invalid_body' in body;
}

function decodeBase64Content(value: string): Buffer {
  return Buffer.from(value, 'base64');
}

function isInlineTextMimeType(mimeType: string): boolean {
  const lowered = mimeType.toLowerCase();
  return (
    lowered.startsWith('text/') ||
    lowered === 'application/json' ||
    lowered === 'application/pdf' ||
    lowered === 'text/csv' ||
    lowered === 'text/markdown'
  );
}

function ensureProductAdaptersRegistered(): void {
  registerProductAdapter(mealscoutAdapter);
}

export async function handleMerlinShellRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();
  ensureProductAdaptersRegistered();

  if (method === 'GET' && pathname === '/api/merlin/shell') {
    const url = new URL(req.url || '', 'http://localhost');
    const operator = resolveOperatorIdentity(req);
    const role = resolveOperatorRole(req);
    const payload = getMerlinShellPayload({
      workspace_id: asText(url.searchParams.get('workspace_id')) || MERLIN_SYSTEM_WORKSPACE_ID,
      brand: asText(url.searchParams.get('brand')) || undefined,
      q: asText(url.searchParams.get('q')) || undefined,
      thread_id: asText(url.searchParams.get('thread_id')) || undefined
    });
    responseJson(res, {
      ...payload,
      operator,
      operatorRole: role
    });
    return true;
  }

  if (method === 'POST' && pathname === '/api/merlin/connected-sources') {
    const body = await parseBody(req);
    if (invalidBody(body)) return responseJson(res, { error: 'invalid_json', mutationAllowed: false, implementationAllowed: false }, 400), true;
    const payload = (body || {}) as Record<string, unknown>;
    const workspaceId = asText(payload.workspace_id) || MERLIN_SYSTEM_WORKSPACE_ID;
    const sourceKey = asText(payload.source_key);
    if (!sourceKey) {
      responseJson(res, { error: 'validation_error', reason: 'source_key is required', mutationAllowed: false, implementationAllowed: false }, 400);
      return true;
    }
    try {
      const connectedSource = connectMerlinSource({
        workspace_id: workspaceId,
        source_key: sourceKey,
        source_label: asText(payload.source_label) || undefined,
        source_type: asText(payload.source_type) || undefined,
        connection_status: payload.connection_status,
        auth_kind: payload.auth_kind,
        capabilities: payload.capabilities,
        metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata as Record<string, unknown> : undefined
      });
      responseJson(res, { mutationAllowed: false, implementationAllowed: false, connectedSource }, 201);
    } catch (error) {
      responseJson(res, { error: error instanceof Error ? error.message : 'connected_source_upsert_failed', mutationAllowed: false, implementationAllowed: false }, 409);
    }
    return true;
  }

  if (method === 'POST' && pathname === '/api/merlin/drive-buffer/upload') {
    const body = await parseBody(req);
    if (invalidBody(body)) return responseJson(res, { error: 'invalid_json', mutationAllowed: false, implementationAllowed: false }, 400), true;
    const payload = (body || {}) as Record<string, unknown>;
    const files = Array.isArray(payload.files) ? payload.files.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null) : [];
    if (files.length === 0) {
      responseJson(res, { error: 'validation_error', reason: 'files are required', mutationAllowed: false, implementationAllowed: false }, 400);
      return true;
    }

    const driveHealth = await assertDriveHealthForMutation('merlin_drive_buffer_upload');
    if (!driveHealth.ok) {
      responseJson(res, buildDriveAuthUnhealthyPayload(driveHealth.health, 'merlin_drive_buffer_upload'), 409);
      return true;
    }

    const requestedParentFolderId = asText(payload.parent_folder_id);
    const requestedFolderLabel = asText(payload.folder_label) || `browser-buffer-${randomUUID().slice(0, 8)}`;
    const discovery = await discoverMealScoutIntakeFolders({ createMissing: false });
    const parentFolderId = requestedParentFolderId || discovery.folders['incoming/unknown']?.id || discovery.folders['incoming/screenshots']?.id;
    const parentFolderPath = requestedParentFolderId
      ? asText(payload.parent_folder_path) || 'Provided Upload Folder'
      : discovery.folders['incoming/unknown']?.path || discovery.folders['incoming/screenshots']?.path || '';

    if (!parentFolderId || !parentFolderPath) {
      responseJson(
        res,
        {
          error: 'drive_buffer_folder_unavailable',
          reason: 'MealScout incoming buffer folder is unavailable',
          mutationAllowed: false,
          implementationAllowed: false
        },
        409
      );
      return true;
    }

    try {
      const driveClient = getDriveClient();
      const uploadFolder = await driveClient.createFolderIfMissing(requestedFolderLabel, parentFolderId);
      const uploadFolderPath = `${parentFolderPath}/${uploadFolder.name}`;
      const uploadedFiles = [];

      for (const file of files) {
        const fileName = asText(file.fileName);
        const mimeType = asText(file.mimeType) || 'application/octet-stream';
        const base64Content = asText(file.base64Content);
        const textContent = asText(file.textContent) || undefined;
        if (!fileName || !base64Content) {
          responseJson(res, { error: 'validation_error', reason: 'each file requires fileName and base64Content', mutationAllowed: false, implementationAllowed: false }, 400);
          return true;
        }
        if (typeof driveClient.uploadFileToFolder !== 'function') {
          responseJson(res, { error: 'drive_upload_unsupported', mutationAllowed: false, implementationAllowed: false }, 409);
          return true;
        }

        const uploaded = await driveClient.uploadFileToFolder({
          fileName,
          mimeType,
          parentFolderId: uploadFolder.id,
          content: decodeBase64Content(base64Content)
        });

        const fileRecord = createDriveFileRecord({
          drive_file_id: uploaded.drive_file_id,
          file_name: uploaded.file_name,
          mime_type: uploaded.mime_type,
          folder_id: uploadFolder.id,
          folder_path: uploadFolderPath,
          web_url: uploaded.web_url,
          observed_at: new Date().toISOString()
        });
        const manifest = createManifestEntry(fileRecord);
        if (textContent && isInlineTextMimeType(mimeType)) {
          updateManifestExtraction(manifest.id, {
            extracted_text: textContent,
            extraction_status: 'provided_by_browser_shell',
            extracted_at: new Date().toISOString()
          });
        }

        uploadedFiles.push({
          drive_file_id: uploaded.drive_file_id,
          file_name: uploaded.file_name,
          mime_type: uploaded.mime_type,
          web_url: uploaded.web_url,
          folder_id: uploadFolder.id,
          folder_path: uploadFolderPath,
          manifest_id: manifest.id,
          extracted_text_available: Boolean(textContent)
        });
      }

      responseJson(res, {
        status: 'ok',
        mutationAllowed: false,
        implementationAllowed: false,
        driveBufferWritten: true,
        driveFolder: {
          id: uploadFolder.id,
          path: uploadFolderPath,
          parentFolderId
        },
        uploadedFiles,
        threadAttachments: uploadedFiles.map((file) => ({
          fileId: file.drive_file_id,
          fileName: file.file_name,
          mimeType: file.mime_type,
          driveFolderId: uploadFolder.id
        }))
      }, 201);
    } catch (error) {
      responseJson(
        res,
        {
          error: error instanceof Error ? error.message : 'drive_buffer_upload_failed',
          mutationAllowed: false,
          implementationAllowed: false
        },
        409
      );
    }
    return true;
  }

  return false;
}
