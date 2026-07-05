import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  appendMerlinThreadMessage,
  createMerlinThread,
  getMerlinThreadById,
  listMerlinThreadMessages,
  listMerlinThreads,
  updateMerlinThreadState
} from '../threadRuntime.js';
import { registerProductAdapter, validateIntentAgainstRegistry } from '../intake/intentRegistry.js';
import { mealscoutAdapter } from '../adapters/mealscoutAdapter.js';
import { attachFilesToUploadIntent, createUploadIntentRecord, getUploadIntentRecord, setUploadIntentPreview, setUploadIntentRouting } from '../intake/uploadIntentStore.js';
import { routeUploadIntentFiles } from '../intake/router.js';
import { buildPreviewPacket } from '../intake/previewBuilder.js';
import { getEvidenceIdsForUpload, indexEvidenceForUpload } from '../index/evidenceIndex.js';
import type { MerlinActorScope, MerlinBrand, MerlinEntityType, UploadIntentFileRef } from '../intake/intakeTypes.js';
import { buildAccountIntakePacketFromThread, inferMerlinThreadIntent } from '../threadIntentRuntime.js';
import { markDriveFileAttachedToThread, markDriveFilePreviewReady } from '../../driveBufferLifecycle.js';

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

function ensureProductAdaptersRegistered(): void {
  registerProductAdapter(mealscoutAdapter);
}

function asBrand(input: unknown): MerlinBrand | undefined {
  const brand = asText(input).toUpperCase();
  return brand === 'MEALSCOUT' || brand === 'TRADESCOUT' || brand === 'HOMEID' || brand === 'MERLIN' ? brand : undefined;
}

function asActorScope(input: unknown): MerlinActorScope | undefined {
  const actorScope = asText(input).toLowerCase();
  return ['owner', 'customer', 'homeowner', 'contractor', 'staff', 'admin', 'rep', 'system'].includes(actorScope) ? actorScope as MerlinActorScope : undefined;
}

function asEntityType(input: unknown): MerlinEntityType | undefined {
  const entityType = asText(input).toLowerCase();
  return ['food_truck', 'restaurant', 'home', 'contractor', 'host_location', 'event', 'unknown'].includes(entityType) ? entityType as MerlinEntityType : undefined;
}

function parseFiles(input: unknown): UploadIntentFileRef[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      fileId: asText(row.fileId),
      fileName: asText(row.fileName) || undefined,
      mimeType: asText(row.mimeType) || undefined,
      driveFolderId: asText(row.driveFolderId) || undefined,
      extractedText: asText(row.extractedText) || undefined,
      metadata: row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : undefined
    }))
    .filter((row) => row.fileId);
}

export async function handleMerlinThreadRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();
  ensureProductAdaptersRegistered();

  if (method === 'GET' && pathname === '/api/merlin/threads') {
    const url = new URL(req.url || '', 'http://localhost');
    const workspaceId = asText(url.searchParams.get('workspace_id'));
    if (!workspaceId) return responseJson(res, { error: 'workspace_id_required', mutationAllowed: false, implementationAllowed: false }, 400), true;
    responseJson(res, {
      mutationAllowed: false,
      implementationAllowed: false,
      threads: listMerlinThreads({
        workspace_id: workspaceId,
        limit: Number(url.searchParams.get('limit') || '50')
      })
    });
    return true;
  }

  if (method === 'POST' && pathname === '/api/merlin/threads') {
    const body = await parseBody(req);
    if (invalidBody(body)) return responseJson(res, { error: 'invalid_json', mutationAllowed: false, implementationAllowed: false }, 400), true;
    const payload = (body || {}) as Record<string, unknown>;
    try {
      const thread = createMerlinThread({
        workspace_id: asText(payload.workspace_id),
        title: asText(payload.title) || undefined,
        brand: asText(payload.brand) || undefined,
        actor_scope: asText(payload.actor_scope) || undefined,
        entity_type: asText(payload.entity_type) || undefined,
        entity_id: asText(payload.entity_id) || undefined,
        action_id: asText(payload.action_id) || undefined
      });
      responseJson(res, { mutationAllowed: false, implementationAllowed: false, thread }, 201);
    } catch (error) {
      responseJson(res, { error: error instanceof Error ? error.message : 'thread_create_failed', mutationAllowed: false, implementationAllowed: false }, 409);
    }
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/merlin\/threads\/([^/]+)$/);
  if (method === 'GET' && detailMatch) {
    const thread = getMerlinThreadById(decodeURIComponent(detailMatch[1]));
    if (!thread) return responseJson(res, { error: 'thread_not_found', mutationAllowed: false, implementationAllowed: false }, 404), true;
    responseJson(res, {
      mutationAllowed: false,
      implementationAllowed: false,
      thread,
      messages: listMerlinThreadMessages(thread.id)
    });
    return true;
  }

  const messagesMatch = pathname.match(/^\/api\/merlin\/threads\/([^/]+)\/messages$/);
  if (messagesMatch) {
    const threadId = decodeURIComponent(messagesMatch[1]);
    if (method === 'GET') {
      if (!getMerlinThreadById(threadId)) return responseJson(res, { error: 'thread_not_found', mutationAllowed: false, implementationAllowed: false }, 404), true;
      responseJson(res, { mutationAllowed: false, implementationAllowed: false, messages: listMerlinThreadMessages(threadId) });
      return true;
    }
    if (method === 'POST') {
      const body = await parseBody(req);
      if (invalidBody(body)) return responseJson(res, { error: 'invalid_json', mutationAllowed: false, implementationAllowed: false }, 400), true;
      const payload = (body || {}) as Record<string, unknown>;
      try {
        const message = appendMerlinThreadMessage({
          thread_id: threadId,
          role: (asText(payload.role).toLowerCase() || 'user') as 'user' | 'assistant' | 'system',
          message_text: asText(payload.message_text),
          attachments: parseFiles(payload.attachments),
          metadata: payload.metadata && typeof payload.metadata === 'object' ? payload.metadata as Record<string, unknown> : undefined
        });
        for (const attachment of message.attachments) {
          if (attachment.fileId) {
            markDriveFileAttachedToThread({
              drive_file_id: attachment.fileId,
              thread_id: threadId,
              note: 'attached_via_merlin_thread'
            });
          }
        }
        responseJson(res, { mutationAllowed: false, implementationAllowed: false, message }, 201);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'thread_message_failed';
        responseJson(res, { error: message, mutationAllowed: false, implementationAllowed: false }, message === 'thread_not_found' ? 404 : 409);
      }
      return true;
    }
  }

  const handoffMatch = pathname.match(/^\/api\/merlin\/threads\/([^/]+)\/intent-handoff$/);
  if (method === 'POST' && handoffMatch) {
    const threadId = decodeURIComponent(handoffMatch[1]);
    const thread = getMerlinThreadById(threadId);
    if (!thread) return responseJson(res, { error: 'thread_not_found', mutationAllowed: false, implementationAllowed: false }, 404), true;
    const body = await parseBody(req);
    if (invalidBody(body)) return responseJson(res, { error: 'invalid_json', mutationAllowed: false, implementationAllowed: false }, 400), true;
    const payload = (body || {}) as Record<string, unknown>;
    const threadMessages = listMerlinThreadMessages(threadId);
    const inferredIntent = inferMerlinThreadIntent({
      messageText: [
        asText(payload.userHint),
        ...threadMessages.map((row) => row.message_text)
      ].filter(Boolean).join('\n'),
      files: parseFiles(payload.files).length
        ? parseFiles(payload.files)
        : threadMessages.flatMap((row) => row.attachments),
      brand: asText(payload.brand || thread.brand),
      actorScope: asText(payload.actorScope || thread.actor_scope),
      entityType: asText(payload.entityType || thread.entity_type),
      actionId: asText(payload.actionId || thread.action_id)
    });
    const brand = asBrand(payload.brand || thread.brand || inferredIntent.brand);
    const actorScope = asActorScope(payload.actorScope || thread.actor_scope || inferredIntent.actorScope);
    const entityType = asEntityType(payload.entityType || thread.entity_type || inferredIntent.entityType);
    const actionId = asText(payload.actionId || thread.action_id || inferredIntent.actionId);
    if (!brand || !actorScope || !entityType || !actionId) {
      return responseJson(res, { error: 'invalid_intent_context', mutationAllowed: false, implementationAllowed: false }, 400), true;
    }
    const validation = validateIntentAgainstRegistry({
      brand,
      actionId,
      actorScope,
      entityType,
      entityId: asText(payload.entityId || thread.entity_id) || undefined,
      userHint: asText(payload.userHint) || inferredIntent.userHint || undefined
    });
    if (!validation.ok) {
      return responseJson(res, { error: validation.code, reason: validation.message, mutationAllowed: false, implementationAllowed: false }, 400), true;
    }
    const files = parseFiles(payload.files).length
      ? parseFiles(payload.files)
      : threadMessages.flatMap((row) => row.attachments);
    const accountPacket = actionId === 'account_intake_review'
      ? buildAccountIntakePacketFromThread({
          files,
          actorScope: actorScope === 'owner' || actorScope === 'staff' || actorScope === 'admin' ? actorScope : 'staff',
          entityId: asText(payload.entityId || thread.entity_id) || undefined
        })
      : undefined;
    const augmentedFiles = accountPacket
      ? files.map((file, index) => index === 0
          ? {
              ...file,
              metadata: {
                ...(file.metadata || {}),
                universalProductUpdatePacket: accountPacket
              }
            }
          : file)
      : files;
    const uploadIntent = createUploadIntentRecord({
      userId: asText(payload.userId) || 'merlin-thread-user',
      accountId: asText(payload.accountId) || thread.workspace_id,
      brand,
      actorScope,
      entityType,
      entityId: asText(payload.entityId || thread.entity_id) || undefined,
      actionId,
      userHint: asText(payload.userHint) || inferredIntent.userHint || undefined,
      actionSnapshot: validation.action
    });
    const attached = augmentedFiles.length ? attachFilesToUploadIntent(uploadIntent.uploadId, augmentedFiles) || uploadIntent : uploadIntent;
    const routing = routeUploadIntentFiles(attached);
    const routed = setUploadIntentRouting(uploadIntent.uploadId, routing) || attached;
    indexEvidenceForUpload(routed, routing);
    const preview = buildPreviewPacket(routed, routing, getEvidenceIdsForUpload(uploadIntent.uploadId));
    const previewed = setUploadIntentPreview(uploadIntent.uploadId, preview) || routed;
    const updatedThread = updateMerlinThreadState({
      thread_id: threadId,
      brand,
      actor_scope: actorScope,
      entity_type: entityType,
      entity_id: asText(payload.entityId || thread.entity_id) || undefined,
      action_id: actionId,
      latest_upload_intent_id: uploadIntent.uploadId,
      latest_preview_upload_intent_id: uploadIntent.uploadId,
      status: preview.holdReasons.length > 0 ? 'waiting_for_user' : 'ready_for_preview'
    });
    const handoffMessage = appendMerlinThreadMessage({
      thread_id: threadId,
      role: 'assistant',
      message_text: preview.holdReasons.length > 0
        ? 'Merlin staged a preview but still needs review on held evidence before any future apply path.'
        : 'Merlin staged a preview from this thread and attached the current evidence set.',
      linked_upload_intent_id: uploadIntent.uploadId,
      metadata: {
        handoff: 'upload_intent_preview_ready',
        holdReasons: preview.holdReasons,
        inferredIntentReasons: inferredIntent.reasons
      }
    });
    for (const file of augmentedFiles) {
      if (file.fileId) {
        markDriveFilePreviewReady({
          drive_file_id: file.fileId,
          thread_id: threadId,
          upload_intent_id: uploadIntent.uploadId,
          note: 'preview_ready_from_merlin_thread'
        });
      }
    }
    responseJson(res, {
      mutationAllowed: false,
      implementationAllowed: false,
      thread: updatedThread,
      uploadIntent: previewed,
      message: handoffMessage,
      inferredIntent
    }, 201);
    return true;
  }

  return false;
}
