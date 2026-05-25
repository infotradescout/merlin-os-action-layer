import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
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
  entity_type?: string;
  source_record_id?: string;
  created_4data_event_id?: string;
  seen_at: string;
  processed_at?: string;
  review_reason?: string;
  notes?: string;
  extracted_text?: string;
  extracted_fields?: Record<string, unknown>;
  extraction_status?: string;
  extraction_error?: string;
  extracted_at?: string;
}

interface ManifestUpdate {
  entity_id?: string;
  entity_type?: string;
  folder_path?: string;
  source_record_id?: string;
  created_4data_event_id?: string;
  processed_at?: string;
  notes?: string;
  extracted_text?: string;
  extracted_fields?: Record<string, unknown>;
  extraction_status?: string;
  extraction_error?: string;
  extracted_at?: string;
}

interface ManifestRow {
  id: string;
  drive_file_id: string;
  file_name: string;
  mime_type: string;
  folder_path: string;
  processing_status: DriveManifestStatus;
  entity_id: string | null;
  entity_type: string | null;
  source_record_id: string | null;
  created_4data_event_id: string | null;
  seen_at: string;
  processed_at: string | null;
  review_reason: string | null;
  notes: string | null;
  extracted_text: string | null;
  extracted_fields_json: string | null;
  extraction_status: string | null;
  extraction_error: string | null;
  extracted_at: string | null;
  order_id: number;
}

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
let db: Database.Database | null = null;
let dbPath: string | null = null;
let manifestSequence = 0;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) {
    initializeDriveManifestStore();
  }
  return db as Database.Database;
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

function nowIso(): string {
  return new Date().toISOString();
}

function mapManifestRow(row: ManifestRow): DriveImportManifestEntry {
  return {
    id: row.id,
    drive_file_id: row.drive_file_id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    folder_path: row.folder_path,
    processing_status: row.processing_status,
    entity_id: row.entity_id ?? undefined,
    entity_type: row.entity_type ?? undefined,
    source_record_id: row.source_record_id ?? undefined,
    created_4data_event_id: row.created_4data_event_id ?? undefined,
    seen_at: row.seen_at,
    processed_at: row.processed_at ?? undefined,
    review_reason: row.review_reason ?? undefined,
    notes: row.notes ?? undefined,
    extracted_text: row.extracted_text ?? undefined,
    extracted_fields: row.extracted_fields_json ? JSON.parse(row.extracted_fields_json) as Record<string, unknown> : undefined,
    extraction_status: row.extraction_status ?? undefined,
    extraction_error: row.extraction_error ?? undefined,
    extracted_at: row.extracted_at ?? undefined
  };
}

function nextSequence(): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(order_id), 0) AS max_order_id FROM drive_manifest_entries')
    .get() as { max_order_id: number };
  manifestSequence = Math.max(manifestSequence, row?.max_order_id ?? 0) + 1;
  return manifestSequence;
}

function getManifestOrThrow(id: string): ManifestRow {
  const row = getDb().prepare('SELECT * FROM drive_manifest_entries WHERE id = ?').get(id) as ManifestRow | undefined;
  if (!row) {
    throw new Error(`Manifest entry not found: ${id}`);
  }
  return row;
}

function updateStatus(id: string, status: DriveManifestStatus, reason?: string, additional?: Partial<ManifestUpdate>): DriveImportManifestEntry {
  const row = getManifestOrThrow(id);
  const stmt = getDb().prepare(`
    UPDATE drive_manifest_entries
    SET processing_status = @status,
        processed_at = @processed_at,
        review_reason = @review_reason,
        entity_id = COALESCE(@entity_id, entity_id),
        entity_type = COALESCE(@entity_type, entity_type),
        folder_path = COALESCE(@folder_path, folder_path),
        source_record_id = COALESCE(@source_record_id, source_record_id),
        created_4data_event_id = COALESCE(@created_4data_event_id, created_4data_event_id),
        notes = COALESCE(@notes, notes),
        extracted_text = COALESCE(@extracted_text, extracted_text),
        extracted_fields_json = COALESCE(@extracted_fields_json, extracted_fields_json),
        extraction_status = COALESCE(@extraction_status, extraction_status),
        extraction_error = COALESCE(@extraction_error, extraction_error),
        extracted_at = COALESCE(@extracted_at, extracted_at)
    WHERE id = @id
  `);
  stmt.run({
    status,
    processed_at: status === 'pending' || status === 'seen' ? null : row.processed_at ?? nowIso(),
    review_reason: reason ?? row.review_reason,
    entity_id: additional?.entity_id ?? null,
    entity_type: additional?.entity_type ?? null,
    folder_path: additional?.folder_path ?? null,
    source_record_id: additional?.source_record_id ?? null,
    created_4data_event_id: additional?.created_4data_event_id ?? null,
    notes: additional?.notes ?? null,
    extracted_text: additional?.extracted_text ?? null,
    extracted_fields_json: additional?.extracted_fields ? JSON.stringify(additional.extracted_fields) : null,
    extraction_status: additional?.extraction_status ?? null,
    extraction_error: additional?.extraction_error ?? null,
    extracted_at: additional?.extracted_at ?? null,
    id
  });
  return mapManifestRow(getManifestOrThrow(id));
}

export function initializeDriveManifestStore(explicitPath?: string): string {
  const nextPath = resolveDbPath(explicitPath);
  if (dbPath === nextPath && db) {
    return nextPath;
  }
  if (db) {
    db.close();
    db = null;
  }

  mkdirSync(dirname(nextPath), { recursive: true });
  const nextDb = new Database(nextPath);
  nextDb.pragma('journal_mode = WAL');
  nextDb.pragma('foreign_keys = ON');

  nextDb.exec(`
    CREATE TABLE IF NOT EXISTS drive_manifest_entries (
      id TEXT PRIMARY KEY,
      drive_file_id TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      processing_status TEXT NOT NULL,
      entity_id TEXT,
      entity_type TEXT,
      source_record_id TEXT,
      created_4data_event_id TEXT,
      seen_at TEXT NOT NULL,
      processed_at TEXT,
      review_reason TEXT,
      notes TEXT,
      extracted_text TEXT,
      extracted_fields_json TEXT,
      extraction_status TEXT,
      extraction_error TEXT,
      extracted_at TEXT,
      order_id INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS drive_manifest_drive_file_idx ON drive_manifest_entries(drive_file_id);
    CREATE INDEX IF NOT EXISTS drive_manifest_status_idx ON drive_manifest_entries(processing_status, seen_at DESC, order_id DESC);
  `);
  const ensureColumn = (name: string, sqlType: string): void => {
    try {
      nextDb.exec(`ALTER TABLE drive_manifest_entries ADD COLUMN ${name} ${sqlType};`);
    } catch {
      // Existing databases already include the column.
    }
  };
  ensureColumn('extracted_text', 'TEXT');
  ensureColumn('extracted_fields_json', 'TEXT');
  ensureColumn('extraction_status', 'TEXT');
  ensureColumn('extraction_error', 'TEXT');
  ensureColumn('extracted_at', 'TEXT');
  ensureColumn('entity_type', 'TEXT');

  db = nextDb;
  dbPath = nextPath;
  manifestSequence = 0;
  return nextPath;
}

export function closeDriveManifestStore(): void {
  if (db) {
    db.close();
    db = null;
    dbPath = null;
    manifestSequence = 0;
  }
}

export function resetDriveManifestForTest(): void {
  const dbInstance = getDb();
  dbInstance.prepare('DELETE FROM drive_manifest_entries').run();
  manifestSequence = 0;
}

export function createManifestEntry(fileRecord: DriveFileRecord): DriveImportManifestEntry {
  const sequence = nextSequence();
  const id = `manifest-${randomUUID()}`;
  const row: DriveImportManifestEntry = {
    id,
    drive_file_id: fileRecord.drive_file_id,
    file_name: fileRecord.file_name,
    mime_type: fileRecord.mime_type,
    folder_path: fileRecord.folder_path,
    processing_status: statusFromDriveProcessing(fileRecord),
    entity_id: fileRecord.entity_id,
    seen_at: fileRecord.observed_at || nowIso()
  };

  getDb()
    .prepare(
      `
      INSERT INTO drive_manifest_entries (
        id, drive_file_id, file_name, mime_type, folder_path, processing_status, entity_id,
        entity_type, source_record_id, created_4data_event_id, seen_at, processed_at, review_reason, notes, order_id
      ) VALUES (
        @id, @drive_file_id, @file_name, @mime_type, @folder_path, @processing_status, @entity_id,
        @entity_type, @source_record_id, @created_4data_event_id, @seen_at, @processed_at, @review_reason, @notes, @order_id
      )
      `
    )
    .run({
      id: row.id,
      drive_file_id: row.drive_file_id,
      file_name: row.file_name,
      mime_type: row.mime_type,
      folder_path: row.folder_path,
      processing_status: row.processing_status,
      entity_id: row.entity_id ?? null,
      entity_type: null,
      source_record_id: null,
      created_4data_event_id: null,
      seen_at: row.seen_at,
      processed_at: null,
      review_reason: null,
      notes: row.notes ?? null,
      order_id: sequence
    });

  return row;
}

export function markManifestProcessed(id: string, updates: ManifestUpdate = {}): DriveImportManifestEntry {
  const row = getManifestOrThrow(id);
  if (!row) {
    throw new Error(`Manifest entry not found: ${id}`);
  }
  return updateStatus(id, 'processed', row.review_reason ?? undefined, {
    entity_id: updates.entity_id,
    entity_type: updates.entity_type,
    source_record_id: updates.source_record_id,
    created_4data_event_id: updates.created_4data_event_id,
    processed_at: updates.processed_at,
    notes: updates.notes
  });
}

export function updateManifestExtraction(id: string, updates: ManifestUpdate): DriveImportManifestEntry {
  return updateStatus(id, getManifestOrThrow(id).processing_status, getManifestOrThrow(id).review_reason ?? undefined, {
    extracted_text: updates.extracted_text,
    extracted_fields: updates.extracted_fields,
    extraction_status: updates.extraction_status,
    extraction_error: updates.extraction_error,
    extracted_at: updates.extracted_at
  });
}

export function markManifestNeedsReview(id: string, reason: string): DriveImportManifestEntry {
  return updateStatus(id, 'needs_review', reason);
}

export function markManifestSkipped(id: string, reason: string): DriveImportManifestEntry {
  return updateStatus(id, 'skipped', reason);
}

export function markManifestFailed(id: string, reason: string): DriveImportManifestEntry {
  return updateStatus(id, 'failed', reason);
}

export function attachManifestToEntity(
  id: string,
  input: { entity_id: string; entity_type?: string; note?: string }
): DriveImportManifestEntry {
  const row = getManifestOrThrow(id);
  const mergedNotes = [row.notes, input.note].filter(Boolean).join(' | ');
  return updateStatus(
    id,
    'processed',
    row.review_reason ?? undefined,
    {
      entity_id: input.entity_id,
      entity_type: input.entity_type,
      notes: mergedNotes || undefined
    }
  );
}

export function routeManifestEntry(
  id: string,
  input: {
    target: 'processed' | 'entity_files' | 'archive';
    folder_path: string;
    entity_id?: string;
    note?: string;
  }
): DriveImportManifestEntry {
  const row = getManifestOrThrow(id);
  const mergedNotes = [row.notes, input.note].filter(Boolean).join(' | ');
  const status: DriveManifestStatus = input.target === 'archive' ? 'archived' : 'processed';
  return updateStatus(id, status, row.review_reason ?? undefined, {
    folder_path: input.folder_path,
    entity_id: input.entity_id,
    notes: mergedNotes || undefined
  });
}

export function getManifestEntryByDriveFileId(driveFileId: string): DriveImportManifestEntry | undefined {
  const row = getDb()
    .prepare('SELECT * FROM drive_manifest_entries WHERE drive_file_id = ? ORDER BY order_id DESC LIMIT 1')
    .get(driveFileId) as ManifestRow | undefined;
  return row ? mapManifestRow(row) : undefined;
}

export function getManifestEntriesByStatus(status: DriveManifestStatus): DriveImportManifestEntry[] {
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM drive_manifest_entries
      WHERE processing_status = ?
      ORDER BY seen_at DESC, order_id DESC
      `
    )
    .all(status) as ManifestRow[];
  return rows.map(mapManifestRow);
}

export function getRecentManifestEntries(limit = 20): DriveImportManifestEntry[] {
  const maxItems = Math.max(1, Math.min(100, limit));
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM drive_manifest_entries
      ORDER BY seen_at DESC, order_id DESC
      LIMIT ?
      `
    )
    .all(maxItems) as ManifestRow[];
  return rows.map(mapManifestRow);
}

initializeDriveManifestStore();
