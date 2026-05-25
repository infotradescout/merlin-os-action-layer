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
  getLisaEntities,
  getLisaEntityRecord,
  getLisaEventsForBrowser,
  searchLisaBrowserEvents,
  searchTimelineEntriesForBrowser,
  getTimelineEntriesForBrowser,
  getRecentChanges,
  ingestCrawlabilityEvent,
  ingestDriveImportEvent,
  ingestTradeScoutEvent,
  ingestMealScoutEvent,
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
import { getHealthPayload } from './health.js';
import { getSearchPayload } from './search.js';
import {
  getReplayEventsForEntity as getReplayEventsForEntityInServer,
  getRecentReplayEvents,
  recordReplayEvent,
  resetReplayForTest
} from './replay.js';
import { getDriveAuthConfig, getDriveAuthProfile } from './driveAuth.js';
import {
  createManifestEntry,
  getManifestEntriesByStatus,
  getManifestEntryByDriveFileId,
  getRecentManifestEntries,
  markManifestFailed,
  markManifestNeedsReview,
  markManifestProcessed,
  markManifestSkipped,
  updateManifestExtraction,
  resetDriveManifestForTest
} from './driveManifest.js';
import { discoverManagedFolders, syncDriveInbox } from './driveSync.js';
import { getDriveSchedulerStatus, startDriveScheduler } from './driveScheduler.js';
import { createCrawlabilityEvent, type CrawlabilityEventInput } from './crawlability.js';
import { createDriveFileRecord, mapDriveFileToSourceRecord, shouldCreate4dataEvent } from './driveIngest.js';
import { extractSupportedFile } from './fileExtraction.js';
import { resetOutcomesForTest } from './outcomes.js';
import { getRecentOutcomes } from './outcomes.js';
import { resetEntityResolutionForTest } from './entityResolution.js';
import { getRecentRecommendations, resetRecommendationsForTest } from './recommendations.js';
import { getRegisteredSources, resetSourceRegistryForTest } from './sourceRegistry.js';
import { loadEnvFromDotFile } from './env.js';
import type { LisaBrowserSearchResult, LisaBrowserRecordType } from './lisa.js';

loadEnvFromDotFile();

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

function mapSearchText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function mapToBrowserSearchResult(input: {
  id: string;
  type: LisaBrowserRecordType;
  title: string;
  summary: string;
  entity_id?: string;
  source_refs?: string[];
  created_at?: string;
  observed_at?: string;
  freshness?: number;
  newness_score?: number;
}): LisaBrowserSearchResult {
  return {
    id: input.id,
    type: input.type,
    title: input.title,
    summary: input.summary,
    entity_id: input.entity_id,
    source_refs: input.source_refs || [],
    created_at: input.created_at,
    observed_at: input.observed_at,
    freshness: input.freshness,
    newness_score: input.newness_score
  };
}

function getMatchTokens(input: string): string[] {
  const rawTokens = (input || '')
    .toLowerCase()
    .split(/[^a-z0-9._:-]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const expanded = new Set<string>();
  for (const token of rawTokens) {
    expanded.add(token);
    const spaceToken = token.replace(/_/g, ' ');
    const compactToken = token.replace(/[\s._-]+/g, '');
    const hyphenToken = token.replace(/[_\s]+/g, '-');
    expanded.add(spaceToken);
    expanded.add(compactToken);
    expanded.add(hyphenToken);
    expanded.add(spaceToken.replace(/-/g, '_'));
  }

  return Array.from(expanded);
}

function rowMatchesQuery(payload: string[], haystack: string): boolean {
  if (!payload.length) return true;
  const lower = haystack.toLowerCase();
  return payload.some((token) => lower.includes(token));
}

function buildBrowserSearchCandidates(query: string, limit = 50): LisaBrowserSearchResult[] {
  const safeLimit = Math.max(1, Math.min(100, limit));
  const tokens = getMatchTokens(query);
  const results: LisaBrowserSearchResult[] = [];
  const seen = new Set<string>();
  const take = (items: LisaBrowserSearchResult[]): void => {
    for (const item of items) {
      if (results.length >= safeLimit) break;
      if (seen.has(item.id)) continue;
      const haystack = [
        item.id,
        item.type,
        item.title,
        item.summary,
        item.entity_id,
        ...(item.source_refs || [])
      ].join(' ');
      if (!rowMatchesQuery(tokens, haystack)) continue;
      seen.add(item.id);
      results.push(item);
    }
  };

  take(searchLisaBrowserEvents(query, safeLimit));
  take(searchTimelineEntriesForBrowser(query, safeLimit));
  take(
    getRecentRecommendations(safeLimit)
      .map((recommendation) =>
        mapToBrowserSearchResult({
          id: recommendation.id,
          type: 'recommendation',
          title: recommendation.title,
          summary: recommendation.summary,
          entity_id: recommendation.entity_id,
          source_refs: recommendation.source_refs,
          created_at: recommendation.created_at,
          freshness: undefined,
          newness_score: undefined
        })
      )
  );
  take(
    getRecentApprovals(safeLimit).map((approval) =>
      mapToBrowserSearchResult({
        id: approval.id,
        type: 'approval',
        title: approval.title,
        summary: approval.summary,
        entity_id: approval.entity_id,
        source_refs: approval.source_refs,
        created_at: approval.created_at
      })
    )
  );
  take(
    getRecentOutcomes(safeLimit).map((outcome) =>
      mapToBrowserSearchResult({
        id: outcome.id,
        type: 'outcome',
        title: mapSearchText(outcome.action),
        summary: mapSearchText(outcome.result) || mapSearchText(outcome.outcome),
        entity_id: outcome.entity_id,
        source_refs: outcome.source_refs,
        created_at: outcome.created_at,
        observed_at: outcome.observed_at
      })
    )
  );
  take(
    getRecentReplayEvents(safeLimit).map((event) =>
      mapToBrowserSearchResult({
        id: event.id,
        type: 'replay',
        title: `Replay: ${event.event_type}`,
        summary: event.summary,
        entity_id: event.entity_id,
        source_refs: event.source_refs || [],
        created_at: event.created_at
      })
    )
  );
  take(
    getRecentManifestEntries(safeLimit).map((entry) =>
      mapToBrowserSearchResult({
        id: entry.id,
        type: 'drive_manifest',
        title: entry.file_name,
        summary: `${entry.processing_status} for ${entry.drive_file_id}${
          entry.extracted_text ? ` | ${entry.extracted_text.slice(0, 120)}` : ''
        }`,
        source_refs: [`drive:${entry.drive_file_id}`],
        created_at: entry.seen_at
      })
    )
  );

  return results.slice(0, safeLimit);
}

type DriveManifestStatusLiteral = 'seen' | 'pending' | 'processed' | 'skipped' | 'needs_review' | 'archived' | 'failed';

function parseDriveManifestStatus(
  value: string | undefined
): DriveManifestStatusLiteral | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  const allowedStatuses = new Set(['seen', 'pending', 'processed', 'skipped', 'needs_review', 'archived', 'failed']);
  return allowedStatuses.has(normalized) ? (normalized as DriveManifestStatusLiteral) : undefined;
}

function getDriveImportRejectReason(fileRecord: ReturnType<typeof createDriveFileRecord>, eventCreated: boolean, hasEntity: boolean): string {
  if (!hasEntity) {
    return 'Missing entity_id for context mapping';
  }
  if (fileRecord.processing_status === 'needs_review') {
    return 'File is in needs-review folder';
  }
  if (fileRecord.processing_status === 'pending') {
    return 'File is still pending inbox processing';
  }
  if (fileRecord.processing_status === 'unknown') {
    return 'Drive file processing failed';
  }
  if (!eventCreated) {
    return 'Unsupported format or low-confidence file';
  }
  return 'Import skipped';
}

function inferDriveReplayType(fileRecord: ReturnType<typeof createDriveFileRecord>, eventCreated: boolean, needsReview: boolean): 'drive_import_needs_review' | 'drive_import_skipped' {
  if (!eventCreated && needsReview) {
    return 'drive_import_needs_review';
  }
  return 'drive_import_skipped';
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
  resetDriveManifestForTest();
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

  if (method === 'GET' && pathname === '/api/lisa/search') {
    const queryString = query.q || '';
    const limit = getNumber(query.limit, 20);
    if (!queryString.trim()) {
      return responseJson(res, { query: '', results: [] });
    }
    return responseJson(res, {
      query: queryString,
      results: buildBrowserSearchCandidates(queryString, limit)
    });
  }

  if (method === 'GET' && pathname === '/api/lisa/events') {
    const queryString = query.q || '';
    const limit = getNumber(query.limit, 20);
    const payload = queryString
      ? searchLisaBrowserEvents(queryString, limit)
      : getLisaEventsForBrowser(limit);
    return responseJson(res, { events: payload });
  }

  if (method === 'GET' && pathname === '/api/lisa/entities') {
    const limit = getNumber(query.limit, 50);
    return responseJson(res, { entities: getLisaEntities(limit) });
  }

  const lisaEntityMatch = pathname.match(/^\/api\/lisa\/entities\/([^/]+)$/);
  if (method === 'GET' && lisaEntityMatch) {
    const entityId = decodeURIComponent(lisaEntityMatch[1]);
    const entity = getLisaEntityRecord(entityId);
    if (!entity) {
      return responseJson(res, { error: 'Entity not found' }, 404);
    }
    const timeline = getEntityTimeline(entityId, getNumber(query.limit, 20));
    const events = getLisaEventsForBrowser(200).filter((event) => event.entity_id === entity.entity_id);
    const timelineRows = getTimelineEntriesForBrowser(200).filter((entry) => entry.entity_id === entity.entity_id);
    const sourceRefs = Array.from(
      new Set(
        [
          ...entity.source_refs,
          ...events.flatMap((entry) => entry.source_refs),
          ...timelineRows.flatMap((entry) => entry.source_refs)
        ].filter((entry) => Boolean(entry))
      )
    );
    return responseJson(res, {
      entity,
      timeline,
      timeline_results: timelineRows,
      source_refs: sourceRefs
    });
  }

  if (method === 'GET' && pathname === '/api/lisa/sources') {
    return responseJson(res, { sources: getRegisteredSources() });
  }

  if (method === 'GET' && pathname === '/api/lisa/replay') {
    const limit = getNumber(query.limit, 20);
    const entityId = query.entity;
    const events = entityId
      ? getReplayEventsForEntityInServer(entityId)
      : getRecentReplayEvents(limit);
    return responseJson(res, { replay_events: events.slice(0, limit) });
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

  if (method === 'POST' && pathname === '/api/drive/import-file') {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = body as Record<string, unknown>;

    const driveFileId = typeof payload.drive_file_id === 'string' ? payload.drive_file_id : '';
    const fileName = typeof payload.file_name === 'string' ? payload.file_name : '';
    const mimeType = typeof payload.mime_type === 'string' ? payload.mime_type : '';
    const folderPath = typeof payload.folder_path === 'string' ? payload.folder_path : '';
    const webUrl = typeof payload.web_url === 'string' ? payload.web_url : '';

    if (!driveFileId || !fileName || !mimeType || !folderPath || !webUrl) {
      return responseJson(
        res,
        { error: 'Drive imports require drive_file_id, file_name, mime_type, folder_path, and web_url' },
        400
      );
    }

    const entityId = typeof payload.entity_id === 'string' ? payload.entity_id : undefined;
    const observedAt = typeof payload.observed_at === 'string' ? payload.observed_at : undefined;
    const rawMetadata =
      payload.raw_metadata && typeof payload.raw_metadata === 'object' ? (payload.raw_metadata as Record<string, unknown>) : undefined;

    const fileRecord = createDriveFileRecord({
      drive_file_id: driveFileId,
      file_name: fileName,
      mime_type: mimeType,
      folder_path: folderPath,
      web_url: webUrl,
      entity_id: entityId,
      observed_at: observedAt
    });

    const sourceRecord = mapDriveFileToSourceRecord(fileRecord);
    const manifest = createManifestEntry(fileRecord);
    let eventId: string | undefined;
    let status: 'processed' | 'needs_review' | 'skipped' | 'failed' = 'failed';
    let updatedManifest = manifest;
    const canCreateEvent = shouldCreate4dataEvent(fileRecord) && Boolean(entityId);
    const textContent =
      rawMetadata && typeof rawMetadata.text_content === 'string'
        ? rawMetadata.text_content
        : rawMetadata && typeof rawMetadata.content === 'string'
          ? rawMetadata.content
          : undefined;

    const extraction = extractSupportedFile({
      file_id: driveFileId,
      file_name: fileName,
      mime_type: mimeType,
      content: textContent
    });
    updatedManifest = updateManifestExtraction(manifest.id, {
      extracted_text: extraction.extracted_text,
      extracted_fields: extraction.extracted_fields,
      extraction_status: extraction.extraction_status,
      extraction_error: extraction.extraction_error,
      extracted_at: extraction.extracted_at
    });

    if (extraction.extraction_status === 'completed') {
      recordReplayEvent({
        event_type: 'drive_file_extraction_completed',
        entity_id: entityId,
        signal_id: manifest.id,
        summary: `Drive file ${driveFileId} extraction completed`,
        source_refs: [`drive:${driveFileId}`, `manifest:${manifest.id}`],
        payload: {
          extracted_at: extraction.extracted_at
        }
      });
    } else if (extraction.extraction_status === 'failed') {
      recordReplayEvent({
        event_type: 'drive_file_extraction_failed',
        entity_id: entityId,
        signal_id: manifest.id,
        summary: `Drive file ${driveFileId} extraction failed`,
        source_refs: [`drive:${driveFileId}`, `manifest:${manifest.id}`],
        payload: {
          extraction_error: extraction.extraction_error
        }
      });
    } else {
      recordReplayEvent({
        event_type: 'drive_file_metadata_only',
        entity_id: entityId,
        signal_id: manifest.id,
        summary: `Drive file ${driveFileId} metadata-only extraction`,
        source_refs: [`drive:${driveFileId}`, `manifest:${manifest.id}`],
        payload: {
          extraction_status: extraction.extraction_status
        }
      });
    }

    recordReplayEvent({
      event_type: 'drive_import_received',
      entity_id: entityId,
      summary: `Drive file ${driveFileId} received for import`,
      source_refs: [`drive:${driveFileId}`, `manifest:${manifest.id}`],
      payload: {
        file_name: fileName,
        mime_type: mimeType,
        folder_path: folderPath,
        raw_metadata: rawMetadata
      }
    });

    try {
      if (canCreateEvent) {
        eventId = ingestDriveImportEvent({
          entity_id: entityId!,
          event_type: 'drive_file_imported',
          origin_surface: 'drive',
          observed_at: observedAt,
          source_reference: `drive:${driveFileId}`,
          file_name: fileName,
          web_url: webUrl,
          folder_path: folderPath,
          folder_id: fileRecord.folder_id,
          mime_type: mimeType,
          drive_file_id: driveFileId,
          source_type: 'google_drive_file',
          processing_status: fileRecord.processing_status,
          payload: rawMetadata,
          title: `Drive file imported: ${fileName}`,
          summary: `Imported ${fileName} from Google Drive into LISA`
        });

        updatedManifest = markManifestProcessed(manifest.id, {
          source_record_id: `drive:${driveFileId}`,
          created_4data_event_id: eventId,
          processed_at: fileRecord.processed_at || new Date().toISOString()
        });
        status = 'processed';

        recordReplayEvent({
          event_type: 'drive_import_processed',
          entity_id: entityId,
          signal_id: eventId,
          recommendation_id: undefined,
          summary: `Drive file ${driveFileId} imported into LISA`,
          source_refs: [`lisa:${eventId}`, `drive:${driveFileId}`, `manifest:${manifest.id}`],
          payload: sourceRecord
        });
      } else {
        const needsReview = fileRecord.processing_status === 'needs_review' || !entityId || fileRecord.confidence === 0;
        const reason = getDriveImportRejectReason(fileRecord, false, Boolean(entityId));
        if (needsReview) {
          updatedManifest = markManifestNeedsReview(manifest.id, reason);
          status = 'needs_review';
          recordReplayEvent({
            event_type: inferDriveReplayType(fileRecord, false, true),
            entity_id: entityId,
            summary: `Drive file ${driveFileId} requires review`,
            source_refs: [`drive:${driveFileId}`, `manifest:${manifest.id}`],
            payload: { reason }
          });
        } else {
          updatedManifest = markManifestSkipped(manifest.id, reason);
          status = 'skipped';
          recordReplayEvent({
            event_type: inferDriveReplayType(fileRecord, false, false),
            entity_id: entityId,
            summary: `Drive file ${driveFileId} was skipped during import`,
            source_refs: [`drive:${driveFileId}`, `manifest:${manifest.id}`],
            payload: { reason }
          });
        }
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Drive import failed';
      updatedManifest = markManifestFailed(manifest.id, reason);
      status = 'failed';
      recordReplayEvent({
        event_type: 'drive_import_failed',
        entity_id: entityId,
        summary: `Drive file ${driveFileId} import failed`,
        source_refs: [`drive:${driveFileId}`, `manifest:${manifest.id}`],
        payload: {
          reason
        }
      });
    }

    return responseJson(res, {
      status: 'ok',
      manifest_entry: updatedManifest,
      event_id: eventId,
      status_hint: status,
      source_record_id: sourceRecord.drive_file_id
    });
  }

  if (method === 'POST' && pathname === '/api/drive/sync') {
    try {
      const result = await syncDriveInbox();
      return responseJson(res, { status: result.status, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Drive sync failed';
      return responseJson(res, { error: message }, 500);
    }
  }

  if (method === 'GET' && pathname === '/api/drive/status') {
    try {
      const discovery = await discoverManagedFolders();
      const authConfig = getDriveAuthConfig();
      const authProfile = getDriveAuthProfile(authConfig);
      const scheduler = getDriveSchedulerStatus();
      return responseJson(res, {
        status: discovery.status,
        mode: discovery.mode,
        root_mode: discovery.rootMode,
        root_folder_name: discovery.root_folder_name,
        root_folder_id: discovery.root_folder_id,
        auth: {
          configured: authProfile.configured,
          ready: authProfile.ready,
          reason: authProfile.reason,
          sync_enabled: authConfig.syncEnabled,
          sync_mode: authConfig.syncMode,
          root_mode: authConfig.rootMode,
          root_folder_name: authConfig.rootFolderName,
          root_folder_id: authConfig.rootFolderId,
          mode: authConfig.mode
        },
        reason: discovery.reason,
        managed_folders: discovery.managed_folders,
        canonical_folder_ids: discovery.canonical_folder_ids,
        duplicate_managed_folders: discovery.duplicate_managed_folders,
        sync_blocked: discovery.sync_blocked,
        sync_block_reason: discovery.sync_block_reason,
        bootstrap_enabled: discovery.bootstrap_enabled,
        create_missing_folders: discovery.create_missing_folders,
        folder_create_allowed: discovery.folder_create_allowed,
        scheduler_enabled: scheduler.scheduler_enabled,
        scheduler_interval_minutes: scheduler.scheduler_interval_minutes,
        last_scheduled_sync_at: scheduler.last_scheduled_sync_at,
        last_scheduled_sync_result: scheduler.last_scheduled_sync_result,
        bootstrap_plan: discovery.bootstrap_plan,
        sync_mode: discovery.syncMode
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Drive status failed';
      return responseJson(res, { error: message }, 500);
    }
  }

  if (method === 'GET' && pathname === '/api/drive/manifest') {
    const limit = getNumber(query.limit, 50);
    const requestedStatus = parseDriveManifestStatus(query.status);
    const payload =
      requestedStatus
        ? getManifestEntriesByStatus(requestedStatus)
        : getRecentManifestEntries(limit);
    return responseJson(res, {
      manifest_entries: requestedStatus
        ? payload.slice(0, limit)
        : payload
    });
  }

  if (method === 'GET' && pathname === '/api/drive/needs-review') {
    const limit = getNumber(query.limit, 50);
    const entries = getManifestEntriesByStatus('needs_review');
    return responseJson(res, { manifest_entries: entries.slice(0, limit) });
  }

  const driveManifestMatch = pathname.match(/^\/api\/drive\/manifest\/([^/]+)$/);
  if (method === 'GET' && driveManifestMatch) {
    const driveFileId = decodeURIComponent(driveManifestMatch[1]);
    const entry = getManifestEntryByDriveFileId(driveFileId);
    if (!entry) {
      return responseJson(res, { error: 'Drive manifest entry not found' }, 404);
    }
    return responseJson(res, { manifest_entry: entry });
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
      source_reference?: string;
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
      event_type: payload.signal_type ?? payload.event_type ?? 'contractor_claim'
    });
    return responseJson(res, { status: 'ok', signal_id: signalId, event_id: signalId });
  }

  if (method === 'POST' && pathname === '/api/events/mealscout') {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = body as Record<string, unknown>;
    const entityId = typeof payload.entity_id === 'string' ? payload.entity_id : undefined;
    const eventType = typeof payload.event_type === 'string' ? payload.event_type : undefined;
    const signalType = typeof payload.signal_type === 'string' ? payload.signal_type : undefined;
    const sourceReference = typeof payload.source_reference === 'string' ? payload.source_reference : undefined;
    if (!entityId) {
      return responseJson(
        res,
        { error: 'MealScout events require entity_id' },
        400
      );
    }
    const signalId = ingestMealScoutEvent({
      ...payload,
      entity_id: entityId,
      origin_surface: 'mealscout',
      source_reference: sourceReference || `mealscout:${entityId}`,
      event_type: signalType ?? eventType ?? 'contractor_claim'
    });
    return responseJson(res, { status: 'ok', signal_id: signalId, event_id: signalId });
  }

  if (method === 'POST' && pathname === '/api/events/crawlability') {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = body as CrawlabilityEventInput;
    try {
      if (!payload || !payload.event_type) {
        return responseJson(
          res,
          { error: 'Crawlability events require event_type' },
          400
        );
      }
      const normalizedEvent = createCrawlabilityEvent(payload);
      if (!normalizedEvent.entity_id) {
        return responseJson(
          res,
          { error: 'Crawlability events require a valid URL or entity_id' },
          400
        );
      }
      const signalId = ingestCrawlabilityEvent(normalizedEvent);
      return responseJson(res, { status: 'ok', signal_id: signalId, event_id: signalId });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to process crawlability event';
      return responseJson(res, { error: message }, 400);
    }
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
  startDriveScheduler();
  server.listen(port, () => {
    console.log(`merlin-or listening on http://localhost:${port}`);
  });
  return server;
}

if (process.env.MERLIN_RUNTIME !== 'test') {
  startMerlinServer();
}
