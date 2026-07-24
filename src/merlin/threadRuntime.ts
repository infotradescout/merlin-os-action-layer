import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';

export type MerlinThreadStatus = 'open' | 'waiting_for_user' | 'ready_for_preview' | 'closed';
export type MerlinThreadMessageRole = 'user' | 'assistant' | 'system';

export type MerlinThreadRecord = {
  id: string;
  workspace_id: string;
  title: string;
  status: MerlinThreadStatus;
  brand?: string;
  actor_scope?: string;
  entity_type?: string;
  entity_id?: string;
  action_id?: string;
  latest_upload_intent_id?: string;
  latest_preview_upload_intent_id?: string;
  created_at: string;
  updated_at: string;
};

export type MerlinThreadMessageRecord = {
  id: string;
  thread_id: string;
  role: MerlinThreadMessageRole;
  message_text: string;
  attachments: Array<{
    fileId: string;
    fileName?: string;
    mimeType?: string;
    extractedText?: string;
    metadata?: Record<string, unknown>;
  }>;
  metadata: Record<string, unknown>;
  linked_upload_intent_id?: string;
  created_at: string;
};

type ThreadRow = {
  id: string;
  workspace_id: string;
  title: string;
  status: MerlinThreadStatus;
  brand: string | null;
  actor_scope: string | null;
  entity_type: string | null;
  entity_id: string | null;
  action_id: string | null;
  latest_upload_intent_id: string | null;
  latest_preview_upload_intent_id: string | null;
  created_at: string;
  updated_at: string;
};

type ThreadMessageRow = {
  id: string;
  thread_id: string;
  role: MerlinThreadMessageRole;
  message_text: string;
  attachments_json: string;
  metadata_json: string;
  linked_upload_intent_id: string | null;
  created_at: string;
};

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';

let db: Database.Database | null = null;
let dbPath: string | null = null;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) initializeMerlinThreadRuntime();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asOptionalText(value: unknown): string | undefined {
  const text = String(value || '').trim();
  return text || undefined;
}

function normalizeStatus(value: unknown): MerlinThreadStatus {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'open' || status === 'waiting_for_user' || status === 'ready_for_preview' || status === 'closed') return status;
  return 'open';
}

function mapThread(row: ThreadRow): MerlinThreadRecord {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    title: row.title,
    status: row.status,
    brand: row.brand || undefined,
    actor_scope: row.actor_scope || undefined,
    entity_type: row.entity_type || undefined,
    entity_id: row.entity_id || undefined,
    action_id: row.action_id || undefined,
    latest_upload_intent_id: row.latest_upload_intent_id || undefined,
    latest_preview_upload_intent_id: row.latest_preview_upload_intent_id || undefined,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function mapMessage(row: ThreadMessageRow): MerlinThreadMessageRecord {
  return {
    id: row.id,
    thread_id: row.thread_id,
    role: row.role,
    message_text: row.message_text,
    attachments: JSON.parse(row.attachments_json) as MerlinThreadMessageRecord['attachments'],
    metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
    linked_upload_intent_id: row.linked_upload_intent_id || undefined,
    created_at: row.created_at
  };
}

export function initializeMerlinThreadRuntime(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS merlin_threads (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      brand TEXT,
      actor_scope TEXT,
      entity_type TEXT,
      entity_id TEXT,
      action_id TEXT,
      latest_upload_intent_id TEXT,
      latest_preview_upload_intent_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_threads_workspace_idx ON merlin_threads(workspace_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS merlin_threads_status_idx ON merlin_threads(status, updated_at DESC);

    CREATE TABLE IF NOT EXISTS merlin_thread_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      role TEXT NOT NULL,
      message_text TEXT NOT NULL,
      attachments_json TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      linked_upload_intent_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_thread_messages_thread_idx ON merlin_thread_messages(thread_id, created_at ASC);
  `);
  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function closeMerlinThreadRuntime(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetMerlinThreadRuntimeForTest(): void {
  const dbi = getDb();
  dbi.prepare('DELETE FROM merlin_thread_messages').run();
  dbi.prepare('DELETE FROM merlin_threads').run();
}

export function createMerlinThread(input: {
  workspace_id: string;
  title?: string;
  status?: unknown;
  brand?: string;
  actor_scope?: string;
  entity_type?: string;
  entity_id?: string;
  action_id?: string;
}): MerlinThreadRecord {
  const now = nowIso();
  const record: MerlinThreadRecord = {
    id: `merlin-thread-${randomUUID()}`,
    workspace_id: String(input.workspace_id || '').trim(),
    title: asOptionalText(input.title) || 'New Merlin thread',
    status: normalizeStatus(input.status),
    brand: asOptionalText(input.brand)?.toUpperCase(),
    actor_scope: asOptionalText(input.actor_scope)?.toLowerCase(),
    entity_type: asOptionalText(input.entity_type)?.toLowerCase(),
    entity_id: asOptionalText(input.entity_id),
    action_id: asOptionalText(input.action_id),
    latest_upload_intent_id: undefined,
    latest_preview_upload_intent_id: undefined,
    created_at: now,
    updated_at: now
  };
  if (!record.workspace_id) throw new Error('workspace_id_required');
  getDb()
    .prepare(
      `INSERT INTO merlin_threads
      (id, workspace_id, title, status, brand, actor_scope, entity_type, entity_id, action_id, latest_upload_intent_id, latest_preview_upload_intent_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      record.id,
      record.workspace_id,
      record.title,
      record.status,
      record.brand || null,
      record.actor_scope || null,
      record.entity_type || null,
      record.entity_id || null,
      record.action_id || null,
      null,
      null,
      record.created_at,
      record.updated_at
    );
  return record;
}

export function listMerlinThreads(filters: {
  workspace_id: string;
  status?: MerlinThreadStatus;
  limit?: number;
}): MerlinThreadRecord[] {
  const clauses = ['workspace_id = ?'];
  const params: Array<string | number> = [filters.workspace_id];
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  const limit = Math.max(1, Math.min(200, filters.limit || 50));
  params.push(limit);
  return (getDb()
    .prepare(`SELECT * FROM merlin_threads WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT ?`)
    .all(...params) as ThreadRow[]).map(mapThread);
}

export function getMerlinThreadById(id: string): MerlinThreadRecord | undefined {
  const row = getDb().prepare('SELECT * FROM merlin_threads WHERE id = ?').get(id) as ThreadRow | undefined;
  return row ? mapThread(row) : undefined;
}

export function listMerlinThreadMessages(threadId: string): MerlinThreadMessageRecord[] {
  return (getDb()
    .prepare('SELECT * FROM merlin_thread_messages WHERE thread_id = ? ORDER BY created_at ASC')
    .all(threadId) as ThreadMessageRow[]).map(mapMessage);
}

export function appendMerlinThreadMessage(input: {
  thread_id: string;
  role: MerlinThreadMessageRole;
  message_text: string;
  attachments?: MerlinThreadMessageRecord['attachments'];
  metadata?: Record<string, unknown>;
  linked_upload_intent_id?: string;
}): MerlinThreadMessageRecord {
  const thread = getMerlinThreadById(input.thread_id);
  if (!thread) throw new Error('thread_not_found');
  const message: MerlinThreadMessageRecord = {
    id: `merlin-thread-message-${randomUUID()}`,
    thread_id: input.thread_id,
    role: input.role,
    message_text: String(input.message_text || '').trim(),
    attachments: Array.isArray(input.attachments) ? input.attachments : [],
    metadata: input.metadata || {},
    linked_upload_intent_id: asOptionalText(input.linked_upload_intent_id),
    created_at: nowIso()
  };
  if (!message.message_text && message.attachments.length === 0) throw new Error('message_or_attachment_required');
  getDb()
    .prepare(
      `INSERT INTO merlin_thread_messages
      (id, thread_id, role, message_text, attachments_json, metadata_json, linked_upload_intent_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      message.id,
      message.thread_id,
      message.role,
      message.message_text,
      JSON.stringify(message.attachments),
      JSON.stringify(message.metadata),
      message.linked_upload_intent_id || null,
      message.created_at
    );
  const nextTitle = thread.title === 'New Merlin thread' && message.role === 'user'
    ? (message.message_text.slice(0, 72) || thread.title)
    : thread.title;
  getDb()
    .prepare('UPDATE merlin_threads SET title = ?, updated_at = ? WHERE id = ?')
    .run(nextTitle, message.created_at, thread.id);
  return message;
}

export function updateMerlinThreadState(input: {
  thread_id: string;
  status?: unknown;
  brand?: string;
  actor_scope?: string;
  entity_type?: string;
  entity_id?: string;
  action_id?: string;
  latest_upload_intent_id?: string;
  latest_preview_upload_intent_id?: string;
}): MerlinThreadRecord {
  const current = getMerlinThreadById(input.thread_id);
  if (!current) throw new Error('thread_not_found');
  const next: MerlinThreadRecord = {
    ...current,
    status: input.status ? normalizeStatus(input.status) : current.status,
    brand: asOptionalText(input.brand)?.toUpperCase() || current.brand,
    actor_scope: asOptionalText(input.actor_scope)?.toLowerCase() || current.actor_scope,
    entity_type: asOptionalText(input.entity_type)?.toLowerCase() || current.entity_type,
    entity_id: asOptionalText(input.entity_id) || current.entity_id,
    action_id: asOptionalText(input.action_id) || current.action_id,
    latest_upload_intent_id: asOptionalText(input.latest_upload_intent_id) || current.latest_upload_intent_id,
    latest_preview_upload_intent_id: asOptionalText(input.latest_preview_upload_intent_id) || current.latest_preview_upload_intent_id,
    updated_at: nowIso()
  };
  getDb()
    .prepare(
      `UPDATE merlin_threads
       SET status = ?, brand = ?, actor_scope = ?, entity_type = ?, entity_id = ?, action_id = ?, latest_upload_intent_id = ?, latest_preview_upload_intent_id = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(
      next.status,
      next.brand || null,
      next.actor_scope || null,
      next.entity_type || null,
      next.entity_id || null,
      next.action_id || null,
      next.latest_upload_intent_id || null,
      next.latest_preview_upload_intent_id || null,
      next.updated_at,
      next.id
    );
  return next;
}

initializeMerlinThreadRuntime();
