import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  createRecommendation,
  getOutcomeById,
  getOutcomesForEntity,
  getRecentOutcomes,
  recordOutcome,
  resetOutcomesForTest
} from '../src/outcomes.ts';

beforeEach(() => {
  resetOutcomesForTest();
});

test('create recommendation', () => {
  const recommendation = createRecommendation({
    recommendation: 'Review insurance document',
    action: 'document_reviewed',
    entity_id: 'business_001'
  });

  assert.equal(recommendation.recommendation, 'Review insurance document');
  assert.equal(recommendation.action, 'document_reviewed');
  assert.equal(recommendation.entity_id, 'business_001');
  assert.equal(recommendation.status, 'suggested');
});

test('record accepted outcome', () => {
  const recommendation = createRecommendation({
    recommendation: 'Call customer about follow-up',
    action: 'follow_up_sent',
    entity_id: 'business_accept',
    signal_id: 'signal-accept-1'
  });

  const outcome = recordOutcome({
    recommendation_id: recommendation.id,
    action: 'follow_up_sent',
    outcome: 'customer_replied',
    status: 'accepted',
    result: 'Customer confirmed quote details'
  });

  assert.equal(outcome.recommendation_id, recommendation.id);
  assert.equal(outcome.entity_id, recommendation.entity_id);
  assert.equal(outcome.status, 'accepted');
  assert.equal(outcome.outcome, 'customer_replied');
  assert.equal(outcome.result, 'Customer confirmed quote details');
  assert.equal(outcome.signal_id, 'signal-accept-1');
});

test('record dismissed outcome', () => {
  const recommendation = createRecommendation({
    recommendation: 'Review pending contract',
    action: 'document_reviewed',
    entity_id: 'business_dismiss'
  });

  const outcome = recordOutcome({
    recommendation_id: recommendation.id,
    action: 'no_action',
    outcome: 'manual_done',
    status: 'dismissed',
    result: 'Ignored stale reminder'
  });

  assert.equal(outcome.status, 'dismissed');
  assert.equal(outcome.outcome, 'manual_done');
  assert.equal(outcome.result, 'Ignored stale reminder');
});

test('record completed outcome', () => {
  const recommendation = createRecommendation({
    recommendation: 'Send final invoice',
    action: 'quote_accepted',
    entity_id: 'business_done',
    signal_id: 'signal-complete-1'
  });

  const outcome = recordOutcome({
    recommendation_id: recommendation.id,
    action: 'invoice_sent',
    outcome: 'job_booked',
    status: 'completed',
    result: 'Job booked and payment collected'
  });

  assert.equal(outcome.status, 'completed');
  assert.equal(outcome.outcome, 'job_booked');
  assert.equal(outcome.signal_id, 'signal-complete-1');
});

test('query outcomes by entity', () => {
  const recommendation = createRecommendation({
    recommendation: 'Review contractor profile',
    action: 'document_reviewed',
    entity_id: 'business_query'
  });

  const first = recordOutcome({
    recommendation_id: recommendation.id,
    action: 'document_reviewed',
    outcome: 'document_reviewed',
    status: 'accepted'
  });

  const second = recordOutcome({
    entity_id: 'business_query',
    action: 'follow_up_sent',
    outcome: 'follow_up_sent',
    status: 'failed'
  });

  const outcomes = getOutcomesForEntity('business_query');
  assert.equal(outcomes.length, 2);
  const ids = outcomes.map((outcome) => outcome.id);
  assert.equal(ids.includes(first.id), true);
  assert.equal(ids.includes(second.id), true);
});

test('recent outcomes ordering', () => {
  const recommendation = createRecommendation({
    recommendation: 'Track response',
    action: 'customer_replied',
    entity_id: 'business_recent'
  });

  const oldest = recordOutcome({
    recommendation_id: recommendation.id,
    action: 'track',
    outcome: 'no_response',
    status: 'suggested',
    observed_at: '2026-05-23T10:00:00.000Z'
  });
  const newest = recordOutcome({
    recommendation_id: recommendation.id,
    action: 'track',
    outcome: 'customer_replied',
    status: 'accepted',
    observed_at: '2026-05-23T12:00:00.000Z'
  });

  const recent = getRecentOutcomes(10);
  const first = recent[0];
  const second = recent[1];
  assert.equal(first.id, newest.id);
  assert.equal(second.id, oldest.id);
});

test('unknown outcome fallback', () => {
  const recommendation = createRecommendation({
    recommendation: 'Review unknown signal',
    action: 'manual_done',
    entity_id: 'business_unknown'
  });

  const outcome = recordOutcome({
    recommendation_id: recommendation.id,
    action: 'manual_done',
    outcome: 'not-a-real-outcome',
    status: 'mystery-status'
  });

  assert.equal(outcome.status, 'unknown');
  assert.equal(outcome.outcome, 'manual_done');
  assert.equal(getOutcomeById(outcome.id)?.id, outcome.id);
});
