import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  createMerlinExecutionPlan,
  getMerlinExecutionPlanById,
  getMerlinExecutionPlanHistory,
  listMerlinExecutionPlans,
  updateMerlinExecutionPlanStatus,
  type MerlinExecutionStatus
} from '../executionPlanRuntime.js';

const EXECUTION_STATUSES = new Set<MerlinExecutionStatus>(['draft', 'eligible', 'blocked', 'expired', 'cancelled', 'executed_dry_run', 'failed']);

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

export async function handleMerlinExecutionPlanRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'POST' && pathname === '/api/merlin/execution-plans') {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'invalid_json', mutationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const actionCardId = asText(payload.action_card_id);
    if (!actionCardId) {
      responseJson(res, { error: 'validation_error', reason: 'action_card_id is required', mutationAllowed: false }, 400);
      return true;
    }
    try {
      const executionPlan = createMerlinExecutionPlan({ action_card_id: actionCardId });
      responseJson(res, { mutationAllowed: false, executionPlan }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'execution_plan_create_failed';
      responseJson(res, { error: message, mutationAllowed: false }, message === 'action_card_not_found' ? 404 : 409);
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/execution-plans') {
    const url = new URL(req.url || '', 'http://localhost');
    const status = asText(url.searchParams.get('status')).toLowerCase();
    const limitRaw = Number(url.searchParams.get('limit') || '100');
    responseJson(res, {
      mutationAllowed: false,
      executionPlans: listMerlinExecutionPlans({
        brand_lane: asText(url.searchParams.get('brand_lane')).toLowerCase() || undefined,
        status: EXECUTION_STATUSES.has(status as MerlinExecutionStatus) ? (status as MerlinExecutionStatus) : undefined,
        entity_id: asText(url.searchParams.get('entity_id')) || undefined,
        limit: Number.isFinite(limitRaw) ? limitRaw : 100
      })
    });
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/merlin\/execution-plans\/([^/]+)$/);
  if (method === 'GET' && detailMatch) {
    const executionPlan = getMerlinExecutionPlanById(decodeURIComponent(detailMatch[1]));
    if (!executionPlan) return responseJson(res, { error: 'execution_plan_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, executionPlan });
    return true;
  }

  const statusMatch = pathname.match(/^\/api\/merlin\/execution-plans\/([^/]+)\/status$/);
  if (method === 'PATCH' && statusMatch) {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'invalid_json', mutationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const status = asText(payload.status).toLowerCase() as MerlinExecutionStatus;
    if (!EXECUTION_STATUSES.has(status)) {
      responseJson(res, { error: 'invalid_execution_status', mutationAllowed: false }, 400);
      return true;
    }
    const executionPlan = updateMerlinExecutionPlanStatus(decodeURIComponent(statusMatch[1]), status, {
      reason: asText(payload.reason) || null,
      updated_by: asText(payload.updated_by) || null
    });
    if (!executionPlan) return responseJson(res, { error: 'execution_plan_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, executionPlan });
    return true;
  }

  const historyMatch = pathname.match(/^\/api\/merlin\/execution-plans\/([^/]+)\/history$/);
  if (method === 'GET' && historyMatch) {
    const executionPlan = getMerlinExecutionPlanById(decodeURIComponent(historyMatch[1]));
    if (!executionPlan) return responseJson(res, { error: 'execution_plan_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, history: getMerlinExecutionPlanHistory(executionPlan.id) });
    return true;
  }

  return false;
}
