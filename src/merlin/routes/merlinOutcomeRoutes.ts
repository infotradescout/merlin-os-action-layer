import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  getMerlinKpiRollup,
  getMerlinOutcomeById,
  getMerlinOutcomeHistory,
  listMerlinOutcomes,
  recordMerlinOutcome,
  updateMerlinOutcomeStatus,
  type MerlinOutcomeStatus,
  type MerlinOutcomeType
} from '../outcomeRuntime.js';

const OUTCOME_TYPES = new Set<MerlinOutcomeType>([
  'manual_done',
  'blocked_resolved',
  'needs_more_data',
  'external_reply_received',
  'internal_task_completed',
  'connection_made',
  'booking_completed',
  'payment_confirmed',
  'verification_completed',
  'profile_updated',
  'no_response',
  'failed'
]);

const OUTCOME_STATUSES = new Set<MerlinOutcomeStatus>(['recorded', 'verified', 'disputed', 'failed', 'dismissed']);

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

export async function handleMerlinOutcomeRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'POST' && pathname === '/api/merlin/outcomes') {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'invalid_json', mutationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const actionCardId = asText(payload.action_card_id);
    const outcomeType = asText(payload.outcome_type).toLowerCase() as MerlinOutcomeType;
    const status = asText(payload.status).toLowerCase() as MerlinOutcomeStatus;
    const resultSummary = asText(payload.result_summary);
    if (!actionCardId || !OUTCOME_TYPES.has(outcomeType) || !OUTCOME_STATUSES.has(status) || !resultSummary) {
      responseJson(res, { error: 'validation_error', reason: 'action_card_id, outcome_type, status, result_summary are required', mutationAllowed: false }, 400);
      return true;
    }
    try {
      const outcome = recordMerlinOutcome({
        action_card_id: actionCardId,
        outcome_type: outcomeType,
        status,
        result_summary: resultSummary,
        source_refs: Array.isArray(payload.source_refs) ? payload.source_refs.map((v) => String(v)) : [],
        observed_at: asText(payload.observed_at) || undefined,
        intake_item_id: asText(payload.intake_item_id) || undefined,
        entity_id: asText(payload.entity_id) || undefined
      });
      responseJson(res, { mutationAllowed: false, outcome }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'outcome_record_failed';
      responseJson(res, { error: message, mutationAllowed: false }, message === 'action_card_not_found' ? 404 : 409);
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/outcomes') {
    const url = new URL(req.url || '', 'http://localhost');
    const outcomes = listMerlinOutcomes({
      brand_lane: asText(url.searchParams.get('brand_lane')).toLowerCase() || undefined,
      kpi: asText(url.searchParams.get('kpi')) || undefined,
      from: asText(url.searchParams.get('from')) || undefined,
      to: asText(url.searchParams.get('to')) || undefined,
      limit: Number(url.searchParams.get('limit') || '100')
    });
    responseJson(res, { mutationAllowed: false, outcomes });
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/merlin\/outcomes\/([^/]+)$/);
  if (method === 'GET' && detailMatch) {
    const outcome = getMerlinOutcomeById(decodeURIComponent(detailMatch[1]));
    if (!outcome) return responseJson(res, { error: 'outcome_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, outcome });
    return true;
  }

  const statusMatch = pathname.match(/^\/api\/merlin\/outcomes\/([^/]+)\/status$/);
  if (method === 'PATCH' && statusMatch) {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'invalid_json', mutationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const status = asText(payload.status).toLowerCase() as MerlinOutcomeStatus;
    if (!OUTCOME_STATUSES.has(status)) {
      responseJson(res, { error: 'invalid_status', mutationAllowed: false }, 400);
      return true;
    }
    const updated = updateMerlinOutcomeStatus(decodeURIComponent(statusMatch[1]), status, {
      reason: asText(payload.reason) || null,
      updated_by: asText(payload.updated_by) || null
    });
    if (!updated) return responseJson(res, { error: 'outcome_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, outcome: updated });
    return true;
  }

  const historyMatch = pathname.match(/^\/api\/merlin\/outcomes\/([^/]+)\/history$/);
  if (method === 'GET' && historyMatch) {
    const outcome = getMerlinOutcomeById(decodeURIComponent(historyMatch[1]));
    if (!outcome) return responseJson(res, { error: 'outcome_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, history: getMerlinOutcomeHistory(outcome.id) });
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/kpi-rollup') {
    const url = new URL(req.url || '', 'http://localhost');
    const rollup = getMerlinKpiRollup({
      brand_lane: asText(url.searchParams.get('brand_lane')).toLowerCase() || undefined,
      kpi: asText(url.searchParams.get('kpi')) || undefined,
      from: asText(url.searchParams.get('from')) || undefined,
      to: asText(url.searchParams.get('to')) || undefined
    });
    responseJson(res, { mutationAllowed: false, rollup });
    return true;
  }

  return false;
}
