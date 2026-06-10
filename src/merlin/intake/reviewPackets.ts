import type {
  HeldRoutingApplyEligibility,
  HeldRoutingDecisionStatus,
  HeldRoutingFinalExecutorDryRunPlan,
  HeldRoutingExplicitApplyApproval,
  HeldRoutingFinalExecutorPreview,
  HeldRoutingOperatorDecision,
  HeldRoutingReviewPacket,
  MerlinRoutedDestination,
  MerlinRoutingOperatorAction,
  RoutingDecision,
  UploadIntent
} from './intakeTypes.js';

export const ROUTING_REVIEW_OPERATOR_ACTIONS: MerlinRoutingOperatorAction[] = [
  'approve_route',
  'change_destination',
  'request_more_info',
  'reject_upload',
  'defer'
];

const REVIEW_SIGNAL_REASONS = new Set([
  'menu_signal_detected',
  'schedule_signal_detected',
  'logo_signal_detected',
  'photo_signal_detected',
  'document_signal_detected',
  'competing_destination_signals',
  'no_destination_signal_detected',
  'low_base_confidence',
  'low_destination_confidence',
  'intent_destination_mismatch',
  'ambiguous_or_wrong_domain'
]);

const ROUTED_DESTINATIONS = new Set<MerlinRoutedDestination>(['menu', 'schedule', 'logo', 'photo', 'document']);
const APPLY_READY_ACTIONS = new Set<MerlinRoutingOperatorAction>(['approve_route', 'change_destination']);
const APPLY_READY_STATUSES = new Set<HeldRoutingDecisionStatus>(['approved_for_apply', 'destination_changed_for_apply']);

type HeldRoutingOperatorDecisionInput = {
  action: string;
  operatorId?: string;
  note?: string;
  selectedDestination?: string;
};

type HeldRoutingExplicitApplyApprovalInput = {
  approvalId?: string;
  operatorId?: string;
  approvedAt: string;
};

type HeldRoutingFinalExecutorPreviewInput = {
  previewId?: string;
};

type HeldRoutingFinalExecutorDryRunPlanInput = {
  dryRunId?: string;
  previewId?: string;
  executionAllowed?: boolean;
};

function detectedEvidenceSignals(row: RoutingDecision): string[] {
  const signals = row.reasons.filter((reason) => REVIEW_SIGNAL_REASONS.has(reason) || reason.startsWith('expected_route_'));
  return signals.length > 0 ? signals : ['operator_review_required'];
}

export function buildHeldRoutingReviewPackets(intent: UploadIntent, routing: RoutingDecision[] = intent.routing): HeldRoutingReviewPacket[] {
  return routing
    .filter((row) => row.routedType === 'held')
    .map((row) => ({
      packetId: `merlin-routing-review:${intent.uploadId}:${row.fileId}`,
      uploadId: intent.uploadId,
      fileId: row.fileId,
      fileName: row.fileName,
      declaredIntent: {
        brand: intent.brand,
        actionId: intent.actionId,
        actorScope: intent.actorScope,
        entityType: intent.entityType,
        entityId: intent.entityId
      },
      detectedEvidenceSignals: detectedEvidenceSignals(row),
      proposedDestination: row.proposedDestination,
      holdReason: row.holdReason || 'ambiguous',
      confidence: {
        score: row.confidence,
        reasons: row.reasons
      },
      operatorActionOptions: [...ROUTING_REVIEW_OPERATOR_ACTIONS],
      mutationAllowed: false,
      implementationAllowed: false
    }));
}

function normalizeOperatorId(operatorId?: string): string {
  return operatorId?.trim() || 'operator-fixture';
}

function normalizeNote(note?: string): string {
  return note?.trim() || 'operator_resolution_recorded';
}

function isOperatorAction(action: string): action is MerlinRoutingOperatorAction {
  return ROUTING_REVIEW_OPERATOR_ACTIONS.includes(action as MerlinRoutingOperatorAction);
}

function isRoutedDestination(destination: string | undefined): destination is MerlinRoutedDestination {
  return typeof destination === 'string' && ROUTED_DESTINATIONS.has(destination as MerlinRoutedDestination);
}

function explicitApplyApproval(input: {
  approvalId: string;
  packet: HeldRoutingReviewPacket;
  decision: HeldRoutingOperatorDecision;
  operatorId: string;
  approvedAt: string;
  applyApproved: boolean;
  reason: HeldRoutingExplicitApplyApproval['reason'];
  resolvedDestination?: MerlinRoutedDestination;
}): HeldRoutingExplicitApplyApproval {
  return {
    approvalId: input.approvalId,
    packetId: input.packet.packetId,
    decisionId: input.decision.decisionId,
    operatorId: input.operatorId,
    approvedAt: input.approvedAt,
    resolvedDestination: input.resolvedDestination,
    applyApproved: input.applyApproved,
    reason: input.reason,
    requiresFinalExecutor: true,
    mutationAllowed: false,
    implementationAllowed: false
  };
}

function finalExecutorPreview(input: {
  previewId: string;
  packet: HeldRoutingReviewPacket;
  decision: HeldRoutingOperatorDecision;
  approval: HeldRoutingExplicitApplyApproval;
  readyForFinalExecutor: boolean;
  reason: HeldRoutingFinalExecutorPreview['reason'];
  resolvedDestination?: MerlinRoutedDestination;
}): HeldRoutingFinalExecutorPreview {
  return {
    previewId: input.previewId,
    packetId: input.packet.packetId,
    decisionId: input.decision.decisionId,
    approvalId: input.approval.approvalId,
    resolvedDestination: input.resolvedDestination,
    readyForFinalExecutor: input.readyForFinalExecutor,
    reason: input.reason,
    requiresFinalExecution: true,
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false
  };
}

function finalExecutorDryRunPlan(input: {
  dryRunId: string;
  packet: HeldRoutingReviewPacket;
  decision: HeldRoutingOperatorDecision;
  approval: HeldRoutingExplicitApplyApproval;
  preview: HeldRoutingFinalExecutorPreview;
  plannedOperation: HeldRoutingFinalExecutorDryRunPlan['plannedOperation'];
  reason: HeldRoutingFinalExecutorDryRunPlan['reason'];
  preconditions: string[];
  blockedMutations: string[];
  resolvedDestination?: MerlinRoutedDestination;
}): HeldRoutingFinalExecutorDryRunPlan {
  return {
    dryRunId: input.dryRunId,
    packetId: input.packet.packetId,
    decisionId: input.decision.decisionId,
    approvalId: input.approval.approvalId,
    previewId: input.preview.previewId,
    resolvedDestination: input.resolvedDestination,
    plannedOperation: input.plannedOperation,
    preconditions: input.preconditions,
    blockedMutations: input.blockedMutations,
    readyForExecution: false,
    requiresLiveExecutor: true,
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false,
    reason: input.reason
  };
}

function hasExecutionAllowedTrue(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  return (record as { executionAllowed?: boolean }).executionAllowed === true;
}

function decisionIdFor(input: {
  packetId: string;
  action: string;
  operatorId: string;
  resolvedDestination?: string;
}): string {
  return [
    'merlin-routing-decision',
    input.packetId,
    input.action,
    input.operatorId,
    input.resolvedDestination || 'none'
  ].join(':');
}

function decision(input: {
  packet: HeldRoutingReviewPacket;
  action: MerlinRoutingOperatorAction | 'invalid_action';
  operatorId: string;
  note: string;
  resultingStatus: HeldRoutingDecisionStatus;
  resolvedDestination?: MerlinRoutedDestination;
  stillRequiresApply: boolean;
}): HeldRoutingOperatorDecision {
  return {
    decisionId: decisionIdFor({
      packetId: input.packet.packetId,
      action: input.action,
      operatorId: input.operatorId,
      resolvedDestination: input.resolvedDestination
    }),
    packetId: input.packet.packetId,
    action: input.action,
    operatorId: input.operatorId,
    note: input.note,
    resultingStatus: input.resultingStatus,
    resolvedDestination: input.resolvedDestination,
    stillRequiresApply: input.stillRequiresApply,
    mutationAllowed: false,
    implementationAllowed: false
  };
}

export function applyHeldRoutingOperatorDecision(
  packet: HeldRoutingReviewPacket,
  input: HeldRoutingOperatorDecisionInput
): HeldRoutingOperatorDecision {
  const operatorId = normalizeOperatorId(input.operatorId);
  const note = normalizeNote(input.note);

  if (!isOperatorAction(input.action)) {
    return decision({
      packet,
      action: 'invalid_action',
      operatorId,
      note,
      resultingStatus: 'invalid_action',
      stillRequiresApply: false
    });
  }

  if (input.action === 'approve_route') {
    if (!packet.proposedDestination) {
      return decision({
        packet,
        action: 'invalid_action',
        operatorId,
        note: 'approve_route_requires_proposed_destination',
        resultingStatus: 'invalid_action',
        stillRequiresApply: false
      });
    }
    return decision({
      packet,
      action: input.action,
      operatorId,
      note,
      resultingStatus: 'approved_for_apply',
      resolvedDestination: packet.proposedDestination,
      stillRequiresApply: true
    });
  }

  if (input.action === 'change_destination') {
    if (!isRoutedDestination(input.selectedDestination)) {
      return decision({
        packet,
        action: 'invalid_action',
        operatorId,
        note: 'change_destination_requires_valid_destination',
        resultingStatus: 'invalid_action',
        stillRequiresApply: false
      });
    }
    return decision({
      packet,
      action: input.action,
      operatorId,
      note,
      resultingStatus: 'destination_changed_for_apply',
      resolvedDestination: input.selectedDestination,
      stillRequiresApply: true
    });
  }

  if (input.action === 'request_more_info') {
    return decision({
      packet,
      action: input.action,
      operatorId,
      note,
      resultingStatus: 'pending_more_info',
      stillRequiresApply: false
    });
  }

  if (input.action === 'reject_upload') {
    return decision({
      packet,
      action: input.action,
      operatorId,
      note,
      resultingStatus: 'rejected',
      stillRequiresApply: false
    });
  }

  return decision({
    packet,
    action: input.action,
    operatorId,
    note,
    resultingStatus: 'deferred',
    stillRequiresApply: false
  });
}

function eligibility(input: {
  packet: HeldRoutingReviewPacket;
  decision?: HeldRoutingOperatorDecision;
  applyEligible: boolean;
  reason: HeldRoutingApplyEligibility['reason'];
  resolvedDestination?: MerlinRoutedDestination;
}): HeldRoutingApplyEligibility {
  return {
    applyEligible: input.applyEligible,
    reason: input.reason,
    packetId: input.packet.packetId,
    decisionId: input.decision?.decisionId,
    resolvedDestination: input.resolvedDestination,
    requiresExplicitApplyApproval: true,
    mutationAllowed: false,
    implementationAllowed: false
  };
}

export function evaluateHeldRoutingApplyEligibility(
  packet: HeldRoutingReviewPacket,
  decisionRecord: HeldRoutingOperatorDecision
): HeldRoutingApplyEligibility {
  if (!decisionRecord.decisionId?.trim()) {
    return eligibility({ packet, decision: decisionRecord, applyEligible: false, reason: 'missing_decision_id' });
  }
  if (!decisionRecord.operatorId?.trim()) {
    return eligibility({ packet, decision: decisionRecord, applyEligible: false, reason: 'missing_operator_id' });
  }
  if (decisionRecord.packetId !== packet.packetId) {
    return eligibility({ packet, decision: decisionRecord, applyEligible: false, reason: 'packet_mismatch' });
  }
  if (decisionRecord.mutationAllowed !== false) {
    return eligibility({ packet, decision: decisionRecord, applyEligible: false, reason: 'mutation_not_allowed' });
  }
  if (decisionRecord.implementationAllowed !== false) {
    return eligibility({ packet, decision: decisionRecord, applyEligible: false, reason: 'implementation_not_allowed' });
  }
  if (!isOperatorAction(decisionRecord.action)) {
    return eligibility({ packet, decision: decisionRecord, applyEligible: false, reason: 'invalid_action' });
  }
  if (!APPLY_READY_ACTIONS.has(decisionRecord.action) || !APPLY_READY_STATUSES.has(decisionRecord.resultingStatus)) {
    return eligibility({ packet, decision: decisionRecord, applyEligible: false, reason: 'decision_not_apply_ready' });
  }
  if (decisionRecord.stillRequiresApply !== true) {
    return eligibility({ packet, decision: decisionRecord, applyEligible: false, reason: 'still_requires_apply_false' });
  }
  if (!isRoutedDestination(decisionRecord.resolvedDestination)) {
    return eligibility({ packet, decision: decisionRecord, applyEligible: false, reason: 'missing_resolved_destination' });
  }

  return eligibility({
    packet,
    decision: decisionRecord,
    applyEligible: true,
    reason: 'apply_ready_requires_explicit_approval',
    resolvedDestination: decisionRecord.resolvedDestination
  });
}

export function createHeldRoutingExplicitApplyApproval(
  packet: HeldRoutingReviewPacket,
  decisionRecord: HeldRoutingOperatorDecision,
  eligibilityRecord: HeldRoutingApplyEligibility,
  input: HeldRoutingExplicitApplyApprovalInput
): HeldRoutingExplicitApplyApproval {
  const approvalId = input.approvalId?.trim() || '';
  const operatorId = input.operatorId?.trim() || '';

  if (!approvalId) {
    return explicitApplyApproval({
      approvalId,
      packet,
      decision: decisionRecord,
      operatorId,
      approvedAt: input.approvedAt,
      applyApproved: false,
      reason: 'missing_approval_id'
    });
  }
  if (eligibilityRecord.mutationAllowed !== false || decisionRecord.mutationAllowed !== false) {
    return explicitApplyApproval({
      approvalId,
      packet,
      decision: decisionRecord,
      operatorId,
      approvedAt: input.approvedAt,
      applyApproved: false,
      reason: 'mutation_not_allowed'
    });
  }
  if (eligibilityRecord.implementationAllowed !== false || decisionRecord.implementationAllowed !== false) {
    return explicitApplyApproval({
      approvalId,
      packet,
      decision: decisionRecord,
      operatorId,
      approvedAt: input.approvedAt,
      applyApproved: false,
      reason: 'implementation_not_allowed'
    });
  }
  if (decisionRecord.packetId !== packet.packetId || eligibilityRecord.packetId !== packet.packetId) {
    return explicitApplyApproval({
      approvalId,
      packet,
      decision: decisionRecord,
      operatorId,
      approvedAt: input.approvedAt,
      applyApproved: false,
      reason: 'packet_mismatch'
    });
  }
  if (!decisionRecord.decisionId?.trim() || decisionRecord.decisionId !== eligibilityRecord.decisionId) {
    return explicitApplyApproval({
      approvalId,
      packet,
      decision: decisionRecord,
      operatorId,
      approvedAt: input.approvedAt,
      applyApproved: false,
      reason: 'decision_mismatch'
    });
  }
  if (eligibilityRecord.applyEligible !== true || eligibilityRecord.requiresExplicitApplyApproval !== true) {
    return explicitApplyApproval({
      approvalId,
      packet,
      decision: decisionRecord,
      operatorId,
      approvedAt: input.approvedAt,
      applyApproved: false,
      reason: 'ineligible_decision'
    });
  }
  if (!isRoutedDestination(eligibilityRecord.resolvedDestination) || !isRoutedDestination(decisionRecord.resolvedDestination)) {
    return explicitApplyApproval({
      approvalId,
      packet,
      decision: decisionRecord,
      operatorId,
      approvedAt: input.approvedAt,
      applyApproved: false,
      reason: 'missing_resolved_destination'
    });
  }
  if (!operatorId) {
    return explicitApplyApproval({
      approvalId,
      packet,
      decision: decisionRecord,
      operatorId,
      approvedAt: input.approvedAt,
      applyApproved: false,
      reason: 'missing_operator_id'
    });
  }

  return explicitApplyApproval({
    approvalId,
    packet,
    decision: decisionRecord,
    operatorId,
    approvedAt: input.approvedAt,
    resolvedDestination: eligibilityRecord.resolvedDestination,
    applyApproved: true,
    reason: 'explicit_apply_approval_recorded'
  });
}

export function createHeldRoutingFinalExecutorPreview(
  packet: HeldRoutingReviewPacket,
  decisionRecord: HeldRoutingOperatorDecision,
  eligibilityRecord: HeldRoutingApplyEligibility,
  approvalRecord: HeldRoutingExplicitApplyApproval,
  input: HeldRoutingFinalExecutorPreviewInput
): HeldRoutingFinalExecutorPreview {
  const previewId = input.previewId?.trim() || '';

  if (!previewId) {
    return finalExecutorPreview({
      previewId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      readyForFinalExecutor: false,
      reason: 'missing_preview_id'
    });
  }
  if (decisionRecord.packetId !== packet.packetId || eligibilityRecord.packetId !== packet.packetId || approvalRecord.packetId !== packet.packetId) {
    return finalExecutorPreview({
      previewId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      readyForFinalExecutor: false,
      reason: 'packet_mismatch'
    });
  }
  if (!decisionRecord.decisionId?.trim() || decisionRecord.decisionId !== eligibilityRecord.decisionId || decisionRecord.decisionId !== approvalRecord.decisionId) {
    return finalExecutorPreview({
      previewId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      readyForFinalExecutor: false,
      reason: 'decision_mismatch'
    });
  }
  if (!approvalRecord.approvalId?.trim()) {
    return finalExecutorPreview({
      previewId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      readyForFinalExecutor: false,
      reason: 'approval_mismatch'
    });
  }
  if (eligibilityRecord.applyEligible !== true) {
    return finalExecutorPreview({
      previewId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      readyForFinalExecutor: false,
      reason: 'ineligible_eligibility'
    });
  }
  if (approvalRecord.applyApproved !== true) {
    return finalExecutorPreview({
      previewId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      readyForFinalExecutor: false,
      reason: 'approval_not_applied'
    });
  }
  if (approvalRecord.requiresFinalExecutor !== true) {
    return finalExecutorPreview({
      previewId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      readyForFinalExecutor: false,
      reason: 'approval_not_final_executor_ready'
    });
  }
  if (
    decisionRecord.mutationAllowed !== false ||
    eligibilityRecord.mutationAllowed !== false ||
    approvalRecord.mutationAllowed !== false
  ) {
    return finalExecutorPreview({
      previewId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      readyForFinalExecutor: false,
      reason: 'mutation_not_allowed'
    });
  }
  if (
    decisionRecord.implementationAllowed !== false ||
    eligibilityRecord.implementationAllowed !== false ||
    approvalRecord.implementationAllowed !== false
  ) {
    return finalExecutorPreview({
      previewId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      readyForFinalExecutor: false,
      reason: 'implementation_not_allowed'
    });
  }
  if (
    hasExecutionAllowedTrue(decisionRecord) ||
    hasExecutionAllowedTrue(eligibilityRecord) ||
    hasExecutionAllowedTrue(approvalRecord)
  ) {
    return finalExecutorPreview({
      previewId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      readyForFinalExecutor: false,
      reason: 'execution_not_allowed'
    });
  }
  if (
    !isRoutedDestination(decisionRecord.resolvedDestination) ||
    !isRoutedDestination(eligibilityRecord.resolvedDestination) ||
    !isRoutedDestination(approvalRecord.resolvedDestination)
  ) {
    return finalExecutorPreview({
      previewId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      readyForFinalExecutor: false,
      reason: 'missing_resolved_destination'
    });
  }
  if (
    decisionRecord.resolvedDestination !== eligibilityRecord.resolvedDestination ||
    decisionRecord.resolvedDestination !== approvalRecord.resolvedDestination
  ) {
    return finalExecutorPreview({
      previewId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      readyForFinalExecutor: false,
      reason: 'approval_mismatch'
    });
  }

  return finalExecutorPreview({
    previewId,
    packet,
    decision: decisionRecord,
    approval: approvalRecord,
    readyForFinalExecutor: true,
    reason: 'final_executor_preview_ready',
    resolvedDestination: approvalRecord.resolvedDestination
  });
}

export function createHeldRoutingFinalExecutorDryRunPlan(
  packet: HeldRoutingReviewPacket,
  decisionRecord: HeldRoutingOperatorDecision,
  eligibilityRecord: HeldRoutingApplyEligibility,
  approvalRecord: HeldRoutingExplicitApplyApproval,
  previewRecord: HeldRoutingFinalExecutorPreview,
  input: HeldRoutingFinalExecutorDryRunPlanInput
): HeldRoutingFinalExecutorDryRunPlan {
  const dryRunId = input.dryRunId?.trim() || '';
  const expectedPreviewId = input.previewId?.trim();

  if (!dryRunId) {
    return finalExecutorDryRunPlan({
      dryRunId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      preview: previewRecord,
      plannedOperation: 'refuse_invalid_preview',
      reason: 'missing_dry_run_id',
      preconditions: ['dry_run_id_required'],
      blockedMutations: ['route_destination_write', 'artifact_move', 'executor_apply']
    });
  }
  if (
    decisionRecord.packetId !== packet.packetId ||
    eligibilityRecord.packetId !== packet.packetId ||
    approvalRecord.packetId !== packet.packetId ||
    previewRecord.packetId !== packet.packetId
  ) {
    return finalExecutorDryRunPlan({
      dryRunId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      preview: previewRecord,
      plannedOperation: 'refuse_invalid_preview',
      reason: 'packet_mismatch',
      preconditions: ['packet_ids_must_match_across_chain'],
      blockedMutations: ['route_destination_write', 'artifact_move', 'executor_apply']
    });
  }
  if (
    !decisionRecord.decisionId?.trim() ||
    decisionRecord.decisionId !== eligibilityRecord.decisionId ||
    decisionRecord.decisionId !== approvalRecord.decisionId ||
    decisionRecord.decisionId !== previewRecord.decisionId
  ) {
    return finalExecutorDryRunPlan({
      dryRunId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      preview: previewRecord,
      plannedOperation: 'refuse_invalid_preview',
      reason: 'decision_mismatch',
      preconditions: ['decision_ids_must_match_across_chain'],
      blockedMutations: ['route_destination_write', 'artifact_move', 'executor_apply']
    });
  }
  if (!approvalRecord.approvalId?.trim() || previewRecord.approvalId !== approvalRecord.approvalId) {
    return finalExecutorDryRunPlan({
      dryRunId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      preview: previewRecord,
      plannedOperation: 'refuse_invalid_preview',
      reason: 'approval_mismatch',
      preconditions: ['approval_id_required_and_must_match_preview'],
      blockedMutations: ['route_destination_write', 'artifact_move', 'executor_apply']
    });
  }
  if (!previewRecord.previewId?.trim() || (expectedPreviewId && expectedPreviewId !== previewRecord.previewId)) {
    return finalExecutorDryRunPlan({
      dryRunId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      preview: previewRecord,
      plannedOperation: 'refuse_invalid_preview',
      reason: 'preview_mismatch',
      preconditions: ['preview_id_required_and_must_match_expected'],
      blockedMutations: ['route_destination_write', 'artifact_move', 'executor_apply']
    });
  }
  if (previewRecord.readyForFinalExecutor !== true) {
    return finalExecutorDryRunPlan({
      dryRunId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      preview: previewRecord,
      plannedOperation: 'refuse_invalid_preview',
      reason: 'preview_not_ready',
      preconditions: ['preview_must_be_ready_for_final_executor'],
      blockedMutations: ['route_destination_write', 'artifact_move', 'executor_apply']
    });
  }
  if (previewRecord.requiresFinalExecution !== true) {
    return finalExecutorDryRunPlan({
      dryRunId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      preview: previewRecord,
      plannedOperation: 'refuse_invalid_preview',
      reason: 'preview_does_not_require_final_execution',
      preconditions: ['preview_requires_final_execution_true'],
      blockedMutations: ['route_destination_write', 'artifact_move', 'executor_apply']
    });
  }
  if (
    decisionRecord.mutationAllowed !== false ||
    eligibilityRecord.mutationAllowed !== false ||
    approvalRecord.mutationAllowed !== false ||
    previewRecord.mutationAllowed !== false
  ) {
    return finalExecutorDryRunPlan({
      dryRunId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      preview: previewRecord,
      plannedOperation: 'refuse_invalid_preview',
      reason: 'mutation_not_allowed',
      preconditions: ['mutation_allowed_must_remain_false'],
      blockedMutations: ['route_destination_write', 'artifact_move', 'executor_apply']
    });
  }
  if (
    decisionRecord.implementationAllowed !== false ||
    eligibilityRecord.implementationAllowed !== false ||
    approvalRecord.implementationAllowed !== false ||
    previewRecord.implementationAllowed !== false
  ) {
    return finalExecutorDryRunPlan({
      dryRunId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      preview: previewRecord,
      plannedOperation: 'refuse_invalid_preview',
      reason: 'implementation_not_allowed',
      preconditions: ['implementation_allowed_must_remain_false'],
      blockedMutations: ['route_destination_write', 'artifact_move', 'executor_apply']
    });
  }
  if (
    hasExecutionAllowedTrue(decisionRecord) ||
    hasExecutionAllowedTrue(eligibilityRecord) ||
    hasExecutionAllowedTrue(approvalRecord) ||
    hasExecutionAllowedTrue(previewRecord) ||
    input.executionAllowed === true
  ) {
    return finalExecutorDryRunPlan({
      dryRunId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      preview: previewRecord,
      plannedOperation: 'refuse_invalid_preview',
      reason: 'execution_not_allowed',
      preconditions: ['execution_allowed_must_remain_false'],
      blockedMutations: ['route_destination_write', 'artifact_move', 'executor_apply']
    });
  }
  if (
    !isRoutedDestination(decisionRecord.resolvedDestination) ||
    !isRoutedDestination(eligibilityRecord.resolvedDestination) ||
    !isRoutedDestination(approvalRecord.resolvedDestination) ||
    !isRoutedDestination(previewRecord.resolvedDestination)
  ) {
    return finalExecutorDryRunPlan({
      dryRunId,
      packet,
      decision: decisionRecord,
      approval: approvalRecord,
      preview: previewRecord,
      plannedOperation: 'hold_for_manual_destination_review',
      reason: 'missing_resolved_destination',
      preconditions: ['resolved_destination_required_before_live_execution'],
      blockedMutations: ['route_destination_write', 'artifact_move', 'executor_apply']
    });
  }

  return finalExecutorDryRunPlan({
    dryRunId,
    packet,
    decision: decisionRecord,
    approval: approvalRecord,
    preview: previewRecord,
    resolvedDestination: previewRecord.resolvedDestination,
    plannedOperation: 'route_to_resolved_destination',
    reason: 'dry_run_ready_for_live_executor',
    preconditions: [
      'final_executor_must_verify_packet_lock',
      'final_executor_must_verify_destination_still_valid',
      'final_executor_must_write_auditable_execution_record'
    ],
    blockedMutations: [
      'route_destination_write',
      'artifact_move',
      'external_api_apply'
    ]
  });
}
