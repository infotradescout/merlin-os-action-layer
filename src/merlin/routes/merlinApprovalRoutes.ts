import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import {
  decideMerlinApproval,
  getMerlinActionCardApprovalState,
  getMerlinApprovalById,
  getMerlinApprovalHistory,
  listMerlinApprovals,
  requestMerlinApproval,
  type MerlinApprovalStatus
} from '../approvalRuntime.js';

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

const APPROVAL_STATUSES = new Set<MerlinApprovalStatus>(['requested', 'approved', 'rejected', 'expired', 'revoked', 'blocked']);

export async function handleMerlinApprovalRoute(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'POST' && pathname === '/api/merlin/approvals/request') {
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
      const approval = requestMerlinApproval({ action_card_id: actionCardId, expires_at: asText(payload.expires_at) || undefined });
      responseJson(res, { mutationAllowed: false, approval }, 201);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'approval_request_failed';
      responseJson(res, { error: message, mutationAllowed: false }, message === 'action_card_not_found' ? 404 : 409);
    }
    return true;
  }

  if (method === 'GET' && pathname === '/api/merlin/approvals') {
    const url = new URL(req.url || '', 'http://localhost');
    const status = asText(url.searchParams.get('status')).toLowerCase();
    const limitRaw = Number(url.searchParams.get('limit') || '100');
    responseJson(res, {
      mutationAllowed: false,
      approvals: listMerlinApprovals({
        brand_lane: asText(url.searchParams.get('brand_lane')).toLowerCase() || undefined,
        status: APPROVAL_STATUSES.has(status as MerlinApprovalStatus) ? (status as MerlinApprovalStatus) : undefined,
        entity_id: asText(url.searchParams.get('entity_id')) || undefined,
        limit: Number.isFinite(limitRaw) ? limitRaw : 100
      })
    });
    return true;
  }

  const detailMatch = pathname.match(/^\/api\/merlin\/approvals\/([^/]+)$/);
  if (method === 'GET' && detailMatch) {
    const approval = getMerlinApprovalById(decodeURIComponent(detailMatch[1]));
    if (!approval) return responseJson(res, { error: 'approval_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, approval });
    return true;
  }

  const decisionMatch = pathname.match(/^\/api\/merlin\/approvals\/([^/]+)\/decision$/);
  if (method === 'PATCH' && decisionMatch) {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      responseJson(res, { error: 'invalid_json', mutationAllowed: false }, 400);
      return true;
    }
    const payload = (body || {}) as Record<string, unknown>;
    const decision = asText(payload.decision).toLowerCase();
    if (!['approved', 'rejected', 'revoked'].includes(decision)) {
      responseJson(res, { error: 'invalid_decision', mutationAllowed: false }, 400);
      return true;
    }
    try {
      const approval = decideMerlinApproval({
        approval_id: decodeURIComponent(decisionMatch[1]),
        decision: decision as 'approved' | 'rejected' | 'revoked',
        decided_by: asText(payload.decided_by) || undefined,
        reason: asText(payload.reason) || undefined
      });
      responseJson(res, { mutationAllowed: false, approval });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'approval_decision_failed';
      responseJson(res, { error: message, mutationAllowed: false }, message === 'approval_not_found' ? 404 : 409);
    }
    return true;
  }

  const historyMatch = pathname.match(/^\/api\/merlin\/approvals\/([^/]+)\/history$/);
  if (method === 'GET' && historyMatch) {
    const approval = getMerlinApprovalById(decodeURIComponent(historyMatch[1]));
    if (!approval) return responseJson(res, { error: 'approval_not_found', mutationAllowed: false }, 404), true;
    responseJson(res, { mutationAllowed: false, history: getMerlinApprovalHistory(approval.id) });
    return true;
  }

  const cardStateMatch = pathname.match(/^\/api\/merlin\/action-cards\/([^/]+)\/approval-state$/);
  if (method === 'GET' && cardStateMatch) {
    try {
      responseJson(res, { mutationAllowed: false, approvalState: getMerlinActionCardApprovalState(decodeURIComponent(cardStateMatch[1])) });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'approval_state_failed';
      responseJson(res, { error: message, mutationAllowed: false }, message === 'action_card_not_found' ? 404 : 409);
    }
    return true;
  }

  return false;
}
