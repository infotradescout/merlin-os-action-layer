import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  createRecommendation,
  getRecommendationById,
  getRecommendationsForEntity,
  getRecentRecommendations,
  linkOutcomeToRecommendation,
  resetRecommendationsForTest,
  updateRecommendationStatus
} from '../src/recommendations.ts';

beforeEach(() => {
  resetRecommendationsForTest();
});

test('create recommendation stores policy result', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_reco_001',
    title: 'Send follow-up message',
    summary: 'Customer has requested callback.',
    action_type: 'draft_message',
    brand_lane: 'tradescout',
    source_refs: ['lisa:abc']
  });

  assert.equal(recommendation.status, 'suggested');
  assert.equal(recommendation.policy_result.allowed, true);
  assert.equal(recommendation.policy_result.level, 'draft_only');
  assert.equal(recommendation.policy_result.brand_lane, 'tradescout');
  assert.equal(recommendation.action_type, 'draft_message');
});

test('draft action maps to draft_only', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_reco_002',
    title: 'Draft response draft',
    summary: 'Generate draft',
    action_type: 'draft_message',
    brand_lane: 'tradescout'
  });

  assert.equal(recommendation.policy_result.level, 'draft_only');
  assert.equal(recommendation.policy_result.requires_approval, false);
});

test('verification approval maps to approval_required', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_reco_003',
    title: 'Approve verification',
    summary: 'Review and approve verification',
    action_type: 'approve_verification',
    brand_lane: 'tradescout'
  });

  assert.equal(recommendation.policy_result.level, 'approval_required');
  assert.equal(recommendation.policy_result.requires_approval, true);
});

test('payment action is blocked_high_risk', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_reco_004',
    title: 'Change payment',
    summary: 'Update payment state',
    action_type: 'change_payment_state',
    brand_lane: 'tradescout'
  });

  assert.equal(recommendation.policy_result.allowed, false);
  assert.equal(recommendation.policy_result.level, 'blocked_high_risk');
  assert.equal(recommendation.policy_result.blocked, true);
});

test('status update works', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_reco_005',
    title: 'Update internal status',
    summary: 'Mark status',
    action_type: 'update_internal_status',
    brand_lane: 'merlin'
  });

  const updated = updateRecommendationStatus(recommendation.id, 'accepted');
  assert.equal(updated.status, 'accepted');
});

test('outcome link works', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_reco_006',
    title: 'Draft message',
    summary: 'Draft and send',
    action_type: 'draft_message',
    brand_lane: 'mealscout'
  });

  const linked = linkOutcomeToRecommendation(recommendation.id, 'outcome-123');
  assert.equal(linked.outcome_id, 'outcome-123');
});

test('query by entity works', () => {
  const first = createRecommendation({
    entity_id: 'business_reco_007',
    title: 'Suggest follow-up',
    summary: 'Follow up customer',
    action_type: 'suggest_follow_up',
    brand_lane: 'tradescout'
  });
  const second = createRecommendation({
    entity_id: 'business_reco_007',
    title: 'Create task',
    summary: 'Task for account',
    action_type: 'create_task',
    brand_lane: 'tradescout'
  });

  const list = getRecommendationsForEntity('business_reco_007');
  assert.equal(list.length, 2);
  const ids = list.map((item) => item.id);
  assert.equal(ids.includes(first.id), true);
  assert.equal(ids.includes(second.id), true);
});

test('recent recommendations ordering works', () => {
  const oldest = createRecommendation({
    entity_id: 'business_reco_008',
    title: 'Old',
    summary: 'Aging rec',
    action_type: 'create_task',
    brand_lane: 'merlin',
    ttlMinutes: 60
  });
  const newest = createRecommendation({
    entity_id: 'business_reco_009',
    title: 'New',
    summary: 'Fresh rec',
    action_type: 'create_task',
    brand_lane: 'merlin',
    ttlMinutes: 60
  });

  const recent = getRecentRecommendations(2);
  assert.equal(recent[0].id, newest.id);
  assert.equal(recent[1].id, oldest.id);
});

test('get recommendation by id', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_reco_010',
    title: 'Lookup',
    summary: 'Lookup rec',
    action_type: 'view_context',
    brand_lane: 'system'
  });

  const found = getRecommendationById(recommendation.id);
  assert.equal(found?.id, recommendation.id);
  assert.equal(found?.entity_id, recommendation.entity_id);
});
