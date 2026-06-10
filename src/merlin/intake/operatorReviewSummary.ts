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
        dryRunRecord.reason === 'dry_run_plan_ready' &&
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

  if (!summaryId) warnings.push('missing_summary_id');
  if (packetMismatch) warnings.push('packet_mismatch');
  if (authorityContaminated) warnings.push('authority_contamination');

  let nextRequiredAction: HeldRoutingOperatorReviewSummary['nextRequiredAction'] = 'ready_for_live_executor';
  let currentStatus: HeldRoutingOperatorReviewSummary['currentStatus'] = 'ready';

  if (warnings.length > 0) {
    nextRequiredAction = 'blocked';
    currentStatus = 'blocked';
  } else if (!decisionRecord) {
    warnings.push('decision_missing');
    nextRequiredAction = 'operator_decision_required';
    currentStatus = 'incomplete';
  } else if (!eligibilityRecord) {
    warnings.push('eligibility_missing');
    nextRequiredAction = 'apply_eligibility_required';
    currentStatus = 'incomplete';
  } else if (!approvalRecord) {
    warnings.push('explicit_approval_missing');
    nextRequiredAction = 'explicit_apply_approval_required';
    currentStatus = 'incomplete';
  } else if (!previewRecord) {
    warnings.push('final_executor_preview_missing');
    nextRequiredAction = 'final_executor_preview_required';
    currentStatus = 'incomplete';
  } else if (!dryRunRecord) {
    warnings.push('dry_run_missing');
    nextRequiredAction = 'dry_run_required';
    currentStatus = 'incomplete';
  } else {
    const chainIsReady =
      eligibilityRecord.applyEligible === true &&
      approvalRecord.applyApproved === true &&
      previewRecord.readyForFinalExecutor === true &&
      previewRecord.requiresFinalExecution === true &&
      dryRunRecord.reason === 'dry_run_plan_ready' &&
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
      warnings.push('invalid_ready_chain');
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
