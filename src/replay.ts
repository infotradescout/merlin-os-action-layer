import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { resolveEntityIdentity } from './entityResolution.js';
import { randomUUID } from 'node:crypto';

type ReplayEventType =
  | 'event_ingested'
  | 'state_updated'
  | 'daily_generated'
  | 'recommendation_created'
  | 'policy_evaluated'
  | 'recommendation_status_updated'
  | 'outcome_recorded'
  | 'outcome_linked'
  | 'drive_import_received'
  | 'drive_import_processed'
  | 'drive_import_skipped'
  | 'drive_import_needs_review'
  | 'drive_import_failed';

type PolicyLevel = 'read_only' | 'organize_internal' | 'draft_only' | 'approval_required' | 'blocked_high_risk';

interface ReplayEvent {
  id: string;
  event_type: ReplayEventType;
  summary: string;
  source_refs: string[];
  created_at: string;
  payload?: unknown;
  entity_id?: string;
  signal_id?: string;
  recommendation_id?: string;
  outcome_id?: string;
  policy_level?: PolicyLevel;
}

interface ReplayEventRow {
  id: string;
  event_type: ReplayEventType;
  entity_id: string | null;
  signal_id: string | null;
  recommendation_id: string | null;
  outcome_id: string | null;
  policy_level: PolicyLevel | null;
  summary: string;
  source_refs_json: string;
  created_at: string;
  payload_json: string | null;
  order_id: number;
}

interface ReplayEventInput {
  event_type: ReplayEventType;
  entity_id?: string;
  signal_id?: string;
  recommendation_id?: string;
  outcome_id?: string;
  policy_level?: PolicyLevel;
  summary: string;
  source_refs?: string[];
  payload?: unknown;
  created_at?: string;
}

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
const MAX_SOURCE_REFS = 30;
let db: Database.Database | null = null;
let dbPath: string | null = null;
let replaySequence = 0;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) {
    initializeReplayStore();
  }
  return db as Database.Database;
}

function canonicalEntityId(entityId?: string): string | undefined {
  if (!entityId) return undefined;
  return resolveEntityIdentity({ entity_id: entityId }).canonical_entity_id;
}

function normalizeSummary(value = ''): string {
  return value.trim() || 'Replay event';
}

function normalizeRefs(sourceRefs: string[] = []): string[] {
  return Array.from(new Set(sourceRefs.map((value) => value.trim()).filter(Boolean))).slice(0, MAX_SOURCE_REFS);
}

function toCreatedAt(value?: string): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function parseReplayRow(row: ReplayEventRow): ReplayEvent {
  return {
    id: row.id,
    event_type: row.event_type,
    entity_id: row.entity_id ?? undefined,
    signal_id: row.signal_id ?? undefined,
    recommendation_id: row.recommendation_id ?? undefined,
    outcome_id: row.outcome_id ?? undefined,
    policy_level: row.policy_level ?? undefined,
    summary: row.summary,
    source_refs: JSON.parse(row.source_refs_json) as string[],
    payload: row.payload_json ? (JSON.parse(row.payload_json) as unknown) : undefined,
    created_at: row.created_at
  };
}

function nextSequence(): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(order_id), 0) AS max_order_id FROM replay_events')
    .get() as { max_order_id: number };
  replaySequence = Math.max(replaySequence, row?.max_order_id ?? 0) + 1;
  return replaySequence;
}

export function initializeReplayStore(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS replay_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      entity_id TEXT,
      signal_id TEXT,
      recommendation_id TEXT,
      outcome_id TEXT,
      policy_level TEXT,
      summary TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      payload_json TEXT,
      created_at TEXT NOT NULL,
      order_id INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS replay_events_entity_idx ON replay_events(entity_id, created_at DESC, order_id DESC);
    CREATE INDEX IF NOT EXISTS replay_events_recommendation_idx ON replay_events(recommendation_id, created_at DESC, order_id DESC);
    CREATE INDEX IF NOT EXISTS replay_events_outcome_idx ON replay_events(outcome_id, created_at DESC, order_id DESC);
  `);

  db = nextDb;
  dbPath = nextPath;
  replaySequence = 0;
  return nextPath;
}

export function closeReplayStore(): void {
  if (db) {
    db.close();
    db = null;
    dbPath = null;
    replaySequence = 0;
  }
}

export function resetReplayForTest(): void {
  const dbInstance = getDb();
  dbInstance.prepare('DELETE FROM replay_events').run();
  replaySequence = 0;
}

export function recordReplayEvent(input: ReplayEventInput): ReplayEvent {
  const createdAt = toCreatedAt(input.created_at);
  const canonical = canonicalEntityId(input.entity_id);
  const sequence = nextSequence();
  const event: ReplayEvent = {
    id: `replay-${randomUUID()}`,
    event_type: input.event_type,
    entity_id: canonical,
    signal_id: input.signal_id,
    recommendation_id: input.recommendation_id,
    outcome_id: input.outcome_id,
    policy_level: input.policy_level,
    summary: normalizeSummary(input.summary),
    source_refs: normalizeRefs(input.source_refs),
    payload: input.payload,
    created_at: createdAt
  };

  getDb()
    .prepare(
      `
      INSERT INTO replay_events (
        id, event_type, entity_id, signal_id, recommendation_id, outcome_id, policy_level,
        summary, source_refs_json, payload_json, created_at, order_id
      ) VALUES (
        @id, @event_type, @entity_id, @signal_id, @recommendation_id, @outcome_id, @policy_level,
        @summary, @source_refs_json, @payload_json, @created_at, @order_id
      )
      `
    )
    .run({
      id: event.id,
      event_type: event.event_type,
      entity_id: event.entity_id ?? null,
      signal_id: event.signal_id ?? null,
      recommendation_id: event.recommendation_id ?? null,
      outcome_id: event.outcome_id ?? null,
      policy_level: event.policy_level ?? null,
      summary: event.summary,
      source_refs_json: JSON.stringify(event.source_refs),
      payload_json: event.payload ? JSON.stringify(event.payload) : null,
      created_at: event.created_at,
      order_id: sequence
    });

  return event;
}

export function getReplayEventById(id: string): ReplayEvent | undefined {
  const row = getDb()
    .prepare('SELECT * FROM replay_events WHERE id = ?')
    .get(id) as ReplayEventRow | undefined;
  return row ? parseReplayRow(row) : undefined;
}

export function getReplayEventsForEntity(entityId: string): ReplayEvent[] {
  const resolvedEntityId = canonicalEntityId(entityId);
  if (!resolvedEntityId) return [];
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM replay_events
      WHERE entity_id = ?
      ORDER BY created_at DESC, order_id DESC
      `
    )
    .all(resolvedEntityId) as ReplayEventRow[];
  return rows.map(parseReplayRow);
}

export function getReplayEventsForRecommendation(recommendationId: string): ReplayEvent[] {
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM replay_events
      WHERE recommendation_id = ?
      ORDER BY created_at DESC, order_id DESC
      `
    )
    .all(recommendationId) as ReplayEventRow[];
  return rows.map(parseReplayRow);
}

export function getReplayEventsForOutcome(outcomeId: string): ReplayEvent[] {
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM replay_events
      WHERE outcome_id = ?
      ORDER BY created_at DESC, order_id DESC
      `
    )
    .all(outcomeId) as ReplayEventRow[];
  return rows.map(parseReplayRow);
}

export function getRecentReplayEvents(limit = 20): ReplayEvent[] {
  const maxItems = Math.max(1, Math.min(100, limit));
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM replay_events
      ORDER BY created_at DESC, order_id DESC
      LIMIT ?
      `
    )
    .all(maxItems) as ReplayEventRow[];
  return rows.map(parseReplayRow);
}

initializeReplayStore();
