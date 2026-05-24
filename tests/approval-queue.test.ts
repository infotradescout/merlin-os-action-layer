import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { createRecommendation, getRecommendationById, resetRecommendationsForTest } from '../src/recommendations.ts';
import {
  createApprovalFromRecommendation,
  getApprovalById,
  getApprovalsForEntity,
  getPendingApprovals,
  getRecentApprovals,
  resetApprovalQueueForTest,
  updateApprovalStatus
} from '../src/approvalQueue.ts';
import { getOutcomeById } from '../src/outcomes.ts';

beforeEach(() => {
  resetRecommendationsForTest();
  resetApprovalQueueForTest();
});

test('create approval from approval_required recommendation', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_approval_required',
    title: 'Request identity verification',
    summary: 'Need approver confirmation',
    action_type: 'approve_verification',
    brand_lane: 'tradescout',
    source_refs: ['tradescout:entity-1']
  });

  const approval = createApprovalFromRecommendation(recommendation.id);

  assert.equal(typeof approval?.id, 'string');
  assert.equal(approval?.status, 'pending');
  assert.equal(approval?.entity_id, recommendation.entity_id);
  assert.equal(approval?.policy_level, 'approval_required');
});

test('do not create approval from draft_only recommendation unless explicitly forced', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_draft_only',
    title: 'Draft outreach note',
    summary: 'Prepare draft',
    action_type: 'draft_message',
    brand_lane: 'tradescout'
  });

  const auto = createApprovalFromRecommendation(recommendation.id);
  const forced = createApprovalFromRecommendation(recommendation.id, { force: true });

  assert.equal(auto, undefined);
  assert.equal(typeof forced?.id, 'string');
  assert.equal(forced?.status, 'pending');
});

test('approve updates approval status', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_approve',
    title: 'Approve customer verification',
    summary: 'Approval required action',
    action_type: 'approve_verification',
    brand_lane: 'tradescout'
  });

  const approval = createApprovalFromRecommendation(recommendation.id);
  assert.ok(approval);

  const approved = updateApprovalStatus(approval.id, 'approved');
  const recommendationAfter = getRecommendationById(recommendation.id);

  assert.equal(approved.status, 'approved');
  assert.equal(recommendationAfter?.status, 'accepted');
});

test('dismiss updates approval and recommendation status', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_dismiss',
    title: 'Approve verification',
    summary: 'Not proceeding',
    action_type: 'approve_verification',
    brand_lane: 'tradescout'
  });

  const approval = createApprovalFromRecommendation(recommendation.id);
  assert.ok(approval);

  const dismissed = updateApprovalStatus(approval.id, 'dismissed');
  const recommendationAfter = getRecommendationById(recommendation.id);

  assert.equal(dismissed.status, 'dismissed');
  assert.equal(recommendationAfter?.status, 'dismissed');
});

test('complete links outcome', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_complete',
    title: 'Approve verification',
    summary: 'Complete flow',
    action_type: 'approve_verification',
    brand_lane: 'tradescout'
  });

  const approval = createApprovalFromRecommendation(recommendation.id);
  assert.ok(approval);

  const complete = updateApprovalStatus(approval.id, 'completed');
  const updatedApproval = getApprovalById(approval.id);

  assert.equal(complete.status, 'completed');
  assert.equal(typeof updatedApproval?.outcome_id, 'string');
  assert.equal(typeof getOutcomeById(updatedApproval?.outcome_id || '')?.id, 'string');
});

test('query pending approvals', () => {
  const firstRequirement = createRecommendation({
    entity_id: 'business_pending_1',
    title: 'Approve first item',
    summary: 'Needs approval',
    action_type: 'approve_verification',
    brand_lane: 'tradescout'
  });
  const secondRequirement = createRecommendation({
    entity_id: 'business_pending_2',
    title: 'Approve second item',
    summary: 'Needs approval',
    action_type: 'approve_verification',
    brand_lane: 'tradescout'
  });

  const first = createApprovalFromRecommendation(firstRequirement.id);
  const second = createApprovalFromRecommendation(secondRequirement.id);

  updateApprovalStatus(second!.id, 'approved');

  const pending = getPendingApprovals();
  const ids = pending.map((item) => item.id);

  assert.equal(ids.includes(first!.id), true);
  assert.equal(ids.includes(second!.id), false);
  assert.equal(pending.length, 1);
});
test('query approvals by entity', () => {
  const recommendationA = createRecommendation({
    entity_id: 'business_entity_1',
    title: 'Approve verification',
    summary: 'Needs approval',
    action_type: 'approve_verification',
    brand_lane: 'tradescout'
  });
  const recommendationB = createRecommendation({
    entity_id: 'business_entity_1',
    title: 'Approve another',
    summary: 'Needs approval',
    action_type: 'approve_verification',
    brand_lane: 'tradescout'
  });
  const recommendationC = createRecommendation({
    entity_id: 'business_entity_2',
    title: 'Approve another',
    summary: 'Needs approval',
    action_type: 'approve_verification',
    brand_lane: 'tradescout'
  });

  const first = createApprovalFromRecommendation(recommendationA.id);
  const second = createApprovalFromRecommendation(recommendationB.id);
  createApprovalFromRecommendation(recommendationC.id);

  const entityOneApprovals = getApprovalsForEntity('business_entity_1');
  const ids = entityOneApprovals.map((item) => item.id);

  assert.equal(ids.includes(first?.id as string), true);
  assert.equal(ids.includes(second?.id as string), true);
  assert.equal(entityOneApprovals.length, 2);
});

test('recent approvals ordering', () => {
  const recommendationA = createRecommendation({
    entity_id: 'business_recent_1',
    title: 'Approve verification',
    summary: 'Needs approval',
    action_type: 'approve_verification',
    brand_lane: 'tradescout'
  });
  const recommendationB = createRecommendation({
    entity_id: 'business_recent_2',
    title: 'Approve verification',
    summary: 'Needs approval',
    action_type: 'approve_verification',
    brand_lane: 'tradescout'
  });

  const older = createApprovalFromRecommendation(recommendationA.id);
  const newer = createApprovalFromRecommendation(recommendationB.id);

  const recent = getRecentApprovals(5);
  assert.equal(recent[0].id, newer?.id);
  assert.equal(recent[1].id, older?.id);
});

