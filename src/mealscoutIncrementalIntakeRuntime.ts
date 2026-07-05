import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export type MealScoutIncrementalQueueStatus = 'active' | 'completed';

export type MealScoutIncrementalQueueRecord = {
  id: string;
  folder_id: string;
  folder_label?: string;
  status: MealScoutIncrementalQueueStatus;
  last_cursor_file_id?: string;
  processed_count: number;
  skipped_count: number;
  last_batch_id?: string;
  created_at: string;
  updated_at: string;
};

type QueueRow = {
  id: string;
  folder_id: string;
  folder_label: string | null;
  status: MealScoutIncrementalQueueStatus;
  last_cursor_file_id: string | null;
  processed_count: number;
  skipped_count: number;
  last_batch_id: string | null;
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
  if (!db) initializeMealScoutIncrementalIntakeRuntime();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapRow(row: QueueRow): MealScoutIncrementalQueueRecord {
  return {
    id: row.id,
    folder_id: row.folder_id,
    folder_label: row.folder_label || undefined,
    status: row.status,
    last_cursor_file_id: row.last_cursor_file_id || undefined,
    processed_count: row.processed_count,
    skipped_count: row.skipped_count,
    last_batch_id: row.last_batch_id || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function initializeMealScoutIncrementalIntakeRuntime(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS mealscout_incremental_intake_queues (
      id TEXT PRIMARY KEY,
      folder_id TEXT NOT NULL,
      folder_label TEXT,
      status TEXT NOT NULL,
      last_cursor_file_id TEXT,
      processed_count INTEGER NOT NULL,
      skipped_count INTEGER NOT NULL,
      last_batch_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS mealscout_incremental_intake_queues_folder_idx
      ON mealscout_incremental_intake_queues(folder_id, updated_at DESC);
  `);
  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function closeMealScoutIncrementalIntakeRuntime(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetMealScoutIncrementalIntakeRuntimeForTest(): void {
  getDb().prepare('DELETE FROM mealscout_incremental_intake_queues').run();
}

export function createMealScoutIncrementalQueue(input: {
  folder_id: string;
  folder_label?: string;
}): MealScoutIncrementalQueueRecord {
  const now = nowIso();
  const record: MealScoutIncrementalQueueRecord = {
    id: `ms-intake-queue-${randomUUID()}`,
    folder_id: input.folder_id,
    folder_label: input.folder_label,
    status: 'active',
    processed_count: 0,
    skipped_count: 0,
    created_at: now,
    updated_at: now
  };
  getDb()
    .prepare(
      `INSERT INTO mealscout_incremental_intake_queues
      (id, folder_id, folder_label, status, last_cursor_file_id, processed_count, skipped_count, last_batch_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.folder_id,
      record.folder_label || null,
      record.status,
      null,
      record.processed_count,
      record.skipped_count,
      null,
      record.created_at,
      record.updated_at
    );
  return record;
}

export function getMealScoutIncrementalQueueById(id: string): MealScoutIncrementalQueueRecord | undefined {
  const row = getDb().prepare('SELECT * FROM mealscout_incremental_intake_queues WHERE id = ?').get(id) as QueueRow | undefined;
  return row ? mapRow(row) : undefined;
}

export function listMealScoutIncrementalQueues(filters: { folder_id?: string; limit?: number } = {}): MealScoutIncrementalQueueRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.folder_id) {
    clauses.push('folder_id = ?');
    params.push(filters.folder_id);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.max(1, Math.min(200, filters.limit || 50));
  params.push(limit);
  const rows = getDb()
    .prepare(`SELECT * FROM mealscout_incremental_intake_queues ${where} ORDER BY updated_at DESC LIMIT ?`)
    .all(...params) as QueueRow[];
  return rows.map(mapRow);
}

export function updateMealScoutIncrementalQueue(
  id: string,
  updates: {
    status?: MealScoutIncrementalQueueStatus;
    last_cursor_file_id?: string;
    processed_delta?: number;
    skipped_delta?: number;
    last_batch_id?: string;
  }
): MealScoutIncrementalQueueRecord | undefined {
  const current = getMealScoutIncrementalQueueById(id);
  if (!current) return undefined;
  const next: MealScoutIncrementalQueueRecord = {
    ...current,
    status: updates.status || current.status,
    last_cursor_file_id:
      updates.last_cursor_file_id !== undefined ? updates.last_cursor_file_id : current.last_cursor_file_id,
    processed_count: current.processed_count + Math.max(0, updates.processed_delta || 0),
    skipped_count: current.skipped_count + Math.max(0, updates.skipped_delta || 0),
    last_batch_id: updates.last_batch_id !== undefined ? updates.last_batch_id : current.last_batch_id,
    updated_at: nowIso()
  };
  getDb()
    .prepare(
      `UPDATE mealscout_incremental_intake_queues
      SET status = ?, last_cursor_file_id = ?, processed_count = ?, skipped_count = ?, last_batch_id = ?, updated_at = ?
      WHERE id = ?`
    )
    .run(
      next.status,
      next.last_cursor_file_id || null,
      next.processed_count,
      next.skipped_count,
      next.last_batch_id || null,
      next.updated_at,
      next.id
    );
  return next;
}

initializeMealScoutIncrementalIntakeRuntime();
