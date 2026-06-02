export type MealScoutFileAttribution = {
  attributionSource: 'drive_metadata' | 'folder_context' | 'request_context' | 'unknown';
  attributionStatus?:
    | 'matched_affiliate'
    | 'matched_affiliate_folder'
    | 'matched_owner_affiliate'
    | 'matched_last_modifier_affiliate'
    | 'request_context'
    | 'ambiguous'
    | 'unmatched'
    | 'unknown';
  driveUploaderEmail?: string;
  driveUploaderName?: string;
  ownerEmail?: string;
  ownerDisplayName?: string;
  lastModifyingUserEmail?: string;
  lastModifyingUserName?: string;
  uploadedAt?: string;
  modifiedAt?: string;
  intakeSubmittedBy?: string;
  affiliateId?: string;
  affiliateEmail?: string;
  affiliateCode?: string;
  affiliate_attribution_email?: string;
  affiliate_attribution_source?: 'folder_email_token';
  affiliate_attribution_folder?: string;
  affiliate_attribution_folder_path?: string;
  affiliate_attribution_warnings?: string[];
  repId?: string;
  needsAttributionReview?: boolean;
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
  reason:
    | 'already_processed'
    | 'unsupported_type'
    | 'empty_bytes'
    | 'ocr_unavailable'
    | 'not_selected'
    | 'duplicate_candidate'
    | 'already_duplicate';
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
  safeMode?: boolean;
  status: 'completed' | 'partial' | 'failed';
  startedAt: string;
  completedAt: string;
  operatorId?: string;
  scannedFileCount: number;
  eligibleFileCount: number;
  processedFileCount: number;
  skippedFileCount: number;
  skippedAlreadyProcessedCount?: number;
  skippedNotSelectedCount?: number;
  skippedUnsupportedCount?: number;
  skippedDuplicateCount?: number;
  skippedDuplicateReviewCount?: number;
  failedFileCount: number;
  ocrFailureCount: number;
  unknownAttributionCount: number;
  unattachedMediaCount: number;
  draftCount: number;
  attributionSources: Array<'drive_metadata' | 'folder_context' | 'request_context' | 'unknown'>;
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
      safeMode: entry.safeMode,
      status: entry.status,
      startedAt: entry.startedAt,
      completedAt: entry.completedAt,
      operatorId: entry.operatorId,
      scannedFileCount: entry.scannedFileCount,
      eligibleFileCount: entry.eligibleFileCount,
      processedFileCount: entry.processedFileCount,
      skippedFileCount: entry.skippedFileCount,
      skippedAlreadyProcessedCount: entry.skippedAlreadyProcessedCount,
      skippedNotSelectedCount: entry.skippedNotSelectedCount,
      skippedUnsupportedCount: entry.skippedUnsupportedCount,
      skippedDuplicateCount: entry.skippedDuplicateCount,
      skippedDuplicateReviewCount: entry.skippedDuplicateReviewCount,
      failedFileCount: entry.failedFileCount,
      ocrFailureCount: entry.ocrFailureCount,
      unknownAttributionCount: entry.unknownAttributionCount,
      unattachedMediaCount: entry.unattachedMediaCount,
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
