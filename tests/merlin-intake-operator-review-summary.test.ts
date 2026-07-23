import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  HeldRoutingApplyEligibility,
  HeldRoutingExplicitApplyApproval,
  HeldRoutingFinalExecutorDryRunPlan,
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
import {
  createHeldRoutingOperatorReviewSummary,
  serializeHeldRoutingOperatorReviewSummary
} from '../src/merlin/intake/operatorReviewSummary.ts';
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
    uploadId: 'upload-intent-operator-review-summary-fixture',
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

function buildCompleteChain() {
  const packet = mismatchPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'approve_route',
    operatorId: 'operator-a',
    note: 'approve route'
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);
  const approval = createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: 'approval-complete-chain',
    operatorId: 'operator-a',
    approvedAt: '2026-06-10T12:00:00.000Z'
  });
  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-complete-chain'
  });
  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-complete-chain',
    previewId: preview.previewId
  });

  return { packet, decision, eligibility, approval, preview, dryRun };
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

function unsafeDryRun(overrides: Partial<HeldRoutingFinalExecutorDryRunPlan>): HeldRoutingFinalExecutorDryRunPlan {
  return {
    dryRunId: 'dry-run-fixture',
    packetId: 'packet-fixture',
    decisionId: 'decision-fixture',
    approvalId: 'approval-fixture',
    previewId: 'preview-fixture',
    resolvedDestination: 'menu',
    plannedOperation: 'route_to_resolved_destination',
    preconditions: ['final_executor_must_verify_packet_lock'],
    blockedMutations: ['route_destination_write'],
    readyForExecution: false,
    requiresLiveExecutor: true,
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false,
    reason: 'dry_run_ready_for_live_executor',
    ...overrides
  } as unknown as HeldRoutingFinalExecutorDryRunPlan;
}

test('complete valid chain returns ready_for_live_executor', () => {
  const { packet, decision, eligibility, approval, preview, dryRun } = buildCompleteChain();

  const summary = createHeldRoutingOperatorReviewSummary(packet, decision, eligibility, approval, preview, dryRun, {
    summaryId: 'summary-complete-chain'
  });

  assert.equal(summary.nextRequiredAction, 'ready_for_live_executor');
  assert.equal(summary.currentStatus, 'ready');
  assert.deepEqual(summary.operatorWarnings, []);
  assert.equal(summary.mutationAllowed, false);
  assert.equal(summary.implementationAllowed, false);
  assert.equal(summary.executionAllowed, false);
});

test('missing decision returns operator_decision_required', () => {
  const packet = mismatchPacket();
  const summary = createHeldRoutingOperatorReviewSummary(packet, undefined, undefined, undefined, undefined, undefined, {
    summaryId: 'summary-missing-decision'
  });

  assert.equal(summary.nextRequiredAction, 'operator_decision_required');
  assert.equal(summary.currentStatus, 'incomplete');
  assert.equal(summary.operatorWarnings.includes('decision_missing'), true);
});

test('missing eligibility returns apply_eligibility_required', () => {
  const packet = mismatchPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'approve_route',
    operatorId: 'operator-b',
    note: 'approve route'
  });

  const summary = createHeldRoutingOperatorReviewSummary(packet, decision, undefined, undefined, undefined, undefined, {
    summaryId: 'summary-missing-eligibility'
  });

  assert.equal(summary.nextRequiredAction, 'apply_eligibility_required');
});

test('missing explicit approval returns explicit_apply_approval_required', () => {
  const packet = mismatchPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'approve_route',
    operatorId: 'operator-c',
    note: 'approve route'
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);

  const summary = createHeldRoutingOperatorReviewSummary(packet, decision, eligibility, undefined, undefined, undefined, {
    summaryId: 'summary-missing-approval'
  });

  assert.equal(summary.nextRequiredAction, 'explicit_apply_approval_required');
});

test('missing preview returns final_executor_preview_required', () => {
  const packet = mismatchPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'approve_route',
    operatorId: 'operator-d',
    note: 'approve route'
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);
  const approval = createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: 'approval-missing-preview',
    operatorId: 'operator-d',
    approvedAt: '2026-06-10T12:00:00.000Z'
  });

  const summary = createHeldRoutingOperatorReviewSummary(packet, decision, eligibility, approval, undefined, undefined, {
    summaryId: 'summary-missing-preview'
  });

  assert.equal(summary.nextRequiredAction, 'final_executor_preview_required');
});

test('missing dry-run returns dry_run_required', () => {
  const packet = mismatchPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'approve_route',
    operatorId: 'operator-e',
    note: 'approve route'
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);
  const approval = createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: 'approval-missing-dry-run',
    operatorId: 'operator-e',
    approvedAt: '2026-06-10T12:00:00.000Z'
  });
  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-missing-dry-run'
  });

  const summary = createHeldRoutingOperatorReviewSummary(packet, decision, eligibility, approval, preview, undefined, {
    summaryId: 'summary-missing-dry-run'
  });

  assert.equal(summary.nextRequiredAction, 'dry_run_required');
});

test('packet mismatch returns blocked', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: 'other-packet' });

  const summary = createHeldRoutingOperatorReviewSummary(packet, decision, undefined, undefined, undefined, undefined, {
    summaryId: 'summary-packet-mismatch'
  });

  assert.equal(summary.nextRequiredAction, 'blocked');
  assert.equal(summary.operatorWarnings.includes('packet_mismatch'), true);
});

test('mutationAllowed true returns blocked', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, mutationAllowed: true as false });

  const summary = createHeldRoutingOperatorReviewSummary(packet, decision, undefined, undefined, undefined, undefined, {
    summaryId: 'summary-mutation-contamination'
  });

  assert.equal(summary.nextRequiredAction, 'blocked');
  assert.equal(summary.operatorWarnings.includes('authority_contamination'), true);
});

test('implementationAllowed true returns blocked', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId, implementationAllowed: true as false });

  const summary = createHeldRoutingOperatorReviewSummary(packet, decision, undefined, undefined, undefined, undefined, {
    summaryId: 'summary-implementation-contamination'
  });

  assert.equal(summary.nextRequiredAction, 'blocked');
  assert.equal(summary.operatorWarnings.includes('authority_contamination'), true);
});

test('executionAllowed true returns blocked', () => {
  const packet = mismatchPacket();
  const decision = unsafeDecision({ packetId: packet.packetId });

  const summary = createHeldRoutingOperatorReviewSummary(packet, decision, undefined, undefined, undefined, undefined, {
    summaryId: 'summary-execution-contamination',
    executionAllowed: true
  });

  assert.equal(summary.nextRequiredAction, 'blocked');
  assert.equal(summary.operatorWarnings.includes('authority_contamination'), true);
});

test('no packet mutation occurs', () => {
  const packet = mismatchPacket();
  const before = structuredClone(packet);
  const decision = unsafeDecision({ packetId: packet.packetId, decisionId: 'decision-no-mutation', resolvedDestination: 'schedule' });
  const eligibility = unsafeEligibility({ packetId: packet.packetId, decisionId: 'decision-no-mutation', resolvedDestination: 'schedule' });
  const approval = unsafeApproval({ packetId: packet.packetId, decisionId: 'decision-no-mutation', approvalId: 'approval-no-mutation', resolvedDestination: 'schedule' });
  const preview = unsafePreview({ packetId: packet.packetId, decisionId: 'decision-no-mutation', approvalId: 'approval-no-mutation', previewId: 'preview-no-mutation', resolvedDestination: 'schedule' });
  const dryRun = unsafeDryRun({ packetId: packet.packetId, decisionId: 'decision-no-mutation', approvalId: 'approval-no-mutation', previewId: 'preview-no-mutation', resolvedDestination: 'schedule' });

  createHeldRoutingOperatorReviewSummary(packet, decision, eligibility, approval, preview, dryRun, {
    summaryId: 'summary-no-mutation'
  });

  assert.deepEqual(packet, before);
});

test('ready path only succeeds with complete valid chain', () => {
  const { packet, decision, eligibility, approval, preview, dryRun } = buildCompleteChain();
  const invalidDecision = {
    ...decision,
    resultingStatus: 'pending_more_info'
  } as unknown as HeldRoutingOperatorDecision;

  const summary = createHeldRoutingOperatorReviewSummary(packet, invalidDecision, eligibility, approval, preview, dryRun, {
    summaryId: 'summary-invalid-decision-status'
  });

  assert.equal(summary.nextRequiredAction, 'blocked');
  assert.equal(summary.operatorWarnings.includes('invalid_decision_status'), true);
  assert.equal(summary.operatorWarnings.includes('invalid_ready_chain'), true);
});

test('malformed JS-style objects fail closed', () => {
  const packet = mismatchPacket();
  const malformedDecision = {
    decisionId: '   ',
    packetId: packet.packetId,
    action: 'approve_route',
    operatorId: 'operator-js',
    note: 'js-malformed',
    resultingStatus: 'approved_for_apply',
    resolvedDestination: 'schedule',
    stillRequiresApply: true,
    mutationAllowed: false,
    implementationAllowed: false
  } as unknown as HeldRoutingOperatorDecision;
  const malformedEligibility = {
    applyEligible: true,
    reason: 'decision_not_apply_ready',
    packetId: packet.packetId,
    decisionId: '   ',
    resolvedDestination: 'schedule',
    requiresExplicitApplyApproval: true,
    mutationAllowed: false,
    implementationAllowed: false
  } as unknown as HeldRoutingApplyEligibility;
  const malformedApproval = {
    approvalId: '   ',
    packetId: packet.packetId,
    decisionId: '   ',
    operatorId: 'operator-js',
    approvedAt: '2026-06-10T12:00:00.000Z',
    resolvedDestination: 'schedule',
    applyApproved: true,
    reason: 'ineligible_decision',
    requiresFinalExecutor: true,
    mutationAllowed: false,
    implementationAllowed: false
  } as unknown as HeldRoutingExplicitApplyApproval;
  const malformedPreview = {
    previewId: '   ',
    packetId: packet.packetId,
    decisionId: '   ',
    approvalId: '   ',
    resolvedDestination: 'schedule',
    readyForFinalExecutor: true,
    reason: 'missing_preview_id',
    requiresFinalExecution: true,
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false
  } as unknown as HeldRoutingFinalExecutorPreview;
  const malformedDryRun = {
    dryRunId: '   ',
    packetId: packet.packetId,
    decisionId: '   ',
    approvalId: '   ',
    previewId: '   ',
    resolvedDestination: 'schedule',
    plannedOperation: 'route_to_resolved_destination',
    preconditions: ['x'],
    blockedMutations: ['y'],
    readyForExecution: false,
    requiresLiveExecutor: true,
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false,
    reason: 'preview_not_ready'
  } as unknown as HeldRoutingFinalExecutorDryRunPlan;

  const summary = createHeldRoutingOperatorReviewSummary(
    packet,
    malformedDecision,
    malformedEligibility,
    malformedApproval,
    malformedPreview,
    malformedDryRun,
    { summaryId: '   ' }
  );

  assert.equal(summary.nextRequiredAction, 'blocked');
  assert.equal(summary.currentStatus, 'blocked');
  assert.deepEqual(summary.operatorWarnings, ['missing_summary_id']);
});

test('blocked overrides ready when contamination exists', () => {
  const { packet, decision, eligibility, approval, preview, dryRun } = buildCompleteChain();
  const contaminatedDryRun = {
    ...dryRun,
    executionAllowed: true
  } as unknown as HeldRoutingFinalExecutorDryRunPlan;

  const summary = createHeldRoutingOperatorReviewSummary(packet, decision, eligibility, approval, preview, contaminatedDryRun, {
    summaryId: 'summary-blocked-overrides-ready'
  });

  assert.equal(summary.nextRequiredAction, 'blocked');
  assert.equal(summary.currentStatus, 'blocked');
  assert.equal(summary.operatorWarnings.includes('authority_contamination'), true);
});

test('warning ordering is stable', () => {
  const packet = mismatchPacket();
  const mismatchedDecision = unsafeDecision({ packetId: 'other-packet' });

  const summary = createHeldRoutingOperatorReviewSummary(packet, mismatchedDecision, undefined, undefined, undefined, undefined, {
    summaryId: '',
    executionAllowed: true
  });

  assert.deepEqual(summary.operatorWarnings, ['missing_summary_id', 'packet_mismatch', 'authority_contamination']);
});

test('byte-for-byte repeated JSON serialization is identical', () => {
  const { packet, decision, eligibility, approval, preview, dryRun } = buildCompleteChain();
  const summary = createHeldRoutingOperatorReviewSummary(packet, decision, eligibility, approval, preview, dryRun, {
    summaryId: 'summary-stable-serialization'
  });

  const serializedA = serializeHeldRoutingOperatorReviewSummary(summary);
  const serializedB = serializeHeldRoutingOperatorReviewSummary(summary);

  assert.equal(serializedA, serializedB);

  const topLevelKeys = Object.keys(JSON.parse(serializedA) as Record<string, unknown>);
  assert.deepEqual(topLevelKeys, [
    'summaryId',
    'packetId',
    'currentStatus',
    'decisionSummary',
    'eligibilitySummary',
    'explicitApprovalSummary',
    'finalExecutorPreviewSummary',
    'dryRunPlanSummary',
    'nextRequiredAction',
    'operatorWarnings',
    'mutationAllowed',
    'implementationAllowed',
    'executionAllowed'
  ]);
});
