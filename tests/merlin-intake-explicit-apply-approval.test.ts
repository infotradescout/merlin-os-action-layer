import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  HeldRoutingApplyEligibility,
  HeldRoutingOperatorDecision,
  HeldRoutingReviewPacket,
  IntentActionDefinition,
  UploadIntent,
  UploadIntentFileRef
} from '../src/merlin/intake/intakeTypes.js';
import {
  applyHeldRoutingOperatorDecision,
  buildHeldRoutingReviewPackets,
  createHeldRoutingExplicitApplyApproval,
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
    uploadId: 'upload-intent-explicit-approval-fixture',
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

function unsafeEligibility(overrides: Partial<HeldRoutingApplyEligibility>): HeldRoutingApplyEligibility {
  return {
    applyEligible: true,
    reason: 'apply_ready_requires_explicit_approval',
    packetId: 'packet-fixture',
    decisionId: 'decision-fixture',
    resolvedDestination: 'menu',
    requiresExplicitApplyApproval: true,
    mutationAllowed: false,
    implementationAllowed: false,
    ...overrides
  } as unknown as HeldRoutingApplyEligibility;
}

test('eligible approve_route can create explicit apply approval', () => {
  const packet = mismatchPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'approve_route',
    operatorId: 'operator-a',
    note: 'approve route'
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);

  const approval = createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: 'approval-approve-route',
    operatorId: 'operator-a',
    approvedAt: '2026-06-10T12:00:00.000Z'
  });

  assert.deepEqual(approval, {
    approvalId: 'approval-approve-route',
    packetId: packet.packetId,
    decisionId: decision.decisionId,
    operatorId: 'operator-a',
    approvedAt: '2026-06-10T12:00:00.000Z',
    resolvedDestination: 'schedule',
    applyApproved: true,
    reason: 'explicit_apply_approval_recorded',
    requiresFinalExecutor: true,
    mutationAllowed: false,
    implementationAllowed: false
  });
});

test('eligible change_destination can create explicit apply approval', () => {
  const packet = ambiguousPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'change_destination',
    operatorId: 'operator-b',
    selectedDestination: 'menu',
    note: 'change to menu'
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);

  const approval = createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: 'approval-change-destination',
    operatorId: 'operator-b',
    approvedAt: '2026-06-10T12:01:00.000Z'
  });

  assert.equal(approval.applyApproved, true);
  assert.equal(approval.reason, 'explicit_apply_approval_recorded');
  assert.equal(approval.resolvedDestination, 'menu');
  assert.equal(approval.requiresFinalExecutor, true);
  assert.equal(approval.mutationAllowed, false);
  assert.equal(approval.implementationAllowed, false);
});

test('ineligible records are refused', () => {
  const packet = mismatchPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'request_more_info',
    operatorId: 'operator-c',
    note: 'need clarification'
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);

  const approval = createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: 'approval-ineligible',
    operatorId: 'operator-c',
    approvedAt: '2026-06-10T12:02:00.000Z'
  });

  assert.equal(approval.applyApproved, false);
  assert.equal(approval.reason, 'ineligible_decision');
});

test('packet mismatch is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({
    packetId: 'other-packet',
    decisionId: 'decision-mismatch-packet'
  });
  const eligibility = unsafeEligibility({
    packetId: packet.packetId,
    decisionId: 'decision-mismatch-packet'
  });

  const approval = createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: 'approval-packet-mismatch',
    operatorId: 'operator-d',
    approvedAt: '2026-06-10T12:03:00.000Z'
  });

  assert.equal(approval.applyApproved, false);
  assert.equal(approval.reason, 'packet_mismatch');
});

test('decision mismatch is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({
    packetId: packet.packetId,
    decisionId: 'decision-a'
  });
  const eligibility = unsafeEligibility({
    packetId: packet.packetId,
    decisionId: 'decision-b'
  });

  const approval = createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: 'approval-decision-mismatch',
    operatorId: 'operator-e',
    approvedAt: '2026-06-10T12:04:00.000Z'
  });

  assert.equal(approval.applyApproved, false);
  assert.equal(approval.reason, 'decision_mismatch');
});

test('mutationAllowed true is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: decision.decisionId, mutationAllowed: true as false });

  const approval = createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: 'approval-mutation-refused',
    operatorId: 'operator-f',
    approvedAt: '2026-06-10T12:05:00.000Z'
  });

  assert.equal(approval.applyApproved, false);
  assert.equal(approval.reason, 'mutation_not_allowed');
});

test('implementationAllowed true is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, implementationAllowed: true as false });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: decision.decisionId });

  const approval = createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: 'approval-implementation-refused',
    operatorId: 'operator-g',
    approvedAt: '2026-06-10T12:06:00.000Z'
  });

  assert.equal(approval.applyApproved, false);
  assert.equal(approval.reason, 'implementation_not_allowed');
});

test('missing operatorId is refused', () => {
  const packet = mismatchPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'approve_route',
    operatorId: 'operator-h',
    note: 'approve route'
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);

  const approval = createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: 'approval-missing-operator',
    operatorId: ' ',
    approvedAt: '2026-06-10T12:07:00.000Z'
  });

  assert.equal(approval.applyApproved, false);
  assert.equal(approval.reason, 'missing_operator_id');
});

test('no packet mutation occurs', () => {
  const packet = mismatchPacket();
  const before = structuredClone(packet);
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'approve_route',
    operatorId: 'operator-i',
    note: 'approve route'
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);

  createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: 'approval-no-packet-mutation',
    operatorId: 'operator-i',
    approvedAt: '2026-06-10T12:08:00.000Z'
  });

  assert.deepEqual(packet, before);
});
