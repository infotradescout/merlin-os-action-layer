import type {
  HeldRoutingOperatorReviewPresentation,
  HeldRoutingOperatorReviewSummary
} from './intakeTypes.js';

type HeldRoutingOperatorReviewPresentationInput = {
  presentationId?: string;
};

function titleFor(action: HeldRoutingOperatorReviewSummary['nextRequiredAction']): string {
  if (action === 'ready_for_live_executor') return 'Held Routing Review Ready';
  if (action === 'blocked') return 'Held Routing Review Blocked';
  if (action === 'operator_decision_required') return 'Operator Decision Required';
  if (action === 'apply_eligibility_required') return 'Apply Eligibility Required';
  if (action === 'explicit_apply_approval_required') return 'Explicit Apply Approval Required';
  if (action === 'final_executor_preview_required') return 'Final Executor Preview Required';
  return 'Dry Run Required';
}

function subtitleFor(summary: HeldRoutingOperatorReviewSummary): string {
  if (summary.currentStatus === 'ready') {
    return 'Advisory chain is complete. Live executor remains separate and disabled here.';
  }
  if (summary.currentStatus === 'blocked') {
    return 'Chain is blocked. Resolve warnings before progressing.';
  }
  return 'Chain is incomplete. Continue required review steps.';
}

function detailLinesFor(summary: HeldRoutingOperatorReviewSummary): string[] {
  return [
    `packetId:${summary.packetId}`,
    `summaryId:${summary.summaryId}`,
    `nextRequiredAction:${summary.nextRequiredAction}`,
    `currentStatus:${summary.currentStatus}`,
    `warnings:${summary.operatorWarnings.join('|') || 'none'}`,
    'authority:mutation=false|implementation=false|execution=false'
  ];
}

export function createHeldRoutingOperatorReviewPresentation(
  summary: HeldRoutingOperatorReviewSummary,
  input: HeldRoutingOperatorReviewPresentationInput
): HeldRoutingOperatorReviewPresentation {
  const presentationId = input.presentationId?.trim() || '';
  const normalizedWarnings = [...summary.operatorWarnings];
  if (!presentationId) normalizedWarnings.unshift('missing_presentation_id');

  const nextRequiredAction = normalizedWarnings.length > 0 ? 'blocked' : summary.nextRequiredAction;
  const currentStatus = normalizedWarnings.length > 0 ? 'blocked' : summary.currentStatus;

  const normalizedSummary: HeldRoutingOperatorReviewSummary = {
    ...summary,
    currentStatus,
    nextRequiredAction,
    operatorWarnings: normalizedWarnings,
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false
  };

  return {
    presentationId,
    status: 'ok',
    mode: 'read_only',
    advisoryOnly: true,
    summaryId: normalizedSummary.summaryId,
    packetId: normalizedSummary.packetId,
    currentStatus: normalizedSummary.currentStatus,
    nextRequiredAction: normalizedSummary.nextRequiredAction,
    operatorWarnings: [...normalizedSummary.operatorWarnings],
    display: {
      title: titleFor(normalizedSummary.nextRequiredAction),
      subtitle: subtitleFor(normalizedSummary),
      detailLines: detailLinesFor(normalizedSummary)
    },
    summary: normalizedSummary,
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false
  };
}

export function serializeHeldRoutingOperatorReviewPresentation(presentation: HeldRoutingOperatorReviewPresentation): string {
  return JSON.stringify({
    presentationId: presentation.presentationId,
    status: presentation.status,
    mode: presentation.mode,
    advisoryOnly: presentation.advisoryOnly,
    summaryId: presentation.summaryId,
    packetId: presentation.packetId,
    currentStatus: presentation.currentStatus,
    nextRequiredAction: presentation.nextRequiredAction,
    operatorWarnings: [...presentation.operatorWarnings],
    display: {
      title: presentation.display.title,
      subtitle: presentation.display.subtitle,
      detailLines: [...presentation.display.detailLines]
    },
    summary: presentation.summary,
    mutationAllowed: presentation.mutationAllowed,
    implementationAllowed: presentation.implementationAllowed,
    executionAllowed: presentation.executionAllowed
  });
}
