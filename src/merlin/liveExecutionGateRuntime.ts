import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { getMerlinActionCardById } from './actionCardRuntime.js';
import { getMerlinApprovalById } from './approvalRuntime.js';
import { getMerlinConnectorAdapterById, listMerlinConnectorAdapterChecks } from './connectorAdapterRuntime.js';
import { getMerlinDryRunExecutionById } from './dryRunExecutorRuntime.js';
import { getMerlinExecutionPlanById } from './executionPlanRuntime.js';

export type MerlinLiveExecutionGateStatus = 'eligible' | 'blocked' | 'disabled' | 'expired' | 'failed';
export type MerlinLiveExecutionRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type MerlinLiveExecutionGateRecord = {
  id: string;
  dry_run_execution_id: string;
  execution_plan_id: string;
  action_card_id: string;
  adapter_check_id?: string;
  approval_id?: string;
  brand_lane: string;
  entity_id?: string;
  kpi: string;
  tool: string;
  action: string;
  gate_status: MerlinLiveExecutionGateStatus;
  risk_level: MerlinLiveExecutionRiskLevel;
  live_execution_enabled: number;
  eligibility_reason: string;
  missing_gates: string[];
  required_gates: string[];
  source_refs: string[];
  created_at: string;
  updated_at: string;
};

type LiveGateRow = {
  id: string;
  dry_run_execution_id: string;
  execution_plan_id: string;
  action_card_id: string;
  adapter_check_id: string | null;
  approval_id: string | null;
  brand_lane: string;
  entity_id: string | null;
  kpi: string;
  tool: string;
  action: string;
  gate_status: MerlinLiveExecutionGateStatus;
  risk_level: MerlinLiveExecutionRiskLevel;
  live_execution_enabled: number;
  eligibility_reason: string;
  missing_gates_json: string;
  required_gates_json: string;
  source_refs_json: string;
  created_at: string;
  updated_at: string;
};

type LiveGateHistoryRow = {
  id: string;
  live_execution_gate_id: string;
  event_type: 'created';
  gate_status: MerlinLiveExecutionGateStatus;
  payload_json: string;
  created_at: string;
};

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
const LIVE_EXECUTION_ENABLED = false;
const REQUIRED_GATES = [
  'dry_run_execution_exists',
  'dry_run_execution_simulated',
  'simulated_result_external_mutation_false',
  'execution_plan_exists',
  'execution_plan_executed_dry_run',
  'adapter_check_exists',
  'adapter_check_pass',
  'approval_present_when_required',
  'approval_approved_when_required',
  'policy_not_blocked',
  'connector_adapter_active',
  'live_execution_enabled'
];

let db: Database.Database | null = null;
let dbPath: string | null = null;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) initializeMerlinLiveExecutionGateRuntime();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapGate(row: LiveGateRow): MerlinLiveExecutionGateRecord {
  return {
    id: row.id,
    dry_run_execution_id: row.dry_run_execution_id,
    execution_plan_id: row.execution_plan_id,
    action_card_id: row.action_card_id,
    adapter_check_id: row.adapter_check_id || undefined,
    approval_id: row.approval_id || undefined,
    brand_lane: row.brand_lane,
    entity_id: row.entity_id || undefined,
    kpi: row.kpi,
    tool: row.tool,
    action: row.action,
    gate_status: row.gate_status,
    risk_level: row.risk_level,
    live_execution_enabled: row.live_execution_enabled,
    eligibility_reason: row.eligibility_reason,
    missing_gates: JSON.parse(row.missing_gates_json) as string[],
    required_gates: JSON.parse(row.required_gates_json) as string[],
    source_refs: JSON.parse(row.source_refs_json) as string[],
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function appendHistory(gateId: string, status: MerlinLiveExecutionGateStatus, payload: Record<string, unknown>): void {
  getDb()
    .prepare(
      `INSERT INTO merlin_live_execution_gate_history
      (id, live_execution_gate_id, event_type, gate_status, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(`merlin-live-gate-history-${randomUUID()}`, gateId, 'created', status, JSON.stringify(payload), nowIso());
}

export function determineMerlinLiveExecutionRisk(tool: string, action: string): MerlinLiveExecutionRiskLevel {
  const normalizedTool = String(tool || '').trim().toLowerCase();
  const normalizedAction = String(action || '').trim().toLowerCase();
  if (normalizedTool === 'stripe' || normalizedAction.includes('payment') || normalizedAction.includes('charge')) return 'critical';
  if (normalizedTool === 'manual' && ['inspect', 'route'].includes(normalizedAction)) return 'low';
  if (normalizedTool === 'github' && ['create', 'update'].includes(normalizedAction)) return 'medium';
  if (normalizedTool === 'googledrive' && ['create', 'update'].includes(normalizedAction)) return 'medium';
  if (normalizedTool === 'googlecalendar' && normalizedAction === 'schedule') return 'high';
  if (normalizedTool === 'gmail' && normalizedAction === 'send_external_message') return 'high';
  if (normalizedTool === 'canva' && normalizedAction === 'generate') return 'medium';
  return 'critical';
}

function riskIsHardBlocked(tool: string, action: string, risk: MerlinLiveExecutionRiskLevel): boolean {
  const normalizedTool = String(tool || '').trim().toLowerCase();
  const normalizedAction = String(action || '').trim().toLowerCase();
  return risk === 'critical' || normalizedTool === 'stripe' || normalizedAction.includes('payment') || normalizedAction.includes('charge');
}

export function initializeMerlinLiveExecutionGateRuntime(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS merlin_live_execution_gates (
      id TEXT PRIMARY KEY,
      dry_run_execution_id TEXT NOT NULL,
      execution_plan_id TEXT NOT NULL,
      action_card_id TEXT NOT NULL,
      adapter_check_id TEXT,
      approval_id TEXT,
      brand_lane TEXT NOT NULL,
      entity_id TEXT,
      kpi TEXT NOT NULL,
      tool TEXT NOT NULL,
      action TEXT NOT NULL,
      gate_status TEXT NOT NULL,
      risk_level TEXT NOT NULL,
      live_execution_enabled INTEGER NOT NULL,
      eligibility_reason TEXT NOT NULL,
      missing_gates_json TEXT NOT NULL,
      required_gates_json TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_live_execution_gates_dry_run_idx ON merlin_live_execution_gates(dry_run_execution_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS merlin_live_execution_gates_brand_status_idx ON merlin_live_execution_gates(brand_lane, gate_status, created_at DESC);

    CREATE TABLE IF NOT EXISTS merlin_live_execution_gate_history (
      id TEXT PRIMARY KEY,
      live_execution_gate_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      gate_status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_live_execution_gate_history_idx ON merlin_live_execution_gate_history(live_execution_gate_id, created_at DESC);
  `);
  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function closeMerlinLiveExecutionGateRuntime(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetMerlinLiveExecutionGateRuntimeForTest(): void {
  const dbi = getDb();
  dbi.prepare('DELETE FROM merlin_live_execution_gate_history').run();
  dbi.prepare('DELETE FROM merlin_live_execution_gates').run();
}

export function createMerlinLiveExecutionGate(input: { dry_run_execution_id: string }): MerlinLiveExecutionGateRecord {
  const dryRun = getMerlinDryRunExecutionById(input.dry_run_execution_id);
  if (!dryRun) throw new Error('dry_run_execution_not_found');

  const plan = getMerlinExecutionPlanById(dryRun.execution_plan_id);
  const card = plan ? getMerlinActionCardById(plan.action_card_id) : undefined;
  const adapterCheck = dryRun.adapter_check_id
    ? listMerlinConnectorAdapterChecks({ execution_plan_id: dryRun.execution_plan_id, limit: 50 }).find((row) => row.id === dryRun.adapter_check_id)
    : undefined;
  const adapter = adapterCheck?.adapter_id ? getMerlinConnectorAdapterById(adapterCheck.adapter_id) : undefined;
  const approval = plan?.approval_id ? getMerlinApprovalById(plan.approval_id) : undefined;
  const risk = determineMerlinLiveExecutionRisk(dryRun.tool, dryRun.action);
  const missingGates: string[] = [];
  const simulatedExternalMutation =
    dryRun.simulated_result && typeof dryRun.simulated_result.externalMutation === 'boolean'
      ? dryRun.simulated_result.externalMutation
      : undefined;

  if (dryRun.dry_run_status !== 'simulated') missingGates.push('dry_run_execution_simulated');
  if (simulatedExternalMutation !== false) missingGates.push('simulated_result_external_mutation_false');
  if (!plan) missingGates.push('execution_plan_exists');
  if (plan && plan.execution_status !== 'executed_dry_run') missingGates.push('execution_plan_executed_dry_run');
  if (!adapterCheck) missingGates.push('adapter_check_exists');
  if (adapterCheck && adapterCheck.check_status !== 'pass') missingGates.push('adapter_check_pass');
  const approvalRequired = Boolean(card?.policy_result.requires_approval || card?.policy_result.blocked || card?.permission_level === 'level_3' || card?.permission_level === 'level_4');
  if (approvalRequired && !approval) missingGates.push('approval_present_when_required');
  if (approvalRequired && approval && approval.approval_status !== 'approved') missingGates.push('approval_approved_when_required');
  if (!card || card.policy_result.blocked) missingGates.push('policy_not_blocked');
  if (!adapter || adapter.adapter_status !== 'active') missingGates.push('connector_adapter_active');
  if (!LIVE_EXECUTION_ENABLED) missingGates.push('live_execution_enabled');

  const hardBlocked = riskIsHardBlocked(dryRun.tool, dryRun.action, risk);
  const status: MerlinLiveExecutionGateStatus = hardBlocked ? 'blocked' : missingGates.length === 1 && missingGates[0] === 'live_execution_enabled' ? 'disabled' : 'blocked';
  const eligibilityReason = hardBlocked
    ? 'critical_tool_or_action_blocked'
    : status === 'disabled'
      ? 'live_execution_disabled'
      : missingGates[0] || 'blocked';

  const now = nowIso();
  const gate: MerlinLiveExecutionGateRecord = {
    id: `merlin-live-gate-${randomUUID()}`,
    dry_run_execution_id: dryRun.id,
    execution_plan_id: dryRun.execution_plan_id,
    action_card_id: dryRun.action_card_id,
    adapter_check_id: dryRun.adapter_check_id,
    approval_id: plan?.approval_id,
    brand_lane: dryRun.brand_lane,
    entity_id: dryRun.entity_id,
    kpi: dryRun.kpi,
    tool: dryRun.tool,
    action: dryRun.action,
    gate_status: status,
    risk_level: risk,
    live_execution_enabled: 0,
    eligibility_reason: eligibilityReason,
    missing_gates: missingGates,
    required_gates: REQUIRED_GATES,
    source_refs: dryRun.source_refs,
    created_at: now,
    updated_at: now
  };
  getDb()
    .prepare(
      `INSERT INTO merlin_live_execution_gates
      (id, dry_run_execution_id, execution_plan_id, action_card_id, adapter_check_id, approval_id, brand_lane, entity_id, kpi, tool, action, gate_status, risk_level, live_execution_enabled, eligibility_reason, missing_gates_json, required_gates_json, source_refs_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      gate.id,
      gate.dry_run_execution_id,
      gate.execution_plan_id,
      gate.action_card_id,
      gate.adapter_check_id || null,
      gate.approval_id || null,
      gate.brand_lane,
      gate.entity_id || null,
      gate.kpi,
      gate.tool,
      gate.action,
      gate.gate_status,
      gate.risk_level,
      gate.live_execution_enabled,
      gate.eligibility_reason,
      JSON.stringify(gate.missing_gates),
      JSON.stringify(gate.required_gates),
      JSON.stringify(gate.source_refs),
      gate.created_at,
      gate.updated_at
    );
  appendHistory(gate.id, gate.gate_status, {
    dry_run_execution_id: gate.dry_run_execution_id,
    execution_plan_id: gate.execution_plan_id,
    missing_gates: gate.missing_gates,
    live_execution_enabled: false
  });
  return gate;
}

export function getMerlinLiveExecutionGateById(id: string): MerlinLiveExecutionGateRecord | undefined {
  const row = getDb().prepare('SELECT * FROM merlin_live_execution_gates WHERE id = ?').get(id) as LiveGateRow | undefined;
  return row ? mapGate(row) : undefined;
}

export function listMerlinLiveExecutionGates(filters: {
  brand_lane?: string;
  status?: MerlinLiveExecutionGateStatus;
  entity_id?: string;
  limit?: number;
} = {}): MerlinLiveExecutionGateRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.brand_lane) {
    clauses.push('brand_lane = ?');
    params.push(filters.brand_lane.trim().toLowerCase());
  }
  if (filters.status) {
    clauses.push('gate_status = ?');
    params.push(filters.status);
  }
  if (filters.entity_id) {
    clauses.push('entity_id = ?');
    params.push(filters.entity_id);
  }
  const limit = Math.max(1, Math.min(500, filters.limit || 100));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (getDb().prepare(`SELECT * FROM merlin_live_execution_gates ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as LiveGateRow[]).map(mapGate);
}

export function getMerlinLiveExecutionGateHistory(gateId: string): Array<{
  id: string;
  live_execution_gate_id: string;
  event_type: string;
  gate_status: MerlinLiveExecutionGateStatus;
  payload: Record<string, unknown>;
  created_at: string;
}> {
  const rows = getDb()
    .prepare('SELECT * FROM merlin_live_execution_gate_history WHERE live_execution_gate_id = ? ORDER BY created_at DESC')
    .all(gateId) as LiveGateHistoryRow[];
  return rows.map((row) => ({
    id: row.id,
    live_execution_gate_id: row.live_execution_gate_id,
    event_type: row.event_type,
    gate_status: row.gate_status,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    created_at: row.created_at
  }));
}

export function searchMerlinLiveExecutionGates(query: string, limit = 20): MerlinLiveExecutionGateRecord[] {
  const q = (query || '').trim().toLowerCase();
  const max = Math.max(1, Math.min(100, limit));
  if (!q) return listMerlinLiveExecutionGates({ limit: max });
  const rows = getDb()
    .prepare(
      `SELECT * FROM merlin_live_execution_gates
       WHERE lower(brand_lane) LIKE ?
          OR lower(kpi) LIKE ?
          OR lower(tool) LIKE ?
          OR lower(action) LIKE ?
          OR lower(gate_status) LIKE ?
          OR lower(risk_level) LIKE ?
          OR lower(eligibility_reason) LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, max) as LiveGateRow[];
  return rows.map(mapGate);
}

initializeMerlinLiveExecutionGateRuntime();
