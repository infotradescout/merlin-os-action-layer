import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { evaluatePolicy, resetPolicyForTest } from '../src/policy.ts';

beforeEach(() => {
  resetPolicyForTest();
});

test('read-only view allowed', () => {
  const decision = evaluatePolicy({
    action_type: 'view_context',
    brand_lane: 'tradescout'
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.level, 'read_only');
  assert.equal(decision.requires_approval, false);
  assert.equal(decision.blocked, false);
  assert.equal(decision.brand_lane, 'tradescout');
  assert.equal(decision.action_type, 'view_context');
});

test('draft message allowed as draft only', () => {
  const decision = evaluatePolicy({
    action_type: 'draft_message',
    brand_lane: 'mealscout'
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.level, 'draft_only');
  assert.equal(decision.requires_approval, false);
  assert.equal(decision.blocked, false);
  assert.equal(decision.action_type, 'draft_message');
});

test('send external message requires approval', () => {
  const decision = evaluatePolicy({
    action_type: 'send_external_message',
    brand_lane: 'tradescout'
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.level, 'approval_required');
  assert.equal(decision.requires_approval, true);
  assert.equal(decision.blocked, false);
});

test('approve verification requires approval', () => {
  const decision = evaluatePolicy({
    action_type: 'approve_verification',
    brand_lane: 'tradescout'
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.level, 'approval_required');
  assert.equal(decision.requires_approval, true);
  assert.equal(decision.blocked, false);
});

test('payment action blocked', () => {
  const decision = evaluatePolicy({
    action_type: 'change_payment_state',
    brand_lane: 'tradescout'
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.level, 'blocked_high_risk');
  assert.equal(decision.blocked, true);
});

test('delete action blocked', () => {
  const decision = evaluatePolicy({
    action_type: 'delete_record',
    brand_lane: 'merlin'
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.level, 'blocked_high_risk');
  assert.equal(decision.blocked, true);
});

test('unknown action blocked safely', () => {
  const decision = evaluatePolicy({
    action_type: 'send_secret_plan',
    brand_lane: 'merlin'
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.level, 'blocked_high_risk');
  assert.equal(decision.blocked, true);
  assert.equal(decision.requires_approval, false);
  assert.equal(decision.brand_lane, 'merlin');
});
