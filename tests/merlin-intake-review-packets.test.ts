import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { IntentActionDefinition, UploadIntent, UploadIntentFileRef } from '../src/merlin/intake/intakeTypes.js';
import { buildHeldRoutingReviewPackets } from '../src/merlin/intake/reviewPackets.ts';
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
    uploadId: 'upload-intent-review-fixture',
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

test('buildHeldRoutingReviewPackets creates deterministic packets for ambiguous held routing', () => {
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
  const routing = routeUploadIntentFiles(intent);
  const packets = buildHeldRoutingReviewPackets(intent, routing);

  assert.equal(packets.length, 1);
  assert.deepEqual(packets[0], {
    packetId: 'merlin-routing-review:upload-intent-review-fixture:file-ambiguous',
    uploadId: 'upload-intent-review-fixture',
    fileId: 'file-ambiguous',
    fileName: 'menu-hours.png',
    declaredIntent: {
      brand: 'MEALSCOUT',
      actionId: 'update_menu',
      actorScope: 'owner',
      entityType: 'food_truck',
      entityId: 'truck-1'
    },
    detectedEvidenceSignals: ['menu_signal_detected', 'schedule_signal_detected', 'competing_destination_signals'],
    proposedDestination: undefined,
    holdReason: 'ambiguous',
    confidence: {
      score: 0.55,
      reasons: ['menu_signal_detected', 'schedule_signal_detected', 'competing_destination_signals']
    },
    operatorActionOptions: ['approve_route', 'change_destination', 'request_more_info', 'reject_upload', 'defer'],
    mutationAllowed: false,
    implementationAllowed: false
  });
});

test('buildHeldRoutingReviewPackets includes proposed destination for intent/evidence mismatch', () => {
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
  const routing = routeUploadIntentFiles(intent);
  const [packet] = buildHeldRoutingReviewPackets(intent, routing);

  assert.equal(packet.proposedDestination, 'schedule');
  assert.equal(packet.holdReason, 'INTENT_EVIDENCE_CONFLICT');
  assert.equal(packet.detectedEvidenceSignals.includes('schedule_signal_detected'), true);
  assert.equal(packet.detectedEvidenceSignals.includes('expected_route_menu'), true);
  assert.equal(packet.detectedEvidenceSignals.includes('intent_destination_mismatch'), true);
  assert.equal(packet.confidence.score, 0.7);
  assert.equal(packet.confidence.reasons.includes('intent_destination_mismatch'), true);
});

test('buildHeldRoutingReviewPackets returns no packets for confident routing', () => {
  const intent = makeIntent({
    actionId: 'add_food_photos',
    files: [
      {
        fileId: 'file-photo',
        fileName: 'tacos.jpg',
        mimeType: 'image/jpeg',
        extractedText: ''
      }
    ]
  });
  const routing = routeUploadIntentFiles(intent);
  const packets = buildHeldRoutingReviewPackets(intent, routing);

  assert.equal(routing[0].routedType, 'photo');
  assert.deepEqual(packets, []);
});
