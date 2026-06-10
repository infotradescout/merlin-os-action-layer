import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  HeldRoutingOperatorDecision,
  HeldRoutingReviewPacket,
  IntentActionDefinition,
  UploadIntent,
  UploadIntentFileRef
} from '../src/merlin/intake/intakeTypes.js';
import {
  applyHeldRoutingOperatorDecision,
  buildHeldRoutingReviewPackets,
  evaluateHeldRoutingApplyEligibility
} from '../src/merlin/intake/reviewPackets.ts';
import { routeUploadIntentFiles } from '../src/merlin/intake/router.ts';

function makeActionSnapshot(actionId: string): IntentActionDefinition {
  return {
    actionId,
    brand: 'MEALSCOUT',
    actorScope: 'owner',
    label: actionId,
    description: `MealScout action ${actionId}`,
    entityTypesAllowed: ['food_truck', 'restaurant', 'unknown'],
    expectedFileTypes: ['image/*', 'application/pdf', 'text/*'],
    allowedOutputTypes: ['menu_update'],
    allowedFieldPaths: ['menu.items'],
    forbiddenFieldPaths: ['businessName'],
    requiresEntityContext: true,
    requiresUserHint: false,
    previewRequired: true,
    approvalRequired: true,
    implementationMode: 'approval_required',
    riskLevel: 'medium'
  };
}

function makeIntent(input: { actionId: string; files: UploadIntentFileRef[] }): UploadIntent {
  return {
    uploadId: 'upload-intent-apply-gate-fixture',
    userId: 'u-1',
    accountId: 'a-1',
    brand: 'MEALSCOUT',
    actorScope: 'owner',
    entityType: 'food_truck',
    entityId: 'truck-1',
    actionId: input.actionId,
    actionSnapshot: makeActionSnapshot(input.actionId),
    files: input.files,
    routing: [],
    status: 'CREATED',
    implementationAllowed: false,
    mutationAllowed: false,
    previewRequired: true,
    approvalRequired: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  };
}

function mismatchPacket(): HeldRoutingReviewPacket {
  const intent = makeIntent({
    actionId: 'update_menu',
    files: [
      {
        fileId: 'file-schedule',
        fileName: 'hours.jpg',
        mimeType: 'image/jpeg',
        extractedText: 'Monday 11:00 AM - 8:00 PM'
      }
    ]
  });
  const [packet] = buildHeldRoutingReviewPackets(intent, routeUploadIntentFiles(intent));
  return packet;
}

function ambiguousPacket(): HeldRoutingReviewPacket {
  const intent = makeIntent({
    actionId: 'update_menu',
    files: [
      {
        fileId: 'file-ambiguous',
        fileName: 'menu-hours.png',
        mimeType: 'image/png',
        extractedText: 'Menu board Monday 11:00 AM - 8:00 PM'
      }
    ]
  });
  const [packet] = buildHeldRoutingReviewPackets(intent, routeUploadIntentFiles(intent));
  return packet;
}

function unsafeDecision(overrides: Partial<HeldRoutingOperatorDecision>): HeldRoutingOperatorDecision {
  return {
    decisionId: 'decision-fixture',
    packetId: 'packet-fixture',
    action: 'approve_route',
    operatorId: 'operator-fixture',
    note: 'fixture',
    resultingStatus: 'approved_for_apply',
    resolvedDestination: 'menu',
    stillRequiresApply: true,
    mutationAllowed: false,
    implementationAllowed: false,
    ...overrides
  } as unknown as HeldRoutingOperatorDecision;
}

test('approve_route is apply eligible but still requires explicit apply approval', () => {
  const packet = mismatchPacket();
  const before = structuredClone(packet);
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'approve_route',
    operatorId: 'operator-a',
    note: 'approve proposed route'
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);

  assert.deepEqual(eligibility, {
    applyEligible: true,
    reason: 'apply_ready_requires_explicit_approval',
    packetId: packet.packetId,
    decisionId: decision.decisionId,
    resolvedDestination: 'schedule',
    requiresExplicitApplyApproval: true,
    mutationAllowed: false,
    implementationAllowed: false
  });
  assert.deepEqual(packet, before);
});

test('change_destination is apply eligible but still requires explicit apply approval', () => {
  const packet = ambiguousPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'change_destination',
    operatorId: 'operator-b',
    selectedDestination: 'menu',
    note: 'route as menu'
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);

  assert.equal(eligibility.applyEligible, true);
  assert.equal(eligibility.reason, 'apply_ready_requires_explicit_approval');
  assert.equal(eligibility.resolvedDestination, 'menu');
  assert.equal(eligibility.requiresExplicitApplyApproval, true);
  assert.equal(eligibility.mutationAllowed, false);
  assert.equal(eligibility.implementationAllowed, false);
});

test('invalid_action is not apply eligible', () => {
  const packet = mismatchPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'publish_now',
    operatorId: 'operator-c'
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);

  assert.equal(eligibility.applyEligible, false);
  assert.equal(eligibility.reason, 'invalid_action');
});

test('mutationAllowed true is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, mutationAllowed: true as false });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);

  assert.equal(eligibility.applyEligible, false);
  assert.equal(eligibility.reason, 'mutation_not_allowed');
});

test('implementationAllowed true is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, implementationAllowed: true as false });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);

  assert.equal(eligibility.applyEligible, false);
  assert.equal(eligibility.reason, 'implementation_not_allowed');
});

test('packet mismatch is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: 'other-packet' });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);

  assert.equal(eligibility.applyEligible, false);
  assert.equal(eligibility.reason, 'packet_mismatch');
});

test('missing resolvedDestination is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, resolvedDestination: undefined });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);

  assert.equal(eligibility.applyEligible, false);
  assert.equal(eligibility.reason, 'missing_resolved_destination');
});

test('missing identifiers and non-apply decisions fail closed', () => {
  const packet = mismatchPacket();
  const missingDecisionId = evaluateHeldRoutingApplyEligibility(packet, unsafeDecision({ packetId: packet.packetId, decisionId: '' }));
  const missingOperatorId = evaluateHeldRoutingApplyEligibility(packet, unsafeDecision({ packetId: packet.packetId, operatorId: '' }));
  const stillRequiresApplyFalse = evaluateHeldRoutingApplyEligibility(packet, unsafeDecision({ packetId: packet.packetId, stillRequiresApply: false }));
  const nonApplyStatus = evaluateHeldRoutingApplyEligibility(packet, unsafeDecision({
    packetId: packet.packetId,
    action: 'request_more_info',
    resultingStatus: 'pending_more_info'
  }));

  assert.equal(missingDecisionId.reason, 'missing_decision_id');
  assert.equal(missingOperatorId.reason, 'missing_operator_id');
  assert.equal(stillRequiresApplyFalse.reason, 'still_requires_apply_false');
  assert.equal(nonApplyStatus.reason, 'decision_not_apply_ready');
});
