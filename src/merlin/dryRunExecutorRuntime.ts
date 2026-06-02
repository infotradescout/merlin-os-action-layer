import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { listMerlinConnectorAdapterChecks } from './connectorAdapterRuntime.js';
import {
  getMerlinExecutionPlanById,
  updateMerlinExecutionPlanStatus,
  type MerlinExecutionPlanRecord
} from './executionPlanRuntime.js';

export type MerlinDryRunStatus = 'simulated' | 'blocked' | 'failed' | 'cancelled';

export type MerlinDryRunExecutionRecord = {
  id: string;
  execution_plan_id: string;
  adapter_check_id?: string;
  action_card_id: string;
  brand_lane: string;
  entity_id?: string;
  kpi: string;
  tool: string;
  action: string;
  dry_run_status: MerlinDryRunStatus;
  simulated_result: Record<string, unknown>;
  suggested_outcome_type: string;
  source_refs: string[];
  created_at: string;
  updated_at: string;
};

type DryRunRow = {
  id: string;
  execution_plan_id: string;
  adapter_check_id: string | null;
  action_card_id: string;
  brand_lane: string;
  entity_id: string | null;
  kpi: string;
  tool: string;
  action: string;
  dry_run_status: MerlinDryRunStatus;
  simulated_result_json: string;
  suggested_outcome_type: string;
  source_refs_json: string;
  created_at: string;
  updated_at: string;
};

type DryRunHistoryRow = {
  id: string;
  dry_run_execution_id: string;
  event_type: 'created' | 'status_updated';
  dry_run_status: MerlinDryRunStatus;
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
  if (!db) initializeMerlinDryRunExecutorRuntime();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapDryRun(row: DryRunRow): MerlinDryRunExecutionRecord {
  return {
    id: row.id,
    execution_plan_id: row.execution_plan_id,
    adapter_check_id: row.adapter_check_id || undefined,
    action_card_id: row.action_card_id,
    brand_lane: row.brand_lane,
    entity_id: row.entity_id || undefined,
    kpi: row.kpi,
    tool: row.tool,
    action: row.action,
    dry_run_status: row.dry_run_status,
    simulated_result: JSON.parse(row.simulated_result_json) as Record<string, unknown>,
    suggested_outcome_type: row.suggested_outcome_type,
    source_refs: JSON.parse(row.source_refs_json) as string[],
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function appendHistory(dryRunId: string, eventType: 'created' | 'status_updated', status: MerlinDryRunStatus, payload: Record<string, unknown>): void {
  getDb()
    .prepare(
      `INSERT INTO merlin_dry_run_execution_history
      (id, dry_run_execution_id, event_type, dry_run_status, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(`merlin-dry-run-history-${randomUUID()}`, dryRunId, eventType, status, JSON.stringify(payload), nowIso());
}

function suggestedOutcomeForAction(action: string): string {
  if (action === 'send_external_message') return 'external_reply_received';
  if (['create', 'update', 'generate', 'schedule', 'route', 'inspect'].includes(action)) return 'manual_done';
  if (action === 'block') return 'blocked_resolved';
  return 'manual_done';
}

function buildSimulatedResult(plan: MerlinExecutionPlanRecord): Record<string, unknown> {
  return {
    dryRun: true,
    externalMutation: false,
    tool: plan.tool,
    action: plan.action,
    wouldExecute: true,
    payloadSummary: {
      intent: typeof plan.payload.intent === 'string' ? plan.payload.intent : '',
      source_of_truth: typeof plan.payload.source_of_truth === 'string' ? plan.payload.source_of_truth : '',
      output_location: typeof plan.payload.output_location === 'string' ? plan.payload.output_location : ''
    }
  };
}

export function initializeMerlinDryRunExecutorRuntime(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS merlin_dry_run_executions (
      id TEXT PRIMARY KEY,
      execution_plan_id TEXT NOT NULL,
      adapter_check_id TEXT,
      action_card_id TEXT NOT NULL,
      brand_lane TEXT NOT NULL,
      entity_id TEXT,
      kpi TEXT NOT NULL,
      tool TEXT NOT NULL,
      action TEXT NOT NULL,
      dry_run_status TEXT NOT NULL,
      simulated_result_json TEXT NOT NULL,
      suggested_outcome_type TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_dry_run_executions_plan_idx ON merlin_dry_run_executions(execution_plan_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS merlin_dry_run_executions_brand_status_idx ON merlin_dry_run_executions(brand_lane, dry_run_status, created_at DESC);

    CREATE TABLE IF NOT EXISTS merlin_dry_run_execution_history (
      id TEXT PRIMARY KEY,
      dry_run_execution_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      dry_run_status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_dry_run_execution_history_idx ON merlin_dry_run_execution_history(dry_run_execution_id, created_at DESC);
  `);
  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function closeMerlinDryRunExecutorRuntime(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetMerlinDryRunExecutorRuntimeForTest(): void {
  const dbi = getDb();
  dbi.prepare('DELETE FROM merlin_dry_run_execution_history').run();
  dbi.prepare('DELETE FROM merlin_dry_run_executions').run();
}

export function createMerlinDryRunExecution(input: { execution_plan_id: string }): MerlinDryRunExecutionRecord {
  const plan = getMerlinExecutionPlanById(input.execution_plan_id);
  if (!plan) throw new Error('execution_plan_not_found');
  const latestCheck = listMerlinConnectorAdapterChecks({ execution_plan_id: plan.id, limit: 1 })[0];
  if (!latestCheck) throw new Error('adapter_check_required');
  if (latestCheck.check_status !== 'pass') throw new Error(`adapter_check_${latestCheck.check_status}`);
  if (plan.execution_status !== 'eligible') throw new Error(`execution_plan_${plan.execution_status}`);
  if (plan.execution_mode !== 'dry_run') throw new Error('execution_mode_not_dry_run');

  const now = nowIso();
  const record: MerlinDryRunExecutionRecord = {
    id: `merlin-dry-run-${randomUUID()}`,
    execution_plan_id: plan.id,
    adapter_check_id: latestCheck.id,
    action_card_id: plan.action_card_id,
    brand_lane: plan.brand_lane,
    entity_id: plan.entity_id,
    kpi: plan.kpi,
    tool: plan.tool,
    action: plan.action,
    dry_run_status: 'simulated',
    simulated_result: buildSimulatedResult(plan),
    suggested_outcome_type: suggestedOutcomeForAction(plan.action),
    source_refs: plan.source_refs,
    created_at: now,
    updated_at: now
  };
  getDb()
    .prepare(
      `INSERT INTO merlin_dry_run_executions
      (id, execution_plan_id, adapter_check_id, action_card_id, brand_lane, entity_id, kpi, tool, action, dry_run_status, simulated_result_json, suggested_outcome_type, source_refs_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.execution_plan_id,
      record.adapter_check_id || null,
      record.action_card_id,
      record.brand_lane,
      record.entity_id || null,
      record.kpi,
      record.tool,
      record.action,
      record.dry_run_status,
      JSON.stringify(record.simulated_result),
      record.suggested_outcome_type,
      JSON.stringify(record.source_refs),
      record.created_at,
      record.updated_at
    );
  appendHistory(record.id, 'created', record.dry_run_status, {
    execution_plan_id: plan.id,
    adapter_check_id: latestCheck.id,
    externalMutation: false
  });
  updateMerlinExecutionPlanStatus(plan.id, 'executed_dry_run', { dry_run_execution_id: record.id });
  return record;
}

export function getMerlinDryRunExecutionById(id: string): MerlinDryRunExecutionRecord | undefined {
  const row = getDb().prepare('SELECT * FROM merlin_dry_run_executions WHERE id = ?').get(id) as DryRunRow | undefined;
  return row ? mapDryRun(row) : undefined;
}

export function listMerlinDryRunExecutions(filters: { brand_lane?: string; status?: MerlinDryRunStatus; entity_id?: string; limit?: number } = {}): MerlinDryRunExecutionRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.brand_lane) {
    clauses.push('brand_lane = ?');
    params.push(filters.brand_lane.trim().toLowerCase());
  }
  if (filters.status) {
    clauses.push('dry_run_status = ?');
    params.push(filters.status);
  }
  if (filters.entity_id) {
    clauses.push('entity_id = ?');
    params.push(filters.entity_id);
  }
  const limit = Math.max(1, Math.min(500, filters.limit || 100));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (getDb().prepare(`SELECT * FROM merlin_dry_run_executions ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as DryRunRow[]).map(mapDryRun);
}

export function updateMerlinDryRunExecutionStatus(
  id: string,
  status: MerlinDryRunStatus,
  payload: Record<string, unknown> = {}
): MerlinDryRunExecutionRecord | undefined {
  const existing = getMerlinDryRunExecutionById(id);
  if (!existing) return undefined;
  getDb().prepare('UPDATE merlin_dry_run_executions SET dry_run_status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id);
  appendHistory(id, 'status_updated', status, payload);
  return getMerlinDryRunExecutionById(id);
}

export function getMerlinDryRunExecutionHistory(id: string): Array<{
  id: string;
  dry_run_execution_id: string;
  event_type: string;
  dry_run_status: MerlinDryRunStatus;
  payload: Record<string, unknown>;
  created_at: string;
}> {
  const rows = getDb()
    .prepare('SELECT * FROM merlin_dry_run_execution_history WHERE dry_run_execution_id = ? ORDER BY created_at DESC')
    .all(id) as DryRunHistoryRow[];
  return rows.map((row) => ({
    id: row.id,
    dry_run_execution_id: row.dry_run_execution_id,
    event_type: row.event_type,
    dry_run_status: row.dry_run_status,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    created_at: row.created_at
  }));
}

export function searchMerlinDryRunExecutions(query: string, limit = 20): MerlinDryRunExecutionRecord[] {
  const q = (query || '').trim().toLowerCase();
  const max = Math.max(1, Math.min(100, limit));
  if (!q) return listMerlinDryRunExecutions({ limit: max });
  const rows = getDb()
    .prepare(
      `SELECT * FROM merlin_dry_run_executions
       WHERE lower(brand_lane) LIKE ?
          OR lower(kpi) LIKE ?
          OR lower(tool) LIKE ?
          OR lower(action) LIKE ?
          OR lower(dry_run_status) LIKE ?
          OR lower(suggested_outcome_type) LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, max) as DryRunRow[];
  return rows.map(mapDryRun);
}

initializeMerlinDryRunExecutorRuntime();
