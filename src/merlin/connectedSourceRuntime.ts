import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { getRegisteredSources } from '../sourceRegistry.js';

export type MerlinConnectedSourceStatus = 'connected' | 'needs_auth' | 'disconnected';
export type MerlinConnectedSourceAuthKind = 'oauth' | 'api_key' | 'manual' | 'internal';

export type MerlinConnectedSourceRecord = {
  id: string;
  workspace_id: string;
  source_key: string;
  source_label: string;
  source_type: string;
  connection_status: MerlinConnectedSourceStatus;
  auth_kind: MerlinConnectedSourceAuthKind;
  capabilities: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

type ConnectedSourceRow = {
  id: string;
  workspace_id: string;
  source_key: string;
  source_label: string;
  source_type: string;
  connection_status: MerlinConnectedSourceStatus;
  auth_kind: MerlinConnectedSourceAuthKind;
  capabilities_json: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
};

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';

let db: Database.Database | null = null;
let dbPath: string | null = null;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) initializeMerlinConnectedSourceRuntime();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_');
}

function normalizeStatus(value: unknown): MerlinConnectedSourceStatus {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'connected' || status === 'needs_auth' || status === 'disconnected') return status;
  return 'needs_auth';
}

function normalizeAuthKind(value: unknown): MerlinConnectedSourceAuthKind {
  const kind = String(value || '').trim().toLowerCase();
  if (kind === 'oauth' || kind === 'api_key' || kind === 'manual' || kind === 'internal') return kind;
  return 'manual';
}

function normalizeCapabilities(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return Array.from(
    new Set(
      input
        .map((value) => String(value || '').trim())
        .filter(Boolean)
    )
  );
}

function mapRow(row: ConnectedSourceRow): MerlinConnectedSourceRecord {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    source_key: row.source_key,
    source_label: row.source_label,
    source_type: row.source_type,
    connection_status: row.connection_status,
    auth_kind: row.auth_kind,
    capabilities: JSON.parse(row.capabilities_json) as string[],
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function inferDefaultCapabilities(sourceType: string): string[] {
  switch (sourceType) {
    case 'drive':
      return ['read_files', 'route_files', 'review_evidence'];
    case 'gmail':
      return ['read_threads', 'draft_replies', 'search_mail'];
    case 'calendar':
      return ['read_events', 'draft_schedule_changes'];
    case 'github':
      return ['read_repo', 'draft_changes'];
    case 'canva':
      return ['read_designs', 'draft_design_changes'];
    case 'app':
      return ['read_product_context', 'start_intents'];
    case 'web':
      return ['inspect_reference'];
    default:
      return ['read_context'];
  }
}

function seedDefaultConnectedSources(): void {
  const now = nowIso();
  const stmt = getDb().prepare(
    `INSERT OR IGNORE INTO merlin_connected_sources
    (id, workspace_id, source_key, source_label, source_type, connection_status, auth_kind, capabilities_json, metadata_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const source of getRegisteredSources()) {
    stmt.run(
      `merlin-connected-source-system-${source.id}`,
      'merlin-workspace-system',
      source.id,
      source.name,
      source.type,
      source.active ? 'connected' : 'disconnected',
      source.type === 'app' ? 'internal' : 'manual',
      JSON.stringify(inferDefaultCapabilities(source.type)),
      JSON.stringify({
        aliases: source.aliases,
        trustLevel: source.trustLevel,
        notes: source.notes || null
      }),
      now,
      now
    );
  }
}

export function initializeMerlinConnectedSourceRuntime(explicitPath?: string): string {
  const nextPath = resolveDbPath(explicitPath);
  if (dbPath === nextPath && db) return nextPath;
  if (db) {
    db.close();
    db = null;
  }
  mkdirSync(dirname(nextPath), { recursive: true });
  const nextDb = new Database(nextPath);
  nextDb.pragma('journal_mode = WAL');
  db = nextDb;
  dbPath = nextPath;
  nextDb.exec(`
    CREATE TABLE IF NOT EXISTS merlin_connected_sources (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      source_key TEXT NOT NULL,
      source_label TEXT NOT NULL,
      source_type TEXT NOT NULL,
      connection_status TEXT NOT NULL,
      auth_kind TEXT NOT NULL,
      capabilities_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS merlin_connected_sources_workspace_key_idx
      ON merlin_connected_sources(workspace_id, source_key);
    CREATE INDEX IF NOT EXISTS merlin_connected_sources_workspace_idx
      ON merlin_connected_sources(workspace_id, updated_at DESC);
  `);
  seedDefaultConnectedSources();
  return nextPath;
}

export function closeMerlinConnectedSourceRuntime(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetMerlinConnectedSourceRuntimeForTest(): void {
  const dbi = getDb();
  dbi.prepare('DELETE FROM merlin_connected_sources').run();
  seedDefaultConnectedSources();
}

export function listMerlinConnectedSources(workspaceId: string): MerlinConnectedSourceRecord[] {
  return (getDb()
    .prepare('SELECT * FROM merlin_connected_sources WHERE workspace_id = ? ORDER BY updated_at DESC, source_label')
    .all(workspaceId) as ConnectedSourceRow[]).map(mapRow);
}

export function upsertMerlinConnectedSource(input: {
  workspace_id: string;
  source_key: string;
  source_label?: string;
  source_type?: string;
  connection_status?: unknown;
  auth_kind?: unknown;
  capabilities?: unknown;
  metadata?: Record<string, unknown>;
}): MerlinConnectedSourceRecord {
  const workspaceId = String(input.workspace_id || '').trim();
  const sourceKey = normalizeKey(input.source_key);
  if (!workspaceId) throw new Error('workspace_id_required');
  if (!sourceKey) throw new Error('source_key_required');

  const existing = getDb()
    .prepare('SELECT * FROM merlin_connected_sources WHERE workspace_id = ? AND source_key = ?')
    .get(workspaceId, sourceKey) as ConnectedSourceRow | undefined;

  const now = nowIso();
  const sourceType = String(input.source_type || existing?.source_type || 'app').trim().toLowerCase();
  const capabilities = normalizeCapabilities(input.capabilities);
  const record: MerlinConnectedSourceRecord = {
    id: existing?.id || `merlin-connected-source-${randomUUID()}`,
    workspace_id: workspaceId,
    source_key: sourceKey,
    source_label: String(input.source_label || existing?.source_label || sourceKey).trim() || sourceKey,
    source_type: sourceType,
    connection_status: normalizeStatus(input.connection_status ?? existing?.connection_status),
    auth_kind: normalizeAuthKind(input.auth_kind ?? existing?.auth_kind),
    capabilities: capabilities.length ? capabilities : existing ? JSON.parse(existing.capabilities_json) as string[] : inferDefaultCapabilities(sourceType),
    metadata: input.metadata || (existing ? JSON.parse(existing.metadata_json) as Record<string, unknown> : {}),
    created_at: existing?.created_at || now,
    updated_at: now
  };

  getDb()
    .prepare(
      `INSERT OR REPLACE INTO merlin_connected_sources
      (id, workspace_id, source_key, source_label, source_type, connection_status, auth_kind, capabilities_json, metadata_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.workspace_id,
      record.source_key,
      record.source_label,
      record.source_type,
      record.connection_status,
      record.auth_kind,
      JSON.stringify(record.capabilities),
      JSON.stringify(record.metadata),
      record.created_at,
      record.updated_at
    );

  return record;
}

initializeMerlinConnectedSourceRuntime();
