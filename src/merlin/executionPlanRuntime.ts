import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { getMerlinActionCardById } from './actionCardRuntime.js';
import { getMerlinActionCardApprovalState } from './approvalRuntime.js';

export type MerlinExecutionStatus = 'draft' | 'eligible' | 'blocked' | 'expired' | 'cancelled' | 'executed_dry_run' | 'failed';
export type MerlinExecutionMode = 'dry_run';

export type MerlinExecutionPlanRecord = {
  id: string;
  action_card_id: string;
  approval_id?: string;
  brand_lane: string;
  entity_id?: string;
  kpi: string;
  tool: string;
  action: string;
  execution_status: MerlinExecutionStatus;
  execution_mode: MerlinExecutionMode;
  eligibility_reason: string;
  payload: Record<string, unknown>;
  source_refs: string[];
  created_at: string;
  updated_at: string;
};

type ExecutionPlanRow = {
  id: string;
  action_card_id: string;
  approval_id: string | null;
  brand_lane: string;
  entity_id: string | null;
  kpi: string;
  tool: string;
  action: string;
  execution_status: MerlinExecutionStatus;
  execution_mode: MerlinExecutionMode;
  eligibility_reason: string;
  payload_json: string;
  source_refs_json: string;
  created_at: string;
  updated_at: string;
};

type ExecutionPlanHistoryRow = {
  id: string;
  execution_plan_id: string;
  event_type: 'created' | 'status_updated';
  execution_status: MerlinExecutionStatus;
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
  if (!db) initializeMerlinExecutionPlanRuntime();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapPlan(row: ExecutionPlanRow): MerlinExecutionPlanRecord {
  return {
    id: row.id,
    action_card_id: row.action_card_id,
    approval_id: row.approval_id || undefined,
    brand_lane: row.brand_lane,
    entity_id: row.entity_id || undefined,
    kpi: row.kpi,
    tool: row.tool,
    action: row.action,
    execution_status: row.execution_status,
    execution_mode: row.execution_mode,
    eligibility_reason: row.eligibility_reason,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    source_refs: JSON.parse(row.source_refs_json) as string[],
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function appendHistory(planId: string, eventType: 'created' | 'status_updated', status: MerlinExecutionStatus, payload: Record<string, unknown>): void {
  getDb()
    .prepare(
      `INSERT INTO merlin_execution_plan_history
      (id, execution_plan_id, event_type, execution_status, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(`merlin-execution-plan-history-${randomUUID()}`, planId, eventType, status, JSON.stringify(payload), nowIso());
}

export function initializeMerlinExecutionPlanRuntime(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS merlin_execution_plans (
      id TEXT PRIMARY KEY,
      action_card_id TEXT NOT NULL,
      approval_id TEXT,
      brand_lane TEXT NOT NULL,
      entity_id TEXT,
      kpi TEXT NOT NULL,
      tool TEXT NOT NULL,
      action TEXT NOT NULL,
      execution_status TEXT NOT NULL,
      execution_mode TEXT NOT NULL,
      eligibility_reason TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_execution_plans_card_idx ON merlin_execution_plans(action_card_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS merlin_execution_plans_brand_status_idx ON merlin_execution_plans(brand_lane, execution_status, created_at DESC);

    CREATE TABLE IF NOT EXISTS merlin_execution_plan_history (
      id TEXT PRIMARY KEY,
      execution_plan_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      execution_status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_execution_plan_history_idx ON merlin_execution_plan_history(execution_plan_id, created_at DESC);
  `);
  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function closeMerlinExecutionPlanRuntime(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetMerlinExecutionPlanRuntimeForTest(): void {
  const dbi = getDb();
  dbi.prepare('DELETE FROM merlin_execution_plan_history').run();
  dbi.prepare('DELETE FROM merlin_execution_plans').run();
}

export function createMerlinExecutionPlan(input: { action_card_id: string }): MerlinExecutionPlanRecord {
  const card = getMerlinActionCardById(input.action_card_id);
  if (!card) throw new Error('action_card_not_found');
  const approvalState = getMerlinActionCardApprovalState(card.id);
  const executionStatus: MerlinExecutionStatus =
    approvalState.approvalStatus === 'expired' ? 'expired' : approvalState.executionEligible ? 'eligible' : 'blocked';
  const now = nowIso();
  const payload = {
    dryRun: true,
    tool: card.tool,
    action: card.action,
    intent: card.intent,
    source_of_truth: card.source_of_truth,
    output_location: card.output_location,
    required_real_data: card.required_real_data,
    fail_safes: card.fail_safes
  };
  const plan: MerlinExecutionPlanRecord = {
    id: `merlin-execution-plan-${randomUUID()}`,
    action_card_id: card.id,
    approval_id: approvalState.approval?.id,
    brand_lane: card.brand,
    entity_id: card.entity_id,
    kpi: card.kpi,
    tool: card.tool,
    action: card.action,
    execution_status: executionStatus,
    execution_mode: 'dry_run',
    eligibility_reason: approvalState.reason,
    payload,
    source_refs: card.source_refs || [],
    created_at: now,
    updated_at: now
  };
  getDb()
    .prepare(
      `INSERT INTO merlin_execution_plans
      (id, action_card_id, approval_id, brand_lane, entity_id, kpi, tool, action, execution_status, execution_mode, eligibility_reason, payload_json, source_refs_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      plan.id,
      plan.action_card_id,
      plan.approval_id || null,
      plan.brand_lane,
      plan.entity_id || null,
      plan.kpi,
      plan.tool,
      plan.action,
      plan.execution_status,
      plan.execution_mode,
      plan.eligibility_reason,
      JSON.stringify(plan.payload),
      JSON.stringify(plan.source_refs),
      plan.created_at,
      plan.updated_at
    );
  appendHistory(plan.id, 'created', plan.execution_status, {
    action_card_id: card.id,
    approval_id: plan.approval_id || null,
    eligibility_reason: plan.eligibility_reason
  });
  return plan;
}

export function getMerlinExecutionPlanById(id: string): MerlinExecutionPlanRecord | undefined {
  const row = getDb().prepare('SELECT * FROM merlin_execution_plans WHERE id = ?').get(id) as ExecutionPlanRow | undefined;
  return row ? mapPlan(row) : undefined;
}

export function listMerlinExecutionPlans(filters: { brand_lane?: string; status?: MerlinExecutionStatus; entity_id?: string; limit?: number } = {}): MerlinExecutionPlanRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.brand_lane) {
    clauses.push('brand_lane = ?');
    params.push(filters.brand_lane.trim().toLowerCase());
  }
  if (filters.status) {
    clauses.push('execution_status = ?');
    params.push(filters.status);
  }
  if (filters.entity_id) {
    clauses.push('entity_id = ?');
    params.push(filters.entity_id);
  }
  const limit = Math.max(1, Math.min(500, filters.limit || 100));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (getDb().prepare(`SELECT * FROM merlin_execution_plans ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as ExecutionPlanRow[]).map(mapPlan);
}

export function updateMerlinExecutionPlanStatus(
  id: string,
  status: MerlinExecutionStatus,
  payload: Record<string, unknown> = {}
): MerlinExecutionPlanRecord | undefined {
  const existing = getMerlinExecutionPlanById(id);
  if (!existing) return undefined;
  getDb().prepare('UPDATE merlin_execution_plans SET execution_status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
  appendHistory(id, 'status_updated', status, payload);
  return getMerlinExecutionPlanById(id);
}

export function getMerlinExecutionPlanHistory(planId: string): Array<{
  id: string;
  execution_plan_id: string;
  event_type: string;
  execution_status: MerlinExecutionStatus;
  payload: Record<string, unknown>;
  created_at: string;
}> {
  const rows = getDb()
    .prepare('SELECT * FROM merlin_execution_plan_history WHERE execution_plan_id = ? ORDER BY created_at DESC')
    .all(planId) as ExecutionPlanHistoryRow[];
  return rows.map((row) => ({
    id: row.id,
    execution_plan_id: row.execution_plan_id,
    event_type: row.event_type,
    execution_status: row.execution_status,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    created_at: row.created_at
  }));
}

export function searchMerlinExecutionPlans(query: string, limit = 20): MerlinExecutionPlanRecord[] {
  const q = (query || '').trim().toLowerCase();
  const max = Math.max(1, Math.min(100, limit));
  if (!q) return listMerlinExecutionPlans({ limit: max });
  const rows = getDb()
    .prepare(
      `SELECT * FROM merlin_execution_plans
       WHERE lower(brand_lane) LIKE ?
          OR lower(kpi) LIKE ?
          OR lower(tool) LIKE ?
          OR lower(action) LIKE ?
          OR lower(execution_status) LIKE ?
          OR lower(eligibility_reason) LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, max) as ExecutionPlanRow[];
  return rows.map(mapPlan);
}

initializeMerlinExecutionPlanRuntime();
