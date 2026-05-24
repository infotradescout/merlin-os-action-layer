import { randomUUID } from 'node:crypto';
import type { DriveFileRecord } from './driveTypes.js';

export type DriveManifestStatus = 'seen' | 'pending' | 'processed' | 'skipped' | 'needs_review' | 'archived' | 'failed';

export interface DriveImportManifestEntry {
  id: string;
  drive_file_id: string;
  file_name: string;
  mime_type: string;
  folder_path: string;
  processing_status: DriveManifestStatus;
  entity_id?: string;
  source_record_id?: string;
  created_4data_event_id?: string;
  seen_at: string;
  processed_at?: string;
  review_reason?: string;
  notes?: string;
}

interface ManifestUpdate {
  source_record_id?: string;
  created_4data_event_id?: string;
  processed_at?: string;
  notes?: string;
}

const manifestStore = new Map<string, DriveImportManifestEntry>();
const manifestByDriveFileId = new Map<string, string>();
const manifestOrder = new Map<string, number>();
let manifestSequence = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function statusFromDriveProcessing(file: DriveFileRecord): DriveManifestStatus {
  switch (file.processing_status) {
    case 'processed':
      return 'processed';
    case 'needs_review':
      return 'needs_review';
    case 'archived':
      return 'archived';
    case 'pending':
 case 'inbox':
      return 'pending';
    case 'unknown':
      return 'seen';
    default:
      return 'seen';
  }
}

export function resetDriveManifestForTest(): void {
  manifestStore.clear();
  manifestByDriveFileId.clear();
  manifestOrder.clear();
  manifestSequence = 0;
}

export function createManifestEntry(fileRecord: DriveFileRecord): DriveImportManifestEntry {
  const id = `manifest-${randomUUID()}`;
  manifestSequence += 1;
  const entry: DriveImportManifestEntry = {
    id,
    drive_file_id: fileRecord.drive_file_id,
    file_name: fileRecord.file_name,
    mime_type: fileRecord.mime_type,
    folder_path: fileRecord.folder_path,
    processing_status: statusFromDriveProcessing(fileRecord),
    entity_id: fileRecord.entity_id,
    seen_at: fileRecord.observed_at || nowIso()
  };
  manifestStore.set(id, entry);
  manifestByDriveFileId.set(fileRecord.drive_file_id, id);
  manifestOrder.set(id, manifestSequence);
  return entry;
}

function getManifestOrThrow(id: string): DriveImportManifestEntry {
  const entry = manifestStore.get(id);
  if (!entry) {
    throw new Error(`Manifest entry not found: ${id}`);
  }
  return entry;
}

export function markManifestProcessed(id: string, updates: ManifestUpdate = {}): DriveImportManifestEntry {
  const entry = getManifestOrThrow(id);
  entry.processing_status = 'processed';
  entry.processed_at = updates.processed_at || nowIso();
  if (updates.source_record_id) {
    entry.source_record_id = updates.source_record_id;
  }
  if (updates.created_4data_event_id) {
    entry.created_4data_event_id = updates.created_4data_event_id;
  }
  if (updates.notes) {
    entry.notes = updates.notes;
  }
  return entry;
}

export function markManifestNeedsReview(id: string, reason: string): DriveImportManifestEntry {
  const entry = getManifestOrThrow(id);
  entry.processing_status = 'needs_review';
  entry.review_reason = reason;
  entry.processed_at = nowIso();
  return entry;
}

export function markManifestSkipped(id: string, reason: string): DriveImportManifestEntry {
  const entry = getManifestOrThrow(id);
  entry.processing_status = 'skipped';
  entry.review_reason = reason;
  entry.processed_at = nowIso();
  return entry;
}

export function markManifestFailed(id: string, reason: string): DriveImportManifestEntry {
  const entry = getManifestOrThrow(id);
  entry.processing_status = 'failed';
  entry.review_reason = reason;
  entry.processed_at = nowIso();
  return entry;
}

export function getManifestEntryByDriveFileId(driveFileId: string): DriveImportManifestEntry | undefined {
  const id = manifestByDriveFileId.get(driveFileId);
  if (!id) return undefined;
  return manifestStore.get(id);
}

export function getManifestEntriesByStatus(status: DriveManifestStatus): DriveImportManifestEntry[] {
  const entries = [...manifestStore.values()].filter((entry) => entry.processing_status === status);
  return entries.sort((left, right) => {
    const dateSort = Date.parse(right.seen_at) - Date.parse(left.seen_at);
    if (dateSort !== 0) return dateSort;
    return (manifestOrder.get(right.id) ?? 0) - (manifestOrder.get(left.id) ?? 0);
  });
}

export function getRecentManifestEntries(limit = 20): DriveImportManifestEntry[] {
  const maxItems = Math.max(1, Math.min(100, limit));
  return [...manifestStore.values()]
    .sort((left, right) => {
      const dateSort = Date.parse(right.seen_at) - Date.parse(left.seen_at);
      if (dateSort !== 0) return dateSort;
      return (manifestOrder.get(right.id) ?? 0) - (manifestOrder.get(left.id) ?? 0);
    })
    .slice(0, maxItems);
}
