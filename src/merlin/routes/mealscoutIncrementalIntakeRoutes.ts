import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { getDriveClient, type DriveFileInfo } from '../../driveClient.js';
import { resolveOperatorRole } from '../../operatorIdentity.js';
import { discoverMealScoutIntakeFolders } from '../../mealscoutDriveIntake.js';
import {
  createMealScoutIncrementalQueue,
  getMealScoutIncrementalQueueById,
  listMealScoutIncrementalQueues,
  updateMealScoutIncrementalQueue
} from '../../mealscoutIncrementalIntakeRuntime.js';
import { createMealScoutEvidenceFromScreenshotInput } from '../../mealscoutScreenshotExtraction.js';
import { clusterMealScoutEvidenceFiles } from '../../mealscoutEvidenceClustering.js';
import { getMealScoutBatchProcessedRecord, rememberMealScoutBatchProcessedRecord } from '../../mealscoutBatchIntakeState.js';

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

function isInvalidBody(body: unknown): boolean {
  return typeof body === 'object' && body !== null && '__invalid_body' in body;
}

function hasAccess(req: IncomingMessage): boolean {
  const role = resolveOperatorRole(req).role;
  return new Set(['admin', 'super-admin', 'super_admin', 'operator', 'staff']).has(role);
}

function isSupportedFile(file: DriveFileInfo): boolean {
  const mime = String(file.mime_type || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  if (mime === 'application/pdf') return true;
  const lowerName = String(file.file_name || '').toLowerCase();
  return /\.(png|jpe?g|webp|gif|bmp|heic|heif|pdf)$/i.test(lowerName);
}

function sortFiles(files: DriveFileInfo[]): DriveFileInfo[] {
  return [...files].sort((left, right) => {
    const leftTime = String(left.modified_time || '');
    const rightTime = String(right.modified_time || '');
    if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
    return left.drive_file_id.localeCompare(right.drive_file_id);
  });
}

async function resolveFolder(folderId?: string): Promise<{ folderId: string; folderLabel: string }> {
  const provided = (folderId || '').trim();
  if (provided) return { folderId: provided, folderLabel: provided };
  const discovery = await discoverMealScoutIntakeFolders({ createMissing: false });
  const entry = discovery.folders['incoming/unknown'] || discovery.folders['incoming/screenshots'];
  if (!entry?.id) throw new Error('mealscout_incremental_folder_unavailable');
  return { folderId: entry.id, folderLabel: entry.path };
}

export async function handleMealScoutIncrementalIntakeRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<boolean> {
  const method = (req.method || 'GET').toUpperCase();

  if (method === 'GET' && pathname === '/api/mealscout/intake/incremental/queues') {
    if (!hasAccess(req)) return responseJson(res, { error: 'forbidden', mutationAllowed: false }, 403), true;
    return responseJson(res, {
      mutationAllowed: false,
      queues: listMealScoutIncrementalQueues({ limit: 100 })
    }), true;
  }

  const queueDetailMatch = pathname.match(/^\/api\/mealscout\/intake\/incremental\/queues\/([^/]+)$/);
  if (method === 'GET' && queueDetailMatch) {
    if (!hasAccess(req)) return responseJson(res, { error: 'forbidden', mutationAllowed: false }, 403), true;
    const queue = getMealScoutIncrementalQueueById(decodeURIComponent(queueDetailMatch[1]));
    if (!queue) return responseJson(res, { error: 'queue_not_found', mutationAllowed: false }, 404), true;
    return responseJson(res, { mutationAllowed: false, queue }), true;
  }

  if (method === 'POST' && pathname === '/api/mealscout/intake/incremental/next') {
    if (!hasAccess(req)) return responseJson(res, { error: 'forbidden', mutationAllowed: false }, 403), true;
    const body = await parseBody(req);
    if (isInvalidBody(body)) return responseJson(res, { error: 'Invalid JSON body', mutationAllowed: false }, 400), true;
    const payload = (body || {}) as {
      folderId?: unknown;
      queueId?: unknown;
      chunkSize?: unknown;
      reprocess?: unknown;
    };
    const chunkSizeRaw = typeof payload.chunkSize === 'number' ? payload.chunkSize : Number(payload.chunkSize);
    const chunkSize = Number.isFinite(chunkSizeRaw) && chunkSizeRaw > 0 ? Math.min(100, Math.floor(chunkSizeRaw)) : 10;
    const reprocess = payload.reprocess === true;

    try {
      const resolvedFolder = await resolveFolder(asText(payload.folderId));
      let queue = asText(payload.queueId) ? getMealScoutIncrementalQueueById(asText(payload.queueId)) : undefined;
      if (!queue) {
        queue = createMealScoutIncrementalQueue({
          folder_id: resolvedFolder.folderId,
          folder_label: resolvedFolder.folderLabel
        });
      }

      const driveClient = getDriveClient();
      const listed = sortFiles((await driveClient.listFilesInFolder(queue.folder_id)).filter(isSupportedFile));
      const cursorIndex = queue.last_cursor_file_id ? listed.findIndex((file) => file.drive_file_id === queue?.last_cursor_file_id) : -1;
      const remainingCandidates = listed.filter((file, index) => {
        if (!reprocess && getMealScoutBatchProcessedRecord(file.drive_file_id)) return false;
        if (cursorIndex >= 0 && index <= cursorIndex && !reprocess) return false;
        return true;
      });
      const selected = remainingCandidates.slice(0, chunkSize);
      const batchId = `ms-incremental-batch-${randomUUID()}`;
      const processedFiles: Array<{
        fileId: string;
        fileName: string;
        classification: string;
        confidence: number;
        truckName?: string;
        email?: string;
        phone?: string;
        cityArea?: string;
        menuItemCount: number;
      }> = [];
      const skippedFiles: Array<{ fileId: string; fileName: string; reason: string }> = [];
      const evidenceFiles = [];

      for (const file of selected) {
        const metadataText = typeof file.raw_metadata?.extracted_text === 'string' ? file.raw_metadata.extracted_text : undefined;
        const extractedText = metadataText || (await driveClient.downloadFileContent(file.drive_file_id)) || '';
        const evidence = createMealScoutEvidenceFromScreenshotInput({
          fileId: file.drive_file_id,
          fileName: file.file_name,
          drivePath: typeof file.raw_metadata?.folder_path === 'string' ? file.raw_metadata.folder_path : file.file_name,
          sourceFolder: typeof file.raw_metadata?.folder_path === 'string' ? file.raw_metadata.folder_path : queue.folder_label,
          extractedText
        });
        evidenceFiles.push(evidence);
        const classification = evidence.detectedType === 'schedule' ? 'schedule' : evidence.detectedType;
        rememberMealScoutBatchProcessedRecord({
          fileId: file.drive_file_id,
          fileName: file.file_name,
          processedAt: new Date().toISOString(),
          batchId,
          classification:
            classification === 'profile_screenshot' || classification === 'schedule'
              ? 'profile'
              : classification === 'menu' || classification === 'logo' || classification === 'truck_photo' || classification === 'food_photo' || classification === 'social'
                ? classification
                : 'unknown',
          ocrSucceeded: extractedText.trim().length > 0,
          extractedTextLength: extractedText.length,
          sourceEvidenceRefs: Object.keys(evidence.extractedSignals).filter((key) => Boolean((evidence.extractedSignals as Record<string, unknown>)[key]))
        });
        processedFiles.push({
          fileId: file.drive_file_id,
          fileName: file.file_name,
          classification,
          confidence: evidence.confidence,
          truckName: evidence.extractedSignals.truckName,
          email: evidence.extractedSignals.email,
          phone: evidence.extractedSignals.phone,
          cityArea: evidence.extractedSignals.cityArea,
          menuItemCount: evidence.extractedSignals.menuItems?.length || 0
        });
      }

      const clusters = clusterMealScoutEvidenceFiles(evidenceFiles, []).map((cluster) => ({
        clusterId: cluster.clusterId,
        likelyTruckName: cluster.likelyTruckName,
        reviewStatus: cluster.reviewStatus,
        fileIds: cluster.files.map((file) => file.fileId),
        confidence: cluster.confidence
      }));
      const remainingEligibleCount = Math.max(0, remainingCandidates.length - selected.length);
      const updatedQueue = updateMealScoutIncrementalQueue(queue.id, {
        last_cursor_file_id: selected[selected.length - 1]?.drive_file_id || queue.last_cursor_file_id,
        processed_delta: processedFiles.length,
        skipped_delta: skippedFiles.length,
        last_batch_id: batchId,
        status: remainingEligibleCount === 0 ? 'completed' : 'active'
      }) || queue;

      responseJson(res, {
        mutationAllowed: false,
        queue: updatedQueue,
        batchId,
        folderId: queue.folder_id,
        chunkSize,
        listedSupportedCount: listed.length,
        processedThisChunkCount: processedFiles.length,
        remainingEligibleCount,
        done: remainingEligibleCount === 0,
        processedFiles,
        skippedFiles,
        clusters
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'mealscout_incremental_next_failed';
      responseJson(res, { error: message, mutationAllowed: false }, 409);
      return true;
    }
  }

  return false;
}
