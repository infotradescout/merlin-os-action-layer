import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type DriveReviewQueueDecision =
  | 'acknowledged'
  | 'needs_manual_review'
  | 'defer'
  | 'false_positive'
  | 'resolved_externally';

export interface DriveReviewQueueDecisionRecord {
  id: string;
  itemId: string;
  decision: DriveReviewQueueDecision;
  note?: string;
  decidedAt: string;
  decidedBy?: string;
  source: 'drive_review_queue';
  mutationAllowed: false;
}

export interface DriveReviewQueueQueryOptions {
  requestId?: string;
  decidedBy?: string;
  decision?: DriveReviewQueueDecision;
  from?: string;
  to?: string;
  limit?: number;
}

interface DriveReviewQueueDecisionRow {
  id: string;
  item_id: string;
  decision: DriveReviewQueueDecision;
  note: string | null;
  decided_at: string;
  decided_by: string | null;
  source: 'drive_review_queue';
  mutation_allowed: number;
  order_id: number;
}

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
let db: Database.Database | null = null;
let dbPath: string | null = null;
let decisionSequence = 0;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) {
    initializeDriveReviewQueueStore();
  }
  return db as Database.Database;
}

function normalizeDecidedAt(value?: string): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function nextSequence(): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(order_id), 0) AS max_order_id FROM drive_review_queue_decisions')
    .get() as { max_order_id: number };
  decisionSequence = Math.max(decisionSequence, row?.max_order_id ?? 0) + 1;
  return decisionSequence;
}

function parseDecisionRow(row: DriveReviewQueueDecisionRow): DriveReviewQueueDecisionRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    decision: row.decision,
    note: row.note ?? undefined,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by ?? undefined,
    source: 'drive_review_queue',
    mutationAllowed: false
  };
}

export function initializeDriveReviewQueueStore(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS drive_review_queue_decisions (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      note TEXT,
      decided_at TEXT NOT NULL,
      decided_by TEXT,
      source TEXT NOT NULL,
      mutation_allowed INTEGER NOT NULL,
      order_id INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS drive_review_queue_decisions_item_idx
      ON drive_review_queue_decisions(item_id, decided_at DESC, order_id DESC);
    CREATE INDEX IF NOT EXISTS drive_review_queue_decisions_recent_idx
      ON drive_review_queue_decisions(decided_at DESC, order_id DESC);
  `);

  db = nextDb;
  dbPath = nextPath;
  decisionSequence = 0;
  return nextPath;
}

export function closeDriveReviewQueueStore(): void {
  if (db) {
    db.close();
    db = null;
    dbPath = null;
    decisionSequence = 0;
  }
}

export function resetDriveReviewQueueStoreForTest(): void {
  const dbInstance = getDb();
  dbInstance.prepare('DELETE FROM drive_review_queue_decisions').run();
  decisionSequence = 0;
}

export function recordDriveReviewQueueDecision(input: {
  itemId: string;
  decision: DriveReviewQueueDecision;
  note?: string;
  decidedBy?: string;
  decidedAt?: string;
}): DriveReviewQueueDecisionRecord {
  const record: DriveReviewQueueDecisionRecord = {
    id: `drvq-${randomUUID()}`,
    itemId: input.itemId,
    decision: input.decision,
    note: input.note,
    decidedAt: normalizeDecidedAt(input.decidedAt),
    decidedBy: input.decidedBy,
    source: 'drive_review_queue',
    mutationAllowed: false
  };

  getDb()
    .prepare(
      `
      INSERT INTO drive_review_queue_decisions (
        id, item_id, decision, note, decided_at, decided_by, source, mutation_allowed, order_id
      ) VALUES (
        @id, @item_id, @decision, @note, @decided_at, @decided_by, @source, @mutation_allowed, @order_id
      )
      `
    )
    .run({
      id: record.id,
      item_id: record.itemId,
      decision: record.decision,
      note: record.note ?? null,
      decided_at: record.decidedAt,
      decided_by: record.decidedBy ?? null,
      source: 'drive_review_queue',
      mutation_allowed: 0,
      order_id: nextSequence()
    });

  return record;
}

function buildHistoryWhereClause(
  itemId: string,
  options: DriveReviewQueueQueryOptions
): { clause: string; params: Array<string | number> } {
  const conditions: string[] = ['item_id = ?'];
  const params: Array<string | number> = [itemId];

  if (options.requestId) {
    conditions.push('id = ?');
    params.push(options.requestId);
  }
  if (options.decidedBy) {
    conditions.push('decided_by = ?');
    params.push(options.decidedBy);
  }
  if (options.decision) {
    conditions.push('decision = ?');
    params.push(options.decision);
  }
  if (options.from) {
    conditions.push('decided_at >= ?');
    params.push(options.from);
  }
  if (options.to) {
    conditions.push('decided_at <= ?');
    params.push(options.to);
  }

  return { clause: conditions.join(' AND '), params };
}

function buildAuditWhereClause(options: DriveReviewQueueQueryOptions): { clause: string; params: Array<string | number> } {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (options.requestId) {
    conditions.push('id = ?');
    params.push(options.requestId);
  }
  if (options.decidedBy) {
    conditions.push('decided_by = ?');
    params.push(options.decidedBy);
  }
  if (options.decision) {
    conditions.push('decision = ?');
    params.push(options.decision);
  }
  if (options.from) {
    conditions.push('decided_at >= ?');
    params.push(options.from);
  }
  if (options.to) {
    conditions.push('decided_at <= ?');
    params.push(options.to);
  }

  const clause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { clause, params };
}

export function getDriveReviewQueueDecisionHistory(
  itemId: string,
  options: DriveReviewQueueQueryOptions = {}
): DriveReviewQueueDecisionRecord[] {
  const maxItems = Math.max(1, Math.min(500, options.limit ?? 200));
  const where = buildHistoryWhereClause(itemId, options);
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM drive_review_queue_decisions
      WHERE ${where.clause}
      ORDER BY decided_at ASC, order_id ASC
      LIMIT ?
      `
    )
    .all(...where.params, maxItems) as DriveReviewQueueDecisionRow[];
  return rows.map(parseDecisionRow);
}

export function getDriveReviewQueueAudit(options: DriveReviewQueueQueryOptions = {}): DriveReviewQueueDecisionRecord[] {
  const maxItems = Math.max(1, Math.min(1000, options.limit ?? 200));
  const where = buildAuditWhereClause(options);
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM drive_review_queue_decisions
      ${where.clause}
      ORDER BY decided_at DESC, order_id DESC
      LIMIT ?
      `
    )
    .all(...where.params, maxItems) as DriveReviewQueueDecisionRow[];
  return rows.map(parseDecisionRow);
}

initializeDriveReviewQueueStore();
