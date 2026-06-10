import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  HeldRoutingApplyEligibility,
  HeldRoutingExplicitApplyApproval,
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
  createHeldRoutingFinalExecutorPreview,
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
    uploadId: 'upload-intent-final-executor-preview-fixture',
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

function unsafeApproval(overrides: Partial<HeldRoutingExplicitApplyApproval>): HeldRoutingExplicitApplyApproval {
  return {
    approvalId: 'approval-fixture',
    packetId: 'packet-fixture',
    decisionId: 'decision-fixture',
    operatorId: 'operator-fixture',
    approvedAt: '2026-06-10T12:00:00.000Z',
    resolvedDestination: 'menu',
    applyApproved: true,
    reason: 'explicit_apply_approval_recorded',
    requiresFinalExecutor: true,
    mutationAllowed: false,
    implementationAllowed: false,
    ...overrides
  } as unknown as HeldRoutingExplicitApplyApproval;
}

function buildApprovalChain(input: {
  action: 'approve_route' | 'change_destination';
  operatorId: string;
  note: string;
  selectedDestination?: 'menu' | 'schedule' | 'logo' | 'photo' | 'document';
}) {
  const packet = input.action === 'approve_route' ? mismatchPacket() : ambiguousPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: input.action,
    operatorId: input.operatorId,
    note: input.note,
    selectedDestination: input.selectedDestination
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);
  const approval = createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: `approval-${input.action}`,
    operatorId: input.operatorId,
    approvedAt: '2026-06-10T12:00:00.000Z'
  });

  return { packet, decision, eligibility, approval };
}

test('approved approve_route can create final executor preview', () => {
  const { packet, decision, eligibility, approval } = buildApprovalChain({
    action: 'approve_route',
    operatorId: 'operator-a',
    note: 'approve route'
  });

  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-approve-route'
  });

  assert.deepEqual(preview, {
    previewId: 'preview-approve-route',
    packetId: packet.packetId,
    decisionId: decision.decisionId,
    approvalId: approval.approvalId,
    resolvedDestination: 'schedule',
    readyForFinalExecutor: true,
    reason: 'final_executor_preview_ready',
    requiresFinalExecution: true,
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false
  });
});

test('approved change_destination can create final executor preview', () => {
  const { packet, decision, eligibility, approval } = buildApprovalChain({
    action: 'change_destination',
    operatorId: 'operator-b',
    note: 'change to menu',
    selectedDestination: 'menu'
  });

  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-change-destination'
  });

  assert.equal(preview.readyForFinalExecutor, true);
  assert.equal(preview.reason, 'final_executor_preview_ready');
  assert.equal(preview.resolvedDestination, 'menu');
  assert.equal(preview.requiresFinalExecution, true);
  assert.equal(preview.mutationAllowed, false);
  assert.equal(preview.implementationAllowed, false);
  assert.equal(preview.executionAllowed, false);
});

test('ineligible eligibility is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-a', resolvedDestination: 'schedule' });
  const eligibility = unsafeEligibility({
    applyEligible: false,
    packetId: packet.packetId,
    decisionId: 'decision-a',
    resolvedDestination: 'schedule'
  });
  const approval = unsafeApproval({
    packetId: packet.packetId,
    decisionId: 'decision-a',
    resolvedDestination: 'schedule'
  });

  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-ineligible-eligibility'
  });

  assert.equal(preview.readyForFinalExecutor, false);
  assert.equal(preview.reason, 'ineligible_eligibility');
});

test('unapproved approval is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-b', resolvedDestination: 'schedule' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-b', resolvedDestination: 'schedule' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-b', applyApproved: false, resolvedDestination: 'schedule' });

  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-unapproved'
  });

  assert.equal(preview.readyForFinalExecutor, false);
  assert.equal(preview.reason, 'approval_not_applied');
});

test('packet mismatch is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: 'other-packet', decisionId: 'decision-c' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-c' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-c' });

  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-packet-mismatch'
  });

  assert.equal(preview.readyForFinalExecutor, false);
  assert.equal(preview.reason, 'packet_mismatch');
});

test('decision mismatch is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-d-1' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-d-2' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-d-1' });

  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-decision-mismatch'
  });

  assert.equal(preview.readyForFinalExecutor, false);
  assert.equal(preview.reason, 'decision_mismatch');
});

test('approval mismatch is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-e', resolvedDestination: 'schedule' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-e', resolvedDestination: 'schedule' });
  const approval = unsafeApproval({
    approvalId: 'approval-e',
    packetId: packet.packetId,
    decisionId: 'decision-e',
    resolvedDestination: 'menu'
  });

  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-approval-mismatch'
  });

  assert.equal(preview.readyForFinalExecutor, false);
  assert.equal(preview.reason, 'approval_mismatch');
});

test('mutationAllowed true is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-f' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-f', mutationAllowed: true as false });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-f' });

  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-mutation-refused'
  });

  assert.equal(preview.readyForFinalExecutor, false);
  assert.equal(preview.reason, 'mutation_not_allowed');
});

test('implementationAllowed true is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-g', implementationAllowed: true as false });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-g' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-g' });

  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-implementation-refused'
  });

  assert.equal(preview.readyForFinalExecutor, false);
  assert.equal(preview.reason, 'implementation_not_allowed');
});

test('executionAllowed true is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-h' }) as HeldRoutingOperatorDecision & { executionAllowed?: boolean };
  decision.executionAllowed = true;
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-h' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-h' });

  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-execution-refused'
  });

  assert.equal(preview.readyForFinalExecutor, false);
  assert.equal(preview.reason, 'execution_not_allowed');
});

test('no packet mutation occurs', () => {
  const { packet, decision, eligibility, approval } = buildApprovalChain({
    action: 'approve_route',
    operatorId: 'operator-z',
    note: 'approve route'
  });
  const before = structuredClone(packet);

  createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-no-packet-mutation'
  });

  assert.deepEqual(packet, before);
});
