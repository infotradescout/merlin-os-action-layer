import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  HeldRoutingOperatorReviewSummary,
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
import { createHeldRoutingOperatorReviewSummary } from '../src/merlin/intake/operatorReviewSummary.ts';
import {
  createHeldRoutingOperatorReviewPresentation,
  serializeHeldRoutingOperatorReviewPresentation
} from '../src/merlin/intake/operatorReviewPresentation.ts';
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
    uploadId: 'upload-intent-operator-review-presentation-fixture',
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

function mismatchPacket() {
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

function buildSummary(): HeldRoutingOperatorReviewSummary {
  const packet = mismatchPacket();
  const decision = applyHeldRoutingOperatorDecision(packet, {
    action: 'approve_route',
    operatorId: 'operator-a',
    note: 'approve route'
  });
  const eligibility = evaluateHeldRoutingApplyEligibility(packet, decision);
  const approval = createHeldRoutingExplicitApplyApproval(packet, decision, eligibility, {
    approvalId: 'approval-presentation',
    operatorId: 'operator-a',
    approvedAt: '2026-06-10T12:00:00.000Z'
  });
  const preview = createHeldRoutingFinalExecutorPreview(packet, decision, eligibility, approval, {
    previewId: 'preview-presentation'
  });
  const dryRun = createHeldRoutingFinalExecutorDryRunPlan(packet, decision, eligibility, approval, preview, {
    dryRunId: 'dry-run-presentation',
    previewId: preview.previewId
  });

  return createHeldRoutingOperatorReviewSummary(packet, decision, eligibility, approval, preview, dryRun, {
    summaryId: 'summary-presentation'
  });
}

test('presentation contract is read-only and advisory', () => {
  const summary = buildSummary();

  const presentation = createHeldRoutingOperatorReviewPresentation(summary, {
    presentationId: 'presentation-1'
  });

  assert.equal(presentation.status, 'ok');
  assert.equal(presentation.mode, 'read_only');
  assert.equal(presentation.advisoryOnly, true);
  assert.equal(presentation.mutationAllowed, false);
  assert.equal(presentation.implementationAllowed, false);
  assert.equal(presentation.executionAllowed, false);
  assert.equal(presentation.summary.mutationAllowed, false);
  assert.equal(presentation.summary.implementationAllowed, false);
  assert.equal(presentation.summary.executionAllowed, false);
});

test('missing presentation id is blocked advisory output', () => {
  const summary = buildSummary();

  const presentation = createHeldRoutingOperatorReviewPresentation(summary, {
    presentationId: ' '
  });

  assert.equal(presentation.nextRequiredAction, 'blocked');
  assert.equal(presentation.currentStatus, 'blocked');
  assert.deepEqual(presentation.operatorWarnings, ['missing_presentation_id']);
});

test('presentation serialization is deterministic', () => {
  const summary = buildSummary();
  const presentation = createHeldRoutingOperatorReviewPresentation(summary, {
    presentationId: 'presentation-stable'
  });

  const a = serializeHeldRoutingOperatorReviewPresentation(presentation);
  const b = serializeHeldRoutingOperatorReviewPresentation(presentation);

  assert.equal(a, b);

  const keys = Object.keys(JSON.parse(a) as Record<string, unknown>);
  assert.deepEqual(keys, [
    'presentationId',
    'status',
    'mode',
    'advisoryOnly',
    'summaryId',
    'packetId',
    'currentStatus',
    'nextRequiredAction',
    'operatorWarnings',
    'display',
    'evidenceBindings',
    'decisionLedgerPreview',
    'approvalGatePreview',
    'approvalArtifactPreview',
    'summary',
    'mutationAllowed',
    'implementationAllowed',
    'executionAllowed'
  ]);
});

test('presentation includes evidence binding for detail lines and warnings', () => {
  const summary = buildSummary();
  const presentation = createHeldRoutingOperatorReviewPresentation(summary, {
    presentationId: 'presentation-evidence'
  });

  assert.equal(presentation.evidenceBindings.detailLines.length, presentation.display.detailLines.length);
  for (const entry of presentation.evidenceBindings.detailLines) {
    if (entry.evidenceState === 'bound') {
      assert.equal(entry.sourceReferences.length > 0, true);
    } else {
      assert.equal(entry.sourceReferences.length, 0);
      assert.equal(typeof entry.noEvidenceReason, 'string');
    }
  }

  assert.equal(presentation.evidenceBindings.warnings.length, 1);
  assert.equal(presentation.evidenceBindings.warnings[0].warning, 'none');
  assert.equal(presentation.evidenceBindings.warnings[0].evidenceState, 'no_evidence');
  assert.equal(presentation.evidenceBindings.warnings[0].noEvidenceReason, 'not_applicable');

  assert.equal(presentation.decisionLedgerPreview.kind, 'operator_review_decision_ledger_preview');
  assert.equal(presentation.decisionLedgerPreview.presentationId, 'presentation-evidence');
  assert.equal(presentation.decisionLedgerPreview.packetId, presentation.packetId);
  assert.equal(presentation.decisionLedgerPreview.summaryId, presentation.summaryId);
  assert.equal(
    presentation.decisionLedgerPreview.wouldRecordEventType,
    'held_routing_operator_review_decision_preview'
  );
  assert.equal(presentation.decisionLedgerPreview.noActionStatus, 'preview_only_no_mutation');
  assert.equal(
    presentation.decisionLedgerPreview.noActionReasonCode,
    'current_status_ready_no_action_surface'
  );
  assert.equal(presentation.decisionLedgerPreview.authoritySnapshot.mutationAllowed, false);
  assert.equal(presentation.decisionLedgerPreview.authoritySnapshot.implementationAllowed, false);
  assert.equal(presentation.decisionLedgerPreview.authoritySnapshot.executionAllowed, false);
  assert.equal(presentation.decisionLedgerPreview.timestampPolicy.mode, 'deterministic_static');
  assert.equal(
    presentation.decisionLedgerPreview.timestampPolicy.previewedAt,
    '2026-06-10T00:00:00.000Z'
  );

  assert.equal(presentation.approvalGatePreview.kind, 'operator_review_approval_gate_preview');
  assert.equal(presentation.approvalGatePreview.gateStatus, 'eligible_preview_only');
  assert.equal(
    presentation.approvalGatePreview.gateReasonCode,
    'eligible_preview_only_read_only_prereqs_met'
  );
  assert.equal(
    presentation.approvalGatePreview.decisionLedgerPreviewStatus.kind,
    'operator_review_decision_ledger_preview'
  );
  assert.equal(presentation.approvalGatePreview.authoritySnapshot.mutationAllowed, false);
  assert.equal(presentation.approvalGatePreview.authoritySnapshot.implementationAllowed, false);
  assert.equal(presentation.approvalGatePreview.authoritySnapshot.executionAllowed, false);
  assert.equal(presentation.approvalGatePreview.noActionStatus, 'preview_only_no_mutation');
  assert.equal(presentation.approvalGatePreview.noActionReasonCode, 'approval_gate_preview_only');
  assert.equal(presentation.approvalGatePreview.timestampPolicy.mode, 'deterministic_static');
  assert.equal(
    presentation.approvalGatePreview.timestampPolicy.previewedAt,
    '2026-06-10T00:00:00.000Z'
  );
  assert.equal(
    presentation.approvalGatePreview.evidenceBindingStatus.detailLines.total,
    presentation.evidenceBindings.detailLines.length
  );
  assert.equal(
    presentation.approvalGatePreview.evidenceBindingStatus.warnings.total,
    presentation.evidenceBindings.warnings.length
  );

  assert.equal(presentation.approvalArtifactPreview.kind, 'operator_review_approval_artifact_preview');
  assert.equal(presentation.approvalArtifactPreview.presentationId, 'presentation-evidence');
  assert.equal(presentation.approvalArtifactPreview.packetId, presentation.packetId);
  assert.equal(presentation.approvalArtifactPreview.summaryId, presentation.summaryId);
  assert.equal(presentation.approvalArtifactPreview.artifactStatus, 'required_not_created');
  assert.equal(
    presentation.approvalArtifactPreview.artifactReasonCode,
    'required_future_approval_artifact_not_created'
  );
  assert.deepEqual(presentation.approvalArtifactPreview.requiredFields, [
    'operatorIdentity',
    'approvalDecision',
    'approvalTimestamp',
    'evidenceBindingSummary',
    'decisionLedgerPreviewReference',
    'approvalGatePreviewReference',
    'authoritySnapshot'
  ]);
  assert.deepEqual(presentation.approvalArtifactPreview.missingFields, [
    'operatorIdentity',
    'approvalDecision',
    'approvalTimestamp'
  ]);
  assert.equal(
    presentation.approvalArtifactPreview.references.decisionLedgerPreviewReference.kind,
    'operator_review_decision_ledger_preview'
  );
  assert.equal(
    presentation.approvalArtifactPreview.references.approvalGatePreviewReference.kind,
    'operator_review_approval_gate_preview'
  );
  assert.equal(
    presentation.approvalArtifactPreview.references.approvalGatePreviewReference.gateStatus,
    'eligible_preview_only'
  );
  assert.equal(
    presentation.approvalArtifactPreview.references.evidenceBindingSummary.detailLines.total,
    presentation.decisionLedgerPreview.evidenceSummary.detailLines.total
  );
  assert.equal(
    presentation.approvalArtifactPreview.futureArtifactPolicy.generation,
    'must_be_generated_only_by_explicit_future_approval_action'
  );
  assert.equal(
    presentation.approvalArtifactPreview.futureArtifactPolicy.bindings.includes('must_bind_operator_identity'),
    true
  );
  assert.equal(presentation.approvalArtifactPreview.noActionStatus, 'preview_only_no_mutation');
  assert.equal(presentation.approvalArtifactPreview.authoritySnapshot.mutationAllowed, false);
  assert.equal(presentation.approvalArtifactPreview.authoritySnapshot.implementationAllowed, false);
  assert.equal(presentation.approvalArtifactPreview.authoritySnapshot.executionAllowed, false);
  assert.equal(presentation.approvalArtifactPreview.timestampPolicy.mode, 'deterministic_static');
  assert.equal(
    presentation.approvalArtifactPreview.timestampPolicy.previewedAt,
    '2026-06-10T00:00:00.000Z'
  );
});

test('approval gate preview is fail-closed and reason-coded when presentation id is missing', () => {
  const summary = buildSummary();
  const presentation = createHeldRoutingOperatorReviewPresentation(summary, {
    presentationId: ' '
  });

  assert.equal(presentation.approvalGatePreview.gateStatus, 'blocked');
  assert.equal(presentation.approvalGatePreview.gateReasonCode, 'missing_required_references');
  assert.equal(presentation.approvalArtifactPreview.artifactStatus, 'blocked_by_gate');
  assert.equal(presentation.approvalArtifactPreview.artifactReasonCode, 'approval_gate_blocked');
  assert.equal(presentation.approvalArtifactPreview.noActionStatus, 'preview_only_no_mutation');
});

test('presentation builder is side-effect free for summary input', () => {
  const summary = buildSummary();
  const before = structuredClone(summary);

  createHeldRoutingOperatorReviewPresentation(summary, {
    presentationId: 'presentation-no-mutation'
  });

  assert.deepEqual(summary, before);
});
