import { createServer, type IncomingMessage, type ServerResponse, type Server as HttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { sep, resolve } from 'node:path';
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
  assertDriveHealthForMutation,
  buildDriveAuthUnhealthyPayload,
  getDriveAuthHealth,
  runDriveReconciliation
} from './driveSafety.js';
import {
  closeDriveReviewQueuePersistence,
  decideDriveReviewQueueItem,
  getDriveReviewQueueAuditTrail,
  getDriveReviewQueueItem,
  getDriveReviewQueueItemHistory,
  resetDriveReviewQueueForTest,
  runDriveReviewQueue,
  type DriveReviewQueueDecision
} from './driveReviewQueue.js';
import {
  attachManifestToEntity,
  createManifestEntry,
  getManifestEntriesByStatus,
  getManifestEntryByDriveFileId,
  getRecentManifestEntries,
  markManifestFailed,
  markManifestNeedsReview,
  markManifestProcessed,
  markManifestSkipped,
  routeManifestEntry,
  updateManifestExtraction,
  resetDriveManifestForTest
} from './driveManifest.js';
import { discoverManagedFolders, syncDriveInbox } from './driveSync.js';
import { getDriveSchedulerStatus, startDriveScheduler } from './driveScheduler.js';
import { getDriveClient } from './driveClient.js';
import type { DriveClient, DriveFileInfo } from './driveClient.js';
import { createCrawlabilityEvent, type CrawlabilityEventInput } from './crawlability.js';
import { createDriveFileRecord, mapDriveFileToSourceRecord, shouldCreate4dataEvent } from './driveIngest.js';
import { extractSupportedFile } from './fileExtraction.js';
import { suggestEntitiesForDriveFile } from './entitySuggestions.js';
import { resetOutcomesForTest } from './outcomes.js';
import { getRecentOutcomes } from './outcomes.js';
import { recordOutcome } from './outcomes.js';
import { resetEntityResolutionForTest } from './entityResolution.js';
import { getRecentRecommendations, resetRecommendationsForTest } from './recommendations.js';
import { getRegisteredSources, resetSourceRegistryForTest } from './sourceRegistry.js';
import { loadEnvFromDotFile } from './env.js';
import { resolveOperatorIdentity } from './operatorIdentity.js';
import { discoverMealScoutIntakeFolders } from './mealscoutDriveIntake.js';
import type { MealScoutIntakeDiscovery } from './mealscoutDriveIntake.js';
import { clusterMealScoutEvidenceFiles } from './mealscoutEvidenceClustering.js';
import { createMealScoutEvidenceFromScreenshotInput, type MealScoutScreenshotInput } from './mealscoutScreenshotExtraction.js';
import { runMealScoutLocalOcr } from './mealscoutOcrAdapter.js';
import { buildMealScoutPublishPlanPreview } from './mealscoutPublishPlan.js';
import { getMealScoutPublishPlan, rememberMealScoutPublishPlan, resetMealScoutPublishPlansForTest } from './mealscoutPublishPlan.js';
import {
  addMealScoutScreenshotEvidence,
  approveMealScoutDraft,
  buildMealScoutDraftsFromClusters,
  buildMealScoutMergeAssist,
  createMealScoutBatch,
  createNewDraftFromCluster,
  getMealScoutBatch,
  getMealScoutBatchDrafts,
  getMealScoutClusterMatches,
  getMealScoutDraft,
  getMealScoutDraftProposedChanges,
  linkClusterToExistingTruck,
  mergeDraftIntoCluster,
  moveEvidenceToCluster,
  publishMealScoutDraft,
  rejectMealScoutDraft,
  resetMealScoutProfileImportForTest,
  splitDraftByEvidence
} from './mealscoutProfileImport.js';
import {
  createMealScoutReviewDecision,
  listMealScoutReviewDecisions,
  resetMealScoutReviewDecisionsForTest,
  updateMealScoutReviewDecision
} from './mealscoutReviewDecisions.js';
import {
  detectSafeMealScoutWritePath,
  executeMealScoutPublishPlan,
  resetMealScoutPublishExecutionForTest
} from './mealscoutPublishExecution.js';
import type { LisaBrowserSearchResult, LisaBrowserRecordType } from './lisa.js';

loadEnvFromDotFile();

type QueryBag = { [key: string]: string | undefined };
type ReviewQueueDecisionLiteral =
  | 'acknowledged'
  | 'needs_manual_review'
  | 'false_positive'
  | 'defer'
  | 'resolved_externally';

type ReviewQueueQueryFilters = {
  requestId?: string;
  decidedBy?: string;
  decision?: ReviewQueueDecisionLiteral;
  from?: string;
  to?: string;
  limit: number;
};

type ReviewQueueFilterSummary = {
  requestId: string | null;
  decidedBy: string | null;
  decision: ReviewQueueDecisionLiteral | null;
  from: string | null;
  to: string | null;
  limit: number;
};

type DemoSeedEvent = {
  entity_id: string;
  event_type: string;
  entity_name?: string;
  title: string;
  summary: string;
  review_required: boolean;
  truth_score?: number;
};

const DRIVE_PREVIEW_SUPPORTED_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'heic',
  'heif',
  'pdf'
]);

function isSupportedMealScoutPreviewFile(file: DriveFileInfo): boolean {
  const mime = (file.mime_type || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (mime === 'application/pdf') return true;
  const extension = file.file_name.includes('.') ? (file.file_name.split('.').pop() || '').toLowerCase() : '';
  return DRIVE_PREVIEW_SUPPORTED_EXTENSIONS.has(extension);
}

function convertDriveFileToMealScoutScreenshotInput(file: DriveFileInfo): MealScoutScreenshotInput {
  const metadata = file.raw_metadata || {};
  const metadataPath = typeof metadata.folder_path === 'string' ? metadata.folder_path : undefined;
  const extractedText = typeof metadata.extracted_text === 'string' ? metadata.extracted_text : undefined;
  const visualLabels = Array.isArray(metadata.visual_labels)
    ? metadata.visual_labels.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : undefined;
  const drivePath = metadataPath ? `${metadataPath}/${file.file_name}` : `drive://${file.folder_id}/${file.file_name}`;

  return {
    fileId: file.drive_file_id,
    fileName: file.file_name,
    drivePath,
    sourceFolder: metadataPath || file.folder_id,
    sourceFolderId: file.folder_id,
    mimeType: file.mime_type,
    modifiedTime: file.modified_time,
    extractedText,
    visualLabels
  };
}

type MealScoutPreviewOcrDiagnostic = {
  fileId: string;
  name: string;
  mimeType: string;
  byteLength: number;
  downloadAttempted: boolean;
  downloadSucceeded: boolean;
  downloadError?: string;
  downloadSource: string;
  detectedEngineCandidates: Array<{ engine: string; status: string }>;
  selectedEngine: string;
  engine: string;
  ocrAttempted: boolean;
  ocrSucceeded: boolean;
  extractedTextLength: number;
  extractedTextSnippet: string;
  extractionError?: string;
};

type HydratedMealScoutPreviewResult = {
  files: DriveFileInfo[];
  diagnostics: MealScoutPreviewOcrDiagnostic[];
};

function buildExtractedTextDiagnostic(text: string | undefined): { extractedTextLength: number; extractedTextSnippet: string } {
  const safeText = (text || '').trim();
  return {
    extractedTextLength: safeText.length,
    extractedTextSnippet: safeText.slice(0, 300)
  };
}

async function hydrateDriveFilesForPreviewWithDiagnostics(
  files: DriveFileInfo[],
  driveClient: DriveClient
): Promise<HydratedMealScoutPreviewResult> {
  const hydratedEntries = await Promise.all(
    files.map(async (file) => {
      const rawMetadata = file.raw_metadata || {};
      const existingText = typeof rawMetadata.extracted_text === 'string' ? rawMetadata.extracted_text : undefined;
      const hasExistingText = Boolean(existingText && existingText.trim().length > 0);
      if (hasExistingText) {
        const base = buildExtractedTextDiagnostic(existingText);
        return {
          file,
          diagnostic: {
            fileId: file.drive_file_id,
            name: file.file_name,
            mimeType: file.mime_type,
            byteLength: 0,
            downloadAttempted: false,
            downloadSucceeded: false,
            downloadSource: 'metadata_existing',
            detectedEngineCandidates: [],
            selectedEngine: 'metadata_existing',
            engine: 'metadata_existing',
            ocrAttempted: false,
            ocrSucceeded: true,
            ...base
          } satisfies MealScoutPreviewOcrDiagnostic
        };
      }
      if (typeof driveClient.downloadFileBinary !== 'function') {
        const legacyText = await driveClient.downloadFileContent(file.drive_file_id);
        const normalizedLegacyText = typeof legacyText === 'string' ? legacyText.trim() : '';
        if (normalizedLegacyText) {
          const base = buildExtractedTextDiagnostic(normalizedLegacyText);
          return {
            file: {
              ...file,
              raw_metadata: {
                ...rawMetadata,
                extracted_text: normalizedLegacyText
              }
            },
            diagnostic: {
              fileId: file.drive_file_id,
              name: file.file_name,
              mimeType: file.mime_type,
              byteLength: Buffer.byteLength(normalizedLegacyText, 'utf8'),
              downloadAttempted: true,
              downloadSucceeded: true,
              downloadSource: 'legacy_text_download',
              detectedEngineCandidates: [],
              selectedEngine: 'legacy_text_download',
              engine: 'legacy_text_download',
              ocrAttempted: false,
              ocrSucceeded: true,
              ...base
            } satisfies MealScoutPreviewOcrDiagnostic
          };
        }
      }
      const ocr = await runMealScoutLocalOcr({
        fileId: file.drive_file_id,
        name: file.file_name,
        mimeType: file.mime_type,
        downloadBytes: async () => {
          if (typeof driveClient.downloadFileBinary === 'function') {
            return driveClient.downloadFileBinary(file.drive_file_id);
          }
          return undefined;
        }
      });

      const nextFile = ocr.ocrSucceeded
        ? {
            ...file,
            raw_metadata: {
              ...rawMetadata,
              extracted_text: ocr.extractedText
            }
          }
        : file;
      const base = buildExtractedTextDiagnostic(ocr.extractedText);
      return {
        file: nextFile,
        diagnostic: {
          fileId: file.drive_file_id,
          name: file.file_name,
          mimeType: file.mime_type,
          byteLength: ocr.byteLength,
          downloadAttempted: ocr.downloadAttempted,
          downloadSucceeded: ocr.downloadSucceeded,
          ...(ocr.downloadError ? { downloadError: ocr.downloadError } : {}),
          downloadSource: ocr.downloadSource,
          detectedEngineCandidates: ocr.detectedEngineCandidates,
          selectedEngine: ocr.selectedEngine,
          engine: ocr.engine,
          ocrAttempted: ocr.ocrAttempted,
          ocrSucceeded: ocr.ocrSucceeded,
          ...base,
          ...(ocr.safeError ? { extractionError: ocr.safeError } : {})
        } satisfies MealScoutPreviewOcrDiagnostic
      };
    })
  );
  return {
    files: hydratedEntries.map((entry) => entry.file),
    diagnostics: hydratedEntries.map((entry) => entry.diagnostic)
  };
}

type MealScoutPreviewDriveFolderResolution =
  | { ok: true; folderId: string; source: 'provided' | 'discovered' }
  | {
      ok: false;
      reason: string;
      diagnostic: {
        expectedPath: string;
        rootPath: string;
        intakePath: string;
        missingPaths: string[];
        discoveryStatus: MealScoutIntakeDiscovery['status'];
        discoveryReason?: string;
      };
    };

function buildMealScoutPreviewUnavailableDiagnostic(discovery: MealScoutIntakeDiscovery): MealScoutPreviewDriveFolderResolution {
  const expectedPath = `${discovery.root.mealscout_intake.path}/incoming/unknown`;
  const missingPaths = discovery.missing.map((key) => `${discovery.root.mealscout_intake.path}/${key}`);
  return {
    ok: false,
    reason: 'MealScout intake folder unavailable for preview listing',
    diagnostic: {
      expectedPath,
      rootPath: discovery.root.merlin.path,
      intakePath: discovery.root.mealscout_intake.path,
      missingPaths,
      discoveryStatus: discovery.status,
      discoveryReason: discovery.reason
    }
  };
}

async function resolveMealScoutPreviewDriveFolderId(folderId?: string): Promise<MealScoutPreviewDriveFolderResolution> {
  const provided = (folderId || '').trim();
  if (provided) {
    return { ok: true, folderId: provided, source: 'provided' };
  }

  const discovery = await discoverMealScoutIntakeFolders({ createMissing: false });
  const discoveredFolderId = discovery.folders['incoming/unknown']?.id || discovery.folders['incoming/screenshots']?.id;
  if (!discoveredFolderId) {
    return buildMealScoutPreviewUnavailableDiagnostic(discovery);
  }
  return { ok: true, folderId: discoveredFolderId, source: 'discovered' };
}

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

function parseIsoTimestamp(value: string, label: string): { iso?: string; error?: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { error: `${label} must not be empty` };
  }
  const isoRfc3339Pattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (!isoRfc3339Pattern.test(trimmed)) {
    return { error: `${label} must be a valid ISO timestamp` };
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return { error: `${label} must be a valid ISO timestamp` };
  }
  return { iso: parsed.toISOString() };
}

function parseReviewQueueQueryFilters(
  query: QueryBag,
  options?: { defaultLimit?: number; maxLimit?: number }
): { filters?: ReviewQueueQueryFilters; error?: string } {
  const allowedKeys = new Set(['requestId', 'decidedBy', 'decision', 'from', 'to', 'limit']);
  for (const key of Object.keys(query)) {
    if (!allowedKeys.has(key)) {
      return { error: `Unsupported query parameter: ${key}` };
    }
  }

  const requestId = query.requestId?.trim();
  const decidedBy = query.decidedBy?.trim();
  const rawDecision = query.decision?.trim();
  const rawFrom = query.from?.trim();
  const rawTo = query.to?.trim();
  const rawLimit = query.limit?.trim();
  const maxLimit = options?.maxLimit ?? 100;
  const defaultLimit = options?.defaultLimit ?? 50;

  const allowedDecisions: ReviewQueueDecisionLiteral[] = [
    'acknowledged',
    'needs_manual_review',
    'false_positive',
    'defer',
    'resolved_externally'
  ];

  let decision: ReviewQueueDecisionLiteral | undefined;
  if (rawDecision) {
    if (!allowedDecisions.includes(rawDecision as ReviewQueueDecisionLiteral)) {
      return { error: 'decision must be one of acknowledged, needs_manual_review, false_positive, defer, resolved_externally' };
    }
    decision = rawDecision as ReviewQueueDecisionLiteral;
  }

  let from: string | undefined;
  if (rawFrom) {
    const parsed = parseIsoTimestamp(rawFrom, 'from');
    if (parsed.error) return { error: parsed.error };
    from = parsed.iso;
  }

  let to: string | undefined;
  if (rawTo) {
    const parsed = parseIsoTimestamp(rawTo, 'to');
    if (parsed.error) return { error: parsed.error };
    to = parsed.iso;
  }

  if (from && to && from > to) {
    return { error: 'from must be less than or equal to to' };
  }

  let limit = defaultLimit;
  if (rawLimit) {
    if (!/^\d+$/.test(rawLimit)) {
      return { error: 'limit must be a positive integer' };
    }
    const parsedLimit = Number.parseInt(rawLimit, 10);
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      return { error: 'limit must be greater than zero' };
    }
    if (parsedLimit > maxLimit) {
      return { error: `limit must be less than or equal to ${maxLimit}` };
    }
    limit = parsedLimit;
  }

  return {
    filters: {
      requestId: requestId || undefined,
      decidedBy: decidedBy || undefined,
      decision,
      from,
      to,
      limit
    }
  };
}

function buildReviewQueueFilterSummary(filters: ReviewQueueQueryFilters): ReviewQueueFilterSummary {
  return {
    requestId: filters.requestId ?? null,
    decidedBy: filters.decidedBy ?? null,
    decision: filters.decision ?? null,
    from: filters.from ?? null,
    to: filters.to ?? null,
    limit: filters.limit
  };
}

const PUBLIC_DIR = resolve(process.cwd(), 'public');

function getPublicMimeType(filePath: string): string {
  const extension = filePath.split('.').pop()?.toLowerCase();
  if (extension === 'js') return 'application/javascript';
  if (extension === 'css') return 'text/css';
  return 'text/html';
}

function servePublicFile(res: ServerResponse, fileName: string): boolean {
  const publicPath = resolve(PUBLIC_DIR, fileName);
  const normalizedDir = PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : `${PUBLIC_DIR}${sep}`;
  if (!publicPath.startsWith(normalizedDir)) {
    return false;
  }
  if (!existsSync(publicPath)) return false;
  try {
    const contents = readFileSync(publicPath, 'utf8');
    res.statusCode = 200;
    res.setHeader('Content-Type', getPublicMimeType(fileName));
    res.end(contents);
    return true;
  } catch {
    return false;
  }
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
        entity_id: entry.entity_id,
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

function canMarkDriveFileReviewed(status: string): boolean {
  return status === 'needs_review' || status === 'failed' || status === 'skipped';
}

function isRouteTarget(value: unknown): value is 'processed' | 'entity_files' | 'archive' {
  return value === 'processed' || value === 'entity_files' || value === 'archive';
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
  resetDriveReviewQueueForTest();
  resetMealScoutProfileImportForTest();
  resetMealScoutReviewDecisionsForTest();
  resetMealScoutPublishPlansForTest();
  resetMealScoutPublishExecutionForTest();
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
    const syncHealth = await assertDriveHealthForMutation('drive_sync');
    if (!syncHealth.ok) {
      return responseJson(
        res,
        buildDriveAuthUnhealthyPayload(syncHealth.health, 'drive_sync'),
        409
      );
    }
    try {
      const result = await syncDriveInbox();
      return responseJson(res, { status: result.status, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Drive sync failed';
      return responseJson(res, { error: message }, 500);
    }
  }

  if (method === 'GET' && pathname === '/api/drive/auth-health') {
    try {
      const health = await getDriveAuthHealth();
      recordReplayEvent({
        event_type: 'drive_auth_health_checked',
        summary: `Drive auth health checked: ${health.status}`,
        source_refs: ['system:drive_auth_health'],
        payload: {
          status: health.status,
          auth: {
            ready: health.auth.ready,
            configured: health.auth.configured
          },
          managedFoldersReady: health.managedFolders.ready
        }
      });
      return responseJson(res, health);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Drive auth health check failed';
      return responseJson(res, { error: message }, 500);
    }
  }

  if (method === 'GET' && pathname === '/api/drive/reconciliation') {
    try {
      const reconciliation = await runDriveReconciliation();
      return responseJson(res, reconciliation);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Drive reconciliation failed';
      return responseJson(res, { error: message }, 500);
    }
  }

  if ((method === 'GET' || method === 'HEAD') && pathname === '/admin/drive-review-queue-client.js') {
    const served = servePublicFile(res, 'drive-review-queue-client.js');
    if (served) return;
    return responseJson(res, { error: 'Drive review queue client not found' }, 404);
  }

  if ((method === 'GET' || method === 'HEAD') && pathname === '/admin/drive-review-queue') {
    const served = servePublicFile(res, 'drive-review-queue.html');
    if (served) return;
    return responseJson(res, { error: 'Drive review queue panel not found' }, 404);
  }

  if ((method === 'GET' || method === 'HEAD') && pathname === '/admin/mealscout-review-queue-client.js') {
    const served = servePublicFile(res, 'mealscout-review-queue-client.js');
    if (served) return;
    return responseJson(res, { error: 'MealScout review queue client not found' }, 404);
  }

  if ((method === 'GET' || method === 'HEAD') && pathname === '/admin/mealscout-review-queue') {
    const served = servePublicFile(res, 'mealscout-review-queue.html');
    if (served) return;
    return responseJson(res, { error: 'MealScout review queue panel not found' }, 404);
  }

  if (method === 'GET' && pathname === '/api/drive/review-queue') {
    try {
      const queue = await runDriveReviewQueue();
      return responseJson(res, queue);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Drive review queue failed';
      return responseJson(res, { error: message }, 500);
    }
  }

  if (method === 'GET' && pathname === '/api/drive/review-queue/audit') {
    const parsed = parseReviewQueueQueryFilters(query, { defaultLimit: 50, maxLimit: 100 });
    if (parsed.error) {
      return responseJson(res, { error: parsed.error }, 400);
    }
    const records = getDriveReviewQueueAuditTrail(parsed.filters);
    return responseJson(res, {
      status: 'ok',
      mode: 'read_only',
      mutationAllowed: false,
      records
    });
  }

  if (method === 'GET' && pathname === '/api/drive/review-queue/audit/export.json') {
    const parsed = parseReviewQueueQueryFilters(query, { defaultLimit: 50, maxLimit: 100 });
    if (parsed.error) {
      return responseJson(res, { error: parsed.error }, 400);
    }
    const filters = parsed.filters as ReviewQueueQueryFilters;
    const records = getDriveReviewQueueAuditTrail(filters);
    const generatedAt = new Date().toISOString();
    const filterSummary = buildReviewQueueFilterSummary(filters);
    const recordCount = records.length;
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'attachment; filename="drive-review-queue-audit.json"');
    res.end(
      JSON.stringify({
        status: 'ok',
        mode: 'read_only',
        mutationAllowed: false,
        exportedAt: generatedAt,
        generatedAt,
        recordCount,
        filterSummary,
        ordering: 'decidedAt_desc',
        sourceEndpoint: '/api/drive/review-queue/audit/export.json',
        records
      })
    );
    return;
  }

  if (method === 'POST' && pathname === '/api/mealscout/profile-import/batches') {
    const batch = createMealScoutBatch();
    return responseJson(res, { status: 'ok', batch }, 201);
  }

  if (method === 'POST' && pathname === '/api/mealscout/intake/preview') {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = (body || {}) as {
      inputs?: MealScoutScreenshotInput[];
      driveFolderId?: string;
      loadFromDriveFolder?: boolean;
      includeUnsupportedDriveFiles?: boolean;
      includeDebugOcr?: boolean;
      existingProfiles?: Array<{
        id: string;
        truckName?: string;
        phone?: string;
        email?: string;
        website?: string;
        cityArea?: string;
        socials?: { facebook?: string; instagram?: string };
      }>;
    };
    const requestInputs = Array.isArray(payload.inputs) ? payload.inputs : [];
    const loadFromDriveFolder = payload.loadFromDriveFolder === true;
    const includeDebugOcr = payload.includeDebugOcr === true;
    let inputs = requestInputs;
    let driveSource:
      | {
          folderId: string;
          folderSource: 'provided' | 'discovered';
          listedCount: number;
          filteredOutCount: number;
        }
      | undefined;
    let driveOcrDiagnostics: MealScoutPreviewOcrDiagnostic[] | undefined;

    if (loadFromDriveFolder) {
      try {
        const resolved = await resolveMealScoutPreviewDriveFolderId(payload.driveFolderId);
        if (!resolved.ok) {
          return responseJson(
            res,
            {
              error: resolved.reason,
              mutationAllowed: false,
              diagnostic: resolved.diagnostic
            },
            409
          );
        }
        const driveClient = getDriveClient();
        const listedFiles = await driveClient.listFilesInFolder(resolved.folderId);
        const filteredFiles = payload.includeUnsupportedDriveFiles
          ? listedFiles
          : listedFiles.filter((file) => isSupportedMealScoutPreviewFile(file));
        const hydratedPreview = await hydrateDriveFilesForPreviewWithDiagnostics(filteredFiles, driveClient);
        const hydratedFiles = hydratedPreview.files;
        driveOcrDiagnostics = hydratedPreview.diagnostics;
        inputs = hydratedFiles.map(convertDriveFileToMealScoutScreenshotInput);
        driveSource = {
          folderId: resolved.folderId,
          folderSource: resolved.source,
          listedCount: listedFiles.length,
          filteredOutCount: Math.max(0, listedFiles.length - filteredFiles.length)
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Drive folder preview listing failed';
        return responseJson(res, { error: message, mutationAllowed: false }, 409);
      }
    }

    if (loadFromDriveFolder && inputs.length === 0) {
      return responseJson(res, {
        status: 'ok',
        mutationAllowed: false,
        driveSource,
        evidenceFiles: [],
        clusters: [],
        drafts: [],
        summary: {
          inputs: 0,
          evidenceCount: 0,
          clusterCount: 0,
          draftCount: 0
        }
      });
    }

    if (inputs.length === 0) {
      return responseJson(res, { error: 'inputs is required and must be a non-empty array' }, 400);
    }

    const evidenceFiles = inputs.map((input) => createMealScoutEvidenceFromScreenshotInput(input));
    const existingHints = (payload.existingProfiles || []).map((profile) => ({
      existingProfileId: profile.id,
      truckName: profile.truckName,
      phone: profile.phone,
      email: profile.email,
      website: profile.website,
      cityArea: profile.cityArea,
      facebook: profile.socials?.facebook,
      instagram: profile.socials?.instagram
    }));
    const clusters = clusterMealScoutEvidenceFiles(evidenceFiles, existingHints);
    const existingProfiles = (payload.existingProfiles || []).map((profile) => ({
      id: profile.id,
      truckName: profile.truckName,
      phone: profile.phone,
      email: profile.email,
      website: profile.website,
      cityArea: profile.cityArea,
      socials: profile.socials
    }));
    const drafts = buildMealScoutDraftsFromClusters(clusters, existingProfiles);
    const mergeAssist = buildMealScoutMergeAssist(drafts);
    const reviewDecisions = listMealScoutReviewDecisions();
    const publishPlan = rememberMealScoutPublishPlan(buildMealScoutPublishPlanPreview(drafts, reviewDecisions));
    const evidenceByFileId = new Map(evidenceFiles.map((file) => [file.fileId, file]));
    const debugOcr =
      includeDebugOcr && driveOcrDiagnostics
        ? driveOcrDiagnostics.map((diagnostic) => {
            const evidence = evidenceByFileId.get(diagnostic.fileId);
            const extractedSignals = evidence?.extractedSignals || {};
            const contactSignals = [
              extractedSignals.phone ? 'phone' : '',
              extractedSignals.email ? 'email' : '',
              extractedSignals.website ? 'website' : '',
              extractedSignals.facebook ? 'facebook' : '',
              extractedSignals.instagram ? 'instagram' : ''
            ].filter(Boolean);
            const priceSignals = (extractedSignals.menuItems || [])
              .map((item) => item.price || '')
              .filter((value) => value.length > 0);
            const socialSignals = [extractedSignals.facebook || '', extractedSignals.instagram || ''].filter(Boolean);
            return {
              ...diagnostic,
              classification: {
                detectedType: evidence?.detectedType || 'unknown',
                confidence: evidence?.confidence ?? 0
              },
              detectedSignals: {
                truckName: extractedSignals.truckName,
                menuItemCount: (extractedSignals.menuItems || []).length,
                contactSignals,
                priceSignals,
                socialSignals
              }
            };
          })
        : undefined;

    return responseJson(res, {
      status: 'ok',
      mutationAllowed: false,
      driveSource,
      ...(debugOcr ? { debugOcr } : {}),
      evidenceFiles,
      clusters,
      drafts,
      mergeAssist,
      publishPlan,
      summary: {
        inputs: inputs.length,
        evidenceCount: evidenceFiles.length,
        clusterCount: clusters.length,
        draftCount: drafts.length
      }
    });
  }

  if (method === 'POST' && pathname === '/api/mealscout/intake/publish-plan/execute') {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body', mutationAllowed: false }, 400);
    }
    const payload = (body || {}) as {
      planId?: unknown;
      recordIds?: unknown;
      confirmation?: unknown;
      operatorId?: unknown;
    };
    const planId = typeof payload.planId === 'string' ? payload.planId.trim() : '';
    const confirmation = payload.confirmation === true;
    const recordIds = Array.isArray(payload.recordIds)
      ? payload.recordIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
    if (!confirmation) return responseJson(res, { error: 'confirmation required', mutationAllowed: false }, 400);
    if (!planId) return responseJson(res, { error: 'planId is required', mutationAllowed: false }, 400);
    if (recordIds.length === 0) return responseJson(res, { error: 'recordIds is required', mutationAllowed: false }, 400);
    const plan = getMealScoutPublishPlan(planId);
    if (!plan) return responseJson(res, { error: 'plan is stale or not found', mutationAllowed: false }, 409);
    try {
      const execution = executeMealScoutPublishPlan({
        planId,
        recordIds,
        confirmation,
        operatorId: typeof payload.operatorId === 'string' ? payload.operatorId : undefined
      });
      return responseJson(res, execution);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'publish execution failed';
      return responseJson(
        res,
        {
          error: message,
          mutationAllowed: false,
          safeWritePath: detectSafeMealScoutWritePath()
        },
        409
      );
    }
  }

  if (method === 'GET' && pathname === '/api/mealscout/review-decisions') {
    const draftId = query.draftId?.trim() || undefined;
    const decisions = listMealScoutReviewDecisions({ draftId });
    return responseJson(res, {
      status: 'ok',
      mutationAllowed: false,
      decisions
    });
  }

  if (method === 'POST' && pathname === '/api/mealscout/review-decisions') {
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body', mutationAllowed: false }, 400);
    }
    const payload = (body || {}) as {
      draftIds?: unknown;
      decision?: unknown;
      reason?: unknown;
      sourceFileIds?: unknown;
      evidenceRefs?: unknown;
      decidedBy?: unknown;
    };
    const draftIds = Array.isArray(payload.draftIds) ? payload.draftIds.filter((item): item is string => typeof item === 'string') : [];
    const decision = typeof payload.decision === 'string' ? payload.decision : '';
    if (!draftIds.length) {
      return responseJson(res, { error: 'draftIds is required', mutationAllowed: false }, 400);
    }
    if (!['same_truck', 'keep_separate', 'needs_review'].includes(decision)) {
      return responseJson(res, { error: 'decision is invalid', mutationAllowed: false }, 400);
    }
    const sourceFileIds = Array.isArray(payload.sourceFileIds)
      ? payload.sourceFileIds.filter((item): item is string => typeof item === 'string')
      : [];
    const evidenceRefs = Array.isArray(payload.evidenceRefs)
      ? payload.evidenceRefs.filter((item): item is string => typeof item === 'string')
      : [];
    const record = createMealScoutReviewDecision({
      draftIds,
      decision: decision as 'same_truck' | 'keep_separate' | 'needs_review',
      reason: typeof payload.reason === 'string' ? payload.reason : undefined,
      sourceFileIds,
      evidenceRefs,
      decidedBy: typeof payload.decidedBy === 'string' ? payload.decidedBy : undefined
    });
    return responseJson(res, { status: 'ok', mutationAllowed: false, decision: record }, 201);
  }

  const reviewDecisionMatch = pathname.match(/^\/api\/mealscout\/review-decisions\/([^/]+)$/);
  if (method === 'PATCH' && reviewDecisionMatch) {
    const decisionId = decodeURIComponent(reviewDecisionMatch[1]);
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body', mutationAllowed: false }, 400);
    }
    const payload = (body || {}) as {
      draftIds?: unknown;
      decision?: unknown;
      reason?: unknown;
      sourceFileIds?: unknown;
      evidenceRefs?: unknown;
      decidedBy?: unknown;
    };
    const updates: Parameters<typeof updateMealScoutReviewDecision>[1] = {};
    if (Array.isArray(payload.draftIds)) {
      updates.draftIds = payload.draftIds.filter((item): item is string => typeof item === 'string');
    }
    if (typeof payload.decision === 'string') {
      if (!['same_truck', 'keep_separate', 'needs_review'].includes(payload.decision)) {
        return responseJson(res, { error: 'decision is invalid', mutationAllowed: false }, 400);
      }
      updates.decision = payload.decision as 'same_truck' | 'keep_separate' | 'needs_review';
    }
    if (typeof payload.reason === 'string') updates.reason = payload.reason;
    if (Array.isArray(payload.sourceFileIds)) {
      updates.sourceFileIds = payload.sourceFileIds.filter((item): item is string => typeof item === 'string');
    }
    if (Array.isArray(payload.evidenceRefs)) {
      updates.evidenceRefs = payload.evidenceRefs.filter((item): item is string => typeof item === 'string');
    }
    if (typeof payload.decidedBy === 'string') updates.decidedBy = payload.decidedBy;

    const updated = updateMealScoutReviewDecision(decisionId, updates);
    if (!updated) return responseJson(res, { error: 'Decision not found', mutationAllowed: false }, 404);
    return responseJson(res, { status: 'ok', mutationAllowed: false, decision: updated });
  }

  const batchScreenshotsMatch = pathname.match(/^\/api\/mealscout\/profile-import\/batches\/([^/]+)\/screenshots$/);
  if (method === 'POST' && batchScreenshotsMatch) {
    const batchId = decodeURIComponent(batchScreenshotsMatch[1]);
    const batch = getMealScoutBatch(batchId);
    if (!batch) return responseJson(res, { error: 'Batch not found' }, 404);
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = body as Record<string, unknown>;
    const fileName = typeof payload.fileName === 'string' ? payload.fileName.trim() : '';
    if (!fileName) return responseJson(res, { error: 'fileName is required' }, 400);
    const evidence = addMealScoutScreenshotEvidence({
      batchId,
      fileName,
      imageStorageKey: typeof payload.imageStorageKey === 'string' ? payload.imageStorageKey : undefined,
      rawExtractedText: typeof payload.rawExtractedText === 'string' ? payload.rawExtractedText : undefined,
      detectedEntityHints:
        typeof payload.detectedEntityHints === 'object' && payload.detectedEntityHints !== null
          ? (payload.detectedEntityHints as Record<string, string>)
          : undefined,
      extractedFacts:
        Array.isArray(payload.extractedFacts)
          ? payload.extractedFacts
              .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
              .map((item) => ({
                field: typeof item.field === 'string' ? item.field : '',
                value: typeof item.value === 'string' ? item.value : '',
                confidence: typeof item.confidence === 'number' ? item.confidence : undefined,
                evidenceText: typeof item.evidenceText === 'string' ? item.evidenceText : undefined
              }))
              .filter((item) => item.field && item.value)
          : undefined
    });
    return responseJson(res, { status: 'ok', evidence }, 201);
  }

  const batchDetailMatch = pathname.match(/^\/api\/mealscout\/profile-import\/batches\/([^/]+)$/);
  if (method === 'GET' && batchDetailMatch) {
    const batchId = decodeURIComponent(batchDetailMatch[1]);
    const batch = getMealScoutBatch(batchId);
    if (!batch) return responseJson(res, { error: 'Batch not found' }, 404);
    return responseJson(res, { status: 'ok', batch });
  }

  const batchDraftsMatch = pathname.match(/^\/api\/mealscout\/profile-import\/batches\/([^/]+)\/drafts$/);
  if (method === 'GET' && batchDraftsMatch) {
    const batchId = decodeURIComponent(batchDraftsMatch[1]);
    const batch = getMealScoutBatch(batchId);
    if (!batch) return responseJson(res, { error: 'Batch not found' }, 404);
    const draftList = getMealScoutBatchDrafts(batchId);
    return responseJson(res, { status: 'ok', drafts: draftList });
  }

  const clusterMatches = pathname.match(/^\/api\/mealscout\/profile-import\/clusters\/([^/]+)\/matches$/);
  if (method === 'GET' && clusterMatches) {
    const clusterId = decodeURIComponent(clusterMatches[1]);
    const matches = getMealScoutClusterMatches(clusterId);
    if (!matches) return responseJson(res, { error: 'Cluster not found' }, 404);
    return responseJson(res, { status: 'ok', matches });
  }

  const linkCluster = pathname.match(/^\/api\/mealscout\/profile-import\/clusters\/([^/]+)\/link-existing$/);
  if (method === 'POST' && linkCluster) {
    const clusterId = decodeURIComponent(linkCluster[1]);
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = body as Record<string, unknown>;
    const truckId = typeof payload.truckId === 'string' ? payload.truckId.trim() : '';
    if (!truckId) return responseJson(res, { error: 'truckId is required' }, 400);
    const draft = linkClusterToExistingTruck(clusterId, truckId);
    if (!draft) return responseJson(res, { error: 'Cluster or truck not found' }, 404);
    return responseJson(res, { status: 'ok', draft });
  }

  const createFromCluster = pathname.match(/^\/api\/mealscout\/profile-import\/clusters\/([^/]+)\/create-new-draft$/);
  if (method === 'POST' && createFromCluster) {
    const clusterId = decodeURIComponent(createFromCluster[1]);
    const draft = createNewDraftFromCluster(clusterId);
    if (!draft) return responseJson(res, { error: 'Cluster not found' }, 404);
    return responseJson(res, { status: 'ok', draft });
  }

  const draftDetail = pathname.match(/^\/api\/mealscout\/profile-import\/drafts\/([^/]+)$/);
  if (method === 'GET' && draftDetail) {
    const draftId = decodeURIComponent(draftDetail[1]);
    const draft = getMealScoutDraft(draftId);
    if (!draft) return responseJson(res, { error: 'Draft not found' }, 404);
    return responseJson(res, { status: 'ok', draft });
  }

  const proposedChangesMatch = pathname.match(/^\/api\/mealscout\/profile-import\/drafts\/([^/]+)\/proposed-changes$/);
  if (method === 'GET' && proposedChangesMatch) {
    const draftId = decodeURIComponent(proposedChangesMatch[1]);
    const proposed = getMealScoutDraftProposedChanges(draftId);
    if (!proposed) return responseJson(res, { error: 'Draft not found' }, 404);
    return responseJson(res, { status: 'ok', proposed });
  }

  const approveDraft = pathname.match(/^\/api\/mealscout\/profile-import\/drafts\/([^/]+)\/approve$/);
  if (method === 'POST' && approveDraft) {
    const draftId = decodeURIComponent(approveDraft[1]);
    const draft = approveMealScoutDraft(draftId);
    if (!draft) return responseJson(res, { error: 'Draft not found' }, 404);
    return responseJson(res, { status: 'ok', draft });
  }

  const approveUpdates = pathname.match(/^\/api\/mealscout\/profile-import\/drafts\/([^/]+)\/approve-updates$/);
  if (method === 'POST' && approveUpdates) {
    const draftId = decodeURIComponent(approveUpdates[1]);
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = (body || {}) as Record<string, unknown>;
    const draft = approveMealScoutDraft(draftId, {
      menuDeferred: Boolean(payload.menuDeferred)
    });
    if (!draft) return responseJson(res, { error: 'Draft not found' }, 404);
    return responseJson(res, { status: 'ok', draft });
  }

  const rejectDraft = pathname.match(/^\/api\/mealscout\/profile-import\/drafts\/([^/]+)\/reject$/);
  if (method === 'POST' && rejectDraft) {
    const draftId = decodeURIComponent(rejectDraft[1]);
    const draft = rejectMealScoutDraft(draftId);
    if (!draft) return responseJson(res, { error: 'Draft not found' }, 404);
    return responseJson(res, { status: 'ok', draft });
  }

  const publishDraft = pathname.match(/^\/api\/mealscout\/profile-import\/drafts\/([^/]+)\/publish$/);
  if (method === 'POST' && publishDraft) {
    const draftId = decodeURIComponent(publishDraft[1]);
    const draft = publishMealScoutDraft(draftId);
    if (!draft) return responseJson(res, { error: 'Draft must be approved before publish' }, 409);
    return responseJson(res, { status: 'ok', draft });
  }

  const moveEvidence = pathname.match(/^\/api\/mealscout\/profile-import\/evidence\/([^/]+)\/move$/);
  if (method === 'POST' && moveEvidence) {
    const evidenceId = decodeURIComponent(moveEvidence[1]);
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = body as Record<string, unknown>;
    const clusterId = typeof payload.clusterId === 'string' ? payload.clusterId.trim() : '';
    if (!clusterId) return responseJson(res, { error: 'clusterId is required' }, 400);
    const draft = moveEvidenceToCluster(evidenceId, clusterId);
    if (!draft) return responseJson(res, { error: 'Evidence or cluster not found' }, 404);
    return responseJson(res, { status: 'ok', draft });
  }

  const mergeDraft = pathname.match(/^\/api\/mealscout\/profile-import\/drafts\/([^/]+)\/merge$/);
  if (method === 'POST' && mergeDraft) {
    const draftId = decodeURIComponent(mergeDraft[1]);
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = body as Record<string, unknown>;
    const fromClusterId = typeof payload.fromClusterId === 'string' ? payload.fromClusterId.trim() : '';
    if (!fromClusterId) return responseJson(res, { error: 'fromClusterId is required' }, 400);
    const draft = mergeDraftIntoCluster(draftId, fromClusterId);
    if (!draft) return responseJson(res, { error: 'Draft or cluster not found' }, 404);
    return responseJson(res, { status: 'ok', draft });
  }

  const splitDraft = pathname.match(/^\/api\/mealscout\/profile-import\/drafts\/([^/]+)\/split$/);
  if (method === 'POST' && splitDraft) {
    const draftId = decodeURIComponent(splitDraft[1]);
    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = body as Record<string, unknown>;
    const evidenceId = typeof payload.evidenceId === 'string' ? payload.evidenceId.trim() : '';
    if (!evidenceId) return responseJson(res, { error: 'evidenceId is required' }, 400);
    const draft = splitDraftByEvidence(draftId, evidenceId);
    if (!draft) return responseJson(res, { error: 'Draft or evidence not found' }, 404);
    return responseJson(res, { status: 'ok', draft });
  }

  const driveReviewQueueMatch = pathname.match(/^\/api\/drive\/review-queue\/([^/]+)$/);
  if (method === 'GET' && driveReviewQueueMatch) {
    const itemId = decodeURIComponent(driveReviewQueueMatch[1]);
    const item = await getDriveReviewQueueItem(itemId);
    if (!item) {
      return responseJson(res, { error: 'Review queue item not found' }, 404);
    }
    return responseJson(res, {
      status: 'ok',
      mode: 'read_only',
      mutationAllowed: false,
      item
    });
  }

  const driveReviewQueueHistoryMatch = pathname.match(/^\/api\/drive\/review-queue\/([^/]+)\/history$/);
  if (method === 'GET' && driveReviewQueueHistoryMatch) {
    const parsed = parseReviewQueueQueryFilters(query, { defaultLimit: 50, maxLimit: 100 });
    if (parsed.error) {
      return responseJson(res, { error: parsed.error }, 400);
    }
    const itemId = decodeURIComponent(driveReviewQueueHistoryMatch[1]);
    const item = await getDriveReviewQueueItem(itemId);
    if (!item) {
      return responseJson(res, { error: 'Review queue item not found' }, 404);
    }
    const history = getDriveReviewQueueItemHistory(itemId, parsed.filters);
    return responseJson(res, {
      status: 'ok',
      mode: 'read_only',
      mutationAllowed: false,
      itemId,
      history
    });
  }

  const reviewQueueDecisionMatch = pathname.match(/^\/api\/drive\/review-queue\/([^/]+)\/decision$/);
  if (method === 'POST' && reviewQueueDecisionMatch) {
    const itemId = decodeURIComponent(reviewQueueDecisionMatch[1]);
    const queueHealth = await assertDriveHealthForMutation('drive_review_queue_decision', undefined);
    if (!queueHealth.ok) {
      return responseJson(
        res,
        buildDriveAuthUnhealthyPayload(queueHealth.health, 'drive_review_queue_decision'),
        409
      );
    }

    const item = await getDriveReviewQueueItem(itemId);
    if (!item) {
      return responseJson(res, { error: 'Review queue item not found' }, 404);
    }

    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = body as Record<string, unknown>;
    const decision = typeof payload.decision === 'string' ? payload.decision.trim() : '';
    if (!decision) {
      return responseJson(res, { error: 'decision is required' }, 400);
    }

    const allowedDecisions: DriveReviewQueueDecision[] = [
      'acknowledged',
      'needs_manual_review',
      'false_positive',
      'defer',
      'resolved_externally'
    ];
    if (!allowedDecisions.includes(decision as DriveReviewQueueDecision)) {
      return responseJson(res, { error: 'Unsupported decision' }, 400);
    }

    const decidedBy = resolveOperatorIdentity(req).decidedBy;
    const note = typeof payload.note === 'string' ? payload.note.trim() : undefined;
    const updated = await decideDriveReviewQueueItem(itemId, decision as DriveReviewQueueDecision, note, decidedBy);
    return responseJson(
      res,
      {
        status: 'ok',
        mode: 'read_only',
        mutationAllowed: false,
        item: updated
      },
      updated ? 200 : 404
    );
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

  if (method === 'GET' && pathname === '/api/mealscout/intake/folders') {
    try {
      const createMissing = query.create === 'true';
      const discovery = await discoverMealScoutIntakeFolders({ createMissing });
      return responseJson(res, discovery, discovery.status === 'ready' ? 200 : discovery.status === 'disabled' ? 503 : 409);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MealScout intake folder discovery failed';
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

  const driveReviewMarkMatch = pathname.match(/^\/api\/drive\/review\/([^/]+)\/mark-reviewed$/);
  if (method === 'POST' && driveReviewMarkMatch) {
    const driveFileId = decodeURIComponent(driveReviewMarkMatch[1]);
    const entry = getManifestEntryByDriveFileId(driveFileId);
    if (!entry) {
      return responseJson(res, { error: 'Drive manifest entry not found' }, 404);
    }

    if (!canMarkDriveFileReviewed(entry.processing_status)) {
      return responseJson(
        res,
        {
          error: 'Drive file is not reviewable in current state',
          processing_status: entry.processing_status
        },
        409
      );
    }

    const reviewedManifest = markManifestProcessed(entry.id, {
      notes: [entry.notes, 'Reviewed manually in Merlin UI'].filter(Boolean).join(' | ')
    });

    const outcome = recordOutcome({
      entity_id: reviewedManifest.entity_id || `drive:${reviewedManifest.drive_file_id}`,
      signal_id: reviewedManifest.created_4data_event_id || reviewedManifest.source_record_id || reviewedManifest.id,
      action: 'mark_drive_file_reviewed',
      outcome: 'manual_done',
      status: 'completed',
      result: `Drive file ${reviewedManifest.file_name} marked reviewed`,
      source_refs: [`drive:${reviewedManifest.drive_file_id}`, `manifest:${reviewedManifest.id}`],
      observed_at: new Date().toISOString()
    });

    const replayEvent = recordReplayEvent({
      event_type: 'drive_file_reviewed',
      entity_id: reviewedManifest.entity_id || `drive:${reviewedManifest.drive_file_id}`,
      signal_id: reviewedManifest.created_4data_event_id || reviewedManifest.source_record_id || reviewedManifest.id,
      outcome_id: outcome.id,
      summary: `Drive file ${reviewedManifest.drive_file_id} marked reviewed`,
      source_refs: [`drive:${reviewedManifest.drive_file_id}`, `manifest:${reviewedManifest.id}`],
      payload: {
        processing_status_before: entry.processing_status,
        processing_status_after: reviewedManifest.processing_status
      }
    });

    return responseJson(res, {
      status: 'ok',
      manifest_entry: reviewedManifest,
      outcome,
      replay_event: replayEvent
    });
  }

  const driveAttachEntityMatch = pathname.match(/^\/api\/drive\/review\/([^/]+)\/attach-entity$/);
  if (method === 'POST' && driveAttachEntityMatch) {
    const driveFileId = decodeURIComponent(driveAttachEntityMatch[1]);
    const entry = getManifestEntryByDriveFileId(driveFileId);
    if (!entry) {
      return responseJson(res, { error: 'Drive manifest entry not found' }, 404);
    }

    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = body as Record<string, unknown>;
    const entityId = typeof payload.entity_id === 'string' ? payload.entity_id.trim() : '';
    const entityType = typeof payload.entity_type === 'string' ? payload.entity_type.trim() : undefined;
    const note = typeof payload.note === 'string' ? payload.note.trim() : undefined;
    if (!entityId) {
      return responseJson(res, { error: 'entity_id is required' }, 400);
    }

    const attachedManifest = attachManifestToEntity(entry.id, {
      entity_id: entityId,
      entity_type: entityType,
      note
    });

    const signalId = ingestDriveImportEvent({
      entity_id: entityId,
      event_type: 'drive_file_attached',
      origin_surface: 'drive',
      observed_at: new Date().toISOString(),
      source_reference: `drive:${attachedManifest.drive_file_id}`,
      file_name: attachedManifest.file_name,
      web_url: '',
      folder_path: attachedManifest.folder_path,
      folder_id: 'managed-folder',
      mime_type: attachedManifest.mime_type,
      drive_file_id: attachedManifest.drive_file_id,
      source_type: 'google_drive_file',
      processing_status: attachedManifest.processing_status,
      payload: {
        note,
        entity_type: entityType,
        manifest_id: attachedManifest.id
      },
      title: `Drive file attached: ${attachedManifest.file_name}`,
      summary: note || `Drive file ${attachedManifest.file_name} manually attached to ${entityId}`
    });

    const outcome = recordOutcome({
      entity_id: entityId,
      signal_id: signalId,
      action: 'attach_drive_file_to_entity',
      outcome: 'manual_done',
      status: 'completed',
      result: `Attached ${attachedManifest.file_name} to ${entityId}`,
      source_refs: [`drive:${attachedManifest.drive_file_id}`, `manifest:${attachedManifest.id}`, `lisa:${signalId}`],
      observed_at: new Date().toISOString()
    });

    const replayEvent = recordReplayEvent({
      event_type: 'drive_file_attached_to_entity',
      entity_id: entityId,
      signal_id: signalId,
      outcome_id: outcome.id,
      summary: `Drive file ${attachedManifest.drive_file_id} attached to ${entityId}`,
      source_refs: [`drive:${attachedManifest.drive_file_id}`, `manifest:${attachedManifest.id}`, `lisa:${signalId}`],
      payload: {
        entity_type: entityType,
        note
      }
    });

    return responseJson(res, {
      status: 'ok',
      manifest_entry: attachedManifest,
      outcome,
      replay_event: replayEvent,
      signal_id: signalId
    });
  }

  const driveSuggestionsMatch = pathname.match(/^\/api\/drive\/review\/([^/]+)\/entity-suggestions$/);
  if (method === 'GET' && driveSuggestionsMatch) {
    const driveFileId = decodeURIComponent(driveSuggestionsMatch[1]);
    const entry = getManifestEntryByDriveFileId(driveFileId);
    if (!entry) {
      return responseJson(res, { error: 'Drive manifest entry not found' }, 404);
    }
    const suggestions = suggestEntitiesForDriveFile(driveFileId);
    const replay = recordReplayEvent({
      event_type: 'drive_entity_suggestions_generated',
      entity_id: entry.entity_id,
      signal_id: entry.id,
      summary: `Generated ${suggestions.length} entity suggestions for drive file ${driveFileId}`,
      source_refs: [`drive:${driveFileId}`, `manifest:${entry.id}`],
      payload: {
        suggestion_count: suggestions.length
      }
    });
    return responseJson(res, {
      drive_file_id: driveFileId,
      suggestions,
      replay_event_id: replay.id
    });
  }

  const driveRouteMatch = pathname.match(/^\/api\/drive\/review\/([^/]+)\/route$/);
  if (method === 'POST' && driveRouteMatch) {
    const driveFileId = decodeURIComponent(driveRouteMatch[1]);
    const entry = getManifestEntryByDriveFileId(driveFileId);
    if (!entry) {
      return responseJson(res, { error: 'Drive manifest entry not found' }, 404);
    }

    const body = await parseBody(req);
    if (typeof body === 'object' && body !== null && '__invalid_body' in body) {
      return responseJson(res, { error: 'Invalid JSON body' }, 400);
    }
    const payload = body as Record<string, unknown>;
    const target = payload.target;
    const note = typeof payload.note === 'string' ? payload.note.trim() : undefined;
    const requestEntityId = typeof payload.entity_id === 'string' ? payload.entity_id.trim() : undefined;
    if (!isRouteTarget(target)) {
      return responseJson(res, { error: 'target must be processed, entity_files, or archive' }, 400);
    }

    const mutationHealth = await assertDriveHealthForMutation('drive_route', driveFileId);
    if (!mutationHealth.ok) {
      return responseJson(
        res,
        buildDriveAuthUnhealthyPayload(mutationHealth.health, 'drive_route', driveFileId),
        409
      );
    }

    const authConfig = getDriveAuthConfig();
    const discovery = await discoverManagedFolders({ rootFolderId: authConfig.rootFolderId });
    if (discovery.status !== 'ready') {
      return responseJson(
        res,
        {
          error: 'Drive routing unavailable',
          reason: discovery.reason || discovery.sync_block_reason || 'drive_not_ready'
        },
        409
      );
    }
    if (discovery.sync_blocked) {
      return responseJson(
        res,
        {
          error: 'Drive routing blocked',
          reason: discovery.sync_block_reason || 'folder_conflict'
        },
        409
      );
    }

    const client = getDriveClient(authConfig);
    let targetFolderId = '';
    let targetFolderPath = '';
    let attachedEntityId: string | undefined = entry.entity_id;

    if (target === 'processed') {
      targetFolderId = discovery.canonical_folder_ids['01_Processed'];
      targetFolderPath = discovery.managed_folders['01_Processed'].path;
    } else if (target === 'archive') {
      targetFolderId = discovery.canonical_folder_ids['03_Archived_Sources'];
      targetFolderPath = discovery.managed_folders['03_Archived_Sources'].path;
    } else {
      attachedEntityId = requestEntityId || entry.entity_id;
      if (!attachedEntityId) {
        return responseJson(res, { error: 'entity_id is required for entity_files routing' }, 400);
      }
      const entityRootId = discovery.canonical_folder_ids['04_Entity_Files'];
      if (!entityRootId) {
        return responseJson(res, { error: 'Entity files folder is not configured' }, 409);
      }
      const entityFolder = await client.createFolderIfMissing(attachedEntityId, entityRootId);
      targetFolderId = entityFolder.id;
      targetFolderPath = `${discovery.managed_folders['04_Entity_Files'].path}/${attachedEntityId}`;
    }

    if (!targetFolderId || !targetFolderPath) {
      return responseJson(res, { error: 'Target folder is unavailable' }, 409);
    }

    await client.moveFileToFolder(driveFileId, targetFolderId);
    const manifest = routeManifestEntry(entry.id, {
      target,
      folder_path: targetFolderPath,
      entity_id: attachedEntityId,
      note
    });

    const outcome = recordOutcome({
      entity_id: attachedEntityId || `drive:${driveFileId}`,
      signal_id: manifest.created_4data_event_id || manifest.source_record_id || manifest.id,
      action: 'route_drive_file',
      outcome: 'manual_done',
      status: 'completed',
      result: `Routed ${manifest.file_name} to ${target}`,
      source_refs: [`drive:${driveFileId}`, `manifest:${manifest.id}`],
      observed_at: new Date().toISOString()
    });

    const replayEvent = recordReplayEvent({
      event_type: 'drive_file_routed',
      entity_id: attachedEntityId,
      signal_id: manifest.created_4data_event_id || manifest.source_record_id || manifest.id,
      outcome_id: outcome.id,
      summary: `Drive file ${driveFileId} routed to ${targetFolderPath}`,
      source_refs: [`drive:${driveFileId}`, `manifest:${manifest.id}`],
      payload: {
        target,
        target_folder_path: targetFolderPath
      }
    });

    return responseJson(res, {
      status: 'ok',
      manifest_entry: manifest,
      outcome,
      replay_event: replayEvent,
      routed_to: targetFolderPath
    });
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
  const server = createServer(createMerlinHandler);
  server.on('close', () => {
    closeDriveReviewQueuePersistence();
  });
  return server;
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
