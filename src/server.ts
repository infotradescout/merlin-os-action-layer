import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { URL } from 'node:url';
import { DEFAULT_PORT } from './constants.js';
import {
  getDailyPayloadForUser,
  getEntityState,
  getEntityTimeline,
  getRecentChanges,
  ingestTradeScoutEvent,
  resetLisaStore
} from './lisa.js';
import {
  createApprovalFromRecommendation,
  getApprovalsForEntity,
  getApprovalById,
  getPendingApprovals,
  getRecentApprovals,
  resetApprovalQueueForTest,
  updateApprovalStatus
} from './approvalQueue.js';
import { getRecentRecommendations } from './recommendations.js';
import { getHealthPayload } from './health.js';
import { getSearchPayload } from './search.js';
import { getRecentReplayEvents, resetReplayForTest } from './replay.js';
import { resetOutcomesForTest } from './outcomes.js';
import { resetEntityResolutionForTest } from './entityResolution.js';
import { resetRecommendationsForTest } from './recommendations.js';
import { resetSourceRegistryForTest } from './sourceRegistry.js';

type QueryBag = { [key: string]: string | undefined };

type DemoSeedEvent = {
  entity_id: string;
  event_type: string;
  entity_name?: string;
  title: string;
  summary: string;
  review_required: boolean;
  truth_score?: number;
};

function parseBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({ __invalid_body: raw });
      }
    });
  });
}

export function responseJson(res: ServerResponse, payload: unknown, status = 200): void {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function readQuery(urlObj: URL): QueryBag {
  const out: QueryBag = {};
  for (const [key, value] of urlObj.searchParams.entries()) {
    out[key] = value;
  }
  return out;
}

function getNumber(value: string | undefined, fallback = 20): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function serveUiIndex(res: ServerResponse): boolean {
  const indexPath = resolve(process.cwd(), 'public', 'index.html');
  if (!existsSync(indexPath)) {
    return false;
  }
  try {
    const html = readFileSync(indexPath, 'utf8');
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html');
    res.end(html);
    return true;
  } catch {
    return false;
  }
}

function isDemoModeEnabled(): boolean {
  const runtimeMode = (process.env.MERLIN_RUNTIME || '').toLowerCase();
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  if (runtimeMode === 'production') {
    return false;
  }
  if (runtimeMode) {
    return runtimeMode !== 'production';
  }
  if (nodeEnv) {
    return nodeEnv !== 'production';
  }
  return true;
}

function seedDemoEvents(): DemoSeedEvent[] {
  const entityId = 'business_demo_001';
  return [
    {
      entity_id: entityId,
      event_type: 'business_profile_claimed',
      entity_name: 'Blue Peak Roofing',
      title: 'Business profile claimed',
      summary: 'TradeScout captured a verified business profile claim.',
      review_required: false,
      truth_score: 0.95
    },
    {
      entity_id: entityId,
      event_type: 'verification_document_uploaded',
      entity_name: 'Blue Peak Roofing',
      title: 'Verification document uploaded',
      summary: 'Insurance and contractor license documents were uploaded.',
      review_required: true,
      truth_score: 0.96
    },
    {
      entity_id: entityId,
      event_type: 'contact_request_created',
      entity_name: 'Blue Peak Roofing',
      title: 'New contact request created',
      summary: 'Customer requested a roofing estimate.',
      review_required: true,
      truth_score: 0.92
    },
    {
      entity_id: entityId,
      event_type: 'quote_sent',
      entity_name: 'Blue Peak Roofing',
      title: 'Quote sent',
      summary: 'Quote sent to contact with project scope.',
      review_required: false,
      truth_score: 0.9
    },
    {
      entity_id: entityId,
      event_type: 'contact_request_stale',
      entity_name: 'Blue Peak Roofing',
      title: 'Contact request stale',
      summary: 'Contact request has not advanced for multiple days.',
      review_required: false,
      truth_score: 0.82
    },
    {
      entity_id: entityId,
      event_type: 'job_outcome_recorded',
      entity_name: 'Blue Peak Roofing',
      title: 'Job outcome recorded',
      summary: 'Job outcome event recorded for the contact.',
      review_required: false,
      truth_score: 0.88
    }
  ];
}

function resetDemoRuntimeState(): void {
  resetLisaStore();
  resetApprovalQueueForTest();
  resetRecommendationsForTest();
  resetOutcomesForTest();
  resetReplayForTest();
  resetEntityResolutionForTest();
  resetSourceRegistryForTest();
}

function createApprovalsForEntity(entityId: string): string[] {
  const pending: string[] = [];
  const recommendations = getRecentRecommendations(100);
  for (const recommendation of recommendations) {
    if (recommendation.entity_id !== entityId) continue;
    if (recommendation.status !== 'suggested') continue;
    const approval = createApprovalFromRecommendation(recommendation.id);
    if (approval) {
      pending.push(approval.id);
    }
  }
  return pending;
}

function demoForbidden(res: ServerResponse): void {
  responseJson(
    res,
    {
      error: 'demo endpoint disabled',
      reason: 'Demo endpoints are available only in non-production mode.'
    },
    403
  );
}

export const createMerlinHandler = async (req: IncomingMessage, res: ServerResponse) => {
  if (!req.url || !req.method) {
    return responseJson(res, { error: 'Invalid request' }, 400);
  }

  const method = req.method.toUpperCase();
  const url = new URL(req.url, `http://localhost:${DEFAULT_PORT}`);
  const pathname = url.pathname;
  const query = readQuery(url);

  if (method === 'GET' && pathname === '/api/health') {
    return responseJson(res, getHealthPayload());
  }

  if (method === 'GET' && pathname === '/api/daily') {
    const userId = query.user || 'demo-user';
    const limit = getNumber(query.limit, 20);
    const payload = getDailyPayloadForUser(userId, {
      now: Date.now(),
      maxItemsPerSection: limit
    });
    return responseJson(res, payload);
  }

  if (method === 'GET' && pathname === '/api/search') {
    const queryString = query.q || '';
    return responseJson(res, getSearchPayload(queryString));
  }

  if (method === 'GET' && pathname === '/api/changes/recent') {
    const limit = getNumber(query.limit, 20);
    return responseJson(res, getRecentChanges(limit));
  }

  if (method === 'GET' && pathname === '/api/replay/recent') {
    const limit = getNumber(query.limit, 20);
    return responseJson(res, { replay_events: getRecentReplayEvents(limit) });
  }

  if (method === 'GET' && pathname === '/api/approvals') {
    const limit = getNumber(query.limit, 20);
    const requestedStatus = query.status;
    const entityId = query.entity;
    const payload = requestedStatus === 'pending'
      ? getPendingApprovals().slice(0, limit)
      : entityId
        ? getApprovalsForEntity(entityId)
        : getRecentApprovals(limit);
    return responseJson(res, { approvals: payload });
  }

  const approvalMatch = pathname.match(/^\/api\/approvals\/([^/]+)$/);
  if (method === 'GET' && approvalMatch) {
    const approvalId = decodeURIComponent(approvalMatch[1]);
    const approval = getApprovalById(approvalId);
    if (!approval) {
      return responseJson(res, { error: 'Approval not found' }, 404);
    }
    return responseJson(res, approval);
  }

  const approvalApproveMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/approve$/);
  if (method === 'POST' && approvalApproveMatch) {
    const approvalId = decodeURIComponent(approvalApproveMatch[1]);
    const approval = updateApprovalStatus(approvalId, 'approved');
    return responseJson(res, { status: 'ok', approval });
  }

  const approvalDismissMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/dismiss$/);
  if (method === 'POST' && approvalDismissMatch) {
    const approvalId = decodeURIComponent(approvalDismissMatch[1]);
    const approval = updateApprovalStatus(approvalId, 'dismissed');
    return responseJson(res, { status: 'ok', approval });
  }

  const approvalCompleteMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/complete$/);
  if (method === 'POST' && approvalCompleteMatch) {
    const approvalId = decodeURIComponent(approvalCompleteMatch[1]);
    const approval = updateApprovalStatus(approvalId, 'completed');
    return responseJson(res, { status: 'ok', approval });
  }

  if (method === 'POST' && pathname === '/api/demo/reset') {
    if (!isDemoModeEnabled()) {
      return demoForbidden(res);
    }
    resetDemoRuntimeState();
    return responseJson(res, { status: 'ok', message: 'demo runtime reset complete' });
  }

  if (method === 'POST' && pathname === '/api/demo/seed-tradescout-loop') {
    if (!isDemoModeEnabled()) {
      return demoForbidden(res);
    }
    resetDemoRuntimeState();

    const signalIds: string[] = [];
    for (const seedEvent of seedDemoEvents()) {
      const signalId = ingestTradeScoutEvent({
        ...seedEvent,
        origin_surface: 'tradescout',
        source_reference: `tradescout:${seedEvent.entity_id}`
      });
      signalIds.push(signalId);
    }

    // Generate recommendations from seeded events using the existing path so approval/replay links are created naturally.
    const daily = getDailyPayloadForUser('demo-user', {
      now: Date.now(),
      maxItemsPerSection: 50,
      createRecommendations: true
    });
    const approvals = createApprovalsForEntity('business_demo_001');
    const timeline = getEntityTimeline('business_demo_001', 20);

    return responseJson(res, {
      status: 'ok',
      message: 'TradeScout demo loop seeded',
      entity_id: 'business_demo_001',
      signals: signalIds,
      timeline_count: timeline.length,
      approvals_created: approvals.length,
      daily_sections: {
        changed: daily.sections.changed.length,
        needs_attention: daily.sections.needs_attention.length,
        waiting: daily.sections.waiting.length,
        stale: daily.sections.stale.length,
        suggested_next_steps: daily.sections.suggested_next_steps.length
      }
    });
  }

  const stateMatch = pathname.match(/^\/api\/entities\/([^/]+)\/state$/);
  if (method === 'GET' && stateMatch) {
    const entityId = decodeURIComponent(stateMatch[1]);
    const state = getEntityState(entityId);
    if (!state) {
      return responseJson(res, { error: 'Entity not found' }, 404);
    }
    return responseJson(res, state);
  }

  const timelineMatch = pathname.match(/^\/api\/entities\/([^/]+)\/timeline$/);
  if (method === 'GET' && timelineMatch) {
    const entityId = decodeURIComponent(timelineMatch[1]);
    const limit = getNumber(query.limit, 20);
    const timeline = getEntityTimeline(entityId, limit);
    return responseJson(res, { entity_id: entityId, timeline });
  }

  if (method === 'POST' && pathname === '/api/events/tradescout') {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = body as {
      entity_id?: string;
      event_type?: string;
      signal_type?: string;
      [key: string]: unknown;
    };
    if (!payload.entity_id) {
      return responseJson(
        res,
        { error: 'TradeScout events require entity_id' },
        400
      );
    }
    const signalId = ingestTradeScoutEvent({
      ...payload,
      entity_id: payload.entity_id,
      event_type: payload.signal_type ?? payload.event_type
    });
    return responseJson(res, { status: 'ok', signal_id: signalId, event_id: signalId });
  }

  if (method === 'GET' && pathname === '/api/events/tradescout') {
    return responseJson(res, {
      status: 'ok',
      request_id: randomUUID(),
      instructions: 'POST events with entity_id and optional signal fields'
    });
  }

  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const served = serveUiIndex(res);
    if (served) return;
    return responseJson(res, { error: 'Merlin Daily UI not found' }, 404);
  }

  responseJson(res, { error: 'Not found' }, 404);
};

export function createMerlinServer(): HttpServer {
  return createServer(createMerlinHandler);
}

export function startMerlinServer(port = Number(process.env.PORT || DEFAULT_PORT)): HttpServer {
  const server = createMerlinServer();
  server.listen(port, () => {
    console.log(`merlin-or listening on http://localhost:${port}`);
  });
  return server;
}

if (process.env.MERLIN_RUNTIME !== 'test') {
  startMerlinServer();
}
