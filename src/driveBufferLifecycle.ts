import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

export type DriveBufferLifecycleState =
  | 'buffered'
  | 'attached_to_thread'
  | 'preview_ready'
  | 'accepted_for_apply'
  | 'cleanup_ready'
  | 'cleaned';

export type DriveBufferLifecycleRecord = {
  id: string;
  drive_file_id: string;
  lifecycle_state: DriveBufferLifecycleState;
  thread_id?: string;
  upload_intent_id?: string;
  accepted_by?: string;
  cleanup_mode?: 'mark_only' | 'trash';
  proof_reference?: string;
  note?: string;
  created_at: string;
  updated_at: string;
};

type LifecycleRow = {
  id: string;
  drive_file_id: string;
  lifecycle_state: DriveBufferLifecycleState;
  thread_id: string | null;
  upload_intent_id: string | null;
  accepted_by: string | null;
  cleanup_mode: string | null;
  proof_reference: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
let db: Database.Database | null = null;
let dbPath: string | null = null;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) initializeDriveBufferLifecycleStore();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: LifecycleRow): DriveBufferLifecycleRecord {
  return {
    id: row.id,
    drive_file_id: row.drive_file_id,
    lifecycle_state: row.lifecycle_state,
    thread_id: row.thread_id || undefined,
    upload_intent_id: row.upload_intent_id || undefined,
    accepted_by: row.accepted_by || undefined,
    cleanup_mode: (row.cleanup_mode as DriveBufferLifecycleRecord['cleanup_mode']) || undefined,
    proof_reference: row.proof_reference || undefined,
    note: row.note || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function initializeDriveBufferLifecycleStore(explicitPath?: string): string {
  const nextPath = resolveDbPath(explicitPath);
  if (dbPath === nextPath && db) return nextPath;
  if (db) {
    db.close();
    db = null;
  }
  mkdirSync(dirname(nextPath), { recursive: true });
  const nextDb = new Database(nextPath);
  nextDb.pragma('journal_mode = WAL');
  nextDb.exec(`
    CREATE TABLE IF NOT EXISTS drive_buffer_lifecycle (
      id TEXT PRIMARY KEY,
      drive_file_id TEXT NOT NULL,
      lifecycle_state TEXT NOT NULL,
      thread_id TEXT,
      upload_intent_id TEXT,
      accepted_by TEXT,
      cleanup_mode TEXT,
      proof_reference TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS drive_buffer_lifecycle_file_idx ON drive_buffer_lifecycle(drive_file_id);
    CREATE INDEX IF NOT EXISTS drive_buffer_lifecycle_state_idx ON drive_buffer_lifecycle(lifecycle_state, updated_at DESC);
  `);
  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function closeDriveBufferLifecycleStore(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetDriveBufferLifecycleStoreForTest(): void {
  getDb().prepare('DELETE FROM drive_buffer_lifecycle').run();
}

export function getDriveBufferLifecycleByFileId(driveFileId: string): DriveBufferLifecycleRecord | undefined {
  const row = getDb().prepare('SELECT * FROM drive_buffer_lifecycle WHERE drive_file_id = ?').get(driveFileId) as LifecycleRow | undefined;
  return row ? mapRow(row) : undefined;
}

export function listDriveBufferLifecycle(filters: { state?: DriveBufferLifecycleState; limit?: number } = {}): DriveBufferLifecycleRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.state) {
    clauses.push('lifecycle_state = ?');
    params.push(filters.state);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(500, filters.limit || 100));
  params.push(limit);
  const rows = getDb().prepare(`SELECT * FROM drive_buffer_lifecycle ${where} ORDER BY updated_at DESC LIMIT ?`).all(...params) as LifecycleRow[];
  return rows.map(mapRow);
}

function upsertLifecycle(input: {
  drive_file_id: string;
  lifecycle_state: DriveBufferLifecycleState;
  thread_id?: string;
  upload_intent_id?: string;
  accepted_by?: string;
  cleanup_mode?: 'mark_only' | 'trash';
  proof_reference?: string;
  note?: string;
}): DriveBufferLifecycleRecord {
  const existing = getDriveBufferLifecycleByFileId(input.drive_file_id);
  const now = nowIso();
  const record: DriveBufferLifecycleRecord = {
    id: existing?.id || `drive-buffer-lifecycle-${randomUUID()}`,
    drive_file_id: input.drive_file_id,
    lifecycle_state: input.lifecycle_state,
    thread_id: input.thread_id || existing?.thread_id,
    upload_intent_id: input.upload_intent_id || existing?.upload_intent_id,
    accepted_by: input.accepted_by || existing?.accepted_by,
    cleanup_mode: input.cleanup_mode || existing?.cleanup_mode,
    proof_reference: input.proof_reference || existing?.proof_reference,
    note: input.note || existing?.note,
    created_at: existing?.created_at || now,
    updated_at: now
  };
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO drive_buffer_lifecycle
      (id, drive_file_id, lifecycle_state, thread_id, upload_intent_id, accepted_by, cleanup_mode, proof_reference, note, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.drive_file_id,
      record.lifecycle_state,
      record.thread_id || null,
      record.upload_intent_id || null,
      record.accepted_by || null,
      record.cleanup_mode || null,
      record.proof_reference || null,
      record.note || null,
      record.created_at,
      record.updated_at
    );
  return record;
}

export function ensureDriveFileBuffered(driveFileId: string, note?: string): DriveBufferLifecycleRecord {
  return upsertLifecycle({ drive_file_id: driveFileId, lifecycle_state: 'buffered', note });
}

export function markDriveFileAttachedToThread(input: {
  drive_file_id: string;
  thread_id: string;
  note?: string;
}): DriveBufferLifecycleRecord {
  return upsertLifecycle({
    drive_file_id: input.drive_file_id,
    lifecycle_state: 'attached_to_thread',
    thread_id: input.thread_id,
    note: input.note
  });
}

export function markDriveFilePreviewReady(input: {
  drive_file_id: string;
  thread_id?: string;
  upload_intent_id?: string;
  note?: string;
}): DriveBufferLifecycleRecord {
  return upsertLifecycle({
    drive_file_id: input.drive_file_id,
    lifecycle_state: 'preview_ready',
    thread_id: input.thread_id,
    upload_intent_id: input.upload_intent_id,
    note: input.note
  });
}

export function markDriveFileAcceptedForApply(input: {
  drive_file_id: string;
  accepted_by: string;
  proof_reference?: string;
  upload_intent_id?: string;
  note?: string;
}): DriveBufferLifecycleRecord {
  return upsertLifecycle({
    drive_file_id: input.drive_file_id,
    lifecycle_state: 'accepted_for_apply',
    accepted_by: input.accepted_by,
    proof_reference: input.proof_reference,
    upload_intent_id: input.upload_intent_id,
    note: input.note
  });
}

export function markDriveFileCleanupReady(input: {
  drive_file_id: string;
  proof_reference: string;
  note?: string;
}): DriveBufferLifecycleRecord {
  return upsertLifecycle({
    drive_file_id: input.drive_file_id,
    lifecycle_state: 'cleanup_ready',
    proof_reference: input.proof_reference,
    note: input.note
  });
}

export function markDriveFileCleaned(input: {
  drive_file_id: string;
  cleanup_mode: 'mark_only' | 'trash';
  note?: string;
}): DriveBufferLifecycleRecord {
  return upsertLifecycle({
    drive_file_id: input.drive_file_id,
    lifecycle_state: 'cleaned',
    cleanup_mode: input.cleanup_mode,
    note: input.note
  });
}

initializeDriveBufferLifecycleStore();
