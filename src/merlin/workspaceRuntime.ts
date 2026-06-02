import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { getMerlinActionCardById } from './actionCardRuntime.js';

export type MerlinWorkspaceType = 'internal' | 'brand' | 'client' | 'affiliate' | 'system';
export type MerlinWorkspaceStatus = 'active' | 'suspended' | 'archived';
export type MerlinWorkspaceRole = 'viewer' | 'operator' | 'admin' | 'owner' | 'super_admin' | 'system';
export type MerlinWorkspaceMemberStatus = 'active' | 'disabled' | 'removed';
export type MerlinRolePolicyAction =
  | 'view'
  | 'create_intake'
  | 'create_action_card'
  | 'request_approval'
  | 'approve'
  | 'create_execution_plan'
  | 'run_dry_run'
  | 'check_live_gate';
export type MerlinRolePolicyCheckStatus =
  | 'pass'
  | 'blocked'
  | 'workspace_not_found'
  | 'operator_not_found'
  | 'role_denied'
  | 'brand_denied'
  | 'target_not_found';

export type MerlinWorkspaceRecord = {
  id: string;
  workspace_name: string;
  workspace_type: MerlinWorkspaceType;
  status: MerlinWorkspaceStatus;
  created_at: string;
  updated_at: string;
};

export type MerlinWorkspaceMemberRecord = {
  id: string;
  workspace_id: string;
  operator_id: string;
  operator_label: string;
  role: MerlinWorkspaceRole;
  status: MerlinWorkspaceMemberStatus;
  created_at: string;
  updated_at: string;
};

export type MerlinWorkspaceBrandPermissionRecord = {
  id: string;
  workspace_id: string;
  brand_lane: string;
  can_view: number;
  can_create_intake: number;
  can_create_action_cards: number;
  can_request_approval: number;
  can_approve: number;
  can_create_execution_plan: number;
  can_run_dry_run: number;
  can_check_live_gate: number;
  created_at: string;
  updated_at: string;
};

export type MerlinRolePolicyCheckRecord = {
  id: string;
  workspace_id: string;
  operator_id: string;
  target_type: string;
  target_id: string;
  action: MerlinRolePolicyAction;
  check_status: MerlinRolePolicyCheckStatus;
  reason: string;
  created_at: string;
};

type WorkspaceRow = MerlinWorkspaceRecord;
type WorkspaceMemberRow = MerlinWorkspaceMemberRecord;
type BrandPermissionRow = MerlinWorkspaceBrandPermissionRecord;
type RolePolicyCheckRow = MerlinRolePolicyCheckRecord;

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
export const MERLIN_SYSTEM_WORKSPACE_ID = 'merlin-workspace-system';
const ACTION_PERMISSION_FIELD: Record<MerlinRolePolicyAction, keyof MerlinWorkspaceBrandPermissionRecord> = {
  view: 'can_view',
  create_intake: 'can_create_intake',
  create_action_card: 'can_create_action_cards',
  request_approval: 'can_request_approval',
  approve: 'can_approve',
  create_execution_plan: 'can_create_execution_plan',
  run_dry_run: 'can_run_dry_run',
  check_live_gate: 'can_check_live_gate'
};
const ROLE_ORDER: Record<MerlinWorkspaceRole, number> = {
  viewer: 0,
  operator: 1,
  admin: 2,
  owner: 3,
  super_admin: 4,
  system: 5
};
const MIN_ROLE_BY_ACTION: Record<MerlinRolePolicyAction, MerlinWorkspaceRole> = {
  view: 'viewer',
  create_intake: 'operator',
  create_action_card: 'operator',
  request_approval: 'operator',
  approve: 'admin',
  create_execution_plan: 'admin',
  run_dry_run: 'operator',
  check_live_gate: 'admin'
};

let db: Database.Database | null = null;
let dbPath: string | null = null;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) initializeMerlinWorkspaceRuntime();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeBrand(brand: string): string {
  return String(brand || '').trim().toLowerCase();
}

function asBit(input: unknown, fallback = false): number {
  return input === true || input === 1 || input === 'true' ? 1 : fallback ? 1 : 0;
}

function permissionLevelRank(value: string | undefined): number {
  const level = String(value || 'level_0').toLowerCase();
  const match = level.match(/level_(\d+)/);
  return match ? Number(match[1]) : 0;
}

function seedSystemWorkspace(): void {
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO merlin_workspaces
      (id, workspace_name, workspace_type, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(MERLIN_SYSTEM_WORKSPACE_ID, 'Merlin System', 'system', 'active', now, now);
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO merlin_workspace_members
      (id, workspace_id, operator_id, operator_label, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run('merlin-workspace-member-system', MERLIN_SYSTEM_WORKSPACE_ID, 'system', 'Merlin System', 'system', 'active', now, now);
}

export function initializeMerlinWorkspaceRuntime(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS merlin_workspaces (
      id TEXT PRIMARY KEY,
      workspace_name TEXT NOT NULL,
      workspace_type TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_workspaces_status_idx ON merlin_workspaces(status, created_at DESC);

    CREATE TABLE IF NOT EXISTS merlin_workspace_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      operator_id TEXT NOT NULL,
      operator_label TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS merlin_workspace_members_operator_idx ON merlin_workspace_members(workspace_id, operator_id);

    CREATE TABLE IF NOT EXISTS merlin_workspace_brand_permissions (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      brand_lane TEXT NOT NULL,
      can_view INTEGER NOT NULL,
      can_create_intake INTEGER NOT NULL,
      can_create_action_cards INTEGER NOT NULL,
      can_request_approval INTEGER NOT NULL,
      can_approve INTEGER NOT NULL,
      can_create_execution_plan INTEGER NOT NULL,
      can_run_dry_run INTEGER NOT NULL,
      can_check_live_gate INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS merlin_workspace_brand_permissions_idx ON merlin_workspace_brand_permissions(workspace_id, brand_lane);

    CREATE TABLE IF NOT EXISTS merlin_role_policy_checks (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      operator_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      action TEXT NOT NULL,
      check_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_role_policy_checks_workspace_idx ON merlin_role_policy_checks(workspace_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS merlin_role_policy_checks_status_idx ON merlin_role_policy_checks(check_status, created_at DESC);
  `);
  seedSystemWorkspace();
  return nextPath;
}

export function closeMerlinWorkspaceRuntime(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetMerlinWorkspaceRuntimeForTest(): void {
  const dbi = getDb();
  dbi.prepare('DELETE FROM merlin_role_policy_checks').run();
  dbi.prepare('DELETE FROM merlin_workspace_brand_permissions').run();
  dbi.prepare('DELETE FROM merlin_workspace_members').run();
  dbi.prepare('DELETE FROM merlin_workspaces').run();
  seedSystemWorkspace();
}

export function createMerlinWorkspace(input: {
  workspace_name: string;
  workspace_type: MerlinWorkspaceType;
  status?: MerlinWorkspaceStatus;
}): MerlinWorkspaceRecord {
  const now = nowIso();
  const record: MerlinWorkspaceRecord = {
    id: `merlin-workspace-${randomUUID()}`,
    workspace_name: input.workspace_name.trim(),
    workspace_type: input.workspace_type,
    status: input.status || 'active',
    created_at: now,
    updated_at: now
  };
  if (!record.workspace_name) throw new Error('workspace_name_required');
  getDb()
    .prepare('INSERT INTO merlin_workspaces (id, workspace_name, workspace_type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(record.id, record.workspace_name, record.workspace_type, record.status, record.created_at, record.updated_at);
  return record;
}

export function getMerlinWorkspaceById(id: string): MerlinWorkspaceRecord | undefined {
  return getDb().prepare('SELECT * FROM merlin_workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
}

export function listMerlinWorkspaces(filters: { status?: MerlinWorkspaceStatus; limit?: number } = {}): MerlinWorkspaceRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  const limit = Math.max(1, Math.min(500, filters.limit || 100));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb().prepare(`SELECT * FROM merlin_workspaces ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as WorkspaceRow[];
}

export function createMerlinWorkspaceMember(input: {
  workspace_id: string;
  operator_id: string;
  operator_label?: string;
  role: MerlinWorkspaceRole;
  status?: MerlinWorkspaceMemberStatus;
}): MerlinWorkspaceMemberRecord {
  if (!getMerlinWorkspaceById(input.workspace_id)) throw new Error('workspace_not_found');
  const now = nowIso();
  const operatorId = input.operator_id.trim();
  if (!operatorId) throw new Error('operator_id_required');
  const record: MerlinWorkspaceMemberRecord = {
    id: `merlin-workspace-member-${randomUUID()}`,
    workspace_id: input.workspace_id,
    operator_id: operatorId,
    operator_label: input.operator_label?.trim() || operatorId,
    role: input.role,
    status: input.status || 'active',
    created_at: now,
    updated_at: now
  };
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO merlin_workspace_members
      (id, workspace_id, operator_id, operator_label, role, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(record.id, record.workspace_id, record.operator_id, record.operator_label, record.role, record.status, record.created_at, record.updated_at);
  return record;
}

export function listMerlinWorkspaceMembers(workspaceId: string): MerlinWorkspaceMemberRecord[] {
  return getDb()
    .prepare('SELECT * FROM merlin_workspace_members WHERE workspace_id = ? ORDER BY created_at DESC')
    .all(workspaceId) as WorkspaceMemberRow[];
}

export function setMerlinWorkspaceBrandPermission(input: {
  workspace_id: string;
  brand_lane: string;
  can_view?: unknown;
  can_create_intake?: unknown;
  can_create_action_cards?: unknown;
  can_request_approval?: unknown;
  can_approve?: unknown;
  can_create_execution_plan?: unknown;
  can_run_dry_run?: unknown;
  can_check_live_gate?: unknown;
}): MerlinWorkspaceBrandPermissionRecord {
  if (!getMerlinWorkspaceById(input.workspace_id)) throw new Error('workspace_not_found');
  const now = nowIso();
  const brand = normalizeBrand(input.brand_lane);
  if (!brand) throw new Error('brand_lane_required');
  const record: MerlinWorkspaceBrandPermissionRecord = {
    id: `merlin-workspace-brand-permission-${randomUUID()}`,
    workspace_id: input.workspace_id,
    brand_lane: brand,
    can_view: asBit(input.can_view),
    can_create_intake: asBit(input.can_create_intake),
    can_create_action_cards: asBit(input.can_create_action_cards),
    can_request_approval: asBit(input.can_request_approval),
    can_approve: asBit(input.can_approve),
    can_create_execution_plan: asBit(input.can_create_execution_plan),
    can_run_dry_run: asBit(input.can_run_dry_run),
    can_check_live_gate: asBit(input.can_check_live_gate),
    created_at: now,
    updated_at: now
  };
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO merlin_workspace_brand_permissions
      (id, workspace_id, brand_lane, can_view, can_create_intake, can_create_action_cards, can_request_approval, can_approve, can_create_execution_plan, can_run_dry_run, can_check_live_gate, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.workspace_id,
      record.brand_lane,
      record.can_view,
      record.can_create_intake,
      record.can_create_action_cards,
      record.can_request_approval,
      record.can_approve,
      record.can_create_execution_plan,
      record.can_run_dry_run,
      record.can_check_live_gate,
      record.created_at,
      record.updated_at
    );
  return record;
}

export function listMerlinWorkspaceBrandPermissions(workspaceId: string): MerlinWorkspaceBrandPermissionRecord[] {
  return getDb()
    .prepare('SELECT * FROM merlin_workspace_brand_permissions WHERE workspace_id = ? ORDER BY brand_lane')
    .all(workspaceId) as BrandPermissionRow[];
}

function getMember(workspaceId: string, operatorId: string): MerlinWorkspaceMemberRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM merlin_workspace_members WHERE workspace_id = ? AND operator_id = ?')
    .get(workspaceId, operatorId) as WorkspaceMemberRow | undefined;
}

function getBrandPermission(workspaceId: string, brandLane: string): MerlinWorkspaceBrandPermissionRecord | undefined {
  return getDb()
    .prepare('SELECT * FROM merlin_workspace_brand_permissions WHERE workspace_id = ? AND brand_lane = ?')
    .get(workspaceId, normalizeBrand(brandLane)) as BrandPermissionRow | undefined;
}

function recordRolePolicyCheck(input: {
  workspace_id: string;
  operator_id: string;
  target_type: string;
  target_id: string;
  action: MerlinRolePolicyAction;
  check_status: MerlinRolePolicyCheckStatus;
  reason: string;
}): MerlinRolePolicyCheckRecord {
  const record: MerlinRolePolicyCheckRecord = {
    id: `merlin-role-policy-check-${randomUUID()}`,
    workspace_id: input.workspace_id,
    operator_id: input.operator_id,
    target_type: input.target_type,
    target_id: input.target_id,
    action: input.action,
    check_status: input.check_status,
    reason: input.reason,
    created_at: nowIso()
  };
  getDb()
    .prepare(
      `INSERT INTO merlin_role_policy_checks
      (id, workspace_id, operator_id, target_type, target_id, action, check_status, reason, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(record.id, record.workspace_id, record.operator_id, record.target_type, record.target_id, record.action, record.check_status, record.reason, record.created_at);
  return record;
}

function inferBrandForTarget(targetType: string, targetId: string): string | undefined {
  if (targetType === 'action_card') return getMerlinActionCardById(targetId)?.brand;
  return undefined;
}

function roleCanApproveTarget(role: MerlinWorkspaceRole, targetType: string, targetId: string): boolean {
  if (role === 'system') return true;
  if (targetType !== 'action_card') return ROLE_ORDER[role] >= ROLE_ORDER.admin;
  const card = getMerlinActionCardById(targetId);
  if (!card) return false;
  const levelRank = permissionLevelRank(card.permission_level);
  if (levelRank >= 4) return ROLE_ORDER[role] >= ROLE_ORDER.super_admin;
  if (levelRank >= 3) return ROLE_ORDER[role] >= ROLE_ORDER.admin;
  if (card.policy_result.requires_approval) return ROLE_ORDER[role] >= ROLE_ORDER.admin;
  return ROLE_ORDER[role] >= ROLE_ORDER.admin;
}

export function runMerlinRolePolicyCheck(input: {
  workspace_id: string;
  operator_id: string;
  target_type: string;
  target_id: string;
  action: MerlinRolePolicyAction;
  brand_lane?: string;
}): MerlinRolePolicyCheckRecord {
  const workspace = getMerlinWorkspaceById(input.workspace_id);
  if (!workspace) {
    return recordRolePolicyCheck({ ...input, check_status: 'workspace_not_found', reason: 'workspace_not_found' });
  }
  if (workspace.status !== 'active') {
    return recordRolePolicyCheck({ ...input, check_status: 'blocked', reason: `workspace_${workspace.status}` });
  }
  const member = getMember(input.workspace_id, input.operator_id);
  if (!member) {
    return recordRolePolicyCheck({ ...input, check_status: 'operator_not_found', reason: 'operator_not_found' });
  }
  if (member.status !== 'active') {
    return recordRolePolicyCheck({ ...input, check_status: 'blocked', reason: `operator_${member.status}` });
  }
  const inferredBrand = input.brand_lane ? normalizeBrand(input.brand_lane) : inferBrandForTarget(input.target_type, input.target_id);
  if (input.target_type === 'action_card' && !getMerlinActionCardById(input.target_id)) {
    return recordRolePolicyCheck({ ...input, check_status: 'target_not_found', reason: 'target_not_found' });
  }
  if (member.role !== 'system') {
    const minRole = MIN_ROLE_BY_ACTION[input.action];
    const rolePass = input.action === 'approve'
      ? roleCanApproveTarget(member.role, input.target_type, input.target_id)
      : ROLE_ORDER[member.role] >= ROLE_ORDER[minRole];
    if (!rolePass) {
      return recordRolePolicyCheck({ ...input, check_status: 'role_denied', reason: `role_${member.role}_cannot_${input.action}` });
    }
  }
  if (inferredBrand) {
    const permission = getBrandPermission(input.workspace_id, inferredBrand);
    const permissionField = ACTION_PERMISSION_FIELD[input.action];
    if (!permission || permission[permissionField] !== 1) {
      return recordRolePolicyCheck({
        ...input,
        check_status: 'brand_denied',
        reason: `brand_${inferredBrand}_${input.action}_denied`
      });
    }
  }
  return recordRolePolicyCheck({ ...input, check_status: 'pass', reason: 'role_policy_passed' });
}

export function listMerlinRolePolicyChecks(filters: {
  workspace_id?: string;
  operator_id?: string;
  status?: MerlinRolePolicyCheckStatus;
  limit?: number;
} = {}): MerlinRolePolicyCheckRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.workspace_id) {
    clauses.push('workspace_id = ?');
    params.push(filters.workspace_id);
  }
  if (filters.operator_id) {
    clauses.push('operator_id = ?');
    params.push(filters.operator_id);
  }
  if (filters.status) {
    clauses.push('check_status = ?');
    params.push(filters.status);
  }
  const limit = Math.max(1, Math.min(500, filters.limit || 100));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb().prepare(`SELECT * FROM merlin_role_policy_checks ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as RolePolicyCheckRow[];
}

export function searchMerlinRolePolicyChecks(query: string, limit = 20): MerlinRolePolicyCheckRecord[] {
  const q = (query || '').trim().toLowerCase();
  const max = Math.max(1, Math.min(100, limit));
  if (!q) return listMerlinRolePolicyChecks({ limit: max });
  return getDb()
    .prepare(
      `SELECT * FROM merlin_role_policy_checks
       WHERE lower(workspace_id) LIKE ?
          OR lower(operator_id) LIKE ?
          OR lower(target_type) LIKE ?
          OR lower(target_id) LIKE ?
          OR lower(action) LIKE ?
          OR lower(check_status) LIKE ?
          OR lower(reason) LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, max) as RolePolicyCheckRow[];
}

initializeMerlinWorkspaceRuntime();
