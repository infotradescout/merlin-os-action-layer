import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { PolicyDecision } from './policy.js';
import {
  getRecommendationById,
  linkOutcomeToRecommendation,
  updateRecommendationStatus,
  type RecommendationStatus
} from './recommendations.js';
import { recordOutcome } from './outcomes.js';
import { recordReplayEvent } from './replay.js';
import { resolveEntityIdentity } from './entityResolution.js';

type RecommendationActionType =
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

type ApprovalStatus = 'pending' | 'approved' | 'dismissed' | 'completed' | 'failed' | 'expired';
type ApprovalPolicyLevel = PolicyDecision['level'];

type BrandLane = 'tradescout' | 'mealscout' | 'merlin' | 'lisa' | 'continuum' | 'marketfilter' | 'system';

interface ApprovalRow {
  id: string;
  recommendation_id: string;
  entity_id: string;
  title: string;
  summary: string;
  action_type: RecommendationActionType;
  brand_lane: BrandLane;
  policy_level: ApprovalPolicyLevel;
  status: ApprovalStatus;
  created_at: string;
  decided_at: string | null;
  outcome_id: string | null;
  source_refs_json: string;
  order_id: number;
}

interface ApprovalRecord {
  id: string;
  recommendation_id: string;
  entity_id: string;
  title: string;
  summary: string;
  action_type: RecommendationActionType;
  brand_lane: BrandLane;
  policy_level: ApprovalPolicyLevel;
  status: ApprovalStatus;
  created_at: string;
  decided_at?: string;
  outcome_id?: string;
  source_refs: string[];
}

interface CreateApprovalOptions {
  force?: boolean;
}

interface ApprovalStore {
  id: string;
  recommendation_id: string;
  entity_id: string;
  title: string;
  summary: string;
  action_type: RecommendationActionType;
  brand_lane: BrandLane;
  policy_level: ApprovalPolicyLevel;
  status: ApprovalStatus;
  created_at: string;
  decided_at: string | null;
  outcome_id: string | null;
  source_refs_json: string;
  order_id: number;
}

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
let db: Database.Database | null = null;
let dbPath: string | null = null;
let approvalSequence = 0;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) {
    initializeApprovalQueueStore();
  }
  return db as Database.Database;
}

function canonicalEntityId(entityId: string): string {
  return resolveEntityIdentity({ entity_id: entityId }).canonical_entity_id;
}

function isValidStatus(value: string): value is ApprovalStatus {
  return value === 'pending' || value === 'approved' || value === 'dismissed' || value === 'completed' || value === 'failed' || value === 'expired';
}

function mapApprovalStatus(status: ApprovalStatus): RecommendationStatus {
  if (status === 'approved') return 'accepted';
  if (status === 'dismissed') return 'dismissed';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'suggested';
}

function mapOutcomeStatus(status: ApprovalStatus): 'suggested' | 'accepted' | 'dismissed' | 'completed' | 'failed' | 'unknown' {
  if (status === 'approved') return 'accepted';
  if (status === 'dismissed') return 'dismissed';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'expired') return 'unknown';
  return 'suggested';
}

function normalizeSourceRefs(sourceRefs: string[] = []): string {
  return JSON.stringify(Array.from(new Set(sourceRefs.map((value) => value.trim()).filter(Boolean))));
}

function mapApprovalRow(row: ApprovalStore): ApprovalRecord {
  return {
    id: row.id,
    recommendation_id: row.recommendation_id,
    entity_id: row.entity_id,
    title: row.title,
    summary: row.summary,
    action_type: row.action_type,
    brand_lane: row.brand_lane,
    policy_level: row.policy_level,
    status: row.status,
    created_at: row.created_at,
    decided_at: row.decided_at || undefined,
    outcome_id: row.outcome_id || undefined,
    source_refs: JSON.parse(row.source_refs_json) as string[]
  };
}

function nextSequence(): number {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(order_id), 0) AS max_order_id FROM approvals')
    .get() as { max_order_id: number };
  approvalSequence = Math.max(approvalSequence, row?.max_order_id ?? 0) + 1;
  return approvalSequence;
}

function ensureApprovalExists(id: string): ApprovalStore {
  const row = getDb().prepare('SELECT * FROM approvals WHERE id = ?').get(id) as ApprovalStore | undefined;
  if (!row) {
    throw new Error(`Approval not found: ${id}`);
  }
  return row;
}

function needsApproval(recommendation: NonNullable<ReturnType<typeof getRecommendationById>>): boolean {
  return recommendation.policy_result.requires_approval === true || recommendation.policy_result.level === 'approval_required';
}

function recordApprovalReplay(approval: ApprovalRecord, summary: string, eventType: 'recommendation_status_updated' = 'recommendation_status_updated'): void {
  recordReplayEvent({
    event_type: eventType,
    entity_id: approval.entity_id,
    recommendation_id: approval.recommendation_id,
    outcome_id: approval.outcome_id,
    summary,
    source_refs: approval.source_refs,
    policy_level: approval.policy_level
  });
}

function recordOutcomeForApproval(approval: ApprovalRecord): void {
  if (!approval.recommendation_id || approval.status === 'pending') return;

  const outcome = recordOutcome({
    entity_id: approval.entity_id,
    recommendation_id: approval.recommendation_id,
    action: approval.action_type,
    outcome: 'manual_done',
    status: mapOutcomeStatus(approval.status),
    source_refs: approval.source_refs
  });

  getDb()
    .prepare('UPDATE approvals SET outcome_id = ? WHERE id = ?')
    .run(outcome.id, approval.id);
  approval.outcome_id = outcome.id;
  linkOutcomeToRecommendation(approval.recommendation_id, outcome.id);
}

export function initializeApprovalQueueStore(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      recommendation_id TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      action_type TEXT NOT NULL,
      brand_lane TEXT NOT NULL,
      policy_level TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      outcome_id TEXT,
      source_refs_json TEXT NOT NULL,
      order_id INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS approvals_entity_idx ON approvals(entity_id, order_id DESC);
    CREATE INDEX IF NOT EXISTS approvals_recommendation_idx ON approvals(recommendation_id, order_id DESC);
    CREATE INDEX IF NOT EXISTS approvals_status_idx ON approvals(status, order_id DESC);
  `);

  db = nextDb;
  dbPath = nextPath;
  approvalSequence = 0;
  return nextPath;
}

export function closeApprovalQueueStore(): void {
  if (db) {
    db.close();
    db = null;
    dbPath = null;
    approvalSequence = 0;
  }
}

export function resetApprovalQueueForTest(): void {
  const dbInstance = getDb();
  dbInstance.prepare('DELETE FROM approvals').run();
  approvalSequence = 0;
}

export function createApprovalFromRecommendation(
  recommendationId: string,
  options: CreateApprovalOptions = {}
): ApprovalRecord | undefined {
  const recommendation = getRecommendationById(recommendationId);
  if (!recommendation) {
    throw new Error(`Recommendation not found: ${recommendationId}`);
  }

  if (!needsApproval(recommendation) && !options.force) {
    return undefined;
  }

  const existing = getDb()
    .prepare('SELECT * FROM approvals WHERE recommendation_id = ? AND status = ?')
    .get(recommendation.id, 'pending') as ApprovalStore | undefined;
  if (existing) return mapApprovalRow(existing);

  const sequence = nextSequence();
  const createdAt = new Date().toISOString();
  const record: ApprovalRecord = {
    id: `approval-${randomUUID()}`,
    recommendation_id: recommendation.id,
    entity_id: recommendation.entity_id,
    title: recommendation.title,
    summary: recommendation.summary,
    action_type: recommendation.action_type,
    brand_lane: recommendation.brand_lane,
    policy_level: recommendation.policy_result.level,
    status: 'pending',
    created_at: createdAt,
    source_refs: recommendation.source_refs,
    outcome_id: recommendation.outcome_id
  };

  getDb()
    .prepare(
      `
      INSERT INTO approvals (
        id, recommendation_id, entity_id, title, summary, action_type, brand_lane,
        policy_level, status, created_at, decided_at, outcome_id, source_refs_json, order_id
      ) VALUES (
        @id, @recommendation_id, @entity_id, @title, @summary, @action_type, @brand_lane,
        @policy_level, @status, @created_at, @decided_at, @outcome_id, @source_refs_json, @order_id
      )
      `
    )
    .run({
      id: record.id,
      recommendation_id: record.recommendation_id,
      entity_id: canonicalEntityId(record.entity_id),
      title: record.title,
      summary: record.summary,
      action_type: record.action_type,
      brand_lane: record.brand_lane,
      policy_level: record.policy_level,
      status: record.status,
      created_at: record.created_at,
      decided_at: null,
      outcome_id: record.outcome_id ?? null,
      source_refs_json: normalizeSourceRefs(record.source_refs),
      order_id: sequence
    });

  recordApprovalReplay(record, `Approval ${record.id} created for recommendation ${recommendation.id}`);
  return record;
}

export function updateApprovalStatus(id: string, status: ApprovalStatus): ApprovalRecord {
  if (!isValidStatus(status)) {
    throw new Error(`Invalid approval status: ${status}`);
  }

  const now = new Date().toISOString();
  const existing = ensureApprovalExists(id);
  getDb()
    .prepare(
      `
      UPDATE approvals
      SET status = ?, decided_at = ?
      WHERE id = ?
      `
    )
    .run(status, now, id);

  const updated = getApprovalById(id);
  if (!updated) {
    throw new Error(`Approval not found: ${id}`);
  }

  if (status === 'approved' || status === 'dismissed' || status === 'completed' || status === 'failed') {
    const recommendation = getRecommendationById(updated.recommendation_id);
    if (recommendation) {
      updateRecommendationStatus(recommendation.id, mapApprovalStatus(status));
    }
    recordOutcomeForApproval(updated);
  }

  recordApprovalReplay(updated, `Approval ${updated.id} status updated to ${status}`);
  return updated;
}

export function getApprovalById(id: string): ApprovalRecord | undefined {
  const row = getDb()
    .prepare('SELECT * FROM approvals WHERE id = ?')
    .get(id) as ApprovalStore | undefined;
  return row ? mapApprovalRow(row) : undefined;
}

export function getPendingApprovals(): ApprovalRecord[] {
  return getRecentApprovals(20).filter((approval) => approval.status === 'pending');
}

export function getApprovalsForEntity(entityId: string): ApprovalRecord[] {
  const resolvedEntityId = canonicalEntityId(entityId);
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM approvals
      WHERE entity_id = ?
      ORDER BY created_at DESC, order_id DESC
      `
    )
    .all(resolvedEntityId) as ApprovalStore[];
  return rows.map(mapApprovalRow);
}

export function getRecentApprovals(limit = 20): ApprovalRecord[] {
  const maxItems = Math.max(1, Math.min(100, limit));
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM approvals
      ORDER BY created_at DESC, order_id DESC
      LIMIT ?
      `
    )
    .all(maxItems) as ApprovalStore[];
  return rows.map(mapApprovalRow);
}

initializeApprovalQueueStore();
