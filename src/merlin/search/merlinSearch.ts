import type { MerlinBrand } from '../intake/intakeTypes.js';
import { searchEvidenceByBrand } from '../index/evidenceIndex.js';

export type MerlinSearchResult = {
  evidenceId: string;
  uploadId: string;
  brand: MerlinBrand;
  entityType: string;
  entityId?: string;
  actionId: string;
  sourceFileRefs: Array<{ fileId: string; fileName?: string; mimeType?: string }>;
  detectedSignals: string[];
  confidence: number;
  status: string;
  createdAt: string;
};

export function runMerlinSearch(brand: MerlinBrand, q: string): MerlinSearchResult[] {
  return searchEvidenceByBrand(brand, q).map((row) => ({
    evidenceId: row.evidenceId,
    uploadId: row.uploadId,
    brand: row.brand,
    entityType: row.entityType,
    entityId: row.entityId,
    actionId: row.actionId,
    sourceFileRefs: row.sourceFileRefs.map((file) => ({
      fileId: file.fileId,
      fileName: file.fileName,
      mimeType: file.mimeType
    })),
    detectedSignals: row.detectedSignals,
    confidence: row.confidence,
    status: row.status,
    createdAt: row.createdAt
  }));
}
