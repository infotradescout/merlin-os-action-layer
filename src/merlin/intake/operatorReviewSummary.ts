import type {
  HeldRoutingApplyEligibility,
  HeldRoutingExplicitApplyApproval,
  HeldRoutingFinalExecutorDryRunPlan,
  HeldRoutingFinalExecutorPreview,
  HeldRoutingOperatorDecision,
  HeldRoutingOperatorReviewSummary,
  HeldRoutingReviewPacket
} from './intakeTypes.js';

type HeldRoutingOperatorReviewSummaryInput = {
  summaryId?: string;
  executionAllowed?: boolean;
};

function isNonEmptyId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function pushWarning(target: string[], warning: string): void {
  if (!target.includes(warning)) target.push(warning);
}

function hasExecutionAllowedTrue(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  return (record as { executionAllowed?: boolean }).executionAllowed === true;
}

function hasMutationAllowedTrue(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  return (record as { mutationAllowed?: boolean }).mutationAllowed === true;
}

function hasImplementationAllowedTrue(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  return (record as { implementationAllowed?: boolean }).implementationAllowed === true;
}

export function createHeldRoutingOperatorReviewSummary(
  packet: HeldRoutingReviewPacket,
  decisionRecord: HeldRoutingOperatorDecision | undefined,
  eligibilityRecord: HeldRoutingApplyEligibility | undefined,
  approvalRecord: HeldRoutingExplicitApplyApproval | undefined,
  previewRecord: HeldRoutingFinalExecutorPreview | undefined,
  dryRunRecord: HeldRoutingFinalExecutorDryRunPlan | undefined,
  input: HeldRoutingOperatorReviewSummaryInput
): HeldRoutingOperatorReviewSummary {
  const summaryId = input.summaryId?.trim() || '';
  const warnings: string[] = [];
  const packetId = packet.packetId?.trim() || '';

  const decisionSummary: HeldRoutingOperatorReviewSummary['decisionSummary'] = {
    present: Boolean(decisionRecord),
    decisionId: decisionRecord?.decisionId,
    resultingStatus: decisionRecord?.resultingStatus,
    resolvedDestination: decisionRecord?.resolvedDestination,
    valid: Boolean(decisionRecord?.decisionId?.trim())
  };

  const eligibilitySummary: HeldRoutingOperatorReviewSummary['eligibilitySummary'] = {
    present: Boolean(eligibilityRecord),
    decisionId: eligibilityRecord?.decisionId,
    applyEligible: eligibilityRecord?.applyEligible,
    reason: eligibilityRecord?.reason,
    valid: Boolean(eligibilityRecord && eligibilityRecord.applyEligible === true)
  };

  const explicitApprovalSummary: HeldRoutingOperatorReviewSummary['explicitApprovalSummary'] = {
    present: Boolean(approvalRecord),
    approvalId: approvalRecord?.approvalId,
    decisionId: approvalRecord?.decisionId,
    applyApproved: approvalRecord?.applyApproved,
    reason: approvalRecord?.reason,
    valid: Boolean(approvalRecord && approvalRecord.applyApproved === true)
  };

  const finalExecutorPreviewSummary: HeldRoutingOperatorReviewSummary['finalExecutorPreviewSummary'] = {
    present: Boolean(previewRecord),
    previewId: previewRecord?.previewId,
    approvalId: previewRecord?.approvalId,
    readyForFinalExecutor: previewRecord?.readyForFinalExecutor,
    reason: previewRecord?.reason,
    valid: Boolean(previewRecord && previewRecord.readyForFinalExecutor === true)
  };

  const dryRunPlanSummary: HeldRoutingOperatorReviewSummary['dryRunPlanSummary'] = {
    present: Boolean(dryRunRecord),
    dryRunId: dryRunRecord?.dryRunId,
    previewId: dryRunRecord?.previewId,
    plannedOperation: dryRunRecord?.plannedOperation,
    reason: dryRunRecord?.reason,
    valid: Boolean(
      dryRunRecord &&
        dryRunRecord.reason === 'dry_run_ready_for_live_executor' &&
        dryRunRecord.plannedOperation === 'route_to_resolved_destination'
    )
  };

  const packetMismatch = [
    decisionRecord?.packetId,
    eligibilityRecord?.packetId,
    approvalRecord?.packetId,
    previewRecord?.packetId,
    dryRunRecord?.packetId
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value !== packet.packetId);

  const authorityContaminated =
    hasMutationAllowedTrue(decisionRecord) ||
    hasMutationAllowedTrue(eligibilityRecord) ||
    hasMutationAllowedTrue(approvalRecord) ||
    hasMutationAllowedTrue(previewRecord) ||
    hasMutationAllowedTrue(dryRunRecord) ||
    hasImplementationAllowedTrue(decisionRecord) ||
    hasImplementationAllowedTrue(eligibilityRecord) ||
    hasImplementationAllowedTrue(approvalRecord) ||
    hasImplementationAllowedTrue(previewRecord) ||
    hasImplementationAllowedTrue(dryRunRecord) ||
    hasExecutionAllowedTrue(decisionRecord) ||
    hasExecutionAllowedTrue(eligibilityRecord) ||
    hasExecutionAllowedTrue(approvalRecord) ||
    hasExecutionAllowedTrue(previewRecord) ||
    hasExecutionAllowedTrue(dryRunRecord) ||
    input.executionAllowed === true;

  if (!summaryId) pushWarning(warnings, 'missing_summary_id');
  if (!packetId) pushWarning(warnings, 'missing_packet_id');
  if (packetMismatch) pushWarning(warnings, 'packet_mismatch');
  if (authorityContaminated) pushWarning(warnings, 'authority_contamination');

  let nextRequiredAction: HeldRoutingOperatorReviewSummary['nextRequiredAction'] = 'ready_for_live_executor';
  let currentStatus: HeldRoutingOperatorReviewSummary['currentStatus'] = 'ready';

  if (warnings.length > 0) {
    nextRequiredAction = 'blocked';
    currentStatus = 'blocked';
  } else if (!decisionRecord) {
    pushWarning(warnings, 'decision_missing');
    nextRequiredAction = 'operator_decision_required';
    currentStatus = 'incomplete';
  } else if (!eligibilityRecord) {
    pushWarning(warnings, 'eligibility_missing');
    nextRequiredAction = 'apply_eligibility_required';
    currentStatus = 'incomplete';
  } else if (!approvalRecord) {
    pushWarning(warnings, 'explicit_approval_missing');
    nextRequiredAction = 'explicit_apply_approval_required';
    currentStatus = 'incomplete';
  } else if (!previewRecord) {
    pushWarning(warnings, 'final_executor_preview_missing');
    nextRequiredAction = 'final_executor_preview_required';
    currentStatus = 'incomplete';
  } else if (!dryRunRecord) {
    pushWarning(warnings, 'dry_run_missing');
    nextRequiredAction = 'dry_run_required';
    currentStatus = 'incomplete';
  } else {
    const decisionId = decisionRecord.decisionId;
    const approvalId = approvalRecord.approvalId;
    const previewId = previewRecord.previewId;
    const dryRunId = dryRunRecord.dryRunId;

    const idsPresent =
      isNonEmptyId(summaryId) &&
      isNonEmptyId(packetId) &&
      isNonEmptyId(decisionId) &&
      isNonEmptyId(approvalId) &&
      isNonEmptyId(previewId) &&
      isNonEmptyId(dryRunId);

    const decisionStatusReady =
      decisionRecord.resultingStatus === 'approved_for_apply' ||
      decisionRecord.resultingStatus === 'destination_changed_for_apply';

    const reasonsReady =
      eligibilityRecord.reason === 'apply_ready_requires_explicit_approval' &&
      approvalRecord.reason === 'explicit_apply_approval_recorded' &&
      previewRecord.reason === 'final_executor_preview_ready' &&
      dryRunRecord.reason === 'dry_run_ready_for_live_executor';

    const chainIsReady =
      idsPresent &&
      eligibilityRecord.applyEligible === true &&
      approvalRecord.applyApproved === true &&
      decisionStatusReady &&
      reasonsReady &&
      previewRecord.readyForFinalExecutor === true &&
      previewRecord.requiresFinalExecution === true &&
      dryRunRecord.plannedOperation === 'route_to_resolved_destination' &&
      dryRunRecord.requiresLiveExecutor === true &&
      dryRunRecord.readyForExecution === false &&
      decisionRecord.decisionId === eligibilityRecord.decisionId &&
      decisionRecord.decisionId === approvalRecord.decisionId &&
      decisionRecord.decisionId === previewRecord.decisionId &&
      decisionRecord.decisionId === dryRunRecord.decisionId &&
      approvalRecord.approvalId === previewRecord.approvalId &&
      approvalRecord.approvalId === dryRunRecord.approvalId &&
      previewRecord.previewId === dryRunRecord.previewId;

    if (!chainIsReady) {
      if (!idsPresent) pushWarning(warnings, 'missing_required_ids');
      if (!decisionStatusReady) pushWarning(warnings, 'invalid_decision_status');
      if (!reasonsReady) pushWarning(warnings, 'invalid_stage_reasons');
      pushWarning(warnings, 'invalid_ready_chain');
      nextRequiredAction = 'blocked';
      currentStatus = 'blocked';
    }
  }

  return {
    summaryId,
    packetId: packet.packetId,
    currentStatus,
    decisionSummary,
    eligibilitySummary,
    explicitApprovalSummary,
    finalExecutorPreviewSummary,
    dryRunPlanSummary,
    nextRequiredAction,
    operatorWarnings: warnings,
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false
  };
}

export function serializeHeldRoutingOperatorReviewSummary(summary: HeldRoutingOperatorReviewSummary): string {
  return JSON.stringify({
    summaryId: summary.summaryId,
    packetId: summary.packetId,
    currentStatus: summary.currentStatus,
    decisionSummary: {
      present: summary.decisionSummary.present,
      decisionId: summary.decisionSummary.decisionId,
      resultingStatus: summary.decisionSummary.resultingStatus,
      resolvedDestination: summary.decisionSummary.resolvedDestination,
      valid: summary.decisionSummary.valid
    },
    eligibilitySummary: {
      present: summary.eligibilitySummary.present,
      decisionId: summary.eligibilitySummary.decisionId,
      applyEligible: summary.eligibilitySummary.applyEligible,
      reason: summary.eligibilitySummary.reason,
      valid: summary.eligibilitySummary.valid
    },
    explicitApprovalSummary: {
      present: summary.explicitApprovalSummary.present,
      approvalId: summary.explicitApprovalSummary.approvalId,
      decisionId: summary.explicitApprovalSummary.decisionId,
      applyApproved: summary.explicitApprovalSummary.applyApproved,
      reason: summary.explicitApprovalSummary.reason,
      valid: summary.explicitApprovalSummary.valid
    },
    finalExecutorPreviewSummary: {
      present: summary.finalExecutorPreviewSummary.present,
      previewId: summary.finalExecutorPreviewSummary.previewId,
      approvalId: summary.finalExecutorPreviewSummary.approvalId,
      readyForFinalExecutor: summary.finalExecutorPreviewSummary.readyForFinalExecutor,
      reason: summary.finalExecutorPreviewSummary.reason,
      valid: summary.finalExecutorPreviewSummary.valid
    },
    dryRunPlanSummary: {
      present: summary.dryRunPlanSummary.present,
      dryRunId: summary.dryRunPlanSummary.dryRunId,
      previewId: summary.dryRunPlanSummary.previewId,
      plannedOperation: summary.dryRunPlanSummary.plannedOperation,
      reason: summary.dryRunPlanSummary.reason,
      valid: summary.dryRunPlanSummary.valid
    },
    nextRequiredAction: summary.nextRequiredAction,
    operatorWarnings: [...summary.operatorWarnings],
    mutationAllowed: summary.mutationAllowed,
    implementationAllowed: summary.implementationAllowed,
    executionAllowed: summary.executionAllowed
  });
}
