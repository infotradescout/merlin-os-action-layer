import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { getMerlinIntakeItemById, updateMerlinIntakeEntityResolution } from './intakeRuntime.js';

export type MerlinEntityStatus = 'active' | 'needs_review' | 'merged' | 'blocked';
export type MerlinConflictStatus = 'open' | 'acknowledged' | 'resolved' | 'false_positive';
export type MerlinIdentifierType =
  | 'email'
  | 'phone'
  | 'domain'
  | 'social'
  | 'drive_file_id'
  | 'github_repo'
  | 'calendar_event'
  | 'stripe_object'
  | 'name_location'
  | 'external_id';
export type MerlinResolutionStatus = 'resolved' | 'new_entity' | 'needs_review' | 'conflict' | 'blocked';

export type MerlinEntityRecord = {
  id: string;
  entity_type: string;
  canonical_name: string;
  brand_lane: string;
  confidence: number;
  status: MerlinEntityStatus;
  created_at: string;
  updated_at: string;
};

export type MerlinSourceObservation = {
  id: string;
  source_type: string;
  source_reference: string;
  origin_surface: string;
  trust_level: number;
  active: number;
  observed_at: string;
  notes: string;
};

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
const TRUST_BY_SOURCE: Record<string, number> = {
  app: 0.95,
  drive: 0.75,
  gmail: 0.7,
  calendar: 0.8,
  github: 0.85,
  manual: 0.6,
  web: 0.45,
  voice: 0.5,
  upload: 0.55
};
let db: Database.Database | null = null;
let dbPath: string | null = null;

type EntityRow = MerlinEntityRecord;

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) initializeMerlinEntityMemoryRuntime();
  return db as Database.Database;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(input: unknown): string {
  return String(input || '').trim();
}

function normalizeName(input: unknown): string {
  return normalizeText(input).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizePhone(input: unknown): string {
  return normalizeText(input).replace(/[^0-9]/g, '');
}

function normalizeEmail(input: unknown): string {
  return normalizeText(input).toLowerCase();
}

function normalizeDomain(input: unknown): string {
  const text = normalizeText(input).toLowerCase();
  return text.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] || text;
}

function normalizeSocial(input: unknown): string {
  return normalizeText(input).toLowerCase().replace(/^@/, '');
}

function normalizeLocation(input: unknown): string {
  return normalizeText(input).toLowerCase();
}

function extractIdentifierSignals(intake: ReturnType<typeof getMerlinIntakeItemById>): Array<{ type: MerlinIdentifierType; value: string; confidence: number }> {
  if (!intake) return [];
  const fields = intake.extracted_fields || {};
  const entity = intake.entity_candidate || {};
  const out: Array<{ type: MerlinIdentifierType; value: string; confidence: number }> = [];
  const add = (type: MerlinIdentifierType, value: string, confidence = intake.confidence || 0.5) => {
    const v = normalizeText(value);
    if (v) out.push({ type, value: v, confidence: Math.max(0, Math.min(1, confidence)) });
  };

  const externalId = normalizeText((entity as Record<string, unknown>).external_id || (fields as Record<string, unknown>).external_id);
  if (externalId) add('external_id', externalId, 0.95);
  const email = normalizeEmail((fields as Record<string, unknown>).email || (entity as Record<string, unknown>).email);
  if (email) add('email', email, 0.92);
  const phone = normalizePhone((fields as Record<string, unknown>).phone || (entity as Record<string, unknown>).phone);
  if (phone) add('phone', phone, 0.9);
  const domain = normalizeDomain((fields as Record<string, unknown>).website || (entity as Record<string, unknown>).website || (fields as Record<string, unknown>).domain);
  if (domain) add('domain', domain, 0.86);
  const social = normalizeSocial(
    (fields as Record<string, unknown>).socialHandle ||
      (fields as Record<string, unknown>).social ||
      (entity as Record<string, unknown>).social ||
      (entity as Record<string, unknown>).socialHandle
  );
  if (social) add('social', social, 0.82);

  const name = normalizeName((fields as Record<string, unknown>).businessName || (fields as Record<string, unknown>).truckName || (entity as Record<string, unknown>).name);
  const city = normalizeLocation((fields as Record<string, unknown>).cityArea || (fields as Record<string, unknown>).location || (entity as Record<string, unknown>).location);
  if (name && city) add('name_location', `${name}:${city}`, 0.68);

  if (intake.source_type === 'drive') add('drive_file_id', intake.source_reference, 0.75);
  if (intake.source_type === 'github') add('github_repo', intake.source_reference, 0.8);
  if (intake.source_type === 'calendar') add('calendar_event', intake.source_reference, 0.8);

  const dedup = new Map<string, { type: MerlinIdentifierType; value: string; confidence: number }>();
  for (const signal of out) dedup.set(`${signal.type}:${signal.value}`, signal);
  return Array.from(dedup.values());
}

function appendEntityHistory(entityId: string, eventType: string, payload: Record<string, unknown>): void {
  getDb()
    .prepare(
      `INSERT INTO merlin_entity_history
      (id, entity_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)`
    )
    .run(`merlin-entity-history-${randomUUID()}`, entityId, eventType, JSON.stringify(payload), nowIso());
}

function createEntity(input: {
  brand_lane: string;
  entity_type: string;
  canonical_name: string;
  confidence: number;
  status: MerlinEntityStatus;
}): MerlinEntityRecord {
  const now = nowIso();
  const entity: MerlinEntityRecord = {
    id: `merlin-entity-${randomUUID()}`,
    entity_type: input.entity_type || 'unknown',
    canonical_name: input.canonical_name || 'Unknown',
    brand_lane: input.brand_lane,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    status: input.status,
    created_at: now,
    updated_at: now
  };
  getDb()
    .prepare(
      `INSERT INTO merlin_entities
      (id, entity_type, canonical_name, brand_lane, confidence, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(entity.id, entity.entity_type, entity.canonical_name, entity.brand_lane, entity.confidence, entity.status, entity.created_at, entity.updated_at);
  appendEntityHistory(entity.id, 'entity_created', { brand_lane: entity.brand_lane, canonical_name: entity.canonical_name });
  return entity;
}

function addEntityIdentifier(entityId: string, type: MerlinIdentifierType, value: string, sourceReference: string, confidence: number): void {
  getDb()
    .prepare(
      `INSERT INTO merlin_entity_identifiers
      (id, entity_id, identifier_type, identifier_value, source_reference, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(`merlin-entity-identifier-${randomUUID()}`, entityId, type, value, sourceReference, confidence, nowIso());
}

function addEntityAlias(entityId: string, alias: string, sourceReference: string, confidence: number): void {
  const clean = normalizeText(alias);
  if (!clean) return;
  getDb()
    .prepare(
      `INSERT INTO merlin_entity_aliases
      (id, entity_id, alias, source_reference, confidence, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(`merlin-entity-alias-${randomUUID()}`, entityId, clean, sourceReference, confidence, nowIso());
}

function createConflict(entityId: string, conflictType: string, summary: string, sourceReference: string): void {
  getDb()
    .prepare(
      `INSERT INTO merlin_entity_conflicts
      (id, entity_id, conflict_type, summary, source_reference, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(`merlin-entity-conflict-${randomUUID()}`, entityId, conflictType, summary, sourceReference, 'open', nowIso(), nowIso());
  appendEntityHistory(entityId, 'conflict_created', { conflict_type: conflictType, summary, source_reference: sourceReference });
}

function findEntitiesByIdentifier(type: MerlinIdentifierType, value: string): MerlinEntityRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT e.*
       FROM merlin_entities e
       JOIN merlin_entity_identifiers i ON i.entity_id = e.id
       WHERE i.identifier_type = ? AND i.identifier_value = ?`
    )
    .all(type, value) as EntityRow[];
  return rows;
}

export function initializeMerlinEntityMemoryRuntime(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS merlin_entities (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      canonical_name TEXT NOT NULL,
      brand_lane TEXT NOT NULL,
      confidence REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS merlin_entity_identifiers (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      identifier_type TEXT NOT NULL,
      identifier_value TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_entity_identifiers_lookup_idx ON merlin_entity_identifiers(identifier_type, identifier_value);

    CREATE TABLE IF NOT EXISTS merlin_entity_aliases (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      alias TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS merlin_entity_conflicts (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      conflict_type TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS merlin_source_observations (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_reference TEXT NOT NULL,
      origin_surface TEXT NOT NULL,
      trust_level REAL NOT NULL,
      active INTEGER NOT NULL,
      observed_at TEXT NOT NULL,
      notes TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS merlin_entity_history (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS merlin_entity_history_entity_idx ON merlin_entity_history(entity_id, created_at DESC);
  `);
  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function closeMerlinEntityMemoryRuntime(): void {
  if (!db) return;
  db.close();
  db = null;
  dbPath = null;
}

export function resetMerlinEntityMemoryRuntimeForTest(): void {
  const dbi = getDb();
  dbi.prepare('DELETE FROM merlin_entity_history').run();
  dbi.prepare('DELETE FROM merlin_source_observations').run();
  dbi.prepare('DELETE FROM merlin_entity_conflicts').run();
  dbi.prepare('DELETE FROM merlin_entity_aliases').run();
  dbi.prepare('DELETE FROM merlin_entity_identifiers').run();
  dbi.prepare('DELETE FROM merlin_entities').run();
}

export function recordMerlinSourceObservation(input: {
  source_type: string;
  source_reference: string;
  origin_surface: string;
  notes?: string;
}): MerlinSourceObservation {
  const trust = TRUST_BY_SOURCE[(input.source_type || '').toLowerCase()] ?? 0.5;
  const row: MerlinSourceObservation = {
    id: `merlin-source-observation-${randomUUID()}`,
    source_type: normalizeText(input.source_type).toLowerCase(),
    source_reference: normalizeText(input.source_reference),
    origin_surface: normalizeText(input.origin_surface) || 'unknown',
    trust_level: trust,
    active: 1,
    observed_at: nowIso(),
    notes: normalizeText(input.notes)
  };
  getDb()
    .prepare(
      `INSERT INTO merlin_source_observations
      (id, source_type, source_reference, origin_surface, trust_level, active, observed_at, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(row.id, row.source_type, row.source_reference, row.origin_surface, row.trust_level, row.active, row.observed_at, row.notes);
  return row;
}

export function listMerlinSourceObservations(limit = 100): MerlinSourceObservation[] {
  const max = Math.max(1, Math.min(500, limit));
  return getDb()
    .prepare(
      `SELECT id, source_type, source_reference, origin_surface, trust_level, active, observed_at, notes
       FROM merlin_source_observations
       ORDER BY observed_at DESC
       LIMIT ?`
    )
    .all(max) as MerlinSourceObservation[];
}

export function listMerlinEntities(filters: { brand_lane?: string; status?: MerlinEntityStatus; limit?: number } = {}): MerlinEntityRecord[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (filters.brand_lane) {
    clauses.push('brand_lane = ?');
    params.push(filters.brand_lane.trim().toLowerCase());
  }
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  const limit = Math.max(1, Math.min(200, filters.limit || 50));
  params.push(limit);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return getDb().prepare(`SELECT * FROM merlin_entities ${where} ORDER BY created_at DESC LIMIT ?`).all(...params) as MerlinEntityRecord[];
}

export function getMerlinEntityById(id: string): MerlinEntityRecord | undefined {
  return getDb().prepare('SELECT * FROM merlin_entities WHERE id = ?').get(id) as MerlinEntityRecord | undefined;
}

export function getMerlinEntityConflicts(entityId: string): Array<{
  id: string;
  entity_id: string;
  conflict_type: string;
  summary: string;
  source_reference: string;
  status: MerlinConflictStatus;
  created_at: string;
  updated_at: string;
}> {
  return getDb()
    .prepare('SELECT * FROM merlin_entity_conflicts WHERE entity_id = ? ORDER BY created_at DESC')
    .all(entityId) as Array<{
    id: string;
    entity_id: string;
    conflict_type: string;
    summary: string;
    source_reference: string;
    status: MerlinConflictStatus;
    created_at: string;
    updated_at: string;
  }>;
}

export function updateMerlinEntityConflictStatus(entityId: string, conflictId: string, status: MerlinConflictStatus): boolean {
  const updated = getDb()
    .prepare('UPDATE merlin_entity_conflicts SET status = ?, updated_at = ? WHERE id = ? AND entity_id = ?')
    .run(status, nowIso(), conflictId, entityId);
  if (updated.changes > 0) appendEntityHistory(entityId, 'conflict_status_updated', { conflict_id: conflictId, status });
  return updated.changes > 0;
}

export function getMerlinEntityHistory(entityId: string): Array<{ id: string; entity_id: string; event_type: string; payload: Record<string, unknown>; created_at: string }> {
  const rows = getDb()
    .prepare('SELECT * FROM merlin_entity_history WHERE entity_id = ? ORDER BY created_at DESC')
    .all(entityId) as Array<{ id: string; entity_id: string; event_type: string; payload_json: string; created_at: string }>;
  return rows.map((row) => ({
    id: row.id,
    entity_id: row.entity_id,
    event_type: row.event_type,
    payload: JSON.parse(row.payload_json) as Record<string, unknown>,
    created_at: row.created_at
  }));
}

export function resolveMerlinEntityFromIntake(intakeItemId: string): {
  intakeItemId: string;
  entity: MerlinEntityRecord;
  resolution_status: MerlinResolutionStatus;
  resolution_confidence: number;
  conflictIds: string[];
  source_observation_id: string;
} {
  const intake = getMerlinIntakeItemById(intakeItemId);
  if (!intake) throw new Error('intake_item_not_found');
  const sourceObservation = recordMerlinSourceObservation({
    source_type: intake.source_type,
    source_reference: intake.source_reference,
    origin_surface: intake.origin_surface,
    notes: `intake:${intake.id}`
  });
  const ids = extractIdentifierSignals(intake);
  const priority: MerlinIdentifierType[] = ['external_id', 'email', 'phone', 'domain', 'social', 'name_location'];
  let matchedEntity: MerlinEntityRecord | undefined;
  let status: MerlinResolutionStatus = 'new_entity';
  let confidence = Math.max(0.35, intake.confidence || 0.5);
  const conflictIds: string[] = [];

  for (const type of priority) {
    const signal = ids.find((x) => x.type === type);
    if (!signal) continue;
    const entities = findEntitiesByIdentifier(type, signal.value);
    const unique = Array.from(new Map(entities.map((e) => [e.id, e])).values());
    if (unique.length > 1) {
      status = 'conflict';
      confidence = Math.max(0.2, signal.confidence);
      for (const entity of unique) {
        createConflict(entity.id, 'identifier_collision', `${type} matched multiple entities: ${signal.value}`, intake.source_reference);
        const created = getDb()
          .prepare('SELECT id FROM merlin_entity_conflicts WHERE entity_id = ? ORDER BY created_at DESC LIMIT 1')
          .get(entity.id) as { id: string } | undefined;
        if (created?.id) conflictIds.push(created.id);
      }
      break;
    }
    if (unique.length === 1) {
      matchedEntity = unique[0];
      status = 'resolved';
      confidence = Math.max(signal.confidence, intake.confidence || 0.5);
      break;
    }
  }

  const fields = intake.extracted_fields || {};
  const entityCandidate = intake.entity_candidate || {};
  const canonicalName =
    normalizeText((fields as Record<string, unknown>).businessName) ||
    normalizeText((fields as Record<string, unknown>).truckName) ||
    normalizeText((entityCandidate as Record<string, unknown>).name) ||
    'Unknown';
  const entityType = normalizeText((entityCandidate as Record<string, unknown>).entity_type || (fields as Record<string, unknown>).entityType || 'unknown').toLowerCase();

  if (!matchedEntity) {
    const sparse = !canonicalName || canonicalName === 'Unknown';
    matchedEntity = createEntity({
      brand_lane: intake.brand_lane,
      entity_type: entityType || 'unknown',
      canonical_name: canonicalName || 'Unknown',
      confidence: sparse ? 0.35 : Math.max(intake.confidence || 0.5, 0.45),
      status: sparse ? 'needs_review' : 'active'
    });
    if (status !== 'conflict') {
      status = sparse ? 'needs_review' : 'new_entity';
      confidence = sparse ? 0.35 : Math.max(intake.confidence || 0.5, 0.45);
    }
  }

  for (const signal of ids) {
    addEntityIdentifier(matchedEntity.id, signal.type, signal.value, intake.source_reference, signal.confidence);
  }
  addEntityAlias(matchedEntity.id, canonicalName, intake.source_reference, Math.max(intake.confidence || 0.4, 0.4));
  appendEntityHistory(matchedEntity.id, 'intake_attached', { intake_item_id: intake.id, resolution_status: status, resolution_confidence: confidence });

  updateMerlinIntakeEntityResolution(intake.id, {
    resolved_entity_id: matchedEntity.id,
    entity_resolution_confidence: confidence,
    entity_resolution_status: status
  });

  return {
    intakeItemId: intake.id,
    entity: matchedEntity,
    resolution_status: status,
    resolution_confidence: confidence,
    conflictIds,
    source_observation_id: sourceObservation.id
  };
}

export function searchMerlinEntities(query: string, limit = 20): MerlinEntityRecord[] {
  const q = normalizeText(query).toLowerCase();
  const max = Math.max(1, Math.min(100, limit));
  if (!q) return listMerlinEntities({ limit: max });
  return getDb()
    .prepare(
      `SELECT DISTINCT e.*
       FROM merlin_entities e
       LEFT JOIN merlin_entity_identifiers i ON i.entity_id = e.id
       LEFT JOIN merlin_entity_aliases a ON a.entity_id = e.id
       WHERE lower(e.canonical_name) LIKE ?
          OR lower(e.brand_lane) LIKE ?
          OR lower(e.entity_type) LIKE ?
          OR lower(ifnull(i.identifier_value,'')) LIKE ?
          OR lower(ifnull(a.alias,'')) LIKE ?
       ORDER BY e.created_at DESC
       LIMIT ?`
    )
    .all(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, max) as MerlinEntityRecord[];
}

initializeMerlinEntityMemoryRuntime();
