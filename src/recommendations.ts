import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { PolicyDecision, evaluatePolicy } from './policy.js';
import { resolveEntityIdentity } from './entityResolution.js';
import { recordReplayEvent } from './replay.js';

export type RecommendationStatus = 'suggested' | 'accepted' | 'dismissed' | 'completed' | 'failed' | 'expired';
export type RecommendationActionType =
  | 'view_context'
  | 'create_internal_note'
  | 'create_task'
  | 'draft_message'
  | 'suggest_follow_up'
  | 'update_internal_status'
  | 'send_external_message'
  | 'approve_verification'
  | 'change_payment_state'
  | 'delete_record';

type BrandLane = 'tradescout' | 'mealscout' | 'merlin' | 'lisa' | 'continuum' | 'marketfilter' | 'system';

export interface RecommendationRecord {
  id: string;
  entity_id: string;
  signal_id?: string;
  title: string;
  summary: string;
  action_type: RecommendationActionType;
  brand_lane: BrandLane;
  policy_result: PolicyDecision;
  source_refs: string[];
  status: RecommendationStatus;
  created_at: string;
  expires_at: string;
  outcome_id?: string;
}

export interface RecommendationInput {
  entity_id: string;
  signal_id?: string;
  title: string;
  summary: string;
  action_type: RecommendationActionType;
  brand_lane: BrandLane;
  source_refs?: string[];
  ttlMinutes?: number;
}

interface RecommendationRow {
  id: string;
  entity_id: string;
  signal_id: string | null;
  title: string;
  summary: string;
  action_type: RecommendationActionType;
  brand_lane: BrandLane;
  policy_result_json: string;
  source_refs_json: string;
  status: RecommendationStatus;
  created_at: string;
  expires_at: string;
  outcome_id: string | null;
  order_id: number;
}

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
let db: Database.Database | null = null;
let dbPath: string | null = null;
let recommendationSequence = 0;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) {
    initializeRecommendationsStore();
  }
  return db as Database.Database;
}

function toCanonicalEntityId(entityId: string): string {
  return resolveEntityIdentity({ entity_id: entityId }).canonical_entity_id;
}

function normalizeRefs(sourceRefs: string[] = []): string[] {
  return Array.from(new Set(sourceRefs.map((value) => value.trim()).filter(Boolean)));
}

function brandFromInput(value: string): BrandLane {
  const normalized = (value || 'system').toLowerCase();
  const supported: BrandLane[] = ['tradescout', 'mealscout', 'merlin', 'lisa', 'continuum', 'marketfilter', 'system'];
  return supported.includes(normalized as BrandLane) ? (normalized as BrandLane) : 'system';
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildExpiry(createdAt: string, ttlMinutes = 60 * 24): string {
  const parsed = new Date(createdAt).getTime();
  return new Date(parsed + ttlMinutes * 60_000).toISOString();
}

function isValidStatus(value: string): value is RecommendationStatus {
  return value === 'suggested' || value === 'accepted' || value === 'dismissed' || value === 'completed' || value === 'failed' || value === 'expired';
}

function parsePolicyResult(value: string): PolicyDecision {
  return JSON.parse(value) as PolicyDecision;
}

function mapRecommendationRow(row: RecommendationRow): RecommendationRecord {
  return {
    id: row.id,
    entity_id: row.entity_id,
    signal_id: row.signal_id ?? undefined,
    title: row.title,
    summary: row.summary,
    action_type: row.action_type,
    brand_lane: row.brand_lane,
    policy_result: parsePolicyResult(row.policy_result_json),
    source_refs: JSON.parse(row.source_refs_json) as string[],
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
    outcome_id: row.outcome_id ?? undefined
  };
}

function nextSequence(): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(order_id), 0) AS max_order_id FROM recommendations')
    .get() as { max_order_id: number };
  recommendationSequence = Math.max(recommendationSequence, row?.max_order_id ?? 0) + 1;
  return recommendationSequence;
}

function ensureCanonicalEntityId(id: string): string {
  const row = getDb().prepare('SELECT entity_id FROM recommendations WHERE id = ?').get(id) as { entity_id: string } | undefined;
  if (!row) {
    throw new Error(`Recommendation not found: ${id}`);
  }
  return row.entity_id;
}

export function initializeRecommendationsStore(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS recommendations (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      signal_id TEXT,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      action_type TEXT NOT NULL,
      brand_lane TEXT NOT NULL,
      policy_result_json TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      outcome_id TEXT,
      order_id INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS recommendations_entity_idx ON recommendations(entity_id, order_id DESC);
    CREATE INDEX IF NOT EXISTS recommendations_status_idx ON recommendations(status, order_id DESC);
    CREATE INDEX IF NOT EXISTS recommendations_created_idx ON recommendations(created_at DESC);
  `);

  db = nextDb;
  dbPath = nextPath;
  recommendationSequence = 0;
  return nextPath;
}

export function closeRecommendationsStore(): void {
  if (db) {
    db.close();
    db = null;
    dbPath = null;
    recommendationSequence = 0;
  }
}

export function resetRecommendationsForTest(): void {
  const dbInstance = getDb();
  dbInstance.prepare('DELETE FROM recommendations').run();
  recommendationSequence = 0;
}

export function createRecommendation(input: RecommendationInput): RecommendationRecord {
  const canonicalEntityId = toCanonicalEntityId(input.entity_id);
  const createdAt = nowIso();
  const brandLane = brandFromInput(input.brand_lane);
  const actionType = input.action_type;
  const policy = evaluatePolicy({
    action_type: actionType,
    brand_lane: brandLane
  });
  const sourceRefs = normalizeRefs(input.source_refs);
  const orderId = nextSequence();

  const record: RecommendationRecord = {
    id: `rec-${randomUUID()}`,
    entity_id: canonicalEntityId,
    signal_id: input.signal_id,
    title: input.title,
    summary: input.summary,
    action_type: actionType,
    brand_lane: brandLane,
    policy_result: policy,
    source_refs: sourceRefs,
    status: 'suggested',
    created_at: createdAt,
    expires_at: buildExpiry(createdAt, input.ttlMinutes),
    outcome_id: undefined
  };

  getDb()
    .prepare(
      `
      INSERT INTO recommendations (
        id, entity_id, signal_id, title, summary, action_type, brand_lane,
        policy_result_json, source_refs_json, status, created_at, expires_at,
        outcome_id, order_id
      ) VALUES (
        @id, @entity_id, @signal_id, @title, @summary, @action_type, @brand_lane,
        @policy_result_json, @source_refs_json, @status, @created_at, @expires_at,
        @outcome_id, @order_id
      )
      `
    )
    .run({
      id: record.id,
      entity_id: record.entity_id,
      signal_id: record.signal_id ?? null,
      title: record.title,
      summary: record.summary,
      action_type: record.action_type,
      brand_lane: record.brand_lane,
      policy_result_json: JSON.stringify(record.policy_result),
      source_refs_json: JSON.stringify(record.source_refs),
      status: record.status,
      created_at: record.created_at,
      expires_at: record.expires_at,
      outcome_id: null,
      order_id: orderId
    });

  recordReplayEvent({
    event_type: 'recommendation_created',
    entity_id: canonicalEntityId,
    signal_id: input.signal_id,
    recommendation_id: record.id,
    summary: `Recommendation ${record.id} created for entity ${canonicalEntityId}`,
    source_refs: record.source_refs,
    policy_level: record.policy_result.level,
    payload: {
      title: record.title,
      summary: record.summary,
      action_type: record.action_type
    }
  });
  recordReplayEvent({
    event_type: 'policy_evaluated',
    entity_id: canonicalEntityId,
    signal_id: input.signal_id,
    recommendation_id: record.id,
    policy_level: record.policy_result.level,
    summary: `Policy evaluated for ${record.action_type} (${record.policy_result.level})`,
    source_refs: record.source_refs,
    payload: {
      allowed: record.policy_result.allowed,
      level: record.policy_result.level,
      requires_approval: record.policy_result.requires_approval,
      blocked: record.policy_result.blocked,
      reason: record.policy_result.reason
    }
  });

  return record;
}

export function updateRecommendationStatus(id: string, status: RecommendationStatus): RecommendationRecord {
  if (!isValidStatus(status)) {
    throw new Error(`Invalid recommendation status: ${status}`);
  }

  const canonicalEntityId = ensureCanonicalEntityId(id);
  const dbInstance = getDb();
  const updated = dbInstance
    .prepare(
      `
      UPDATE recommendations
      SET status = ?
      WHERE id = ?
      `
    )
    .run(status, id);
  if (!updated.changes) {
    throw new Error(`Recommendation not found: ${id}`);
  }

  const recommendation = getRecommendationById(id);
  if (!recommendation) {
    throw new Error(`Recommendation not found: ${id}`);
  }

  recordReplayEvent({
    event_type: 'recommendation_status_updated',
    entity_id: canonicalEntityId,
    signal_id: recommendation.signal_id,
    recommendation_id: recommendation.id,
    summary: `Recommendation ${recommendation.id} status updated to ${status}`,
    source_refs: recommendation.source_refs,
    policy_level: recommendation.policy_result.level,
    payload: {
      status
    }
  });

  return recommendation;
}

export function linkOutcomeToRecommendation(recommendationId: string, outcomeId: string): RecommendationRecord {
  const canonicalEntityId = ensureCanonicalEntityId(recommendationId);
  const dbInstance = getDb();
  const updated = dbInstance
    .prepare(
      `
      UPDATE recommendations
      SET outcome_id = ?
      WHERE id = ?
      `
    )
    .run(outcomeId, recommendationId);
  if (!updated.changes) {
    throw new Error(`Recommendation not found: ${recommendationId}`);
  }

  const recommendation = getRecommendationById(recommendationId);
  if (!recommendation) {
    throw new Error(`Recommendation not found: ${recommendationId}`);
  }

  recordReplayEvent({
    event_type: 'outcome_linked',
    entity_id: canonicalEntityId,
    signal_id: recommendation.signal_id,
    recommendation_id: recommendation.id,
    outcome_id: outcomeId,
    summary: `Recommendation ${recommendation.id} linked to outcome ${outcomeId}`,
    source_refs: recommendation.source_refs,
    policy_level: recommendation.policy_result.level,
    payload: {
      outcome_id: outcomeId
    }
  });

  return recommendation;
}

export function getRecommendationById(id: string): RecommendationRecord | undefined {
  const row = getDb()
    .prepare('SELECT * FROM recommendations WHERE id = ?')
    .get(id) as RecommendationRow | undefined;
  return row ? mapRecommendationRow(row) : undefined;
}

export function getRecommendationsForEntity(entityId: string): RecommendationRecord[] {
  const canonicalEntityId = toCanonicalEntityId(entityId);
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM recommendations
      WHERE entity_id = ?
      ORDER BY created_at DESC, order_id DESC
      `
    )
    .all(canonicalEntityId) as RecommendationRow[];
  return rows.map(mapRecommendationRow);
}

export function getRecentRecommendations(limit = 20): RecommendationRecord[] {
  const maxItems = Math.max(1, Math.min(100, limit));
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM recommendations
      ORDER BY created_at DESC, order_id DESC
      LIMIT ?
      `
    )
    .all(maxItems) as RecommendationRow[];
  return rows.map(mapRecommendationRow);
}

initializeRecommendationsStore();
