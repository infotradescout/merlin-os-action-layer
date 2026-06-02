import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  createMerlinDryRunExecution,
  getMerlinDryRunExecutionById,
  getMerlinDryRunExecutionHistory,
  listMerlinDryRunExecutions,
  updateMerlinDryRunExecutionStatus,
  type MerlinDryRunStatus
} from '../dryRunExecutorRuntime.js';

const DRY_RUN_STATUSES = new Set<MerlinDryRunStatus>(['simulated', 'blocked', 'failed', 'cancelled']);

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

export async function handleMerlinDryRunExecutorRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'POST' && pathname === '/api/merlin/dry-run-executions') {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'invalid_json', mutationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const executionPlanId = asText(payload.execution_plan_id);
    if (!executionPlanId) {
      responseJson(res, { error: 'validation_error', reason: 'execution_plan_id is required', mutationAllowed: false }, 400);
      return true;
    }
    try {
      const dryRunExecution = createMerlinDryRunExecution({ execution_plan_id: executionPlanId });
      responseJson(res, { mutationAllowed: false, dryRunExecution }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'dry_run_execution_failed';
      responseJson(res, { error: message, mutationAllowed: false }, message === 'execution_plan_not_found' ? 404 : 409);
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/dry-run-executions') {
    const url = new URL(req.url || '', 'http://localhost');
    const status = asText(url.searchParams.get('status')).toLowerCase();
    const limitRaw = Number(url.searchParams.get('limit') || '100');
    responseJson(res, {
      mutationAllowed: false,
      dryRunExecutions: listMerlinDryRunExecutions({
        brand_lane: asText(url.searchParams.get('brand_lane')).toLowerCase() || undefined,
        status: DRY_RUN_STATUSES.has(status as MerlinDryRunStatus) ? (status as MerlinDryRunStatus) : undefined,
        entity_id: asText(url.searchParams.get('entity_id')) || undefined,
        limit: Number.isFinite(limitRaw) ? limitRaw : 100
      })
    });
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/merlin\/dry-run-executions\/([^/]+)$/);
  if (method === 'GET' && detailMatch) {
    const dryRunExecution = getMerlinDryRunExecutionById(decodeURIComponent(detailMatch[1]));
    if (!dryRunExecution) return responseJson(res, { error: 'dry_run_execution_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, dryRunExecution });
    return true;
  }

  const statusMatch = pathname.match(/^\/api\/merlin\/dry-run-executions\/([^/]+)\/status$/);
  if (method === 'PATCH' && statusMatch) {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'invalid_json', mutationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const status = asText(payload.status).toLowerCase() as MerlinDryRunStatus;
    if (!DRY_RUN_STATUSES.has(status)) {
      responseJson(res, { error: 'invalid_dry_run_status', mutationAllowed: false }, 400);
      return true;
    }
    const dryRunExecution = updateMerlinDryRunExecutionStatus(decodeURIComponent(statusMatch[1]), status, {
      reason: asText(payload.reason) || null,
      updated_by: asText(payload.updated_by) || null
    });
    if (!dryRunExecution) return responseJson(res, { error: 'dry_run_execution_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, dryRunExecution });
    return true;
  }

  const historyMatch = pathname.match(/^\/api\/merlin\/dry-run-executions\/([^/]+)\/history$/);
  if (method === 'GET' && historyMatch) {
    const dryRunExecution = getMerlinDryRunExecutionById(decodeURIComponent(historyMatch[1]));
    if (!dryRunExecution) return responseJson(res, { error: 'dry_run_execution_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, history: getMerlinDryRunExecutionHistory(dryRunExecution.id) });
    return true;
  }

  return false;
}
