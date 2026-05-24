import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { resolveEntityIdentity } from './entityResolution.js';
import { recordReplayEvent } from './replay.js';

type OutcomeType =
  | 'customer_replied'
  | 'document_reviewed'
  | 'follow_up_sent'
  | 'job_booked'
  | 'quote_accepted'
  | 'quote_rejected'
  | 'no_response'
  | 'manual_done';

type OutcomeStatus = 'suggested' | 'accepted' | 'dismissed' | 'completed' | 'failed' | 'unknown';

interface OutcomeRecommendationRow {
  id: string;
  recommendation: string;
  action: string;
  entity_id: string;
  signal_id: string | null;
  status: OutcomeStatus;
  source_refs_json: string;
  observed_at: string;
  created_at: string;
}

interface OutcomeRow {
  id: string;
  recommendation_id: string | null;
  entity_id: string;
  signal_id: string | null;
  action: string;
  outcome: string;
  status: OutcomeStatus;
  result: string | null;
  source_refs_json: string;
  observed_at: string;
  created_at: string;
}

export interface OutcomeRecommendationInput {
  recommendation: string;
  action: string;
  entity_id: string;
  signal_id?: string;
  source_refs?: string[];
}

export interface OutcomeRecommendation {
  id: string;
  recommendation: string;
  action: string;
  entity_id: string;
  signal_id?: string;
  status: OutcomeStatus;
  source_refs: string[];
  observed_at: string;
  created_at: string;
}

export interface OutcomeInput {
  recommendation_id?: string;
  entity_id?: string;
  signal_id?: string;
  action: string;
  outcome: string;
  status: string;
  result?: string;
  source_refs?: string[];
  observed_at?: string;
}

export interface OutcomeRecord {
  id: string;
  recommendation_id?: string;
  entity_id: string;
  signal_id?: string;
  action: string;
  outcome: OutcomeType;
  status: OutcomeStatus;
  result?: string;
  source_refs: string[];
  observed_at: string;
  created_at: string;
}

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
const ALLOWED_OUTCOMES: Set<string> = new Set([
  'customer_replied',
  'document_reviewed',
  'follow_up_sent',
  'job_booked',
  'quote_accepted',
  'quote_rejected',
  'no_response',
  'manual_done'
]);
const ALLOWED_STATUS: Set<string> = new Set([
  'suggested',
  'accepted',
  'dismissed',
  'completed',
  'failed',
  'unknown'
]);

let db: Database.Database | null = null;
let dbPath: string | null = null;
let outcomeSequence = 0;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) {
    initializeOutcomesStore();
  }
  return db as Database.Database;
}

function resolveCanonicalEntityId(entityId: string): string {
  const resolved = resolveEntityIdentity({ entity_id: entityId });
  return resolved.canonical_entity_id;
}

function normalizeSourceRefs(sourceRefs: string[] = []): string[] {
  const entries = sourceRefs.filter((ref) => typeof ref === 'string').map((ref) => ref.trim()).filter(Boolean);
  return Array.from(new Set(entries));
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeOutcomeType(value: string): OutcomeType {
  const normalized = (value || '').trim().toLowerCase();
  if (ALLOWED_OUTCOMES.has(normalized)) {
    return normalized as OutcomeType;
  }
  return 'manual_done';
}

function normalizeStatus(value: string): OutcomeStatus {
  const normalized = (value || '').trim().toLowerCase();
  if (ALLOWED_STATUS.has(normalized)) {
    return normalized as OutcomeStatus;
  }
  return 'unknown';
}

function parseRecommendationRow(row: OutcomeRecommendationRow): OutcomeRecommendation {
  return {
    id: row.id,
    recommendation: row.recommendation,
    action: row.action,
    entity_id: row.entity_id,
    signal_id: row.signal_id ?? undefined,
    status: row.status,
    source_refs: JSON.parse(row.source_refs_json) as string[],
    observed_at: row.observed_at,
    created_at: row.created_at
  };
}

function parseOutcomeRow(row: OutcomeRow): OutcomeRecord {
  return {
    id: row.id,
    recommendation_id: row.recommendation_id || undefined,
    entity_id: row.entity_id,
    signal_id: row.signal_id || undefined,
    action: row.action,
    outcome: row.outcome as OutcomeType,
    status: row.status,
    result: row.result || undefined,
    source_refs: JSON.parse(row.source_refs_json) as string[],
    observed_at: row.observed_at,
    created_at: row.created_at
  };
}

function nextSequence(): number {
  const row = getDb().prepare('SELECT COALESCE(MAX(outcome_order), 0) AS max_order FROM outcome_records').get() as {
    max_order: number;
  };
  outcomeSequence = Math.max(outcomeSequence, row?.max_order ?? 0) + 1;
  return outcomeSequence;
}

function nextRecommendationSequence(): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(recommendation_order), 0) AS max_order FROM outcome_recommendations')
    .get() as { max_order: number };
  outcomeSequence = Math.max(outcomeSequence, row?.max_order ?? 0) + 1;
  return outcomeSequence;
}

function getRecommendationForOutcome(id: string): OutcomeRecommendation | undefined {
  const row = getDb().prepare('SELECT * FROM outcome_recommendations WHERE id = ?').get(id) as
    | OutcomeRecommendationRow
    | undefined;
  return row ? parseRecommendationRow(row) : undefined;
}

export function initializeOutcomesStore(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS outcome_recommendations (
      id TEXT PRIMARY KEY,
      recommendation TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      signal_id TEXT,
      status TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      recommendation_order INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS outcome_records (
      id TEXT PRIMARY KEY,
      recommendation_id TEXT,
      entity_id TEXT NOT NULL,
      signal_id TEXT,
      action TEXT NOT NULL,
      outcome TEXT NOT NULL,
      status TEXT NOT NULL,
      result TEXT,
      source_refs_json TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      outcome_order INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS outcome_recommendations_entity_idx ON outcome_recommendations(entity_id, recommendation_order DESC);
    CREATE INDEX IF NOT EXISTS outcome_records_entity_idx ON outcome_records(entity_id, outcome_order DESC);
    CREATE INDEX IF NOT EXISTS outcome_records_recommendation_idx ON outcome_records(recommendation_id);
  `);

  db = nextDb;
  dbPath = nextPath;
  outcomeSequence = 0;
  return nextPath;
}

export function closeOutcomesStore(): void {
  if (db) {
    db.close();
    db = null;
    dbPath = null;
    outcomeSequence = 0;
  }
}

export function resetOutcomesForTest(): void {
  const dbInstance = getDb();
  dbInstance.prepare('DELETE FROM outcome_records').run();
  dbInstance.prepare('DELETE FROM outcome_recommendations').run();
  outcomeSequence = 0;
}

export function createRecommendation(input: OutcomeRecommendationInput): OutcomeRecommendation {
  const canonicalEntityId = resolveCanonicalEntityId(input.entity_id);
  const now = nowIso();
  const id = `recommendation-${randomUUID()}`;
  const recommendation: OutcomeRecommendation = {
    id,
    recommendation: input.recommendation,
    action: input.action,
    entity_id: canonicalEntityId,
    signal_id: input.signal_id,
    status: 'suggested',
    source_refs: normalizeSourceRefs(input.source_refs),
    observed_at: now,
    created_at: now
  };

  getDb()
    .prepare(
      `
      INSERT INTO outcome_recommendations (
        id, recommendation, action, entity_id, signal_id, status,
        source_refs_json, observed_at, created_at, recommendation_order
      ) VALUES (
        @id, @recommendation, @action, @entity_id, @signal_id, @status,
        @source_refs_json, @observed_at, @created_at, @recommendation_order
      )
      `
    )
    .run({
      id: recommendation.id,
      recommendation: recommendation.recommendation,
      action: recommendation.action,
      entity_id: recommendation.entity_id,
      signal_id: recommendation.signal_id ?? null,
      status: recommendation.status,
      source_refs_json: JSON.stringify(recommendation.source_refs),
      observed_at: recommendation.observed_at,
      created_at: recommendation.created_at,
      recommendation_order: nextRecommendationSequence()
    });

  return recommendation;
}

export function recordOutcome(input: OutcomeInput): OutcomeRecord {
  const recommendation = input.recommendation_id ? getRecommendationForOutcome(input.recommendation_id) : undefined;
  const entityId = recommendation?.entity_id || (input.entity_id ? resolveCanonicalEntityId(input.entity_id) : '');

  if (!entityId) {
    throw new Error('outcomes require entity_id or recommendation_id');
  }

  const now = nowIso();
  const outcome: OutcomeRecord = {
    id: `outcome-${randomUUID()}`,
    recommendation_id: input.recommendation_id,
    entity_id: entityId,
    signal_id: input.signal_id || recommendation?.signal_id,
    action: input.action,
    outcome: normalizeOutcomeType(input.outcome),
    status: normalizeStatus(input.status),
    result: input.result,
    source_refs: [...normalizeSourceRefs(input.source_refs), ...(recommendation ? recommendation.source_refs : [])],
    observed_at: input.observed_at || now,
    created_at: now
  };

  getDb()
    .prepare(
      `
      INSERT INTO outcome_records (
        id, recommendation_id, entity_id, signal_id, action, outcome, status, result,
        source_refs_json, observed_at, created_at, outcome_order
      ) VALUES (
        @id, @recommendation_id, @entity_id, @signal_id, @action, @outcome, @status, @result,
        @source_refs_json, @observed_at, @created_at, @outcome_order
      )
      `
    )
    .run({
      id: outcome.id,
      recommendation_id: outcome.recommendation_id ?? null,
      entity_id: outcome.entity_id,
      signal_id: outcome.signal_id ?? null,
      action: outcome.action,
      outcome: outcome.outcome,
      status: outcome.status,
      result: outcome.result ?? null,
      source_refs_json: JSON.stringify(outcome.source_refs),
      observed_at: outcome.observed_at,
      created_at: outcome.created_at,
      outcome_order: nextSequence()
    });

  recordReplayEvent({
    event_type: 'outcome_recorded',
    entity_id: outcome.entity_id,
    signal_id: outcome.signal_id,
    recommendation_id: outcome.recommendation_id,
    outcome_id: outcome.id,
    summary: `Outcome ${outcome.id} recorded for entity ${entityId}`,
    source_refs: outcome.source_refs,
    payload: {
      action: outcome.action,
      outcome: outcome.outcome,
      status: outcome.status
    }
  });

  return outcome;
}

export function getOutcomesForEntity(entityId: string): OutcomeRecord[] {
  const canonicalEntityId = resolveCanonicalEntityId(entityId);
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM outcome_records
      WHERE entity_id = ?
      ORDER BY created_at DESC, outcome_order DESC
      `
    )
    .all(canonicalEntityId) as OutcomeRow[];
  return rows.map(parseOutcomeRow);
}

export function getOutcomeById(id: string): OutcomeRecord | undefined {
  const row = getDb().prepare('SELECT * FROM outcome_records WHERE id = ?').get(id) as OutcomeRow | undefined;
  return row ? parseOutcomeRow(row) : undefined;
}

export function getRecentOutcomes(limit = 20): OutcomeRecord[] {
  const maxItems = Math.max(1, Math.min(100, limit));
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM outcome_records
      ORDER BY observed_at DESC, outcome_order DESC
      LIMIT ?
      `
    )
    .all(maxItems) as OutcomeRow[];
  return rows.map(parseOutcomeRow);
}

initializeOutcomesStore();
