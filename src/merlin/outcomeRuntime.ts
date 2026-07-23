import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { getMerlinActionCardById, updateMerlinActionCardStatus } from './actionCardRuntime.js';
import { findMerlinIntakeItemIdByActionCardId, getMerlinIntakeItemById } from './intakeRuntime.js';

export type MerlinOutcomeType =
  | 'manual_done'
  | 'blocked_resolved'
  | 'needs_more_data'
  | 'external_reply_received'
  | 'internal_task_completed'
  | 'connection_made'
  | 'booking_completed'
  | 'payment_confirmed'
  | 'verification_completed'
  | 'profile_updated'
  | 'no_response'
  | 'failed';

export type MerlinOutcomeStatus = 'recorded' | 'verified' | 'disputed' | 'failed' | 'dismissed';

export type MerlinOutcomeRecord = {
  id: string;
  action_card_id: string;
  intake_item_id?: string;
  entity_id?: string;
  brand_lane: string;
  kpi: string;
  outcome_type: MerlinOutcomeType;
  status: MerlinOutcomeStatus;
  result_summary: string;
  source_refs: string[];
  observed_at: string;
  created_at: string;
  updated_at: string;
};

type OutcomeRow = {
  id: string;
  action_card_id: string;
  intake_item_id: string | null;
  entity_id: string | null;
  brand_lane: string;
  kpi: string;
  outcome_type: MerlinOutcomeType;
  status: MerlinOutcomeStatus;
  result_summary: string;
  source_refs_json: string;
  observed_at: string;
  created_at: string;
  updated_at: string;
};

type OutcomeHistoryRow = {
  id: string;
  outcome_id: string;
  event_type: 'created' | 'status_updated';
  status: MerlinOutcomeStatus;
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
  if (!db) initializeMerlinOutcomeRuntime();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapOutcome(row: OutcomeRow): MerlinOutcomeRecord {
  return {
    id: row.id,
    action_card_id: row.action_card_id,
    intake_item_id: row.intake_item_id || undefined,
    entity_id: row.entity_id || undefined,
    brand_lane: row.brand_lane,
    kpi: row.kpi,
    outcome_type: row.outcome_type,
    status: row.status,
    result_summary: row.result_summary,
    source_refs: JSON.parse(row.source_refs_json) as string[],
    observed_at: row.observed_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function appendHistory(outcomeId: string, eventType: 'created' | 'status_updated', status: MerlinOutcomeStatus, payload: Record<string, unknown>): void {
  getDb()
    .prepare(
      `INSERT INTO merlin_outcome_history
      (id, outcome_id, event_type, status, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(`merlin-outcome-history-${randomUUID()}`, outcomeId, eventType, status, JSON.stringify(payload), nowIso());
}

export function initializeMerlinOutcomeRuntime(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS merlin_outcomes (
      id TEXT PRIMARY KEY,
      action_card_id TEXT NOT NULL,
      intake_item_id TEXT,
      entity_id TEXT,
      brand_lane TEXT NOT NULL,
      kpi TEXT NOT NULL,
      outcome_type TEXT NOT NULL,
      status TEXT NOT NULL,
      result_summary TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_outcomes_action_card_idx ON merlin_outcomes(action_card_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS merlin_outcomes_brand_kpi_idx ON merlin_outcomes(brand_lane, kpi, observed_at DESC);

    CREATE TABLE IF NOT EXISTS merlin_outcome_history (
      id TEXT PRIMARY KEY,
      outcome_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_outcome_history_idx ON merlin_outcome_history(outcome_id, created_at DESC);
  `);
  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function closeMerlinOutcomeRuntime(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetMerlinOutcomeRuntimeForTest(): void {
  const dbi = getDb();
  dbi.prepare('DELETE FROM merlin_outcome_history').run();
  dbi.prepare('DELETE FROM merlin_outcomes').run();
}

function normalizeRefs(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(new Set(input.map((v) => String(v || '').trim()).filter(Boolean)));
}

export function recordMerlinOutcome(input: {
  action_card_id: string;
  outcome_type: MerlinOutcomeType;
  status: MerlinOutcomeStatus;
  result_summary: string;
  source_refs?: string[];
  observed_at?: string;
  intake_item_id?: string;
  entity_id?: string;
}): MerlinOutcomeRecord {
  const actionCard = getMerlinActionCardById(input.action_card_id);
  if (!actionCard) throw new Error('action_card_not_found');
  const inferredIntakeItemId = input.intake_item_id || findMerlinIntakeItemIdByActionCardId(actionCard.id);
  const inferredIntake = inferredIntakeItemId ? getMerlinIntakeItemById(inferredIntakeItemId) : undefined;
  const now = nowIso();
  const outcome: MerlinOutcomeRecord = {
    id: `merlin-outcome-${randomUUID()}`,
    action_card_id: actionCard.id,
    intake_item_id: inferredIntakeItemId,
    entity_id: input.entity_id || actionCard.entity_id || inferredIntake?.resolved_entity_id,
    brand_lane: actionCard.brand,
    kpi: actionCard.kpi,
    outcome_type: input.outcome_type,
    status: input.status,
    result_summary: String(input.result_summary || '').trim(),
    source_refs: normalizeRefs(input.source_refs),
    observed_at: input.observed_at || now,
    created_at: now,
    updated_at: now
  };
  getDb()
    .prepare(
      `INSERT INTO merlin_outcomes
      (id, action_card_id, intake_item_id, entity_id, brand_lane, kpi, outcome_type, status, result_summary, source_refs_json, observed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      outcome.id,
      outcome.action_card_id,
      outcome.intake_item_id || null,
      outcome.entity_id || null,
      outcome.brand_lane,
      outcome.kpi,
      outcome.outcome_type,
      outcome.status,
      outcome.result_summary,
      JSON.stringify(outcome.source_refs),
      outcome.observed_at,
      outcome.created_at,
      outcome.updated_at
    );
  appendHistory(outcome.id, 'created', outcome.status, {
    action_card_id: outcome.action_card_id,
    outcome_type: outcome.outcome_type,
    result_summary: outcome.result_summary
  });

  if (outcome.outcome_type === 'failed') {
    updateMerlinActionCardStatus(actionCard.id, { status: 'failed', reason: `outcome:${outcome.id}:failed` });
  } else if (outcome.outcome_type === 'needs_more_data') {
    updateMerlinActionCardStatus(actionCard.id, { status: 'deferred', reason: `outcome:${outcome.id}:needs_more_data` });
  } else {
    updateMerlinActionCardStatus(actionCard.id, { status: 'completed', reason: `outcome:${outcome.id}:completed` });
  }

  return outcome;
}

export function getMerlinOutcomeById(id: string): MerlinOutcomeRecord | undefined {
  const row = getDb().prepare('SELECT * FROM merlin_outcomes WHERE id = ?').get(id) as OutcomeRow | undefined;
  return row ? mapOutcome(row) : undefined;
}

export function listMerlinOutcomes(filters: { brand_lane?: string; kpi?: string; from?: string; to?: string; limit?: number } = {}): MerlinOutcomeRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.brand_lane) {
    clauses.push('brand_lane = ?');
    params.push(filters.brand_lane.trim().toLowerCase());
  }
  if (filters.kpi) {
    clauses.push('kpi = ?');
    params.push(filters.kpi.trim());
  }
  if (filters.from) {
    clauses.push('observed_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push('observed_at <= ?');
    params.push(filters.to);
  }
  const limit = Math.max(1, Math.min(500, filters.limit || 100));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = getDb().prepare(`SELECT * FROM merlin_outcomes ${where} ORDER BY observed_at DESC LIMIT ?`).all(...params) as OutcomeRow[];
  return rows.map(mapOutcome);
}

export function updateMerlinOutcomeStatus(id: string, status: MerlinOutcomeStatus, payload: Record<string, unknown> = {}): MerlinOutcomeRecord | undefined {
  const existing = getMerlinOutcomeById(id);
  if (!existing) return undefined;
  getDb().prepare('UPDATE merlin_outcomes SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
  appendHistory(id, 'status_updated', status, payload);
  return getMerlinOutcomeById(id);
}

export function getMerlinOutcomeHistory(outcomeId: string): Array<{ id: string; outcome_id: string; event_type: string; status: MerlinOutcomeStatus; payload: Record<string, unknown>; created_at: string }> {
  const rows = getDb()
    .prepare('SELECT * FROM merlin_outcome_history WHERE outcome_id = ? ORDER BY created_at DESC')
    .all(outcomeId) as OutcomeHistoryRow[];
  return rows.map((row) => ({
    id: row.id,
    outcome_id: row.outcome_id,
    event_type: row.event_type,
    status: row.status,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    created_at: row.created_at
  }));
}

export function getMerlinKpiRollup(filters: { brand_lane?: string; kpi?: string; from?: string; to?: string } = {}): Array<{
  brand_lane: string;
  kpi: string;
  total_outcomes: number;
  verified_outcomes: number;
  failed_outcomes: number;
  blocked_resolved_count: number;
  completion_rate: number;
  failure_rate: number;
}> {
  const outcomes = listMerlinOutcomes({ ...filters, limit: 5000 });
  const byKey = new Map<string, { brand_lane: string; kpi: string; total: number; verified: number; failed: number; blockedResolved: number }>();
  for (const row of outcomes) {
    const key = `${row.brand_lane}::${row.kpi}`;
    if (!byKey.has(key)) byKey.set(key, { brand_lane: row.brand_lane, kpi: row.kpi, total: 0, verified: 0, failed: 0, blockedResolved: 0 });
    const agg = byKey.get(key)!;
    agg.total += 1;
    if (row.status === 'verified') agg.verified += 1;
    if (row.status === 'failed' || row.outcome_type === 'failed') agg.failed += 1;
    if (row.outcome_type === 'blocked_resolved') agg.blockedResolved += 1;
  }
  return Array.from(byKey.values()).map((agg) => ({
    brand_lane: agg.brand_lane,
    kpi: agg.kpi,
    total_outcomes: agg.total,
    verified_outcomes: agg.verified,
    failed_outcomes: agg.failed,
    blocked_resolved_count: agg.blockedResolved,
    completion_rate: agg.total > 0 ? Number(((agg.total - agg.failed) / agg.total).toFixed(4)) : 0,
    failure_rate: agg.total > 0 ? Number((agg.failed / agg.total).toFixed(4)) : 0
  }));
}

export function searchMerlinOutcomes(query: string, limit = 20): MerlinOutcomeRecord[] {
  const q = (query || '').trim().toLowerCase();
  const max = Math.max(1, Math.min(100, limit));
  if (!q) return listMerlinOutcomes({ limit: max });
  const rows = getDb()
    .prepare(
      `SELECT * FROM merlin_outcomes
       WHERE lower(brand_lane) LIKE ?
          OR lower(kpi) LIKE ?
          OR lower(outcome_type) LIKE ?
          OR lower(status) LIKE ?
          OR lower(result_summary) LIKE ?
       ORDER BY observed_at DESC LIMIT ?`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, max) as OutcomeRow[];
  return rows.map(mapOutcome);
}

initializeMerlinOutcomeRuntime();
