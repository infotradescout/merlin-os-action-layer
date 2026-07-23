import { randomUUID } from 'node:crypto';
import type { MerlinBrand, MerlinEntityType, RoutingDecision, UploadIntent, UploadIntentFileRef } from '../intake/intakeTypes.js';

export type EvidenceRecord = {
  evidenceId: string;
  uploadId: string;
  brand: MerlinBrand;
  entityType: MerlinEntityType;
  entityId?: string;
  actionId: string;
  sourceFileRefs: UploadIntentFileRef[];
  extractedSnippets: Array<{ fileId: string; snippet: string }>;
  detectedSignals: string[];
  routingDomain: string;
  routingSubtype: string;
  confidence: number;
  status: 'indexed' | 'held';
  createdAt: string;
  updatedAt: string;
};

const evidenceStore = new Map<string, EvidenceRecord>();
const uploadToEvidenceIds = new Map<string, string[]>();

function nowIso(): string {
  return new Date().toISOString();
}

export function indexEvidenceForUpload(intent: UploadIntent, routing: RoutingDecision[]): EvidenceRecord[] {
  const createdAt = nowIso();
  const perFile: EvidenceRecord[] = routing.map((row) => {
    const evidenceId = `merlin-evidence-${randomUUID()}`;
    const record: EvidenceRecord = {
      evidenceId,
      uploadId: intent.uploadId,
      brand: intent.brand,
      entityType: intent.entityType,
      entityId: intent.entityId,
      actionId: intent.actionId,
      sourceFileRefs: [{
        fileId: row.fileId,
        fileName: row.fileName,
        mimeType: row.mimeType,
        driveFolderId: row.driveFolderId,
        extractedText: row.extractedText,
        metadata: row.metadata
      }],
      extractedSnippets: row.extractedText
        ? [{ fileId: row.fileId, snippet: row.extractedText.slice(0, 280) }]
        : [],
      detectedSignals: [...new Set([...(row.reasons || []), row.holdReason || '', `routed_${row.routedType}`].filter(Boolean))],
      routingDomain: intent.brand.toLowerCase(),
      routingSubtype: row.routedType,
      confidence: row.confidence,
      status: row.routedType === 'held' ? 'held' : 'indexed',
      createdAt,
      updatedAt: createdAt
    };
    evidenceStore.set(evidenceId, record);
    return record;
  });

  uploadToEvidenceIds.set(intent.uploadId, perFile.map((row) => row.evidenceId));
  return perFile;
}

export function getEvidenceIdsForUpload(uploadId: string): string[] {
  return [...(uploadToEvidenceIds.get(uploadId) || [])];
}

export function listEvidenceByBrand(brand: MerlinBrand): EvidenceRecord[] {
  return [...evidenceStore.values()].filter((row) => row.brand === brand);
}

export function searchEvidenceByBrand(brand: MerlinBrand, q: string): EvidenceRecord[] {
  const query = q.trim().toLowerCase();
  const scope = listEvidenceByBrand(brand);
  if (!query) return scope;
  return scope.filter((row) => {
    if ((row.entityId || '').toLowerCase().includes(query)) return true;
    if ((row.actionId || '').toLowerCase().includes(query)) return true;
    if (row.detectedSignals.some((sig) => sig.toLowerCase().includes(query))) return true;
    if (row.sourceFileRefs.some((file) => (file.fileName || '').toLowerCase().includes(query))) return true;
    if (row.extractedSnippets.some((snippet) => snippet.snippet.toLowerCase().includes(query))) return true;
    return false;
  });
}

export function resetEvidenceIndexForTest(): void {
  evidenceStore.clear();
  uploadToEvidenceIds.clear();
}
