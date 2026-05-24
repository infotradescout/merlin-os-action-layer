import { randomUUID } from 'node:crypto';
import { resolveEntityIdentity } from './entityResolution.js';
import { recordReplayEvent } from './replay.js';

type OutcomeType =
  | 'customer_replied'
  | 'document_reviewed'
  | 'follow_up_sent'
  | 'job_booked'
  | 'quote_accepted'
  | 'quote_rejected'
  | 'no_response'
  | 'manual_done';

type OutcomeStatus = 'suggested' | 'accepted' | 'dismissed' | 'completed' | 'failed' | 'unknown';

export interface OutcomeRecommendationInput {
  recommendation: string;
  action: string;
  entity_id: string;
  signal_id?: string;
  source_refs?: string[];
}

export interface OutcomeRecommendation {
  id: string;
  recommendation: string;
  action: string;
  entity_id: string;
  signal_id?: string;
  status: OutcomeStatus;
  source_refs: string[];
  observed_at: string;
  created_at: string;
}

export interface OutcomeInput {
  recommendation_id?: string;
  entity_id?: string;
  signal_id?: string;
  action: string;
  outcome: string;
  status: string;
  result?: string;
  source_refs?: string[];
  observed_at?: string;
}

export interface OutcomeRecord {
  id: string;
  recommendation_id?: string;
  entity_id: string;
  signal_id?: string;
  action: string;
  outcome: OutcomeType;
  status: OutcomeStatus;
  result?: string;
  source_refs: string[];
  observed_at: string;
  created_at: string;
}

const recommendations = new Map<string, OutcomeRecommendation>();
const outcomes = new Map<string, OutcomeRecord>();
const outcomesByEntity = new Map<string, string[]>();

const ALLOWED_OUTCOMES: Set<string> = new Set([
  'customer_replied',
  'document_reviewed',
  'follow_up_sent',
  'job_booked',
  'quote_accepted',
  'quote_rejected',
  'no_response',
  'manual_done'
]);

const ALLOWED_STATUS: Set<string> = new Set([
  'suggested',
  'accepted',
  'dismissed',
  'completed',
  'failed',
  'unknown'
]);

function resolveCanonicalEntityId(entityId: string): string {
  const resolved = resolveEntityIdentity({ entity_id: entityId });
  return resolved.canonical_entity_id;
}

function normalizeSourceRefs(sourceRefs: string[] = []): string[] {
  const entries = sourceRefs.filter((ref) => typeof ref === 'string').map((ref) => ref.trim()).filter(Boolean);
  return Array.from(new Set(entries));
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeOutcomeType(value: string): OutcomeType {
  const normalized = (value || '').trim().toLowerCase();
  if (ALLOWED_OUTCOMES.has(normalized)) {
    return normalized as OutcomeType;
  }
  return 'manual_done';
}

function normalizeStatus(value: string): OutcomeStatus {
  const normalized = (value || '').trim().toLowerCase();
  if (ALLOWED_STATUS.has(normalized)) {
    return normalized as OutcomeStatus;
  }
  return 'unknown';
}

function upsertEntityIndex(entityId: string, outcomeId: string): void {
  const key = entityId;
  const list = outcomesByEntity.get(key);
  if (list) {
    list.push(outcomeId);
    return;
  }
  outcomesByEntity.set(key, [outcomeId]);
}

export function resetOutcomesForTest(): void {
  recommendations.clear();
  outcomes.clear();
  outcomesByEntity.clear();
}

export function createRecommendation(input: OutcomeRecommendationInput): OutcomeRecommendation {
  const canonicalEntityId = resolveCanonicalEntityId(input.entity_id);
  const now = nowIso();
  const id = `recommendation-${randomUUID()}`;
  const recommendation: OutcomeRecommendation = {
    id,
    recommendation: input.recommendation,
    action: input.action,
    entity_id: canonicalEntityId,
    signal_id: input.signal_id,
    status: 'suggested',
    source_refs: normalizeSourceRefs(input.source_refs),
    observed_at: now,
    created_at: now
  };
  recommendations.set(id, recommendation);
  return recommendation;
}

export function recordOutcome(input: OutcomeInput): OutcomeRecord {
  const recommendation = input.recommendation_id ? recommendations.get(input.recommendation_id) : undefined;
  const entityId = recommendation?.entity_id || (input.entity_id ? resolveCanonicalEntityId(input.entity_id) : '');

  if (!entityId) {
    throw new Error('outcomes require entity_id or recommendation_id');
  }

  const now = nowIso();
  const outcome: OutcomeRecord = {
    id: `outcome-${randomUUID()}`,
    recommendation_id: input.recommendation_id,
    entity_id: entityId,
    signal_id: input.signal_id || recommendation?.signal_id,
    action: input.action,
    outcome: normalizeOutcomeType(input.outcome),
    status: normalizeStatus(input.status),
    result: input.result,
    source_refs: [
      ...normalizeSourceRefs(input.source_refs),
      ...(recommendation ? recommendation.source_refs : [])
    ],
    observed_at: input.observed_at || now,
    created_at: now
  };

  outcomes.set(outcome.id, outcome);
  upsertEntityIndex(entityId, outcome.id);
  recordReplayEvent({
    event_type: 'outcome_recorded',
    entity_id: entityId,
    signal_id: outcome.signal_id,
    recommendation_id: outcome.recommendation_id,
    outcome_id: outcome.id,
    summary: `Outcome ${outcome.id} recorded for entity ${entityId}`,
    source_refs: outcome.source_refs,
    payload: {
      action: outcome.action,
      outcome: outcome.outcome,
      status: outcome.status
    }
  });
  return outcome;
}

export function getOutcomesForEntity(entityId: string): OutcomeRecord[] {
  const canonicalEntityId = resolveCanonicalEntityId(entityId);
  const outcomeIds = outcomesByEntity.get(canonicalEntityId) || [];
  return outcomeIds
    .map((id) => outcomes.get(id))
    .filter((outcome): outcome is OutcomeRecord => Boolean(outcome))
    .sort((left, right) => Date.parse(right!.observed_at) - Date.parse(left!.observed_at));
}

export function getOutcomeById(id: string): OutcomeRecord | undefined {
  return outcomes.get(id);
}

export function getRecentOutcomes(limit = 20): OutcomeRecord[] {
  const all = [...outcomes.values()].sort((left, right) => Date.parse(right.observed_at) - Date.parse(left.observed_at));
  return all.slice(0, Math.max(1, Math.min(100, limit)));
}
