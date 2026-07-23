import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  getMerlinEntityById,
  getMerlinEntityConflicts,
  getMerlinEntityHistory,
  listMerlinEntities,
  listMerlinSourceObservations,
  resolveMerlinEntityFromIntake,
  updateMerlinEntityConflictStatus,
  type MerlinConflictStatus
} from '../entityMemoryRuntime.js';

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

const VALID_CONFLICT_STATUS = new Set<MerlinConflictStatus>(['open', 'acknowledged', 'resolved', 'false_positive']);

export async function handleMerlinEntityMemoryRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();

  const resolveMatch = pathname.match(/^\/api\/merlin\/intake\/([^/]+)\/resolve-entity$/);
  if (method === 'POST' && resolveMatch) {
    const intakeId = decodeURIComponent(resolveMatch[1]);
    try {
      const resolved = resolveMerlinEntityFromIntake(intakeId);
      responseJson(res, { mutationAllowed: false, resolution: resolved });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'resolution_failed';
      const status = message === 'intake_item_not_found' ? 404 : 409;
      responseJson(res, { error: message, mutationAllowed: false }, status);
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/entities') {
    const url = new URL(req.url || '', 'http://localhost');
    const brandLane = (url.searchParams.get('brand_lane') || '').trim().toLowerCase() || undefined;
    const status = (url.searchParams.get('status') || '').trim().toLowerCase() || undefined;
    const limitRaw = Number(url.searchParams.get('limit') || '50');
    const limit = Number.isFinite(limitRaw) ? limitRaw : 50;
    const entities = listMerlinEntities({ brand_lane: brandLane, status: status as never, limit });
    responseJson(res, { mutationAllowed: false, entities });
    return true;
  }

  const entityDetailMatch = pathname.match(/^\/api\/merlin\/entities\/([^/]+)$/);
  if (method === 'GET' && entityDetailMatch) {
    const entity = getMerlinEntityById(decodeURIComponent(entityDetailMatch[1]));
    if (!entity) return responseJson(res, { error: 'entity_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, entity });
    return true;
  }

  const entityHistoryMatch = pathname.match(/^\/api\/merlin\/entities\/([^/]+)\/history$/);
  if (method === 'GET' && entityHistoryMatch) {
    const entityId = decodeURIComponent(entityHistoryMatch[1]);
    const entity = getMerlinEntityById(entityId);
    if (!entity) return responseJson(res, { error: 'entity_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, history: getMerlinEntityHistory(entityId) });
    return true;
  }

  const entityConflictListMatch = pathname.match(/^\/api\/merlin\/entities\/([^/]+)\/conflicts$/);
  if (method === 'GET' && entityConflictListMatch) {
    const entityId = decodeURIComponent(entityConflictListMatch[1]);
    const entity = getMerlinEntityById(entityId);
    if (!entity) return responseJson(res, { error: 'entity_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, conflicts: getMerlinEntityConflicts(entityId) });
    return true;
  }

  const entityConflictPatchMatch = pathname.match(/^\/api\/merlin\/entities\/([^/]+)\/conflicts\/([^/]+)$/);
  if (method === 'PATCH' && entityConflictPatchMatch) {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'invalid_json', mutationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const status = typeof payload.status === 'string' ? payload.status.trim().toLowerCase() : '';
    if (!VALID_CONFLICT_STATUS.has(status as MerlinConflictStatus)) {
      responseJson(res, { error: 'invalid_conflict_status', mutationAllowed: false }, 400);
      return true;
    }
    const entityId = decodeURIComponent(entityConflictPatchMatch[1]);
    const conflictId = decodeURIComponent(entityConflictPatchMatch[2]);
    const ok = updateMerlinEntityConflictStatus(entityId, conflictId, status as MerlinConflictStatus);
    if (!ok) return responseJson(res, { error: 'conflict_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, status: 'ok' });
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/source-observations') {
    const url = new URL(req.url || '', 'http://localhost');
    const limitRaw = Number(url.searchParams.get('limit') || '100');
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
    responseJson(res, { mutationAllowed: false, observations: listMerlinSourceObservations(limit) });
    return true;
  }

  return false;
}
