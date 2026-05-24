import { randomUUID } from 'node:crypto';
import { PolicyDecision, evaluatePolicy } from './policy.js';
import { resolveEntityIdentity } from './entityResolution.js';
import { recordReplayEvent } from './replay.js';

export type RecommendationStatus = 'suggested' | 'accepted' | 'dismissed' | 'completed' | 'failed' | 'expired';
export type RecommendationActionType =
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

type BrandLane = 'tradescout' | 'mealscout' | 'merlin' | 'lisa' | 'continuum' | 'marketfilter' | 'system';

interface RecommendationRecord {
  id: string;
  entity_id: string;
  signal_id?: string;
  title: string;
  summary: string;
  action_type: RecommendationActionType;
  brand_lane: BrandLane;
  policy_result: PolicyDecision;
  source_refs: string[];
  status: RecommendationStatus;
  created_at: string;
  expires_at: string;
  outcome_id?: string;
}

export interface RecommendationInput {
  entity_id: string;
  signal_id?: string;
  title: string;
  summary: string;
  action_type: RecommendationActionType;
  brand_lane: BrandLane;
  source_refs?: string[];
  ttlMinutes?: number;
}

const recommendations = new Map<string, RecommendationRecord>();
const recommendationIndexByEntity = new Map<string, string[]>();
const recommendationOrder = new Map<string, number>();
let recommendationSequence = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeRefs(sourceRefs: string[] = []): string[] {
  return Array.from(new Set(sourceRefs.map((value) => value.trim()).filter(Boolean)));
}

function canonicalizeEntityId(entityId: string): string {
  return resolveEntityIdentity({ entity_id: entityId }).canonical_entity_id;
}

function brandFromInput(value: string): BrandLane {
  const normalized = (value || 'system').toLowerCase();
  const supported: BrandLane[] = ['tradescout', 'mealscout', 'merlin', 'lisa', 'continuum', 'marketfilter', 'system'];
  return (supported.includes(normalized as BrandLane) ? (normalized as BrandLane) : 'system');
}

function isValidStatus(value: string): value is RecommendationStatus {
  return value === 'suggested' || value === 'accepted' || value === 'dismissed' || value === 'completed' || value === 'failed' || value === 'expired';
}

function indexForEntity(entityId: string, recommendationId: string): void {
  const list = recommendationIndexByEntity.get(entityId);
  if (!list) {
    recommendationIndexByEntity.set(entityId, [recommendationId]);
    return;
  }
  list.push(recommendationId);
}

function buildExpiry(createdAt: string, ttlMinutes = 60 * 24): string {
  const parsed = new Date(createdAt).getTime();
  const expiresAt = new Date(parsed + ttlMinutes * 60_000);
  return expiresAt.toISOString();
}

export function resetRecommendationsForTest(): void {
  recommendations.clear();
  recommendationIndexByEntity.clear();
  recommendationOrder.clear();
  recommendationSequence = 0;
}

export function createRecommendation(input: RecommendationInput): RecommendationRecord {
  const canonicalEntityId = canonicalizeEntityId(input.entity_id);
  const createdAt = nowIso();
  const brandLane = brandFromInput(input.brand_lane);
  const actionType = input.action_type;
  const policy = evaluatePolicy({
    action_type: actionType,
    brand_lane: brandLane
  });
  recommendationSequence += 1;
  const sequence = recommendationSequence;

  const recommendation: RecommendationRecord = {
    id: `rec-${randomUUID()}`,
    entity_id: canonicalEntityId,
    signal_id: input.signal_id,
    title: input.title,
    summary: input.summary,
    action_type: actionType,
    brand_lane: brandLane,
    policy_result: policy,
    source_refs: normalizeRefs(input.source_refs),
    status: 'suggested',
    created_at: createdAt,
    expires_at: buildExpiry(createdAt, input.ttlMinutes),
    outcome_id: undefined
  };

  recommendations.set(recommendation.id, recommendation);
  recommendationOrder.set(recommendation.id, sequence);
  indexForEntity(canonicalEntityId, recommendation.id);
  recordReplayEvent({
    event_type: 'recommendation_created',
    entity_id: canonicalEntityId,
    signal_id: input.signal_id,
    recommendation_id: recommendation.id,
    summary: `Recommendation ${recommendation.id} created for entity ${canonicalEntityId}`,
    source_refs: recommendation.source_refs,
    policy_level: recommendation.policy_result.level,
    payload: {
      title: recommendation.title,
      summary: recommendation.summary,
      action_type: recommendation.action_type
    }
  });
  recordReplayEvent({
    event_type: 'policy_evaluated',
    entity_id: canonicalEntityId,
    signal_id: input.signal_id,
    recommendation_id: recommendation.id,
    policy_level: recommendation.policy_result.level,
    summary: `Policy evaluated for ${recommendation.action_type} (${recommendation.policy_result.level})`,
    source_refs: recommendation.source_refs,
    payload: {
      allowed: recommendation.policy_result.allowed,
      level: recommendation.policy_result.level,
      requires_approval: recommendation.policy_result.requires_approval,
      blocked: recommendation.policy_result.blocked,
      reason: recommendation.policy_result.reason
    }
  });
  return recommendation;
}

export function updateRecommendationStatus(id: string, status: RecommendationStatus): RecommendationRecord {
  const recommendation = recommendations.get(id);
  if (!recommendation) {
    throw new Error(`Recommendation not found: ${id}`);
  }
  if (!isValidStatus(status)) {
    throw new Error(`Invalid recommendation status: ${status}`);
  }
  recommendation.status = status;
  recordReplayEvent({
    event_type: 'recommendation_status_updated',
    entity_id: recommendation.entity_id,
    signal_id: recommendation.signal_id,
    recommendation_id: recommendation.id,
    summary: `Recommendation ${recommendation.id} status updated to ${status}`,
    source_refs: recommendation.source_refs,
    policy_level: recommendation.policy_result.level,
    payload: {
      status
    }
  });
  return recommendation;
}

export function linkOutcomeToRecommendation(recommendationId: string, outcomeId: string): RecommendationRecord {
  const recommendation = recommendations.get(recommendationId);
  if (!recommendation) {
    throw new Error(`Recommendation not found: ${recommendationId}`);
  }
  recommendation.outcome_id = outcomeId;
  recordReplayEvent({
    event_type: 'outcome_linked',
    entity_id: recommendation.entity_id,
    signal_id: recommendation.signal_id,
    recommendation_id: recommendation.id,
    outcome_id: outcomeId,
    summary: `Recommendation ${recommendation.id} linked to outcome ${outcomeId}`,
    source_refs: recommendation.source_refs,
    policy_level: recommendation.policy_result.level,
    payload: {
      outcome_id: outcomeId
    }
  });
  return recommendation;
}

export function getRecommendationById(id: string): RecommendationRecord | undefined {
  return recommendations.get(id);
}

export function getRecommendationsForEntity(entityId: string): RecommendationRecord[] {
  const canonicalEntityId = canonicalizeEntityId(entityId);
  const ids = recommendationIndexByEntity.get(canonicalEntityId) || [];
  return ids
    .map((id) => recommendations.get(id))
    .filter((recommendation): recommendation is RecommendationRecord => Boolean(recommendation))
    .sort((left, right) => {
      const dateSort = Date.parse(right.created_at) - Date.parse(left.created_at);
      if (dateSort !== 0) return dateSort;
      return (recommendationOrder.get(right.id) ?? 0) - (recommendationOrder.get(left.id) ?? 0);
    });
}

export function getRecentRecommendations(limit = 20): RecommendationRecord[] {
  const maxItems = Math.max(1, Math.min(100, limit));
  return [...recommendations.values()].sort((left, right) => {
    const dateSort = Date.parse(right.created_at) - Date.parse(left.created_at);
    if (dateSort !== 0) return dateSort;
    return (recommendationOrder.get(right.id) ?? 0) - (recommendationOrder.get(left.id) ?? 0);
  }).slice(0, maxItems);
}
