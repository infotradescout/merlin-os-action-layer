export type MealScoutFileAttribution = {
  attributionSource: 'drive_metadata' | 'request_context' | 'unknown';
  driveUploaderEmail?: string;
  driveUploaderName?: string;
  uploadedAt?: string;
  modifiedAt?: string;
  intakeSubmittedBy?: string;
  affiliateCode?: string;
  repId?: string;
  sourceChannel?: 'drive_upload' | 'manual_upload' | 'admin_import';
  batchId?: string;
  capturedAt?: string;
};

export type MealScoutBatchProcessedRecord = {
  fileId: string;
  fileName: string;
  processedAt: string;
  batchId: string;
  classification: 'profile' | 'menu' | 'logo' | 'truck_photo' | 'food_photo' | 'social' | 'unknown';
  ocrSucceeded: boolean;
  extractedTextLength: number;
  sourceEvidenceRefs: string[];
  sourceFileAttribution?: MealScoutFileAttribution;
};

export type MealScoutBatchSkippedRecord = {
  fileId: string;
  fileName: string;
  reason: 'already_processed' | 'unsupported_type' | 'empty_bytes' | 'ocr_unavailable' | 'not_selected';
};

export type MealScoutBatchErrorRecord = {
  fileId?: string;
  message: string;
};

export type MealScoutBatchReviewStatusCounts = {
  unreviewed: number;
  same_truck: number;
  keep_separate: number;
  needs_review: number;
  publish_ready: number;
  blocked: number;
  executed: number;
};

export type MealScoutBatchHistoryEntry = {
  batchId: string;
  folderId: string;
  status: 'completed' | 'partial' | 'failed';
  startedAt: string;
  completedAt: string;
  operatorId?: string;
  scannedFileCount: number;
  eligibleFileCount: number;
  processedFileCount: number;
  skippedFileCount: number;
  failedFileCount: number;
  draftCount: number;
  attributionSources: Array<'drive_metadata' | 'request_context' | 'unknown'>;
  repIds: string[];
  affiliateCodes: string[];
  sourceChannels: Array<'drive_upload' | 'manual_upload' | 'admin_import'>;
  reviewStatusCounts: MealScoutBatchReviewStatusCounts;
};

export type MealScoutBatchHistoryDetail = MealScoutBatchHistoryEntry & {
  processedFiles: MealScoutBatchProcessedRecord[];
  skippedFiles: MealScoutBatchSkippedRecord[];
  failedFiles: MealScoutBatchErrorRecord[];
  generatedDraftIds: string[];
  relatedPublishPlanIds: string[];
  relatedExecutionIds: string[];
};

const processedByFileId = new Map<string, MealScoutBatchProcessedRecord>();
const batchHistoryById = new Map<string, MealScoutBatchHistoryDetail>();

export function getMealScoutBatchProcessedRecord(fileId: string): MealScoutBatchProcessedRecord | undefined {
  return processedByFileId.get(fileId);
}

export function rememberMealScoutBatchProcessedRecord(record: MealScoutBatchProcessedRecord): MealScoutBatchProcessedRecord {
  processedByFileId.set(record.fileId, record);
  return record;
}

export function listMealScoutBatchProcessedRecords(): MealScoutBatchProcessedRecord[] {
  return Array.from(processedByFileId.values());
}

export function rememberMealScoutBatchHistory(detail: MealScoutBatchHistoryDetail): MealScoutBatchHistoryDetail {
  batchHistoryById.set(detail.batchId, detail);
  return detail;
}

export function listMealScoutBatchHistory(): MealScoutBatchHistoryEntry[] {
  return Array.from(batchHistoryById.values())
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .map((entry) => ({
      batchId: entry.batchId,
      folderId: entry.folderId,
      status: entry.status,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
      operatorId: entry.operatorId,
      scannedFileCount: entry.scannedFileCount,
      eligibleFileCount: entry.eligibleFileCount,
      processedFileCount: entry.processedFileCount,
      skippedFileCount: entry.skippedFileCount,
      failedFileCount: entry.failedFileCount,
      draftCount: entry.draftCount,
      attributionSources: entry.attributionSources,
      repIds: entry.repIds,
      affiliateCodes: entry.affiliateCodes,
      sourceChannels: entry.sourceChannels,
      reviewStatusCounts: entry.reviewStatusCounts
    }));
}

export function getMealScoutBatchHistoryDetail(batchId: string): MealScoutBatchHistoryDetail | undefined {
  return batchHistoryById.get(batchId);
}

export function resetMealScoutBatchProcessedStateForTest(): void {
  processedByFileId.clear();
  batchHistoryById.clear();
}
