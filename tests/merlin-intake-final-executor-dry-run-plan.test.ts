import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  HeldRoutingApplyEligibility,
  HeldRoutingExplicitApplyApproval,
  HeldRoutingFinalExecutorPreview,
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
  createHeldRoutingFinalExecutorDryRunPlan,
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
    uploadId: 'upload-intent-final-executor-dry-run-fixture',
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

function unsafePreview(overrides: Partial<HeldRoutingFinalExecutorPreview>): HeldRoutingFinalExecutorPreview {
  return {
    previewId: 'preview-fixture',
    packetId: 'packet-fixture',
    decisionId: 'decision-fixture',
    approvalId: 'approval-fixture',
    resolvedDestination: 'menu',
    readyForFinalExecutor: true,
    reason: 'final_executor_preview_ready',
    requiresFinalExecution: true,
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false,
    ...overrides
  } as unknown as HeldRoutingFinalExecutorPreview;
}

function buildPreviewChain(input: {
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
  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: `preview-${input.action}`
  });

  return { packet, decision, eligibility, approval, preview };
}

test('valid final executor preview creates dry-run plan', () => {
  const { packet, decision, eligibility, approval, preview } = buildPreviewChain({
    action: 'approve_route',
    operatorId: 'operator-a',
    note: 'approve route'
  });

  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-approve-route',
    previewId: preview.previewId
  });

  assert.equal(dryRun.reason, 'dry_run_ready_for_live_executor');
  assert.equal(dryRun.readyForExecution, false);
  assert.equal(dryRun.requiresLiveExecutor, true);
  assert.equal(dryRun.mutationAllowed, false);
  assert.equal(dryRun.implementationAllowed, false);
  assert.equal(dryRun.executionAllowed, false);
});

test('approve_route produces plannedOperation route_to_resolved_destination', () => {
  const { packet, decision, eligibility, approval, preview } = buildPreviewChain({
    action: 'approve_route',
    operatorId: 'operator-b',
    note: 'approve route'
  });

  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-planned-op-approve',
    previewId: preview.previewId
  });

  assert.equal(dryRun.plannedOperation, 'route_to_resolved_destination');
  assert.equal(dryRun.resolvedDestination, 'schedule');
});

test('change_destination produces plannedOperation route_to_resolved_destination', () => {
  const { packet, decision, eligibility, approval, preview } = buildPreviewChain({
    action: 'change_destination',
    operatorId: 'operator-c',
    note: 'change to menu',
    selectedDestination: 'menu'
  });

  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-planned-op-change',
    previewId: preview.previewId
  });

  assert.equal(dryRun.plannedOperation, 'route_to_resolved_destination');
  assert.equal(dryRun.resolvedDestination, 'menu');
});

test('missing dryRunId is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-missing-id', resolvedDestination: 'schedule' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-missing-id', resolvedDestination: 'schedule' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-missing-id', resolvedDestination: 'schedule', approvalId: 'approval-missing-id' });
  const preview = unsafePreview({ packetId: packet.packetId, decisionId: 'decision-missing-id', approvalId: 'approval-missing-id', resolvedDestination: 'schedule' });

  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: ''
  });

  assert.equal(dryRun.reason, 'missing_dry_run_id');
  assert.equal(dryRun.plannedOperation, 'refuse_invalid_preview');
});

test('preview not ready is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-preview-not-ready', resolvedDestination: 'schedule' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-preview-not-ready', resolvedDestination: 'schedule' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-preview-not-ready', resolvedDestination: 'schedule', approvalId: 'approval-preview-not-ready' });
  const preview = unsafePreview({
    packetId: packet.packetId,
    decisionId: 'decision-preview-not-ready',
    approvalId: 'approval-preview-not-ready',
    resolvedDestination: 'schedule',
    readyForFinalExecutor: false
  });

  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-preview-not-ready',
    previewId: preview.previewId
  });

  assert.equal(dryRun.reason, 'preview_not_ready');
  assert.equal(dryRun.plannedOperation, 'refuse_invalid_preview');
});

test('packet mismatch is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: 'other-packet', decisionId: 'decision-packet-mismatch' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-packet-mismatch' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-packet-mismatch', approvalId: 'approval-packet-mismatch' });
  const preview = unsafePreview({ packetId: packet.packetId, decisionId: 'decision-packet-mismatch', approvalId: 'approval-packet-mismatch' });

  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-packet-mismatch',
    previewId: preview.previewId
  });

  assert.equal(dryRun.reason, 'packet_mismatch');
});

test('decision mismatch is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-one' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-two' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-one', approvalId: 'approval-decision-mismatch' });
  const preview = unsafePreview({ packetId: packet.packetId, decisionId: 'decision-one', approvalId: 'approval-decision-mismatch' });

  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-decision-mismatch',
    previewId: preview.previewId
  });

  assert.equal(dryRun.reason, 'decision_mismatch');
});

test('approval mismatch is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-approval-mismatch', resolvedDestination: 'schedule' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-approval-mismatch', resolvedDestination: 'schedule' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-approval-mismatch', approvalId: 'approval-actual', resolvedDestination: 'schedule' });
  const preview = unsafePreview({ packetId: packet.packetId, decisionId: 'decision-approval-mismatch', approvalId: 'approval-other', resolvedDestination: 'schedule' });

  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-approval-mismatch',
    previewId: preview.previewId
  });

  assert.equal(dryRun.reason, 'approval_mismatch');
});

test('preview mismatch is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-preview-mismatch', resolvedDestination: 'schedule' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-preview-mismatch', resolvedDestination: 'schedule' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-preview-mismatch', approvalId: 'approval-preview-mismatch', resolvedDestination: 'schedule' });
  const preview = unsafePreview({ packetId: packet.packetId, decisionId: 'decision-preview-mismatch', approvalId: 'approval-preview-mismatch', resolvedDestination: 'schedule', previewId: 'preview-real' });

  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-preview-mismatch',
    previewId: 'preview-expected'
  });

  assert.equal(dryRun.reason, 'preview_mismatch');
});

test('mutationAllowed true is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-mutation-not-allowed', resolvedDestination: 'schedule' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-mutation-not-allowed', resolvedDestination: 'schedule', mutationAllowed: true as false });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-mutation-not-allowed', approvalId: 'approval-mutation-not-allowed', resolvedDestination: 'schedule' });
  const preview = unsafePreview({ packetId: packet.packetId, decisionId: 'decision-mutation-not-allowed', approvalId: 'approval-mutation-not-allowed', resolvedDestination: 'schedule' });

  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-mutation-not-allowed',
    previewId: preview.previewId
  });

  assert.equal(dryRun.reason, 'mutation_not_allowed');
});

test('implementationAllowed true is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-implementation-not-allowed', resolvedDestination: 'schedule' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-implementation-not-allowed', resolvedDestination: 'schedule' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-implementation-not-allowed', approvalId: 'approval-implementation-not-allowed', resolvedDestination: 'schedule' });
  const preview = unsafePreview({ packetId: packet.packetId, decisionId: 'decision-implementation-not-allowed', approvalId: 'approval-implementation-not-allowed', resolvedDestination: 'schedule', implementationAllowed: true as false });

  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-implementation-not-allowed',
    previewId: preview.previewId
  });

  assert.equal(dryRun.reason, 'implementation_not_allowed');
});

test('executionAllowed true is refused', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-execution-not-allowed', resolvedDestination: 'schedule' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-execution-not-allowed', resolvedDestination: 'schedule' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-execution-not-allowed', approvalId: 'approval-execution-not-allowed', resolvedDestination: 'schedule' });
  const preview = unsafePreview({ packetId: packet.packetId, decisionId: 'decision-execution-not-allowed', approvalId: 'approval-execution-not-allowed', resolvedDestination: 'schedule' });

  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-execution-not-allowed',
    previewId: preview.previewId,
    executionAllowed: true
  });

  assert.equal(dryRun.reason, 'execution_not_allowed');
});

test('no packet mutation occurs', () => {
  const { packet, decision, eligibility, approval, preview } = buildPreviewChain({
    action: 'approve_route',
    operatorId: 'operator-z',
    note: 'approve route'
  });
  const before = structuredClone(packet);

  createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-no-packet-mutation',
    previewId: preview.previewId
  });

  assert.deepEqual(packet, before);
});
