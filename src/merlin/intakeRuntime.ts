import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { createMerlinActionCard, type MerlinActionCardRecord } from './actionCardRuntime.js';

export type MerlinIntakeStatus =
  | 'received'
  | 'classified'
  | 'needs_more_data'
  | 'action_cards_generated'
  | 'blocked'
  | 'resolved'
  | 'failed';

export type MerlinSourceType = 'drive' | 'gmail' | 'calendar' | 'github' | 'app' | 'manual' | 'web' | 'voice' | 'upload';

export type MerlinIntakeItemInput = {
  brand_lane: string;
  source_type: MerlinSourceType;
  source_reference: string;
  origin_surface?: string;
  entity_candidate?: Record<string, unknown>;
  intent_text?: string;
  raw_text?: string;
  extracted_fields?: Record<string, unknown>;
  confidence?: number;
  required_real_data?: string[];
};

export type MerlinIntakeItemRecord = {
  id: string;
  brand_lane: string;
  source_type: MerlinSourceType;
  source_reference: string;
  origin_surface: string;
  entity_candidate: Record<string, unknown>;
  intent_text: string;
  raw_text: string;
  extracted_fields: Record<string, unknown>;
  confidence: number;
  status: MerlinIntakeStatus;
  resolved_entity_id?: string;
  entity_resolution_confidence?: number;
  entity_resolution_status?: 'resolved' | 'new_entity' | 'needs_review' | 'conflict' | 'blocked';
  required_real_data: string[];
  created_at: string;
  updated_at: string;
};

export type MerlinIntakeHistoryRecord = {
  id: string;
  intake_item_id: string;
  event_type: 'created' | 'status_updated' | 'action_cards_generated' | 'blocked';
  status: MerlinIntakeStatus;
  payload: Record<string, unknown>;
  created_at: string;
};

type IntakeRow = {
  id: string;
  brand_lane: string;
  source_type: MerlinSourceType;
  source_reference: string;
  origin_surface: string;
  entity_candidate_json: string;
  intent_text: string;
  raw_text: string;
  extracted_fields_json: string;
  confidence: number;
  status: MerlinIntakeStatus;
  resolved_entity_id: string | null;
  entity_resolution_confidence: number | null;
  entity_resolution_status: string | null;
  required_real_data_json: string;
  created_at: string;
  updated_at: string;
};

type IntakeHistoryRow = {
  id: string;
  intake_item_id: string;
  event_type: 'created' | 'status_updated' | 'action_cards_generated' | 'blocked';
  status: MerlinIntakeStatus;
  payload_json: string;
  created_at: string;
};

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
const SUPPORTED_BRANDS = new Set(['mealscout', 'tradescout', 'homeid', 'merlin']);
const VALID_STATUSES: MerlinIntakeStatus[] = ['received', 'classified', 'needs_more_data', 'action_cards_generated', 'blocked', 'resolved', 'failed'];
let db: Database.Database | null = null;
let dbPath: string | null = null;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) initializeMerlinIntakeRuntime();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeList(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map((v) => String(v || '').trim()).filter(Boolean)));
}

function mapIntake(row: IntakeRow): MerlinIntakeItemRecord {
  return {
    id: row.id,
    brand_lane: row.brand_lane,
    source_type: row.source_type,
    source_reference: row.source_reference,
    origin_surface: row.origin_surface,
    entity_candidate: JSON.parse(row.entity_candidate_json) as Record<string, unknown>,
    intent_text: row.intent_text,
    raw_text: row.raw_text,
    extracted_fields: JSON.parse(row.extracted_fields_json) as Record<string, unknown>,
    confidence: row.confidence,
    status: row.status,
    resolved_entity_id: row.resolved_entity_id || undefined,
    entity_resolution_confidence: typeof row.entity_resolution_confidence === 'number' ? row.entity_resolution_confidence : undefined,
    entity_resolution_status: (row.entity_resolution_status as MerlinIntakeItemRecord['entity_resolution_status']) || undefined,
    required_real_data: JSON.parse(row.required_real_data_json) as string[],
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapHistory(row: IntakeHistoryRow): MerlinIntakeHistoryRecord {
  return {
    id: row.id,
    intake_item_id: row.intake_item_id,
    event_type: row.event_type,
    status: row.status,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    created_at: row.created_at
  };
}

function appendHistory(input: {
  intake_item_id: string;
  event_type: 'created' | 'status_updated' | 'action_cards_generated' | 'blocked';
  status: MerlinIntakeStatus;
  payload: Record<string, unknown>;
}): void {
  getDb()
    .prepare(
      `INSERT INTO merlin_intake_item_history
       (id, intake_item_id, event_type, status, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(`merlin-intake-history-${randomUUID()}`, input.intake_item_id, input.event_type, input.status, JSON.stringify(input.payload), nowIso());
}

export function initializeMerlinIntakeRuntime(explicitPath?: string): string {
  const nextPath = resolveDbPath(explicitPath);
  if (dbPath === nextPath && db) return nextPath;
  if (db) {
    db.close();
    db = null;
  }
  mkdirSync(dirname(nextPath), { recursive: true });
  const nextDb = new Database(nextPath);
  nextDb.pragma('journal_mode = WAL');
  nextDb.pragma('foreign_keys = ON');
  nextDb.exec(`
    CREATE TABLE IF NOT EXISTS merlin_intake_items (
      id TEXT PRIMARY KEY,
      brand_lane TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      origin_surface TEXT NOT NULL,
      entity_candidate_json TEXT NOT NULL,
      intent_text TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      extracted_fields_json TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      resolved_entity_id TEXT,
      entity_resolution_confidence REAL,
      entity_resolution_status TEXT,
      required_real_data_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_intake_items_brand_status_idx ON merlin_intake_items(brand_lane, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS merlin_intake_items_source_type_idx ON merlin_intake_items(source_type, created_at DESC);

    CREATE TABLE IF NOT EXISTS merlin_intake_item_history (
      id TEXT PRIMARY KEY,
      intake_item_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_intake_item_history_item_idx ON merlin_intake_item_history(intake_item_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS merlin_intake_action_card_links (
      id TEXT PRIMARY KEY,
      intake_item_id TEXT NOT NULL,
      action_card_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS merlin_intake_action_card_links_unique_idx ON merlin_intake_action_card_links(intake_item_id, action_card_id);
  `);
  const columns = nextDb.prepare(`PRAGMA table_info('merlin_intake_items')`).all() as Array<{ name: string }>;
  const hasColumn = (name: string) => columns.some((col) => col.name === name);
  if (!hasColumn('resolved_entity_id')) nextDb.exec('ALTER TABLE merlin_intake_items ADD COLUMN resolved_entity_id TEXT');
  if (!hasColumn('entity_resolution_confidence')) nextDb.exec('ALTER TABLE merlin_intake_items ADD COLUMN entity_resolution_confidence REAL');
  if (!hasColumn('entity_resolution_status')) nextDb.exec('ALTER TABLE merlin_intake_items ADD COLUMN entity_resolution_status TEXT');
  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function closeMerlinIntakeRuntime(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetMerlinIntakeRuntimeForTest(): void {
  const dbi = getDb();
  dbi.prepare('DELETE FROM merlin_intake_action_card_links').run();
  dbi.prepare('DELETE FROM merlin_intake_item_history').run();
  dbi.prepare('DELETE FROM merlin_intake_items').run();
}

export function createMerlinIntakeItem(input: MerlinIntakeItemInput): MerlinIntakeItemRecord {
  const now = nowIso();
  const record: MerlinIntakeItemRecord = {
    id: `merlin-intake-${randomUUID()}`,
    brand_lane: (input.brand_lane || '').trim().toLowerCase(),
    source_type: input.source_type,
    source_reference: (input.source_reference || '').trim(),
    origin_surface: (input.origin_surface || 'unknown').trim(),
    entity_candidate: input.entity_candidate && typeof input.entity_candidate === 'object' ? input.entity_candidate : {},
    intent_text: (input.intent_text || '').trim(),
    raw_text: (input.raw_text || '').trim(),
    extracted_fields: input.extracted_fields && typeof input.extracted_fields === 'object' ? input.extracted_fields : {},
    confidence: typeof input.confidence === 'number' && Number.isFinite(input.confidence) ? Math.max(0, Math.min(1, input.confidence)) : 0,
    status: 'received',
    resolved_entity_id: undefined,
    entity_resolution_confidence: undefined,
    entity_resolution_status: undefined,
    required_real_data: normalizeList(input.required_real_data),
    created_at: now,
    updated_at: now
  };
  getDb()
    .prepare(
      `INSERT INTO merlin_intake_items
      (id, brand_lane, source_type, source_reference, origin_surface, entity_candidate_json, intent_text, raw_text, extracted_fields_json, confidence, status, resolved_entity_id, entity_resolution_confidence, entity_resolution_status, required_real_data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.brand_lane,
      record.source_type,
      record.source_reference,
      record.origin_surface,
      JSON.stringify(record.entity_candidate),
      record.intent_text,
      record.raw_text,
      JSON.stringify(record.extracted_fields),
      record.confidence,
      record.status,
      null,
      null,
      null,
      JSON.stringify(record.required_real_data),
      record.created_at,
      record.updated_at
    );
  appendHistory({
    intake_item_id: record.id,
    event_type: 'created',
    status: record.status,
    payload: { source_reference: record.source_reference, source_type: record.source_type }
  });
  return record;
}

export function listMerlinIntakeItems(filters: {
  brand_lane?: string;
  status?: MerlinIntakeStatus;
  source_type?: MerlinSourceType;
  limit?: number;
} = {}): MerlinIntakeItemRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.brand_lane) {
    clauses.push('brand_lane = ?');
    params.push(filters.brand_lane.trim().toLowerCase());
  }
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.source_type) {
    clauses.push('source_type = ?');
    params.push(filters.source_type);
  }
  const limit = Math.max(1, Math.min(200, filters.limit || 50));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb().prepare(`SELECT * FROM merlin_intake_items ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as IntakeRow[];
  return rows.map(mapIntake);
}

export function getMerlinIntakeItemById(id: string): MerlinIntakeItemRecord | undefined {
  const row = getDb().prepare('SELECT * FROM merlin_intake_items WHERE id = ?').get(id) as IntakeRow | undefined;
  return row ? mapIntake(row) : undefined;
}

export function updateMerlinIntakeStatus(id: string, status: MerlinIntakeStatus, payload: Record<string, unknown> = {}): MerlinIntakeItemRecord | undefined {
  if (!VALID_STATUSES.includes(status)) return undefined;
  const existing = getMerlinIntakeItemById(id);
  if (!existing) return undefined;
  const updatedAt = nowIso();
  getDb().prepare('UPDATE merlin_intake_items SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, id);
  appendHistory({ intake_item_id: id, event_type: 'status_updated', status, payload });
  return getMerlinIntakeItemById(id);
}

export function updateMerlinIntakeEntityResolution(
  id: string,
  input: {
    resolved_entity_id?: string;
    entity_resolution_confidence?: number;
    entity_resolution_status?: 'resolved' | 'new_entity' | 'needs_review' | 'conflict' | 'blocked';
  }
): MerlinIntakeItemRecord | undefined {
  const existing = getMerlinIntakeItemById(id);
  if (!existing) return undefined;
  const updatedAt = nowIso();
  getDb()
    .prepare(
      'UPDATE merlin_intake_items SET resolved_entity_id = ?, entity_resolution_confidence = ?, entity_resolution_status = ?, updated_at = ? WHERE id = ?'
    )
    .run(
      input.resolved_entity_id || null,
      typeof input.entity_resolution_confidence === 'number' ? input.entity_resolution_confidence : null,
      input.entity_resolution_status || null,
      updatedAt,
      id
    );
  appendHistory({
    intake_item_id: id,
    event_type: 'status_updated',
    status: existing.status,
    payload: {
      entity_resolution: {
        resolved_entity_id: input.resolved_entity_id || null,
        entity_resolution_confidence: typeof input.entity_resolution_confidence === 'number' ? input.entity_resolution_confidence : null,
        entity_resolution_status: input.entity_resolution_status || null
      }
    }
  });
  return getMerlinIntakeItemById(id);
}

export function listMerlinIntakeHistory(id: string): MerlinIntakeHistoryRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM merlin_intake_item_history WHERE intake_item_id = ? ORDER BY created_at DESC')
    .all(id) as IntakeHistoryRow[];
  return rows.map(mapHistory);
}

export function listMerlinIntakeActionCardLinks(intakeItemId: string): Array<{ id: string; intake_item_id: string; action_card_id: string; created_at: string }> {
  return getDb()
    .prepare('SELECT id, intake_item_id, action_card_id, created_at FROM merlin_intake_action_card_links WHERE intake_item_id = ? ORDER BY created_at DESC')
    .all(intakeItemId) as Array<{ id: string; intake_item_id: string; action_card_id: string; created_at: string }>;
}

export function generateActionCardsFromMerlinIntakeItem(intakeItemId: string): { intakeItem: MerlinIntakeItemRecord; cards: MerlinActionCardRecord[] } {
  const intakeItem = getMerlinIntakeItemById(intakeItemId);
  if (!intakeItem) throw new Error('intake_item_not_found');
  if (intakeItem.entity_resolution_status === 'conflict') {
    updateMerlinIntakeStatus(intakeItemId, 'blocked', { reason: 'entity_conflict_blocked' });
    appendHistory({ intake_item_id: intakeItemId, event_type: 'blocked', status: 'blocked', payload: { reason: 'entity_conflict_blocked' } });
    throw new Error('entity_conflict_blocked');
  }
  if (!intakeItem.source_reference.trim()) {
    updateMerlinIntakeStatus(intakeItemId, 'blocked', { reason: 'missing_source_reference' });
    appendHistory({ intake_item_id: intakeItemId, event_type: 'blocked', status: 'blocked', payload: { reason: 'missing_source_reference' } });
    throw new Error('missing_source_reference');
  }
  if (!SUPPORTED_BRANDS.has(intakeItem.brand_lane)) {
    updateMerlinIntakeStatus(intakeItemId, 'blocked', { reason: 'unsupported_brand_lane', brand_lane: intakeItem.brand_lane });
    appendHistory({ intake_item_id: intakeItemId, event_type: 'blocked', status: 'blocked', payload: { reason: 'unsupported_brand_lane' } });
    throw new Error('unsupported_brand_lane');
  }

  const card = createMerlinActionCard({
    brand: intakeItem.brand_lane,
    kpi: 'intake_action_resolution',
    intent: intakeItem.intent_text || 'review intake evidence',
    source_of_truth: intakeItem.source_reference,
    required_real_data: intakeItem.required_real_data,
    tool: intakeItem.source_type,
    action: 'create_task',
    permission_level: 'level_1',
    fail_safes: ['requires_review', 'no_auto_execution'],
    output_location: `${intakeItem.brand_lane}.intake.review_queue`,
    source_refs: [intakeItem.source_reference],
    entity_id: typeof intakeItem.entity_candidate?.id === 'string' ? intakeItem.entity_candidate.id : undefined
  });

  getDb()
    .prepare(
      `INSERT OR IGNORE INTO merlin_intake_action_card_links
      (id, intake_item_id, action_card_id, created_at)
      VALUES (?, ?, ?, ?)`
    )
    .run(`merlin-intake-link-${randomUUID()}`, intakeItem.id, card.id, nowIso());

  const updated = updateMerlinIntakeStatus(intakeItem.id, 'action_cards_generated', {
    action_card_ids: [card.id],
    count: 1
  });
  appendHistory({
    intake_item_id: intakeItem.id,
    event_type: 'action_cards_generated',
    status: 'action_cards_generated',
    payload: { action_card_ids: [card.id] }
  });

  return { intakeItem: updated || intakeItem, cards: [card] };
}

export function searchMerlinIntakeItems(query: string, limit = 20): MerlinIntakeItemRecord[] {
  const q = (query || '').trim().toLowerCase();
  const max = Math.max(1, Math.min(100, limit));
  if (!q) return listMerlinIntakeItems({ limit: max });
  const rows = getDb()
    .prepare(
      `SELECT * FROM merlin_intake_items
       WHERE lower(brand_lane) LIKE ?
          OR lower(source_type) LIKE ?
          OR lower(source_reference) LIKE ?
          OR lower(origin_surface) LIKE ?
          OR lower(intent_text) LIKE ?
          OR lower(raw_text) LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, max) as IntakeRow[];
  return rows.map(mapIntake);
}

initializeMerlinIntakeRuntime();
