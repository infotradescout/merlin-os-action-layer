import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  createMerlinActionCard,
  getMerlinActionCardById,
  getMerlinActionCardHistory,
  listMerlinActionCards,
  updateMerlinActionCardDecision,
  type MerlinActionCardInput
} from '../actionCardRuntime.js';

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

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function handleMerlinActionCardRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'POST' && pathname === '/api/merlin/action-cards') {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'Invalid JSON body', mutationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const required = ['brand', 'kpi', 'intent', 'source_of_truth', 'tool', 'action', 'permission_level', 'output_location'];
    for (const key of required) {
      if (!hasText(payload[key])) {
        responseJson(res, { error: `${key} is required`, mutationAllowed: false }, 400);
        return true;
      }
    }
    if (!Array.isArray(payload.required_real_data)) {
      responseJson(res, { error: 'required_real_data must be an array', mutationAllowed: false }, 400);
      return true;
    }
    if (!Array.isArray(payload.fail_safes)) {
      responseJson(res, { error: 'fail_safes must be an array', mutationAllowed: false }, 400);
      return true;
    }

    const input: MerlinActionCardInput = {
      brand: String(payload.brand).trim().toLowerCase(),
      kpi: String(payload.kpi).trim(),
      intent: String(payload.intent).trim(),
      source_of_truth: String(payload.source_of_truth).trim(),
      required_real_data: (payload.required_real_data as unknown[]).map((v) => String(v)),
      tool: String(payload.tool).trim(),
      action: String(payload.action).trim().toLowerCase(),
      permission_level: String(payload.permission_level).trim().toLowerCase() as MerlinActionCardInput['permission_level'],
      fail_safes: (payload.fail_safes as unknown[]).map((v) => String(v)),
      output_location: String(payload.output_location).trim(),
      source_refs: Array.isArray(payload.source_refs) ? payload.source_refs.map((v) => String(v)) : [],
      entity_id: hasText(payload.entity_id) ? String(payload.entity_id).trim() : undefined
    };

    const card = createMerlinActionCard(input);
    responseJson(res, { mutationAllowed: false, card }, 201);
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/action-cards') {
    const url = new URL(req.url || '', 'http://localhost');
    const brand = hasText(url.searchParams.get('brand')) ? String(url.searchParams.get('brand')).toLowerCase() : undefined;
    const status = hasText(url.searchParams.get('status')) ? String(url.searchParams.get('status')).toLowerCase() : undefined;
    const limit = hasText(url.searchParams.get('limit')) ? Number(url.searchParams.get('limit')) : undefined;
    const cards = listMerlinActionCards({ brand, status, limit: Number.isFinite(limit as number) ? (limit as number) : undefined });
    responseJson(res, { mutationAllowed: false, cards });
    return true;
  }

  const cardIdMatch = pathname.match(/^\/api\/merlin\/action-cards\/([^/]+)$/);
  if (method === 'GET' && cardIdMatch) {
    const card = getMerlinActionCardById(decodeURIComponent(cardIdMatch[1]));
    if (!card) {
      responseJson(res, { error: 'action_card_not_found', mutationAllowed: false }, 404);
      return true;
    }
    responseJson(res, { mutationAllowed: false, card });
    return true;
  }

  const decisionMatch = pathname.match(/^\/api\/merlin\/action-cards\/([^/]+)\/decision$/);
  if (method === 'PATCH' && decisionMatch) {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'Invalid JSON body', mutationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const decision = hasText(payload.decision) ? String(payload.decision).toLowerCase() : '';
    if (!['approved', 'rejected', 'deferred', 'blocked'].includes(decision)) {
      responseJson(res, { error: 'invalid_decision', mutationAllowed: false }, 400);
      return true;
    }
    const updated = updateMerlinActionCardDecision(decodeURIComponent(decisionMatch[1]), {
      decision: decision as 'approved' | 'rejected' | 'deferred' | 'blocked',
      reason: hasText(payload.reason) ? String(payload.reason).trim() : undefined,
      decided_by: hasText(payload.decided_by) ? String(payload.decided_by).trim() : undefined
    });
    if (!updated) {
      responseJson(res, { error: 'action_card_not_found', mutationAllowed: false }, 404);
      return true;
    }
    responseJson(res, { mutationAllowed: false, card: updated });
    return true;
  }

  const historyMatch = pathname.match(/^\/api\/merlin\/action-cards\/([^/]+)\/history$/);
  if (method === 'GET' && historyMatch) {
    const cardId = decodeURIComponent(historyMatch[1]);
    const card = getMerlinActionCardById(cardId);
    if (!card) {
      responseJson(res, { error: 'action_card_not_found', mutationAllowed: false }, 404);
      return true;
    }
    const history = getMerlinActionCardHistory(cardId);
    responseJson(res, { mutationAllowed: false, history });
    return true;
  }

  return false;
}
