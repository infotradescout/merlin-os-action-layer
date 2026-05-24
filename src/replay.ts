import { randomUUID } from 'node:crypto';
import { resolveEntityIdentity } from './entityResolution.js';

type ReplayEventType =
  | 'event_ingested'
  | 'state_updated'
  | 'daily_generated'
  | 'recommendation_created'
  | 'policy_evaluated'
  | 'recommendation_status_updated'
  | 'outcome_recorded'
  | 'outcome_linked';

type PolicyLevel = 'read_only' | 'organize_internal' | 'draft_only' | 'approval_required' | 'blocked_high_risk';

interface ReplayEvent {
  id: string;
  event_type: ReplayEventType;
  summary: string;
  source_refs: string[];
  created_at: string;
  payload?: unknown;
  entity_id?: string;
  signal_id?: string;
  recommendation_id?: string;
  outcome_id?: string;
  policy_level?: PolicyLevel;
}

interface ReplayEventInput {
  event_type: ReplayEventType;
  entity_id?: string;
  signal_id?: string;
  recommendation_id?: string;
  outcome_id?: string;
  policy_level?: PolicyLevel;
  summary: string;
  source_refs?: string[];
  payload?: unknown;
  created_at?: string;
}

const replayEvents = new Map<string, ReplayEvent>();
const indexByEntity = new Map<string, string[]>();
const indexByRecommendation = new Map<string, string[]>();
const indexByOutcome = new Map<string, string[]>();
const replayOrder = new Map<string, number>();
let replaySequence = 0;

function toCanonicalEntityId(entityId?: string): string | undefined {
  if (!entityId) return undefined;
  return resolveEntityIdentity({ entity_id: entityId }).canonical_entity_id;
}

function normalizeSummary(value = ''): string {
  return value.trim() || 'Replay event';
}

function normalizeRefs(sourceRefs: string[] = []): string[] {
  return Array.from(new Set(sourceRefs.map((value) => value.trim()).filter(Boolean)));
}

function toCreatedAt(value?: string): string {
  if (!value) return new Date().toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function appendIndex(index: Map<string, string[]>, key: string, eventId: string): void {
  const list = index.get(key);
  if (!list) {
    index.set(key, [eventId]);
    return;
  }
  list.push(eventId);
}

function sortByRecent(events: ReplayEvent[]): ReplayEvent[] {
  return events.sort((left, right) => {
    const ageSort = Date.parse(right.created_at) - Date.parse(left.created_at);
    if (ageSort !== 0) return ageSort;
    return (replayOrder.get(right.id) ?? 0) - (replayOrder.get(left.id) ?? 0);
  });
}

function indexReplayEvent(event: ReplayEvent): void {
  if (event.entity_id) {
    appendIndex(indexByEntity, event.entity_id, event.id);
  }
  if (event.recommendation_id) {
    appendIndex(indexByRecommendation, event.recommendation_id, event.id);
  }
  if (event.outcome_id) {
    appendIndex(indexByOutcome, event.outcome_id, event.id);
  }
}

export function resetReplayForTest(): void {
  replayEvents.clear();
  indexByEntity.clear();
  indexByRecommendation.clear();
  indexByOutcome.clear();
  replayOrder.clear();
  replaySequence = 0;
}

export function recordReplayEvent(input: ReplayEventInput): ReplayEvent {
  const createdAt = toCreatedAt(input.created_at);
  const canonicalEntityId = toCanonicalEntityId(input.entity_id);
  replaySequence += 1;
  const sequence = replaySequence;

  const event: ReplayEvent = {
    id: `replay-${randomUUID()}`,
    event_type: input.event_type,
    entity_id: canonicalEntityId,
    signal_id: input.signal_id,
    recommendation_id: input.recommendation_id,
    outcome_id: input.outcome_id,
    policy_level: input.policy_level,
    summary: normalizeSummary(input.summary),
    source_refs: normalizeRefs(input.source_refs),
    payload: input.payload,
    created_at: createdAt
  };

  replayEvents.set(event.id, event);
  replayOrder.set(event.id, sequence);
  indexReplayEvent(event);
  return event;
}

export function getReplayEventById(id: string): ReplayEvent | undefined {
  return replayEvents.get(id);
}

export function getReplayEventsForEntity(entityId: string): ReplayEvent[] {
  const canonicalEntityId = toCanonicalEntityId(entityId);
  const ids = canonicalEntityId ? indexByEntity.get(canonicalEntityId) || [] : [];
  return sortByRecent(
    ids
      .map((id) => replayEvents.get(id))
      .filter((event): event is ReplayEvent => Boolean(event))
  );
}

export function getReplayEventsForRecommendation(recommendationId: string): ReplayEvent[] {
  const ids = indexByRecommendation.get(recommendationId) || [];
  return sortByRecent(
    ids
      .map((id) => replayEvents.get(id))
      .filter((event): event is ReplayEvent => Boolean(event))
  );
}

export function getReplayEventsForOutcome(outcomeId: string): ReplayEvent[] {
  const ids = indexByOutcome.get(outcomeId) || [];
  return sortByRecent(
    ids
      .map((id) => replayEvents.get(id))
      .filter((event): event is ReplayEvent => Boolean(event))
  );
}

export function getRecentReplayEvents(limit = 20): ReplayEvent[] {
  const maxItems = Math.max(1, Math.min(100, limit));
  return sortByRecent([...replayEvents.values()]).slice(0, maxItems);
}
