type BrandLane = 'TradeScout' | 'MealScout' | 'TradersCorner' | 'LISA' | 'MerlinOS';

type SignalType =
  | 'contractor_claim'
  | 'homeowner_need'
  | 'host_intake'
  | 'event_intake'
  | 'vendor_activation'
  | 'online_order'
  | 'parking_booking'
  | 'payment_status'
  | 'design_request'
  | 'calendar_commitment'
  | 'support_request'
  | 'repo_task'
  | 'ops_update'
  | 'onboarding_started'
  | 'role_selected'
  | 'signup_completed'
  | 'business_profile_started'
  | 'business_claim_started'
  | 'service_category_selected'
  | 'location_added'
  | 'verification_started'
  | 'pricing_viewed'
  | 'contact_cta_clicked'
  | 'claim_cta_clicked'
  | 'onboarding_abandoned';

const SIGNAL_TYPES: SignalType[] = [
  'contractor_claim',
  'homeowner_need',
  'host_intake',
  'event_intake',
  'vendor_activation',
  'online_order',
  'parking_booking',
  'payment_status',
  'design_request',
  'calendar_commitment',
  'support_request',
  'repo_task',
  'ops_update',
  'onboarding_started',
  'role_selected',
  'signup_completed',
  'business_profile_started',
  'business_claim_started',
  'service_category_selected',
  'location_added',
  'verification_started',
  'pricing_viewed',
  'contact_cta_clicked',
  'claim_cta_clicked',
  'onboarding_abandoned'
];

const TRADESCOUT_SIGNAL_MAP: Record<string, SignalType> = {
  verification_document_uploaded: 'contractor_claim',
  insurance_document_uploaded: 'contractor_claim',
  contractor_document_uploaded: 'contractor_claim',
  quote_requested: 'support_request',
  payment_received: 'payment_status',
  verification_review_needed: 'support_request',
  onboarding_started: 'onboarding_started',
  role_selected: 'role_selected',
  signup_completed: 'signup_completed',
  business_profile_started: 'business_profile_started',
  business_claim_started: 'business_claim_started',
  service_category_selected: 'service_category_selected',
  location_added: 'location_added',
  verification_started: 'verification_started',
  pricing_viewed: 'pricing_viewed',
  contact_cta_clicked: 'contact_cta_clicked',
  claim_cta_clicked: 'claim_cta_clicked',
  onboarding_abandoned: 'onboarding_abandoned'
};

type SourceType = 'drive' | 'gmail' | 'calendar' | 'stripe' | 'canva' | 'github' | 'web' | 'app' | 'manual';

type ActionType = 'none' | 'inspect' | 'draft' | 'create' | 'update' | 'route' | 'block';

interface LISARecommendedAction {
  type: ActionType;
  description: string;
}

interface LISAEntityRef {
  type: string;
  id_or_name: string;
}

interface LISASource {
  type: SourceType;
  name: string;
  reference: string;
}

interface LISAEvent {
  signal_id: string;
  source: LISASource;
  brand_lane: BrandLane;
  signal_type: SignalType;
  entity: LISAEntityRef;
  observed_at: string;
  truth_score: number;
  newness_score: number;
  recommended_action: LISARecommendedAction;
  review_required: boolean;
  block_reason?: string;
  notes?: string;
  title?: string;
  summary?: string;
}

interface TradeScoutActivityEvent {
  event_id?: string;
  entity_id: string;
  business_name?: string;
  entity_name?: string;
  email?: string;
  phone?: string;
  phone_number?: string;
  domain?: string;
  location?: string;
  county?: string;
  aliases?: string[];
  entity_type?: string;
  event_type?: string;
  signal_type?: string;
  origin_surface?: string;
  observed_at?: string;
  truth_score?: number;
  newness_score?: number;
  recommended_action?: LISARecommendedAction;
  review_required?: boolean;
  source_reference?: string;
  title?: string;
  summary?: string;
  notes?: string;
}

export interface EntityStatePayload {
  entity_id: string;
  entity_type: string;
  brand_lane: BrandLane;
  current_state: string;
  truth_score: number;
  newness_score: number;
  state_age_hours: number;
  last_signal_id: string;
  source_refs: string[];
  last_observed_at: string;
  attention_required: boolean;
}

export interface TimelineEntry {
  id: string;
  entity_id: string;
  signal_type: SignalType;
  observed_at: string;
  age_hours: number;
  title: string;
  summary: string;
  source: string;
  brand_lane: BrandLane;
  review_required: boolean;
  truth_score: number;
  newness_score: number;
}

export interface DailyChangeItem {
  id: string;
  title: string;
  summary: string;
  source_refs: string[];
  confidence?: number;
}

export interface DailyPayload {
  date: string;
  user_id: string;
  sections: {
    changed: DailyChangeItem[];
    needs_attention: DailyChangeItem[];
    waiting: DailyChangeItem[];
    stale: DailyChangeItem[];
    suggested_next_steps: DailyChangeItem[];
  };
  source_refs: string[];
  generated_at: string;
}

interface DailyConfig {
  userId: string;
  now: number;
  maxItemsPerSection: number;
  createRecommendations?: boolean;
}

type ChangeResult = {
  changes: TimelineEntry[];
  sourceRefs: string[];
};

type EventRow = {
  id: string;
  event_type: string;
  normalized_signal_type: string;
  entity_id: string;
  entity_type: string;
  observed_at: string;
  truth_score: number;
  newness_score: number;
  review_required: number;
  recommended_action_type: string;
  recommended_action_description: string | null;
  source_type: string;
  source_name: string;
  source_reference: string;
  brand_lane: string;
  title: string | null;
  summary: string | null;
  notes: string | null;
};

type TimelineRow = {
  id: string;
  entity_id: string;
  signal_id: string;
  event_type: string;
  title: string;
  summary: string;
  observed_at: string;
  created_at: string;
  source_json: string;
  truth_score: number;
  newness_score: number;
  review_required: number;
  brand_lane: string;
};

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { calculateFreshnessScore, type FreshnessResult } from './freshness.js';
import { resolveAndTrackEntity, resolveEntityIdentity } from './entityResolution.js';
import { resolveSource, type ResolvedSource } from './sourceRegistry.js';
import { recordReplayEvent } from './replay.js';
import { createRecommendation } from './recommendations.js';

const DEFAULT_DB_PATH = './data/merlin-or.sqlite';
const ONE_HOUR = 1000 * 60 * 60;
const DAY = ONE_HOUR * 24;

let db: Database.Database | null = null;
let dbPath: string | null = null;

function toBoolean(value: number | boolean | null): boolean {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined) return false;
  return value === 1;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function resolveDbPath(explicitPath?: string): string {
  return resolve(process.cwd(), explicitPath || process.env.MERLIN_DB_PATH || DEFAULT_DB_PATH);
}

function getDb(): Database.Database {
  if (!db) {
    initializeLisaStore();
  }
  return db as Database.Database;
}

function resolveCanonicalEntityId(entityId: string): string {
  const resolved = resolveEntityIdentity({ entity_id: entityId });
  return resolved.canonical_entity_id;
}

export function initializeLisaStore(explicitPath?: string): string {
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
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      origin_system TEXT NOT NULL,
      origin_surface TEXT,
      entity_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      normalized_signal_type TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      payload_json TEXT,
      raw_json TEXT,
      truth_score REAL NOT NULL DEFAULT 0.9,
      newness_score REAL NOT NULL DEFAULT 0.9,
      review_required INTEGER NOT NULL DEFAULT 0,
      entity_type TEXT NOT NULL DEFAULT 'entity',
      source_reference TEXT NOT NULL,
      source_type TEXT NOT NULL DEFAULT 'app',
      source_name TEXT NOT NULL DEFAULT 'TradeScout',
      recommended_action_type TEXT NOT NULL DEFAULT 'none',
      recommended_action_description TEXT,
      title TEXT,
      summary TEXT,
      notes TEXT,
      brand_lane TEXT NOT NULL DEFAULT 'TradeScout'
    );

    CREATE TABLE IF NOT EXISTS timeline_entries (
      id TEXT PRIMARY KEY,
      entity_id TEXT NOT NULL,
      signal_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      source_json TEXT NOT NULL,
      truth_score REAL NOT NULL DEFAULT 0.9,
      newness_score REAL NOT NULL DEFAULT 0.9,
      review_required INTEGER NOT NULL DEFAULT 0,
      brand_lane TEXT NOT NULL DEFAULT 'TradeScout'
    );

    CREATE INDEX IF NOT EXISTS events_entity_idx ON events(entity_id, observed_at DESC);
    CREATE INDEX IF NOT EXISTS events_observed_idx ON events(observed_at DESC);
    CREATE INDEX IF NOT EXISTS timeline_entity_idx ON timeline_entries(entity_id, observed_at DESC);
  `);

  nextDb.exec(`
    CREATE TABLE IF NOT EXISTS entity_state (
      entity_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db = nextDb;
  dbPath = nextPath;
  return nextPath;
}

export function closeLisaStore(): void {
  if (db) {
    db.close();
    db = null;
    dbPath = null;
  }
}

function toSignalDate(observedAt?: string): string {
  if (!observedAt) return new Date().toISOString();
  const parsed = new Date(observedAt);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function toTimelineEntry(event: EventRow, now: number): TimelineEntry {
  const observedTime = new Date(event.observed_at).getTime();
  const title = event.title || `${event.normalized_signal_type.replace(/_/g, ' ')} for ${event.entity_id} (TradeScout)`;
  const summary = event.summary || `TradeScout reported: ${event.recommended_action_description || `Review ${event.normalized_signal_type.replace(/_/g, ' ')}`}`;

  return {
    id: event.id,
    entity_id: event.entity_id,
    signal_type: event.normalized_signal_type as SignalType,
    observed_at: event.observed_at,
    age_hours: Math.max(0, (now - observedTime) / ONE_HOUR),
    title,
    summary,
    source: event.source_reference,
    brand_lane: event.brand_lane as BrandLane,
    review_required: toBoolean(event.review_required),
    truth_score: event.truth_score,
    newness_score: event.newness_score
  };
}

function asDailyItem(event: EventRow): DailyChangeItem {
  const summary = event.summary || `${event.recommended_action_description || 'Review event'} (${new Date(event.observed_at).toISOString()})`;
  return {
    id: `daily-${event.id}`,
    title: (event.title || `${event.normalized_signal_type.replace(/_/g, ' ')}`),
    summary,
    confidence: event.truth_score,
    source_refs: [event.source_reference, `lisa:${event.id}`]
  };
}

function deriveActionType(signalType: SignalType): ActionType {
  if (signalType === 'contractor_claim' || signalType === 'support_request') return 'inspect';
  if (signalType === 'host_intake' || signalType === 'vendor_activation') return 'route';
  if (signalType === 'online_order' || signalType === 'parking_booking') return 'update';
  if (signalType === 'business_claim_started' || signalType === 'business_profile_started' || signalType === 'verification_started') return 'inspect';
  if (
    signalType === 'onboarding_started' ||
    signalType === 'role_selected' ||
    signalType === 'signup_completed' ||
    signalType === 'service_category_selected' ||
    signalType === 'location_added' ||
    signalType === 'pricing_viewed' ||
    signalType === 'contact_cta_clicked' ||
    signalType === 'claim_cta_clicked' ||
    signalType === 'onboarding_abandoned'
  )
    return 'none';
  return 'none';
}

function inferSectionFromEventType(rawEventType: string): keyof DailyPayload['sections'] | undefined {
  switch (rawEventType) {
    case 'onboarding_started':
    case 'role_selected':
    case 'pricing_viewed':
    case 'signup_completed':
    case 'service_category_selected':
    case 'contact_cta_clicked':
    case 'claim_cta_clicked':
    case 'location_added':
      return 'changed';
    case 'business_profile_started':
    case 'business_claim_started':
    case 'verification_started':
      return 'needs_attention';
    case 'onboarding_abandoned':
      return 'stale';
    default:
      return undefined;
  }
}

type PolicyActionType =
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

function mapPolicyActionFromEvent(event: EventRow): PolicyActionType {
  const actionType = event.recommended_action_type || '';
  switch (actionType) {
    case 'draft':
      return 'draft_message';
    case 'create':
    case 'inspect':
      return 'update_internal_status';
    case 'route':
    case 'update':
      return 'suggest_follow_up';
    case 'none':
    default:
      return 'view_context';
  }
}

function normalizeBrandLaneForRecommendation(brandLane: string): 'tradescout' | 'mealscout' | 'merlin' | 'lisa' | 'continuum' | 'marketfilter' | 'system' {
  const normalized = brandLane.toLowerCase();
  const supported = [
    'tradescout',
    'mealscout',
    'merlin',
    'lisa',
    'continuum',
    'marketfilter',
    'system'
  ];
  return (supported.includes(normalized) ? normalized : 'system') as
    | 'tradescout'
    | 'mealscout'
    | 'merlin'
    | 'lisa'
    | 'continuum'
    | 'marketfilter'
    | 'system';
}

function normalizeSignalType(value?: string): SignalType {
  if (!value) return 'contractor_claim';
  const direct = value.trim().toLowerCase();
  if (SIGNAL_TYPES.includes(direct as SignalType)) return direct as SignalType;
  if (direct in TRADESCOUT_SIGNAL_MAP) return TRADESCOUT_SIGNAL_MAP[direct];
  return 'contractor_claim';
}

function createSignalFromTradeScoutEvent(payload: TradeScoutActivityEvent): LISAEvent {
  const observedAt = toSignalDate(payload.observed_at);
  const rawSignalType = payload.signal_type ?? payload.event_type;
  const signalType = normalizeSignalType(rawSignalType);
  const signalId = payload.event_id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const resolvedSource = resolveSource({
    sourceReference: payload.source_reference,
    originSurface: payload.origin_surface,
    entityId: payload.entity_id
  });
  const freshness: FreshnessResult = calculateFreshnessScore(observedAt, {
    trustLevel: resolvedSource.trustLevel,
    nowMs: Date.now()
  });
  const title = payload.title || `TradeScout ${signalType.replace(/_/g, ' ')}: ${payload.entity_id}`;
  const summary = payload.summary || `${payload.entity_id} had a TradeScout activity of ${signalType.replace(/_/g, ' ')}`;
  const action =
    payload.recommended_action ??
    { type: deriveActionType(signalType), description: `Review ${signalType.replace(/_/g, ' ')}` };
  const source = asLISASource(resolvedSource);

  return {
    signal_id: signalId,
    source,
    brand_lane: 'TradeScout',
    signal_type: signalType,
    entity: {
      type: payload.entity_type || 'entity',
      id_or_name: payload.entity_id
    },
    observed_at: observedAt,
    truth_score: clamp01(payload.truth_score ?? 0.9),
    newness_score: clamp01(payload.newness_score ?? freshness.score),
    recommended_action: action,
    review_required: Boolean(payload.review_required),
    title,
    summary,
    notes: payload.notes
  };
}

function asLISASource(source: ResolvedSource): LISASource {
  return {
    type: source.type,
    name: source.name,
    reference: source.reference
  };
}

function classifyEventForDaily(event: EventRow, now: number): keyof DailyPayload['sections'] | 'ignore' {
  const mappedSection = inferSectionFromEventType(event.event_type);
  if (mappedSection) return mappedSection;

  const ageHours = (now - new Date(event.observed_at).getTime()) / ONE_HOUR;
  if (Boolean(event.review_required)) return 'needs_attention';
  if (ageHours <= 24 && event.truth_score >= 0.6) return 'changed';
  if (event.recommended_action_type === 'route' && ageHours <= (DAY / ONE_HOUR) * 2) return 'waiting';
  if (ageHours >= 72 && event.truth_score < 0.75) return 'stale';
  return 'ignore';
}

function sanitizeLimit(limit: number): number {
  return Math.max(1, Math.min(100, limit));
}

function buildEntityStateFromEvent(event: EventRow): EntityStatePayload {
  const now = Date.now();
  const ageHours = (now - new Date(event.observed_at).getTime()) / ONE_HOUR;
  const attentionRequired = toBoolean(event.review_required) || event.truth_score < 0.5;
  const actionType = event.recommended_action_type as ActionType;
  const currentState =
    toBoolean(event.review_required)
      ? 'needs_attention'
      : actionType === 'route'
        ? 'waiting_for_followup'
        : actionType === 'none'
          ? 'monitoring'
          : 'active';

  return {
    entity_id: event.entity_id,
    entity_type: event.entity_type,
    brand_lane: event.brand_lane as BrandLane,
    current_state: currentState,
    truth_score: event.truth_score,
    newness_score: event.newness_score,
    state_age_hours: ageHours,
    last_signal_id: event.id,
    source_refs: [event.source_reference, `lisa:${event.id}`],
    last_observed_at: event.observed_at,
    attention_required: attentionRequired
  };
}

function fetchEventById(eventId: string): EventRow | null {
  const row = getDb()
    .prepare(
      `
      SELECT
        e.id,
        e.event_type,
        e.normalized_signal_type,
        e.entity_id,
        e.entity_type,
        e.observed_at,
        e.truth_score,
        e.newness_score,
        e.review_required,
        e.recommended_action_type,
        e.recommended_action_description,
        e.source_reference,
        e.source_type,
        e.source_name,
        e.brand_lane,
        e.title,
        e.summary,
        e.notes
      FROM events e
      WHERE e.id = ?;
      `
    )
    .get(eventId) as EventRow | undefined;
  return row ?? null;
}

function fetchEvents(limit: number): EventRow[] {
  return getDb()
    .prepare(
      `
      SELECT
        e.id,
        e.event_type,
        e.normalized_signal_type,
        e.entity_id,
        e.entity_type,
        e.observed_at,
        e.truth_score,
        e.newness_score,
        e.review_required,
        e.recommended_action_type,
        e.recommended_action_description,
        e.source_reference,
        e.source_type,
        e.source_name,
        e.brand_lane,
        e.title,
        e.summary,
        e.notes
      FROM events e
      ORDER BY e.observed_at DESC, e.created_at DESC
      LIMIT ?;
      `
    )
    .all(limit) as EventRow[];
}

function fetchEntityStateRow(entityId: string): { state_json: string } | undefined {
  return getDb().prepare('SELECT state_json FROM entity_state WHERE entity_id = ?').get(entityId) as { state_json: string } | undefined;
}

export function ingestTradeScoutEvent(payload: TradeScoutActivityEvent): string {
  if (!payload.entity_id || !String(payload.entity_id).trim()) {
    throw new Error('TradeScout events require entity_id');
  }

  const resolved = resolveAndTrackEntity({
    entity_id: payload.entity_id,
    business_name: payload.business_name,
    entity_name: payload.entity_name,
    phone: payload.phone,
    phone_number: payload.phone_number,
    email: payload.email,
    domain: payload.domain,
    location: payload.location,
    county: payload.county,
    aliases: payload.aliases
  });
  const normalizedPayload = {
    ...payload,
    entity_id: resolved.canonical_entity_id
  };

  const event = createSignalFromTradeScoutEvent(normalizedPayload);
  const now = new Date().toISOString();
  const dbInstance = getDb();
  const eventRow = {
    id: event.signal_id,
    origin_system: 'tradescout',
    origin_surface: payload.origin_surface || 'tradescout',
    entity_id: event.entity.id_or_name,
    event_type: payload.event_type || payload.signal_type || event.signal_type,
    normalized_signal_type: event.signal_type,
    observed_at: event.observed_at,
    created_at: now,
    payload_json: JSON.stringify(normalizedPayload),
    raw_json: JSON.stringify(normalizedPayload),
    truth_score: event.truth_score,
    newness_score: event.newness_score,
    review_required: event.review_required ? 1 : 0,
    entity_type: event.entity.type,
    source_reference: event.source.reference,
    source_type: event.source.type,
    source_name: event.source.name,
    recommended_action_type: event.recommended_action.type,
    recommended_action_description: event.recommended_action.description,
    title: event.title,
    summary: event.summary,
    notes: event.notes,
    brand_lane: event.brand_lane
  };

  const timelineRow = {
    id: event.signal_id,
    entity_id: event.entity.id_or_name,
    signal_id: event.signal_id,
    event_type: event.signal_type,
    title: event.title ?? `TradeScout ${event.signal_type.replace(/_/g, ' ')}`,
    summary: event.summary ?? `${event.entity.id_or_name} had a TradeScout activity of ${event.signal_type.replace(/_/g, ' ')}`,
    observed_at: event.observed_at,
    created_at: now,
    source_json: JSON.stringify(event.source),
    truth_score: event.truth_score,
    newness_score: event.newness_score,
    review_required: event.review_required ? 1 : 0,
    brand_lane: event.brand_lane
  };

  const state = buildEntityStateFromEvent({ ...eventRow, source_type: 'app', source_name: 'TradeScout', notes: event.notes || null } as unknown as EventRow);
  const upsertState = dbInstance.prepare(`
    INSERT INTO entity_state (entity_id, state_json, updated_at)
    VALUES (@entity_id, @state_json, @updated_at)
    ON CONFLICT(entity_id) DO UPDATE SET
      state_json = excluded.state_json,
      updated_at = excluded.updated_at;
  `);
  const insertEvent = dbInstance.prepare(`
    INSERT INTO events (
      id,
      origin_system,
      origin_surface,
      entity_id,
      event_type,
      normalized_signal_type,
      observed_at,
      created_at,
      payload_json,
      raw_json,
      truth_score,
      newness_score,
      review_required,
      entity_type,
      source_reference,
      source_type,
      source_name,
      recommended_action_type,
      recommended_action_description,
      title,
      summary,
      notes,
      brand_lane
    ) VALUES (
      @id,
      @origin_system,
      @origin_surface,
      @entity_id,
      @event_type,
      @normalized_signal_type,
      @observed_at,
      @created_at,
      @payload_json,
      @raw_json,
      @truth_score,
      @newness_score,
      @review_required,
      @entity_type,
      @source_reference,
      @source_type,
      @source_name,
      @recommended_action_type,
      @recommended_action_description,
      @title,
      @summary,
      @notes,
      @brand_lane
    );
  `);
  const insertTimeline = dbInstance.prepare(`
    INSERT INTO timeline_entries (
      id,
      entity_id,
      signal_id,
      event_type,
      title,
      summary,
      observed_at,
      created_at,
      source_json,
      truth_score,
      newness_score,
      review_required,
      brand_lane
    ) VALUES (
      @id,
      @entity_id,
      @signal_id,
      @event_type,
      @title,
      @summary,
      @observed_at,
      @created_at,
      @source_json,
      @truth_score,
      @newness_score,
      @review_required,
      @brand_lane
    );
  `);

  const tx = dbInstance.transaction(() => {
    insertEvent.run(eventRow);
    insertTimeline.run(timelineRow);
    upsertState.run({
      entity_id: state.entity_id,
      state_json: JSON.stringify(state),
      updated_at: now
    });
  });
  tx();

  recordReplayEvent({
    event_type: 'event_ingested',
    entity_id: event.entity.id_or_name,
    signal_id: event.signal_id,
    summary: `TradeScout event ${event.signal_id} ingested for ${event.entity.id_or_name}`,
    source_refs: [event.source.reference, `lisa:${event.signal_id}`],
    payload: {
      origin_system: 'tradescout',
      event_type: eventRow.event_type,
      normalized_signal_type: eventRow.normalized_signal_type,
      origin_surface: eventRow.origin_surface
    }
  });

  recordReplayEvent({
    event_type: 'state_updated',
    entity_id: event.entity.id_or_name,
    signal_id: event.signal_id,
    summary: `Entity ${event.entity.id_or_name} state updated from event ${event.signal_id}`,
    source_refs: [event.source.reference, `lisa:${event.signal_id}`],
    payload: {
      new_state: state.current_state,
      last_signal_id: state.last_signal_id,
      state_age_hours: state.state_age_hours
    }
  });

  return event.signal_id;
}

export function getEntityState(entityId: string): EntityStatePayload | null {
  const resolvedEntityId = resolveCanonicalEntityId(entityId);
  const row = fetchEntityStateRow(resolvedEntityId);
  if (!row) return null;
  try {
    return JSON.parse(row.state_json) as EntityStatePayload;
  } catch {
    return null;
  }
}

export function getEntityTimeline(entityId: string, limit = 20): TimelineEntry[] {
  const resolvedEntityId = resolveCanonicalEntityId(entityId);
  const safeLimit = sanitizeLimit(limit);
  const rows = getDb()
    .prepare(
      `
      SELECT
        id,
        entity_id,
        signal_id,
        event_type,
        title,
        summary,
        observed_at,
        truth_score,
        newness_score,
        review_required,
        brand_lane,
        source_json
      FROM timeline_entries
      WHERE entity_id = ?
      ORDER BY observed_at DESC, created_at DESC
      LIMIT ?;
      `
    )
    .all(resolvedEntityId, safeLimit) as TimelineRow[];
  const now = Date.now();
  return rows.map((row) => {
    const title = row.title || `${row.event_type.replace(/_/g, ' ')} for ${row.entity_id} (TradeScout)`;
    const summary = row.summary || `TradeScout reported: ${row.event_type.replace(/_/g, ' ')}`;
    const sourceJson = JSON.parse(row.source_json) as LISASource;
    return {
      id: row.id,
      entity_id: row.entity_id,
      signal_type: row.event_type as SignalType,
      observed_at: row.observed_at,
      age_hours: Math.max(0, (now - new Date(row.observed_at).getTime()) / ONE_HOUR),
      title,
      summary,
      source: sourceJson.reference,
      brand_lane: row.brand_lane as BrandLane,
      review_required: Boolean(row.review_required),
      truth_score: row.truth_score,
      newness_score: row.newness_score
    };
  });
}

export function getRecentChanges(limit = 20): ChangeResult {
  const safeLimit = sanitizeLimit(limit);
  const now = Date.now();
  const rows = fetchEvents(safeLimit);
  const changes = rows.map((row) => toTimelineEntry(row, now));
  const sourceRefs = Array.from(new Set(changes.map((change) => `lisa:${change.id}`)));
  return { changes, sourceRefs };
}

export function searchLisaSignals(query: string, limit = 20): ChangeResult {
  const token = (query || '').trim().toLowerCase();
  const maxCount = sanitizeLimit(limit);
  const events = fetchEvents(500);
  const now = Date.now();

  const candidates = token.length
    ? events.filter((event) => {
        const haystack =
          `${event.id} ${event.normalized_signal_type} ${event.entity_id} ${event.title ?? ''} ${event.summary ?? ''} ${event.notes ?? ''}`.toLowerCase();
        return haystack.includes(token);
      })
    : events;

  const results = candidates.slice(0, maxCount).map((event) => toTimelineEntry(event, now));
  const sourceRefs = Array.from(new Set(results.map((item) => item.source)));
  return { changes: results, sourceRefs };
}

export function getDailyPayloadForUser(userId = 'demo-user', options: Partial<DailyConfig> = {}): DailyPayload {
  const now = options.now || Date.now();
  const maxItemsPerSection = options.maxItemsPerSection || 12;
  const shouldCreateRecommendations = Boolean(options.createRecommendations);
  const events = fetchEvents(500);
  const sectionCounts = {
    changed: [] as DailyChangeItem[],
    needs_attention: [] as DailyChangeItem[],
    waiting: [] as DailyChangeItem[],
    stale: [] as DailyChangeItem[],
    suggested_next_steps: [] as DailyChangeItem[]
  };

  for (const event of events) {
    const category = classifyEventForDaily(event, now);
    if (category === 'ignore') continue;
    if (sectionCounts[category].length >= maxItemsPerSection) continue;
    sectionCounts[category].push(asDailyItem(event));
  }

  sectionCounts.suggested_next_steps = [
    ...sectionCounts.needs_attention,
    ...sectionCounts.waiting,
    ...sectionCounts.changed.filter((entry) => entry.confidence && entry.confidence >= 0.8)
  ].slice(0, maxItemsPerSection).map((entry, index) => ({
    ...entry,
    id: `next-${index + 1}-${entry.id}`
  }));

  if (shouldCreateRecommendations && sectionCounts.suggested_next_steps.length > 0) {
    for (const suggestion of sectionCounts.suggested_next_steps) {
      const matched = /^next-\d+-(.+)$/.exec(suggestion.id);
      if (!matched) {
        continue;
      }
      const dailyEventId = matched[1];
      const eventId = dailyEventId.startsWith('daily-') ? dailyEventId.slice('daily-'.length) : dailyEventId;
      if (!eventId) {
        continue;
      }
      const eventRow = eventId ? fetchEventById(eventId) : null;
      if (!eventRow) continue;
      const policyAction = mapPolicyActionFromEvent(eventRow);
      const brandLane = normalizeBrandLaneForRecommendation(eventRow.brand_lane);
      createRecommendation({
        entity_id: eventRow.entity_id,
        signal_id: eventRow.id,
        title: suggestion.title,
        summary: suggestion.summary,
        action_type: policyAction,
        brand_lane: brandLane,
        source_refs: suggestion.source_refs
      });
    }
  }

  const sourceRefs = new Set<string>(['lisa']);
  for (const item of [...sectionCounts.changed, ...sectionCounts.needs_attention, ...sectionCounts.waiting, ...sectionCounts.stale]) {
    for (const ref of item.source_refs) sourceRefs.add(ref);
  }

  return {
    date: new Date(now).toISOString().slice(0, 10),
    user_id: userId,
    sections: sectionCounts,
    source_refs: [...sourceRefs],
    generated_at: new Date(now).toISOString()
  };
}

export function resetLisaStore(): void {
  const dbInstance = getDb();
  dbInstance.prepare('DELETE FROM timeline_entries').run();
  dbInstance.prepare('DELETE FROM events').run();
  dbInstance.prepare('DELETE FROM entity_state').run();
}

initializeLisaStore();
