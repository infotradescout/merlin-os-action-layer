import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { getMerlinExecutionPlanById } from './executionPlanRuntime.js';

export type MerlinAdapterStatus = 'active' | 'disabled' | 'blocked';
export type MerlinAdapterExecutionMode = 'dry_run_only';
export type MerlinAdapterCheckStatus = 'pass' | 'blocked' | 'missing_fields' | 'forbidden_fields' | 'adapter_not_found';

export type MerlinConnectorAdapterRecord = {
  id: string;
  tool: string;
  action: string;
  adapter_status: MerlinAdapterStatus;
  execution_mode: MerlinAdapterExecutionMode;
  permission_level_required: string;
  requires_approval: number;
  required_fields: string[];
  forbidden_fields: string[];
  created_at: string;
  updated_at: string;
};

export type MerlinConnectorAdapterCheckRecord = {
  id: string;
  execution_plan_id: string;
  adapter_id?: string;
  check_status: MerlinAdapterCheckStatus;
  reason: string;
  missing_fields: string[];
  forbidden_fields_found: string[];
  created_at: string;
};

type AdapterRow = {
  id: string;
  tool: string;
  action: string;
  adapter_status: MerlinAdapterStatus;
  execution_mode: MerlinAdapterExecutionMode;
  permission_level_required: string;
  requires_approval: number;
  required_fields_json: string;
  forbidden_fields_json: string;
  created_at: string;
  updated_at: string;
};

type AdapterCheckRow = {
  id: string;
  execution_plan_id: string;
  adapter_id: string | null;
  check_status: MerlinAdapterCheckStatus;
  reason: string;
  missing_fields_json: string;
  forbidden_fields_found_json: string;
  created_at: string;
};

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
const DEFAULT_REQUIRED_FIELDS = ['dryRun', 'tool', 'action', 'intent', 'source_of_truth', 'output_location', 'required_real_data', 'fail_safes'];
const DEFAULT_FORBIDDEN_FIELDS = [
  'sendNow',
  'chargeNow',
  'deleteNow',
  'archiveNow',
  'recipientGuessed',
  'paymentObjectGuessed',
  'calendarAttendeeGuessed',
  'externalMutationAllowed'
];

let db: Database.Database | null = null;
let dbPath: string | null = null;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) initializeMerlinConnectorAdapterRuntime();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeTool(tool: string): string {
  const normalized = String(tool || '').trim().toLowerCase();
  const aliases: Record<string, string> = {
    gmail: 'Gmail',
    googledrive: 'GoogleDrive',
    drive: 'GoogleDrive',
    googlecalendar: 'GoogleCalendar',
    calendar: 'GoogleCalendar',
    github: 'GitHub',
    canva: 'Canva',
    manual: 'Manual',
    none: 'None'
  };
  return aliases[normalized] || String(tool || '').trim();
}

function normalizeAction(action: string): string {
  return String(action || '').trim().toLowerCase();
}

function mapAdapter(row: AdapterRow): MerlinConnectorAdapterRecord {
  return {
    id: row.id,
    tool: row.tool,
    action: row.action,
    adapter_status: row.adapter_status,
    execution_mode: row.execution_mode,
    permission_level_required: row.permission_level_required,
    requires_approval: row.requires_approval,
    required_fields: JSON.parse(row.required_fields_json) as string[],
    forbidden_fields: JSON.parse(row.forbidden_fields_json) as string[],
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapCheck(row: AdapterCheckRow): MerlinConnectorAdapterCheckRecord {
  return {
    id: row.id,
    execution_plan_id: row.execution_plan_id,
    adapter_id: row.adapter_id || undefined,
    check_status: row.check_status,
    reason: row.reason,
    missing_fields: JSON.parse(row.missing_fields_json) as string[],
    forbidden_fields_found: JSON.parse(row.forbidden_fields_found_json) as string[],
    created_at: row.created_at
  };
}

function seedAdapter(tool: string, action: string): void {
  const id = `merlin-adapter-${tool.toLowerCase()}-${action.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO merlin_connector_adapters
      (id, tool, action, adapter_status, execution_mode, permission_level_required, requires_approval, required_fields_json, forbidden_fields_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      tool,
      action,
      'active',
      'dry_run_only',
      'level_2',
      1,
      JSON.stringify(DEFAULT_REQUIRED_FIELDS),
      JSON.stringify(DEFAULT_FORBIDDEN_FIELDS),
      now,
      now
    );
}

function seedDefaultAdapters(): void {
  seedAdapter('Gmail', 'send_external_message');
  seedAdapter('GoogleDrive', 'create');
  seedAdapter('GoogleDrive', 'update');
  seedAdapter('GoogleCalendar', 'schedule');
  seedAdapter('GitHub', 'create');
  seedAdapter('GitHub', 'update');
  seedAdapter('Canva', 'generate');
  seedAdapter('Manual', 'inspect');
  seedAdapter('Manual', 'route');
  seedAdapter('None', 'block');
}

export function initializeMerlinConnectorAdapterRuntime(explicitPath?: string): string {
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
  db = nextDb;
  dbPath = nextPath;
  nextDb.exec(`
    CREATE TABLE IF NOT EXISTS merlin_connector_adapters (
      id TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      action TEXT NOT NULL,
      adapter_status TEXT NOT NULL,
      execution_mode TEXT NOT NULL,
      permission_level_required TEXT NOT NULL,
      requires_approval INTEGER NOT NULL,
      required_fields_json TEXT NOT NULL,
      forbidden_fields_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS merlin_connector_adapters_tool_action_idx ON merlin_connector_adapters(tool, action);

    CREATE TABLE IF NOT EXISTS merlin_connector_adapter_checks (
      id TEXT PRIMARY KEY,
      execution_plan_id TEXT NOT NULL,
      adapter_id TEXT,
      check_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      missing_fields_json TEXT NOT NULL,
      forbidden_fields_found_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_connector_adapter_checks_plan_idx ON merlin_connector_adapter_checks(execution_plan_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS merlin_connector_adapter_checks_status_idx ON merlin_connector_adapter_checks(check_status, created_at DESC);
  `);
  seedDefaultAdapters();
  return nextPath;
}

export function closeMerlinConnectorAdapterRuntime(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetMerlinConnectorAdapterRuntimeForTest(): void {
  const dbi = getDb();
  dbi.prepare('DELETE FROM merlin_connector_adapter_checks').run();
  dbi.prepare('DELETE FROM merlin_connector_adapters').run();
  seedDefaultAdapters();
}

export function listMerlinConnectorAdapters(filters: { tool?: string; action?: string; limit?: number } = {}): MerlinConnectorAdapterRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.tool) {
    clauses.push('tool = ?');
    params.push(normalizeTool(filters.tool));
  }
  if (filters.action) {
    clauses.push('action = ?');
    params.push(normalizeAction(filters.action));
  }
  const limit = Math.max(1, Math.min(500, filters.limit || 100));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (getDb().prepare(`SELECT * FROM merlin_connector_adapters ${where} ORDER BY tool, action LIMIT ?`).all(...params) as AdapterRow[]).map(mapAdapter);
}

export function getMerlinConnectorAdapterById(id: string): MerlinConnectorAdapterRecord | undefined {
  const row = getDb().prepare('SELECT * FROM merlin_connector_adapters WHERE id = ?').get(id) as AdapterRow | undefined;
  return row ? mapAdapter(row) : undefined;
}

function findAdapter(tool: string, action: string): MerlinConnectorAdapterRecord | undefined {
  const row = getDb()
    .prepare('SELECT * FROM merlin_connector_adapters WHERE tool = ? AND action = ?')
    .get(normalizeTool(tool), normalizeAction(action)) as AdapterRow | undefined;
  return row ? mapAdapter(row) : undefined;
}

function recordCheck(input: {
  execution_plan_id: string;
  adapter_id?: string;
  check_status: MerlinAdapterCheckStatus;
  reason: string;
  missing_fields?: string[];
  forbidden_fields_found?: string[];
}): MerlinConnectorAdapterCheckRecord {
  const row: MerlinConnectorAdapterCheckRecord = {
    id: `merlin-adapter-check-${randomUUID()}`,
    execution_plan_id: input.execution_plan_id,
    adapter_id: input.adapter_id,
    check_status: input.check_status,
    reason: input.reason,
    missing_fields: input.missing_fields || [],
    forbidden_fields_found: input.forbidden_fields_found || [],
    created_at: nowIso()
  };
  getDb()
    .prepare(
      `INSERT INTO merlin_connector_adapter_checks
      (id, execution_plan_id, adapter_id, check_status, reason, missing_fields_json, forbidden_fields_found_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      row.execution_plan_id,
      row.adapter_id || null,
      row.check_status,
      row.reason,
      JSON.stringify(row.missing_fields),
      JSON.stringify(row.forbidden_fields_found),
      row.created_at
    );
  return row;
}

export function runMerlinConnectorAdapterCheck(executionPlanId: string): MerlinConnectorAdapterCheckRecord {
  const plan = getMerlinExecutionPlanById(executionPlanId);
  if (!plan) throw new Error('execution_plan_not_found');
  const adapter = findAdapter(plan.tool, plan.action);
  if (!adapter) {
    return recordCheck({ execution_plan_id: plan.id, check_status: 'adapter_not_found', reason: 'adapter_not_found' });
  }
  if (adapter.adapter_status !== 'active') {
    return recordCheck({ execution_plan_id: plan.id, adapter_id: adapter.id, check_status: 'blocked', reason: `adapter_${adapter.adapter_status}` });
  }
  if (plan.execution_mode !== 'dry_run') {
    return recordCheck({ execution_plan_id: plan.id, adapter_id: adapter.id, check_status: 'blocked', reason: 'execution_mode_not_dry_run' });
  }
  if (plan.execution_status !== 'eligible') {
    return recordCheck({ execution_plan_id: plan.id, adapter_id: adapter.id, check_status: 'blocked', reason: `execution_plan_${plan.execution_status}` });
  }
  const missing = adapter.required_fields.filter((field) => !Object.prototype.hasOwnProperty.call(plan.payload, field));
  if (missing.length > 0) {
    return recordCheck({ execution_plan_id: plan.id, adapter_id: adapter.id, check_status: 'missing_fields', reason: 'missing_required_fields', missing_fields: missing });
  }
  const forbidden = adapter.forbidden_fields.filter((field) => Object.prototype.hasOwnProperty.call(plan.payload, field));
  if (forbidden.length > 0) {
    return recordCheck({
      execution_plan_id: plan.id,
      adapter_id: adapter.id,
      check_status: 'forbidden_fields',
      reason: 'forbidden_fields_found',
      forbidden_fields_found: forbidden
    });
  }
  return recordCheck({ execution_plan_id: plan.id, adapter_id: adapter.id, check_status: 'pass', reason: 'adapter_contract_passed' });
}

export function listMerlinConnectorAdapterChecks(filters: {
  execution_plan_id?: string;
  status?: MerlinAdapterCheckStatus;
  limit?: number;
} = {}): MerlinConnectorAdapterCheckRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.execution_plan_id) {
    clauses.push('execution_plan_id = ?');
    params.push(filters.execution_plan_id);
  }
  if (filters.status) {
    clauses.push('check_status = ?');
    params.push(filters.status);
  }
  const limit = Math.max(1, Math.min(500, filters.limit || 100));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (getDb().prepare(`SELECT * FROM merlin_connector_adapter_checks ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as AdapterCheckRow[]).map(mapCheck);
}

export function searchMerlinConnectorAdapterChecks(query: string, limit = 20): MerlinConnectorAdapterCheckRecord[] {
  const q = (query || '').trim().toLowerCase();
  const max = Math.max(1, Math.min(100, limit));
  if (!q) return listMerlinConnectorAdapterChecks({ limit: max });
  const rows = getDb()
    .prepare(
      `SELECT * FROM merlin_connector_adapter_checks
       WHERE lower(check_status) LIKE ?
          OR lower(reason) LIKE ?
          OR lower(execution_plan_id) LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, max) as AdapterCheckRow[];
  return rows.map(mapCheck);
}

initializeMerlinConnectorAdapterRuntime();
