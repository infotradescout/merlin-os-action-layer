import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { HeldRoutingReviewPacket, IntentActionDefinition, UploadIntent, UploadIntentFileRef } from '../src/merlin/intake/intakeTypes.js';
import { applyHeldRoutingOperatorDecision, buildHeldRoutingReviewPackets } from '../src/merlin/intake/reviewPackets.ts';
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
    uploadId: 'upload-intent-decision-fixture',
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

test('approve_route resolves to approved_for_apply without mutating packet or implementation state', () => {
  const packet = mismatchPacket();
  const before = structuredClone(packet);
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'approve_route',
    operatorId: 'operator-a',
    note: 'schedule is acceptable for this upload'
  });

  assert.equal(decision.decisionId, `merlin-routing-decision:${packet.packetId}:approve_route:operator-a:schedule`);
  assert.equal(decision.packetId, packet.packetId);
  assert.equal(decision.action, 'approve_route');
  assert.equal(decision.operatorId, 'operator-a');
  assert.equal(decision.note, 'schedule is acceptable for this upload');
  assert.equal(decision.resultingStatus, 'approved_for_apply');
  assert.equal(decision.resolvedDestination, 'schedule');
  assert.equal(decision.stillRequiresApply, true);
  assert.equal(decision.mutationAllowed, false);
  assert.equal(decision.implementationAllowed, false);
  assert.deepEqual(packet, before);
});

test('change_destination records selected destination without mutating packet or applying', () => {
  const packet = ambiguousPacket();
  const before = structuredClone(packet);
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'change_destination',
    operatorId: 'operator-b',
    selectedDestination: 'menu',
    note: 'operator selected menu after review'
  });

  assert.equal(decision.action, 'change_destination');
  assert.equal(decision.resultingStatus, 'destination_changed_for_apply');
  assert.equal(decision.resolvedDestination, 'menu');
  assert.equal(decision.stillRequiresApply, true);
  assert.equal(decision.mutationAllowed, false);
  assert.equal(decision.implementationAllowed, false);
  assert.deepEqual(packet, before);
});

test('request_more_info leaves routing unresolved and pending information', () => {
  const packet = ambiguousPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'request_more_info',
    note: 'need owner confirmation'
  });

  assert.equal(decision.operatorId, 'operator-fixture');
  assert.equal(decision.action, 'request_more_info');
  assert.equal(decision.resultingStatus, 'pending_more_info');
  assert.equal(decision.resolvedDestination, undefined);
  assert.equal(decision.stillRequiresApply, false);
  assert.equal(decision.mutationAllowed, false);
  assert.equal(decision.implementationAllowed, false);
});

test('reject_upload blocks apply', () => {
  const packet = mismatchPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'reject_upload',
    operatorId: 'operator-c',
    note: 'wrong evidence'
  });

  assert.equal(decision.action, 'reject_upload');
  assert.equal(decision.resultingStatus, 'rejected');
  assert.equal(decision.stillRequiresApply, false);
  assert.equal(decision.resolvedDestination, undefined);
  assert.equal(decision.mutationAllowed, false);
  assert.equal(decision.implementationAllowed, false);
});

test('defer leaves packet held without apply path', () => {
  const packet = ambiguousPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'defer',
    operatorId: 'operator-d',
    note: 'waiting for shift lead'
  });

  assert.equal(decision.action, 'defer');
  assert.equal(decision.resultingStatus, 'deferred');
  assert.equal(decision.stillRequiresApply, false);
  assert.equal(decision.resolvedDestination, undefined);
  assert.equal(decision.mutationAllowed, false);
  assert.equal(decision.implementationAllowed, false);
});

test('invalid action fails closed', () => {
  const packet = mismatchPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'publish_now',
    operatorId: 'operator-e',
    note: 'attempted unsupported action'
  });

  assert.equal(decision.action, 'invalid_action');
  assert.equal(decision.resultingStatus, 'invalid_action');
  assert.equal(decision.stillRequiresApply, false);
  assert.equal(decision.resolvedDestination, undefined);
  assert.equal(decision.mutationAllowed, false);
  assert.equal(decision.implementationAllowed, false);
});
