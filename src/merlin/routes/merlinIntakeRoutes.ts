import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  createMerlinIntakeItem,
  generateActionCardsFromMerlinIntakeItem,
  getMerlinIntakeItemById,
  listMerlinIntakeActionCardLinks,
  listMerlinIntakeHistory,
  listMerlinIntakeItems,
  updateMerlinIntakeStatus,
  type MerlinIntakeStatus,
  type MerlinSourceType
} from '../intakeRuntime.js';
import { mealscoutAdapter } from '../adapters/mealscoutAdapter.js';
import { getMerlinIntakeFlags, isMerlinIntakeEnabled, isProductIntakeEnabled } from '../intake/intakeFeatureFlags.js';
import type { MerlinActorScope, MerlinBrand, MerlinEntityType, UploadIntentFileRef } from '../intake/intakeTypes.js';
import { getRegisteredActions, registerProductAdapter, validateIntentAgainstRegistry } from '../intake/intentRegistry.js';
import {
  attachFilesToUploadIntent,
  createUploadIntentRecord,
  getUploadIntentRecord,
  setUploadIntentPreview,
  setUploadIntentRouting
} from '../intake/uploadIntentStore.js';
import { routeUploadIntentFiles } from '../intake/router.js';
import { buildPreviewPacket } from '../intake/previewBuilder.js';
import { getEvidenceIdsForUpload, indexEvidenceForUpload } from '../index/evidenceIndex.js';

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

const ALLOWED_STATUSES = new Set<MerlinIntakeStatus>(['received', 'classified', 'needs_more_data', 'action_cards_generated', 'blocked', 'resolved', 'failed']);
const ALLOWED_SOURCE_TYPES = new Set<MerlinSourceType>(['drive', 'gmail', 'calendar', 'github', 'app', 'manual', 'web', 'voice', 'upload']);
const BRANDS = new Set<MerlinBrand>(['MEALSCOUT', 'TRADESCOUT', 'HOMEID', 'MERLIN']);
const ACTOR_SCOPES = new Set<MerlinActorScope>(['owner', 'customer', 'homeowner', 'contractor', 'staff', 'admin', 'rep', 'system']);
const ENTITY_TYPES = new Set<MerlinEntityType>(['food_truck', 'restaurant', 'home', 'contractor', 'host_location', 'event', 'unknown']);

function ensureProductAdaptersRegistered(): void {
  registerProductAdapter(mealscoutAdapter);
}

function asBrand(input: unknown): MerlinBrand | undefined {
  const brand = asText(input).toUpperCase() as MerlinBrand;
  return BRANDS.has(brand) ? brand : undefined;
}

function asActorScope(input: unknown): MerlinActorScope | undefined {
  const actorScope = asText(input).toLowerCase() as MerlinActorScope;
  return ACTOR_SCOPES.has(actorScope) ? actorScope : undefined;
}

function asEntityType(input: unknown): MerlinEntityType | undefined {
  const entityType = asText(input).toLowerCase() as MerlinEntityType;
  return ENTITY_TYPES.has(entityType) ? entityType : undefined;
}

function parseUploadIntentFiles(input: unknown): UploadIntentFileRef[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
    .map((row) => ({
      fileId: asText(row.fileId),
      fileName: asText(row.fileName) || undefined,
      mimeType: asText(row.mimeType) || undefined,
      driveFolderId: asText(row.driveFolderId) || undefined,
      extractedText: asText(row.extractedText) || undefined,
      metadata: row.metadata && typeof row.metadata === 'object' ? (row.metadata as Record<string, unknown>) : undefined
    }))
    .filter((row) => row.fileId);
}

export async function handleMerlinIntakeRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();
  ensureProductAdaptersRegistered();

  if (method === 'GET' && pathname === '/api/merlin/intake/flags') {
    responseJson(res, { mutationAllowed: false, implementationAllowed: false, flags: getMerlinIntakeFlags() });
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/intake/actions') {
    const url = new URL(req.url || '', 'http://localhost');
    const brand = asText(url.searchParams.get('brand')).toUpperCase();
    const actions = getRegisteredActions().filter((row) => !brand || row.brand === brand);
    responseJson(res, { mutationAllowed: false, implementationAllowed: false, actions });
    return true;
  }

  if (method === 'POST' && pathname === '/api/merlin/intake/upload-intents') {
    if (!isMerlinIntakeEnabled()) {
      responseJson(res, { error: 'MERLIN_INTAKE_DISABLED', mutationAllowed: false, implementationAllowed: false }, 503);
      return true;
    }
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'INVALID_JSON', mutationAllowed: false, implementationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const brand = asBrand(payload.brand);
    const actorScope = asActorScope(payload.actorScope);
    const entityType = asEntityType(payload.entityType);
    const actionId = asText(payload.actionId);
    if (!brand || !actorScope || !entityType || !actionId) {
      responseJson(res, { error: 'INVALID_INTENT', mutationAllowed: false, implementationAllowed: false }, 400);
      return true;
    }
    if (!isProductIntakeEnabled(brand)) {
      responseJson(res, { error: 'PRODUCT_INTAKE_DISABLED', mutationAllowed: false, implementationAllowed: false }, 503);
      return true;
    }
    const validation = validateIntentAgainstRegistry({
      brand,
      actionId,
      actorScope,
      entityType,
      entityId: asText(payload.entityId) || undefined,
      userHint: asText(payload.userHint) || undefined
    });
    if (!validation.ok) {
      responseJson(res, { error: validation.code, reason: validation.message, mutationAllowed: false, implementationAllowed: false }, 400);
      return true;
    }
    const intent = createUploadIntentRecord({
      userId: asText(payload.userId),
      accountId: asText(payload.accountId),
      brand,
      actorScope,
      entityType,
      entityId: asText(payload.entityId) || undefined,
      actionId,
      userHint: asText(payload.userHint) || undefined,
      actionSnapshot: validation.action
    });
    responseJson(res, { mutationAllowed: false, implementationAllowed: false, intent }, 201);
    return true;
  }

  const filesMatch = pathname.match(/^\/api\/merlin\/intake\/upload-intents\/([^/]+)\/files$/);
  if (method === 'POST' && filesMatch) {
    const uploadId = decodeURIComponent(filesMatch[1]);
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'INVALID_JSON', mutationAllowed: false, implementationAllowed: false }, 400);
      return true;
    }
    const files = parseUploadIntentFiles((body as Record<string, unknown> | undefined)?.files);
    const intent = attachFilesToUploadIntent(uploadId, files);
    if (!intent) return responseJson(res, { error: 'upload_intent_not_found', mutationAllowed: false, implementationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, implementationAllowed: false, intent });
    return true;
  }

  const routeMatch = pathname.match(/^\/api\/merlin\/intake\/upload-intents\/([^/]+)\/route$/);
  if (method === 'POST' && routeMatch) {
    const uploadId = decodeURIComponent(routeMatch[1]);
    const intent = getUploadIntentRecord(uploadId);
    if (!intent) return responseJson(res, { error: 'upload_intent_not_found', mutationAllowed: false, implementationAllowed: false }, 404), true;
    const routingDecisions = routeUploadIntentFiles(intent);
    const routedIntent = setUploadIntentRouting(uploadId, routingDecisions) || intent;
    const evidenceRecords = indexEvidenceForUpload(routedIntent, routingDecisions);
    responseJson(res, { mutationAllowed: false, implementationAllowed: false, intent: routedIntent, routingDecisions, evidenceRecords });
    return true;
  }

  const previewMatch = pathname.match(/^\/api\/merlin\/intake\/upload-intents\/([^/]+)\/preview$/);
  if (method === 'POST' && previewMatch) {
    const uploadId = decodeURIComponent(previewMatch[1]);
    const intent = getUploadIntentRecord(uploadId);
    if (!intent) return responseJson(res, { error: 'upload_intent_not_found', mutationAllowed: false, implementationAllowed: false }, 404), true;
    const routing = intent.routing.length ? intent.routing : routeUploadIntentFiles(intent);
    if (!intent.routing.length) setUploadIntentRouting(uploadId, routing);
    const linkedEvidenceIds = getEvidenceIdsForUpload(uploadId);
    const preview = buildPreviewPacket(intent, routing, linkedEvidenceIds);
    const previewed = setUploadIntentPreview(uploadId, preview);
    if (!previewed) return responseJson(res, { error: 'upload_intent_not_found', mutationAllowed: false, implementationAllowed: false }, 404), true;
    responseJson(res, {
      mutationAllowed: false,
      implementationAllowed: false,
      applyEnabled: false,
      cleanupEnabled: false,
      intent: previewed
    });
    return true;
  }

  const uploadDetailMatch = pathname.match(/^\/api\/merlin\/intake\/upload-intents\/([^/]+)$/);
  if (method === 'GET' && uploadDetailMatch) {
    const intent = getUploadIntentRecord(decodeURIComponent(uploadDetailMatch[1]));
    if (!intent) return responseJson(res, { error: 'upload_intent_not_found', mutationAllowed: false, implementationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, implementationAllowed: false, intent });
    return true;
  }

  if (method === 'POST' && pathname === '/api/merlin/intake') {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'validation_error', reason: 'invalid_json_body', mutationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const brandLane = asText(payload.brand_lane).toLowerCase();
    const sourceType = asText(payload.source_type).toLowerCase() as MerlinSourceType;
    const sourceReference = asText(payload.source_reference);
    const intentText = asText(payload.intent_text);
    const rawText = asText(payload.raw_text);
    if (!brandLane) return responseJson(res, { error: 'validation_error', reason: 'brand_lane is required', mutationAllowed: false }, 400), true;
    if (!sourceType || !ALLOWED_SOURCE_TYPES.has(sourceType)) {
      return responseJson(res, { error: 'validation_error', reason: 'source_type is required and must be supported', mutationAllowed: false }, 400), true;
    }
    if (!sourceReference) return responseJson(res, { error: 'validation_error', reason: 'source_reference is required', mutationAllowed: false }, 400), true;
    if (!intentText && !rawText) {
      return responseJson(res, { error: 'validation_error', reason: 'intent_text or raw_text is required', mutationAllowed: false }, 400), true;
    }
    const intake = createMerlinIntakeItem({
      brand_lane: brandLane,
      source_type: sourceType,
      source_reference: sourceReference,
      origin_surface: asText(payload.origin_surface) || 'unknown',
      entity_candidate: payload.entity_candidate && typeof payload.entity_candidate === 'object' ? (payload.entity_candidate as Record<string, unknown>) : {},
      intent_text: intentText,
      raw_text: rawText,
      extracted_fields: payload.extracted_fields && typeof payload.extracted_fields === 'object' ? (payload.extracted_fields as Record<string, unknown>) : {},
      confidence: typeof payload.confidence === 'number' ? payload.confidence : undefined,
      required_real_data: Array.isArray(payload.required_real_data) ? payload.required_real_data.map((v) => String(v)) : []
    });
    responseJson(res, { mutationAllowed: false, intake }, 201);
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/intake') {
    const url = new URL(req.url || '', 'http://localhost');
    const brandLane = asText(url.searchParams.get('brand_lane')).toLowerCase() || undefined;
    const status = (asText(url.searchParams.get('status')).toLowerCase() || undefined) as MerlinIntakeStatus | undefined;
    const sourceType = (asText(url.searchParams.get('source_type')).toLowerCase() || undefined) as MerlinSourceType | undefined;
    const limitRaw = Number(url.searchParams.get('limit') || '50');
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const items = listMerlinIntakeItems({ brand_lane: brandLane, status, source_type: sourceType, limit });
    responseJson(res, { mutationAllowed: false, items });
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/merlin\/intake\/([^/]+)$/);
  if (method === 'GET' && detailMatch) {
    const intakeId = decodeURIComponent(detailMatch[1]);
    const intake = getMerlinIntakeItemById(intakeId);
    if (!intake) return responseJson(res, { error: 'intake_item_not_found', mutationAllowed: false }, 404), true;
    const links = listMerlinIntakeActionCardLinks(intakeId);
    responseJson(res, { mutationAllowed: false, intake, actionCardLinks: links });
    return true;
  }

  const statusMatch = pathname.match(/^\/api\/merlin\/intake\/([^/]+)\/status$/);
  if (method === 'PATCH' && statusMatch) {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'validation_error', reason: 'invalid_json_body', mutationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const status = asText(payload.status).toLowerCase() as MerlinIntakeStatus;
    if (!ALLOWED_STATUSES.has(status)) return responseJson(res, { error: 'validation_error', reason: 'invalid status', mutationAllowed: false }, 400), true;
    const intakeId = decodeURIComponent(statusMatch[1]);
    const updated = updateMerlinIntakeStatus(intakeId, status, {
      reason: asText(payload.reason) || null,
      updated_by: asText(payload.updated_by) || null
    });
    if (!updated) return responseJson(res, { error: 'intake_item_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, intake: updated });
    return true;
  }

  const generateMatch = pathname.match(/^\/api\/merlin\/intake\/([^/]+)\/action-cards$/);
  if (method === 'POST' && generateMatch) {
    const intakeId = decodeURIComponent(generateMatch[1]);
    const intake = getMerlinIntakeItemById(intakeId);
    if (!intake) return responseJson(res, { error: 'intake_item_not_found', mutationAllowed: false }, 404), true;
    if (!asText(intake.source_reference)) {
      return responseJson(res, { error: 'missing_source_reference', mutationAllowed: false }, 400), true;
    }
    try {
      const generated = generateActionCardsFromMerlinIntakeItem(intakeId);
      responseJson(res, { mutationAllowed: false, intake: generated.intakeItem, cards: generated.cards });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'action_card_generation_failed';
      const statusCode = message === 'unsupported_brand_lane' ? 409 : 400;
      responseJson(res, { error: message, mutationAllowed: false }, statusCode);
      return true;
    }
  }

  const historyMatch = pathname.match(/^\/api\/merlin\/intake\/([^/]+)\/history$/);
  if (method === 'GET' && historyMatch) {
    const intakeId = decodeURIComponent(historyMatch[1]);
    const intake = getMerlinIntakeItemById(intakeId);
    if (!intake) return responseJson(res, { error: 'intake_item_not_found', mutationAllowed: false }, 404), true;
    const history = listMerlinIntakeHistory(intakeId);
    responseJson(res, { mutationAllowed: false, history });
    return true;
  }

  return false;
}
