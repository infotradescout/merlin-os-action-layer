import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { evaluatePolicy, type PolicyDecision } from '../policy.js';

export type MerlinActionCardStatus =
  | 'suggested'
  | 'action_card_generated'
  | 'approved'
  | 'rejected'
  | 'deferred'
  | 'blocked'
  | 'failed'
  | 'completed';

export type MerlinPermissionLevel = 'level_0' | 'level_1' | 'level_2' | 'level_3' | 'level_4';

export type MerlinActionCardInput = {
  brand: string;
  kpi: string;
  intent: string;
  source_of_truth: string;
  required_real_data: string[];
  tool: string;
  action: string;
  permission_level: MerlinPermissionLevel;
  fail_safes: string[];
  output_location: string;
  source_refs?: string[];
  entity_id?: string;
};

export type MerlinActionCardRecord = MerlinActionCardInput & {
  id: string;
  status: MerlinActionCardStatus;
  policy_result: PolicyDecision;
  created_at: string;
  updated_at: string;
};

export type MerlinActionCardDecisionInput = {
  decision: 'approved' | 'rejected' | 'deferred' | 'blocked';
  reason?: string;
  decided_by?: string;
};

export type MerlinActionCardHistoryRecord = {
  id: string;
  action_card_id: string;
  event_type: 'created' | 'decision';
  status: MerlinActionCardStatus;
  payload: Record<string, unknown>;
  created_at: string;
};

type ActionCardRow = {
  id: string;
  brand: string;
  kpi: string;
  intent: string;
  source_of_truth: string;
  required_real_data_json: string;
  tool: string;
  action: string;
  permission_level: MerlinPermissionLevel;
  fail_safes_json: string;
  output_location: string;
  source_refs_json: string;
  entity_id: string | null;
  status: MerlinActionCardStatus;
  policy_result_json: string;
  created_at: string;
  updated_at: string;
};

type ActionCardHistoryRow = {
  id: string;
  action_card_id: string;
  event_type: 'created' | 'decision';
  status: MerlinActionCardStatus;
  payload_json: string;
  created_at: string;
};

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
let db: Database.Database | null = null;
let dbPath: string | null = null;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) initializeMerlinActionCardRuntime();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapActionCard(row: ActionCardRow): MerlinActionCardRecord {
  return {
    id: row.id,
    brand: row.brand,
    kpi: row.kpi,
    intent: row.intent,
    source_of_truth: row.source_of_truth,
    required_real_data: JSON.parse(row.required_real_data_json) as string[],
    tool: row.tool,
    action: row.action,
    permission_level: row.permission_level,
    fail_safes: JSON.parse(row.fail_safes_json) as string[],
    output_location: row.output_location,
    source_refs: JSON.parse(row.source_refs_json) as string[],
    entity_id: row.entity_id || undefined,
    status: row.status,
    policy_result: JSON.parse(row.policy_result_json) as PolicyDecision,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapHistory(row: ActionCardHistoryRow): MerlinActionCardHistoryRecord {
  return {
    id: row.id,
    action_card_id: row.action_card_id,
    event_type: row.event_type,
    status: row.status,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    created_at: row.created_at
  };
}

function normalizeList(input: string[] | undefined): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map((v) => String(v || '').trim()).filter(Boolean)));
}

function appendHistory(input: {
  action_card_id: string;
  event_type: 'created' | 'decision';
  status: MerlinActionCardStatus;
  payload: Record<string, unknown>;
}): void {
  const createdAt = nowIso();
  getDb()
    .prepare(
      `INSERT INTO merlin_action_card_history
       (id, action_card_id, event_type, status, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(`ms-hist-${randomUUID()}`, input.action_card_id, input.event_type, input.status, JSON.stringify(input.payload), createdAt);
}

export function initializeMerlinActionCardRuntime(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS merlin_action_cards (
      id TEXT PRIMARY KEY,
      brand TEXT NOT NULL,
      kpi TEXT NOT NULL,
      intent TEXT NOT NULL,
      source_of_truth TEXT NOT NULL,
      required_real_data_json TEXT NOT NULL,
      tool TEXT NOT NULL,
      action TEXT NOT NULL,
      permission_level TEXT NOT NULL,
      fail_safes_json TEXT NOT NULL,
      output_location TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      entity_id TEXT,
      status TEXT NOT NULL,
      policy_result_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_action_cards_brand_idx ON merlin_action_cards(brand, created_at DESC);
    CREATE INDEX IF NOT EXISTS merlin_action_cards_status_idx ON merlin_action_cards(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS merlin_action_card_history (
      id TEXT PRIMARY KEY,
      action_card_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_action_card_history_card_idx ON merlin_action_card_history(action_card_id, created_at DESC);
  `);
  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function closeMerlinActionCardRuntime(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetMerlinActionCardRuntimeForTest(): void {
  const dbi = getDb();
  dbi.prepare('DELETE FROM merlin_action_card_history').run();
  dbi.prepare('DELETE FROM merlin_action_cards').run();
}

export function createMerlinActionCard(input: MerlinActionCardInput): MerlinActionCardRecord {
  const createdAt = nowIso();
  const policy = evaluatePolicy({
    action_type: input.action,
    brand_lane: input.brand
  });
  const status: MerlinActionCardStatus = policy.allowed ? 'action_card_generated' : 'blocked';
  const record: MerlinActionCardRecord = {
    id: `ms-action-${randomUUID()}`,
    brand: input.brand,
    kpi: input.kpi,
    intent: input.intent,
    source_of_truth: input.source_of_truth,
    required_real_data: normalizeList(input.required_real_data),
    tool: input.tool,
    action: input.action,
    permission_level: input.permission_level,
    fail_safes: normalizeList(input.fail_safes),
    output_location: input.output_location,
    source_refs: normalizeList(input.source_refs),
    entity_id: input.entity_id,
    status,
    policy_result: policy,
    created_at: createdAt,
    updated_at: createdAt
  };
  getDb()
    .prepare(
      `INSERT INTO merlin_action_cards
      (id, brand, kpi, intent, source_of_truth, required_real_data_json, tool, action, permission_level, fail_safes_json, output_location, source_refs_json, entity_id, status, policy_result_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.brand,
      record.kpi,
      record.intent,
      record.source_of_truth,
      JSON.stringify(record.required_real_data),
      record.tool,
      record.action,
      record.permission_level,
      JSON.stringify(record.fail_safes),
      record.output_location,
      JSON.stringify(record.source_refs || []),
      record.entity_id || null,
      record.status,
      JSON.stringify(record.policy_result),
      record.created_at,
      record.updated_at
    );
  appendHistory({
    action_card_id: record.id,
    event_type: 'created',
    status: record.status,
    payload: {
      policy_level: record.policy_result.level,
      policy_allowed: record.policy_result.allowed,
      source_of_truth: record.source_of_truth
    }
  });
  return record;
}

export function getMerlinActionCardById(id: string): MerlinActionCardRecord | undefined {
  const row = getDb().prepare('SELECT * FROM merlin_action_cards WHERE id = ?').get(id) as ActionCardRow | undefined;
  return row ? mapActionCard(row) : undefined;
}

export function listMerlinActionCards(filters: { brand?: string; status?: string; limit?: number } = {}): MerlinActionCardRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.brand) {
    clauses.push('brand = ?');
    params.push(filters.brand);
  }
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  const limit = Math.max(1, Math.min(200, filters.limit || 50));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb()
    .prepare(`SELECT * FROM merlin_action_cards ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params) as ActionCardRow[];
  return rows.map(mapActionCard);
}

export function updateMerlinActionCardDecision(id: string, input: MerlinActionCardDecisionInput): MerlinActionCardRecord | undefined {
  const existing = getMerlinActionCardById(id);
  if (!existing) return undefined;
  const nextStatus = input.decision;
  const updatedAt = nowIso();
  getDb().prepare('UPDATE merlin_action_cards SET status = ?, updated_at = ? WHERE id = ?').run(nextStatus, updatedAt, id);
  appendHistory({
    action_card_id: id,
    event_type: 'decision',
    status: nextStatus,
    payload: {
      decision: input.decision,
      reason: input.reason || null,
      decided_by: input.decided_by || null
    }
  });
  return getMerlinActionCardById(id);
}

export function getMerlinActionCardHistory(id: string): MerlinActionCardHistoryRecord[] {
  const rows = getDb()
    .prepare('SELECT * FROM merlin_action_card_history WHERE action_card_id = ? ORDER BY created_at DESC')
    .all(id) as ActionCardHistoryRow[];
  return rows.map(mapHistory);
}

export function searchMerlinActionCards(query: string, limit = 20): MerlinActionCardRecord[] {
  const q = (query || '').trim().toLowerCase();
  const max = Math.max(1, Math.min(100, limit));
  if (!q) return listMerlinActionCards({ limit: max });
  const rows = getDb()
    .prepare(
      `SELECT * FROM merlin_action_cards
       WHERE lower(brand) LIKE ? OR lower(kpi) LIKE ? OR lower(intent) LIKE ? OR lower(source_of_truth) LIKE ? OR lower(action) LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, max) as ActionCardRow[];
  return rows.map(mapActionCard);
}

initializeMerlinActionCardRuntime();
