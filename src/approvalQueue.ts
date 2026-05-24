import { randomUUID } from 'node:crypto';
import { type PolicyDecision } from './policy.js';
import {
  getRecommendationById,
  linkOutcomeToRecommendation,
  updateRecommendationStatus,
  type RecommendationStatus
} from './recommendations.js';
import { recordOutcome } from './outcomes.js';
import { recordReplayEvent } from './replay.js';
import { resolveEntityIdentity } from './entityResolution.js';

type RecommendationActionType =
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

type ApprovalStatus = 'pending' | 'approved' | 'dismissed' | 'completed' | 'failed' | 'expired';
type ApprovalPolicyLevel = PolicyDecision['level'];

type BrandLane = 'tradescout' | 'mealscout' | 'merlin' | 'lisa' | 'continuum' | 'marketfilter' | 'system';

interface ApprovalRecord {
  id: string;
  recommendation_id: string;
  entity_id: string;
  title: string;
  summary: string;
  action_type: RecommendationActionType;
  brand_lane: BrandLane;
  policy_level: ApprovalPolicyLevel;
  status: ApprovalStatus;
  created_at: string;
  decided_at?: string;
  outcome_id?: string;
  source_refs: string[];
}

interface CreateApprovalOptions {
  force?: boolean;
}

const approvals = new Map<string, ApprovalRecord>();
const approvalsByEntity = new Map<string, string[]>();
const approvalsByRecommendation = new Map<string, string[]>();
const approvalOrder = new Map<string, number>();
let approvalSequence = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function canonicalEntityId(entityId: string): string {
  return resolveEntityIdentity({ entity_id: entityId }).canonical_entity_id;
}

function isValidStatus(value: string): value is ApprovalStatus {
  return value === 'pending' || value === 'approved' || value === 'dismissed' || value === 'completed' || value === 'failed' || value === 'expired';
}

function indexForEntity(entityId: string, approvalId: string): void {
  const list = approvalsByEntity.get(entityId);
  if (!list) {
    approvalsByEntity.set(entityId, [approvalId]);
    return;
  }
  list.push(approvalId);
}

function indexForRecommendation(recommendationId: string, approvalId: string): void {
  const list = approvalsByRecommendation.get(recommendationId);
  if (!list) {
    approvalsByRecommendation.set(recommendationId, [approvalId]);
    return;
  }
  list.push(approvalId);
}

function mapRecommendationStatus(status: ApprovalStatus): RecommendationStatus {
  if (status === 'approved') return 'accepted';
  if (status === 'dismissed') return 'dismissed';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'suggested';
}

function mapOutcomeStatus(status: ApprovalStatus): 'suggested' | 'accepted' | 'dismissed' | 'completed' | 'failed' | 'unknown' {
  if (status === 'approved') return 'accepted';
  if (status === 'dismissed') return 'dismissed';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  if (status === 'expired') return 'unknown';
  return 'suggested';
}

function needsApproval(recommendation: NonNullable<ReturnType<typeof getRecommendationById>>): boolean {
  return recommendation.policy_result.requires_approval === true || recommendation.policy_result.level === 'approval_required';
}

function recordApprovalReplay(approval: ApprovalRecord, summary: string, eventType: 'recommendation_status_updated' = 'recommendation_status_updated') {
  recordReplayEvent({
    event_type: eventType,
    entity_id: approval.entity_id,
    recommendation_id: approval.recommendation_id,
    outcome_id: approval.outcome_id,
    summary,
    source_refs: approval.source_refs,
    policy_level: approval.policy_level
  });
}

export function resetApprovalQueueForTest(): void {
  approvals.clear();
  approvalsByEntity.clear();
  approvalsByRecommendation.clear();
  approvalOrder.clear();
  approvalSequence = 0;
}

export function createApprovalFromRecommendation(recommendationId: string, options: CreateApprovalOptions = {}): ApprovalRecord | undefined {
  const recommendation = getRecommendationById(recommendationId);
  if (!recommendation) {
    throw new Error(`Recommendation not found: ${recommendationId}`);
  }

  if (!needsApproval(recommendation) && !options.force) {
    return undefined;
  }

  const existing = [...approvals.values()].find(
    (item) => item.recommendation_id === recommendation.id && item.status === 'pending'
  );
  if (existing) return existing;

  approvalSequence += 1;
  const createdAt = nowIso();
  const record: ApprovalRecord = {
    id: `approval-${randomUUID()}`,
    recommendation_id: recommendation.id,
    entity_id: recommendation.entity_id,
    title: recommendation.title,
    summary: recommendation.summary,
    action_type: recommendation.action_type,
    brand_lane: recommendation.brand_lane,
    policy_level: recommendation.policy_result.level,
    status: 'pending',
    created_at: createdAt,
    source_refs: recommendation.source_refs,
    outcome_id: recommendation.outcome_id
  };

  approvals.set(record.id, record);
  approvalOrder.set(record.id, approvalSequence);
  indexForEntity(record.entity_id, record.id);
  indexForRecommendation(record.recommendation_id, record.id);

  recordApprovalReplay(record, `Approval ${record.id} created for recommendation ${recommendation.id}`);
  return record;
}

function recordOutcomeForApproval(approval: ApprovalRecord): void {
  if (!approval.recommendation_id || approval.status === 'pending') return;

  const outcome = recordOutcome({
    entity_id: approval.entity_id,
    recommendation_id: approval.recommendation_id,
    action: approval.action_type,
    outcome: 'manual_done',
    status: mapOutcomeStatus(approval.status),
    source_refs: approval.source_refs
  });
  linkOutcomeToRecommendation(approval.recommendation_id, outcome.id);
  approval.outcome_id = outcome.id;
}

export function updateApprovalStatus(id: string, status: ApprovalStatus): ApprovalRecord {
  if (!isValidStatus(status)) {
    throw new Error(`Invalid approval status: ${status}`);
  }

  const approval = approvals.get(id);
  if (!approval) {
    throw new Error(`Approval not found: ${id}`);
  }

  approval.status = status;
  approval.decided_at = nowIso();

  if (status === 'approved' || status === 'dismissed' || status === 'completed' || status === 'failed') {
    const recommendation = getRecommendationById(approval.recommendation_id);
    if (recommendation) {
      updateRecommendationStatus(recommendation.id, mapRecommendationStatus(status));
    }

    recordOutcomeForApproval(approval);
  }

  recordApprovalReplay(approval, `Approval ${approval.id} status updated to ${status}`);
  return approval;
}

export function getApprovalById(id: string): ApprovalRecord | undefined {
  return approvals.get(id);
}

export function getPendingApprovals(): ApprovalRecord[] {
  return getRecentApprovals().filter((approval) => approval.status === 'pending');
}

export function getApprovalsForEntity(entityId: string): ApprovalRecord[] {
  const canonical = canonicalEntityId(entityId);
  const ids = approvalsByEntity.get(canonical) || [];
  return ids
    .map((id) => approvals.get(id))
    .filter((approval): approval is ApprovalRecord => Boolean(approval))
    .sort((left, right) => {
      const dateSort = Date.parse(right.created_at) - Date.parse(left.created_at);
      if (dateSort !== 0) return dateSort;
      return (approvalOrder.get(right.id) ?? 0) - (approvalOrder.get(left.id) ?? 0);
    });
}

export function getRecentApprovals(limit = 20): ApprovalRecord[] {
  const maxItems = Math.max(1, Math.min(100, limit));
  return [...approvals.values()]
    .sort((left, right) => {
      const dateSort = Date.parse(right.created_at) - Date.parse(left.created_at);
      if (dateSort !== 0) return dateSort;
      return (approvalOrder.get(right.id) ?? 0) - (approvalOrder.get(left.id) ?? 0);
    })
    .slice(0, maxItems);
}


