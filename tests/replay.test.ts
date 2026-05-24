import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  createRecommendation,
  linkOutcomeToRecommendation,
  resetRecommendationsForTest
} from '../src/recommendations.ts';
import { recordOutcome, resetOutcomesForTest } from '../src/outcomes.ts';
import {
  getRecentReplayEvents,
  getReplayEventById,
  getReplayEventsForEntity,
  getReplayEventsForOutcome,
  getReplayEventsForRecommendation,
  recordReplayEvent,
  resetReplayForTest
} from '../src/replay.ts';

beforeEach(() => {
  resetReplayForTest();
  resetRecommendationsForTest();
  resetOutcomesForTest();
});

test('record generic replay event', () => {
  const event = recordReplayEvent({
    event_type: 'event_ingested',
    entity_id: 'business_replay_generic',
    summary: 'A generic replay event was created',
    source_refs: ['lisa:generic'],
    created_at: '2026-05-23T09:00:00.000Z'
  });

  const found = getReplayEventById(event.id);
  assert.equal(found?.id, event.id);
  assert.equal(found?.event_type, 'event_ingested');
});

test('query replay events by entity', () => {
  recordReplayEvent({
    event_type: 'event_ingested',
    entity_id: 'business_replay_entity',
    summary: 'First event for entity',
    source_refs: ['lisa:first'],
    created_at: '2026-05-23T09:00:00.000Z'
  });

  recordReplayEvent({
    event_type: 'state_updated',
    entity_id: 'business_replay_entity',
    summary: 'State update for entity',
    source_refs: ['lisa:second'],
    created_at: '2026-05-23T11:00:00.000Z'
  });

  const events = getReplayEventsForEntity('business_replay_entity');
  assert.equal(events.length, 2);
  assert.equal(events[0].summary.includes('State update'), true);
  assert.equal(events[1].summary.includes('First event'), true);
});

test('query replay events by recommendation', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_replay_rec',
    title: 'Verify profile',
    summary: 'Profile data changed',
    action_type: 'approve_verification',
    brand_lane: 'tradescout',
    source_refs: ['lisa:source']
  });

  const events = getReplayEventsForRecommendation(recommendation.id);
  const hasCreated = events.some((event) => event.event_type === 'recommendation_created');
  const hasPolicy = events.some((event) => event.event_type === 'policy_evaluated');

  assert.equal(hasCreated, true);
  assert.equal(hasPolicy, true);
});

test('query replay events by outcome', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_replay_outcome',
    title: 'Follow-up customer',
    summary: 'Ask for response',
    action_type: 'draft_message',
    brand_lane: 'tradescout'
  });

  const outcome = recordOutcome({
    recommendation_id: recommendation.id,
    entity_id: recommendation.entity_id,
    action: 'follow_up_sent',
    outcome: 'customer_replied',
    status: 'completed'
  });

  const events = getReplayEventsForOutcome(outcome.id);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'outcome_recorded');
});

test('recent replay ordering', () => {
  const older = recordReplayEvent({
    event_type: 'event_ingested',
    summary: 'older event',
    source_refs: ['lisa:older'],
    created_at: '2026-05-23T09:00:00.000Z'
  });

  const newer = recordReplayEvent({
    event_type: 'state_updated',
    summary: 'newer event',
    source_refs: ['lisa:newer'],
    created_at: '2026-05-23T10:00:00.000Z'
  });

  const recent = getRecentReplayEvents(2);
  assert.equal(recent[0].id, newer.id);
  assert.equal(recent[1].id, older.id);
});

test('recommendation creation emits replay event', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_replay_emit',
    title: 'Draft verification message',
    summary: 'Customer asked to update docs',
    action_type: 'draft_message',
    brand_lane: 'tradescout',
    source_refs: ['lisa:create']
  });

  const events = getReplayEventsForEntity(recommendation.entity_id);
  const hasRecommendationCreated = events.some((event) => event.event_type === 'recommendation_created');
  const hasPolicyEvaluated = events.some((event) => event.event_type === 'policy_evaluated');

  assert.equal(hasRecommendationCreated, true);
  assert.equal(hasPolicyEvaluated, true);
});

test('outcome link emits replay event', () => {
  const recommendation = createRecommendation({
    entity_id: 'business_replay_link',
    title: 'Update internal status',
    summary: 'Draft internal note',
    action_type: 'create_task',
    brand_lane: 'merlin'
  });

  linkOutcomeToRecommendation(recommendation.id, 'outcome-123');

  const events = getReplayEventsForRecommendation(recommendation.id);
  const linked = events.find((event) => event.event_type === 'outcome_linked');

  assert.equal(linked?.recommendation_id, recommendation.id);
  assert.equal(linked?.outcome_id, 'outcome-123');
});
