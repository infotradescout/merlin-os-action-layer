import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  createMerlinLiveExecutionGate,
  getMerlinLiveExecutionGateById,
  getMerlinLiveExecutionGateHistory,
  listMerlinLiveExecutionGates,
  type MerlinLiveExecutionGateStatus
} from '../liveExecutionGateRuntime.js';

const LIVE_GATE_STATUSES = new Set<MerlinLiveExecutionGateStatus>(['eligible', 'blocked', 'disabled', 'expired', 'failed']);

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

export async function handleMerlinLiveExecutionGateRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'POST' && pathname === '/api/merlin/live-execution-gates') {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'invalid_json', mutationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const dryRunExecutionId = asText(payload.dry_run_execution_id);
    if (!dryRunExecutionId) {
      responseJson(res, { error: 'validation_error', reason: 'dry_run_execution_id is required', mutationAllowed: false }, 400);
      return true;
    }
    try {
      const liveExecutionGate = createMerlinLiveExecutionGate({ dry_run_execution_id: dryRunExecutionId });
      responseJson(res, { mutationAllowed: false, liveExecutionGate }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'live_execution_gate_failed';
      responseJson(res, { error: message, mutationAllowed: false }, message === 'dry_run_execution_not_found' ? 404 : 409);
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/live-execution-gates') {
    const url = new URL(req.url || '', 'http://localhost');
    const status = asText(url.searchParams.get('status')).toLowerCase();
    const limitRaw = Number(url.searchParams.get('limit') || '100');
    responseJson(res, {
      mutationAllowed: false,
      liveExecutionGates: listMerlinLiveExecutionGates({
        brand_lane: asText(url.searchParams.get('brand_lane')).toLowerCase() || undefined,
        status: LIVE_GATE_STATUSES.has(status as MerlinLiveExecutionGateStatus) ? (status as MerlinLiveExecutionGateStatus) : undefined,
        entity_id: asText(url.searchParams.get('entity_id')) || undefined,
        limit: Number.isFinite(limitRaw) ? limitRaw : 100
      })
    });
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/merlin\/live-execution-gates\/([^/]+)$/);
  if (method === 'GET' && detailMatch) {
    const liveExecutionGate = getMerlinLiveExecutionGateById(decodeURIComponent(detailMatch[1]));
    if (!liveExecutionGate) return responseJson(res, { error: 'live_execution_gate_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, liveExecutionGate });
    return true;
  }

  const historyMatch = pathname.match(/^\/api\/merlin\/live-execution-gates\/([^/]+)\/history$/);
  if (method === 'GET' && historyMatch) {
    const liveExecutionGate = getMerlinLiveExecutionGateById(decodeURIComponent(historyMatch[1]));
    if (!liveExecutionGate) return responseJson(res, { error: 'live_execution_gate_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, history: getMerlinLiveExecutionGateHistory(liveExecutionGate.id) });
    return true;
  }

  return false;
}
