import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import {
  getMerlinActionCardById,
  updateMerlinActionCardStatus,
  type MerlinActionCardRecord
} from './actionCardRuntime.js';
import { runMerlinRolePolicyCheck } from './workspaceRuntime.js';

export type MerlinApprovalStatus = 'requested' | 'approved' | 'rejected' | 'expired' | 'revoked' | 'blocked';
export type MerlinApprovalLevel = 'operator' | 'admin' | 'owner' | 'super_admin' | 'system_block';

export type MerlinApprovalRecord = {
  id: string;
  action_card_id: string;
  brand_lane: string;
  entity_id?: string;
  kpi: string;
  approval_status: MerlinApprovalStatus;
  approval_level: MerlinApprovalLevel;
  policy_level: string;
  requires_approval: number;
  approved_by?: string;
  approval_reason?: string;
  source_refs: string[];
  expires_at?: string;
  created_at: string;
  updated_at: string;
};

type ApprovalRow = {
  id: string;
  action_card_id: string;
  brand_lane: string;
  entity_id: string | null;
  kpi: string;
  approval_status: MerlinApprovalStatus;
  approval_level: MerlinApprovalLevel;
  policy_level: string;
  requires_approval: number;
  approved_by: string | null;
  approval_reason: string | null;
  source_refs_json: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

type ApprovalHistoryRow = {
  id: string;
  approval_id: string;
  event_type: 'requested' | 'decision';
  approval_status: MerlinApprovalStatus;
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
  if (!db) initializeMerlinApprovalRuntime();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function mapApproval(row: ApprovalRow): MerlinApprovalRecord {
  return {
    id: row.id,
    action_card_id: row.action_card_id,
    brand_lane: row.brand_lane,
    entity_id: row.entity_id || undefined,
    kpi: row.kpi,
    approval_status: row.approval_status,
    approval_level: row.approval_level,
    policy_level: row.policy_level,
    requires_approval: row.requires_approval,
    approved_by: row.approved_by || undefined,
    approval_reason: row.approval_reason || undefined,
    source_refs: JSON.parse(row.source_refs_json) as string[],
    expires_at: row.expires_at || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function appendHistory(approvalId: string, eventType: 'requested' | 'decision', status: MerlinApprovalStatus, payload: Record<string, unknown>): void {
  getDb()
    .prepare(
      `INSERT INTO merlin_approval_history
      (id, approval_id, event_type, approval_status, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(`merlin-approval-history-${randomUUID()}`, approvalId, eventType, status, JSON.stringify(payload), nowIso());
}

function permissionNeedsApproval(card: MerlinActionCardRecord): boolean {
  return card.permission_level === 'level_3' || card.permission_level === 'level_4';
}

function defaultApprovalLevel(card: MerlinActionCardRecord): MerlinApprovalLevel {
  if (card.policy_result.blocked) return 'system_block';
  if (card.permission_level === 'level_4') return 'super_admin';
  if (card.permission_level === 'level_3') return 'admin';
  return 'operator';
}

function approvalIsExpired(row: MerlinApprovalRecord): boolean {
  return Boolean(row.expires_at && Date.parse(row.expires_at) <= Date.now());
}

export function initializeMerlinApprovalRuntime(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS merlin_approvals (
      id TEXT PRIMARY KEY,
      action_card_id TEXT NOT NULL,
      brand_lane TEXT NOT NULL,
      entity_id TEXT,
      kpi TEXT NOT NULL,
      approval_status TEXT NOT NULL,
      approval_level TEXT NOT NULL,
      policy_level TEXT NOT NULL,
      requires_approval INTEGER NOT NULL,
      approved_by TEXT,
      approval_reason TEXT,
      source_refs_json TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_approvals_card_idx ON merlin_approvals(action_card_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS merlin_approvals_brand_status_idx ON merlin_approvals(brand_lane, approval_status, created_at DESC);

    CREATE TABLE IF NOT EXISTS merlin_approval_history (
      id TEXT PRIMARY KEY,
      approval_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      approval_status TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_approval_history_idx ON merlin_approval_history(approval_id, created_at DESC);
  `);
  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function closeMerlinApprovalRuntime(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetMerlinApprovalRuntimeForTest(): void {
  const dbi = getDb();
  dbi.prepare('DELETE FROM merlin_approval_history').run();
  dbi.prepare('DELETE FROM merlin_approvals').run();
}

export function requestMerlinApproval(input: { action_card_id: string; expires_at?: string; workspace_id?: string; operator_id?: string }): MerlinApprovalRecord {
  const card = getMerlinActionCardById(input.action_card_id);
  if (!card) throw new Error('action_card_not_found');
  if (input.workspace_id || input.operator_id) {
    if (!input.workspace_id || !input.operator_id) throw new Error('workspace_id_and_operator_id_required');
    const check = runMerlinRolePolicyCheck({
      workspace_id: input.workspace_id,
      operator_id: input.operator_id,
      target_type: 'action_card',
      target_id: card.id,
      action: 'request_approval'
    });
    if (check.check_status !== 'pass') throw new Error(`role_policy_${check.check_status}`);
  }
  const requiresApproval = card.policy_result.requires_approval || card.policy_result.blocked || permissionNeedsApproval(card);
  if (!requiresApproval) throw new Error('approval_not_required');
  const now = nowIso();
  const status: MerlinApprovalStatus = card.policy_result.blocked ? 'blocked' : 'requested';
  const approval: MerlinApprovalRecord = {
    id: `merlin-approval-${randomUUID()}`,
    action_card_id: card.id,
    brand_lane: card.brand,
    entity_id: card.entity_id,
    kpi: card.kpi,
    approval_status: status,
    approval_level: defaultApprovalLevel(card),
    policy_level: card.policy_result.level,
    requires_approval: requiresApproval ? 1 : 0,
    source_refs: card.source_refs || [],
    expires_at: input.expires_at,
    created_at: now,
    updated_at: now
  };
  getDb()
    .prepare(
      `INSERT INTO merlin_approvals
      (id, action_card_id, brand_lane, entity_id, kpi, approval_status, approval_level, policy_level, requires_approval, approved_by, approval_reason, source_refs_json, expires_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      approval.id,
      approval.action_card_id,
      approval.brand_lane,
      approval.entity_id || null,
      approval.kpi,
      approval.approval_status,
      approval.approval_level,
      approval.policy_level,
      approval.requires_approval,
      null,
      null,
      JSON.stringify(approval.source_refs),
      approval.expires_at || null,
      approval.created_at,
      approval.updated_at
    );
  appendHistory(approval.id, 'requested', approval.approval_status, {
    action_card_id: card.id,
    policy_level: card.policy_result.level,
    policy_blocked: card.policy_result.blocked
  });
  return approval;
}

export function getMerlinApprovalById(id: string): MerlinApprovalRecord | undefined {
  const row = getDb().prepare('SELECT * FROM merlin_approvals WHERE id = ?').get(id) as ApprovalRow | undefined;
  return row ? mapApproval(row) : undefined;
}

export function listMerlinApprovals(filters: { brand_lane?: string; status?: MerlinApprovalStatus; entity_id?: string; limit?: number } = {}): MerlinApprovalRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.brand_lane) {
    clauses.push('brand_lane = ?');
    params.push(filters.brand_lane.trim().toLowerCase());
  }
  if (filters.status) {
    clauses.push('approval_status = ?');
    params.push(filters.status);
  }
  if (filters.entity_id) {
    clauses.push('entity_id = ?');
    params.push(filters.entity_id);
  }
  const limit = Math.max(1, Math.min(500, filters.limit || 100));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return (getDb().prepare(`SELECT * FROM merlin_approvals ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as ApprovalRow[]).map(mapApproval);
}

export function decideMerlinApproval(input: {
  approval_id: string;
  decision: 'approved' | 'rejected' | 'revoked';
  decided_by?: string;
  reason?: string;
  workspace_id?: string;
  operator_id?: string;
}): MerlinApprovalRecord {
  const approval = getMerlinApprovalById(input.approval_id);
  if (!approval) throw new Error('approval_not_found');
  if (approval.approval_status === 'blocked') throw new Error('blocked_approval_cannot_be_approved');
  if (approval.approval_status === 'expired' || approvalIsExpired(approval)) throw new Error('expired_approval_cannot_be_approved');
  const reason = String(input.reason || '').trim();
  const decidedBy = String(input.decided_by || '').trim();
  if (input.workspace_id || input.operator_id) {
    if (!input.workspace_id || !input.operator_id) throw new Error('workspace_id_and_operator_id_required');
    const actionCard = getMerlinActionCardById(approval.action_card_id);
    if (!actionCard) throw new Error('action_card_not_found');
    const check = runMerlinRolePolicyCheck({
      workspace_id: input.workspace_id,
      operator_id: input.operator_id,
      target_type: 'action_card',
      target_id: actionCard.id,
      action: 'approve'
    });
    if (check.check_status !== 'pass') throw new Error(`role_policy_${check.check_status}`);
  }
  if (input.decision === 'approved' && (!decidedBy || !reason)) throw new Error('approved_requires_decided_by_and_reason');
  if ((input.decision === 'rejected' || input.decision === 'revoked') && !reason) throw new Error(`${input.decision}_requires_reason`);
  const nextStatus = input.decision;
  getDb()
    .prepare('UPDATE merlin_approvals SET approval_status = ?, approved_by = ?, approval_reason = ?, updated_at = ? WHERE id = ?')
    .run(nextStatus, decidedBy || null, reason || null, nowIso(), approval.id);
  appendHistory(approval.id, 'decision', nextStatus, { decision: input.decision, decided_by: decidedBy || null, reason });

  const nextCardStatus = nextStatus === 'approved' ? 'approved' : nextStatus === 'rejected' ? 'rejected' : 'deferred';
  updateMerlinActionCardStatus(approval.action_card_id, {
    status: nextCardStatus,
    reason: `approval:${approval.id}:${nextStatus}`,
    decided_by: decidedBy,
    event_type: 'decision'
  });
  return getMerlinApprovalById(approval.id) as MerlinApprovalRecord;
}

export function getMerlinApprovalHistory(approvalId: string): Array<{
  id: string;
  approval_id: string;
  event_type: string;
  approval_status: MerlinApprovalStatus;
  payload: Record<string, unknown>;
  created_at: string;
}> {
  const rows = getDb()
    .prepare('SELECT * FROM merlin_approval_history WHERE approval_id = ? ORDER BY created_at DESC')
    .all(approvalId) as ApprovalHistoryRow[];
  return rows.map((row) => ({
    id: row.id,
    approval_id: row.approval_id,
    event_type: row.event_type,
    approval_status: row.approval_status,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    created_at: row.created_at
  }));
}

export function getMerlinActionCardApprovalState(actionCardId: string): {
  status: 'ok';
  action_card_id: string;
  requiresApproval: boolean;
  approvalStatus: MerlinApprovalStatus | 'none';
  executionEligible: boolean;
  reason: string;
  approval?: MerlinApprovalRecord;
} {
  const card = getMerlinActionCardById(actionCardId);
  if (!card) throw new Error('action_card_not_found');
  const requiresApproval = card.policy_result.requires_approval || card.policy_result.blocked || permissionNeedsApproval(card);
  const approvals = listMerlinApprovals({ limit: 100 }).filter((row) => row.action_card_id === actionCardId);
  const approval = approvals[0];
  const approvalStatus = approval ? (approvalIsExpired(approval) ? 'expired' : approval.approval_status) : 'none';
  let executionEligible = false;
  let reason = requiresApproval ? 'approval_required' : 'approval_not_required';
  if (card.policy_result.blocked) {
    reason = 'policy_blocked';
  } else if (requiresApproval && !approval) {
    reason = 'approval_required';
  } else if (approvalStatus === 'expired') {
    reason = 'approval_expired';
  } else if (approvalStatus !== 'approved' && requiresApproval) {
    reason = `approval_${approvalStatus}`;
  } else {
    executionEligible = true;
    reason = 'approved';
  }
  return {
    status: 'ok',
    action_card_id: actionCardId,
    requiresApproval,
    approvalStatus,
    executionEligible,
    reason,
    approval
  };
}

export function searchMerlinApprovals(query: string, limit = 20): MerlinApprovalRecord[] {
  const q = (query || '').trim().toLowerCase();
  const max = Math.max(1, Math.min(100, limit));
  if (!q) return listMerlinApprovals({ limit: max });
  const rows = getDb()
    .prepare(
      `SELECT * FROM merlin_approvals
       WHERE lower(brand_lane) LIKE ?
          OR lower(kpi) LIKE ?
          OR lower(approval_status) LIKE ?
          OR lower(approval_level) LIKE ?
          OR lower(ifnull(approved_by,'')) LIKE ?
          OR lower(ifnull(approval_reason,'')) LIKE ?
       ORDER BY created_at DESC LIMIT ?`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, max) as ApprovalRow[];
  return rows.map(mapApproval);
}

initializeMerlinApprovalRuntime();
