export type MealScoutBatchProcessedRecord = {
  fileId: string;
  fileName: string;
  processedAt: string;
  batchId: string;
  classification: 'profile' | 'menu' | 'logo' | 'social' | 'unknown';
  ocrSucceeded: boolean;
  extractedTextLength: number;
  sourceEvidenceRefs: string[];
  sourceFileAttribution?: {
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
};

const processedByFileId = new Map<string, MealScoutBatchProcessedRecord>();

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

export function resetMealScoutBatchProcessedStateForTest(): void {
  processedByFileId.clear();
}
