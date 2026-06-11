import type {
  HeldRoutingOperatorReviewPresentation,
  HeldRoutingOperatorReviewSummary
} from './intakeTypes.js';

type HeldRoutingOperatorReviewPresentationInput = {
  presentationId?: string;
};

const LEDGER_PREVIEW_STATIC_TIMESTAMP = '2026-06-10T00:00:00.000Z';

type PresentationEvidenceItem = {
  sourceReferences: string[];
  evidenceState: 'bound' | 'no_evidence';
  noEvidenceReason?: 'not_applicable' | 'source_unavailable';
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

function detailEvidenceFor(
  summary: HeldRoutingOperatorReviewSummary,
  detailLine: string
): PresentationEvidenceItem {
  if (detailLine.startsWith('packetId:')) {
    if (summary.packetId.trim()) {
      return {
        sourceReferences: [`packet:${summary.packetId}`],
        evidenceState: 'bound'
      };
    }
    return {
      sourceReferences: [],
      evidenceState: 'no_evidence',
      noEvidenceReason: 'source_unavailable'
    };
  }

  if (detailLine.startsWith('summaryId:')) {
    if (summary.summaryId.trim()) {
      return {
        sourceReferences: [`summary:${summary.summaryId}`],
        evidenceState: 'bound'
      };
    }
    return {
      sourceReferences: [],
      evidenceState: 'no_evidence',
      noEvidenceReason: 'source_unavailable'
    };
  }

  if (detailLine.startsWith('nextRequiredAction:') || detailLine.startsWith('currentStatus:')) {
    const refs = [summary.summaryId && `summary:${summary.summaryId}`, summary.packetId && `packet:${summary.packetId}`].filter(
      (value): value is string => Boolean(value)
    );
    if (refs.length > 0) {
      return {
        sourceReferences: refs,
        evidenceState: 'bound'
      };
    }
    return {
      sourceReferences: [],
      evidenceState: 'no_evidence',
      noEvidenceReason: 'source_unavailable'
    };
  }

  if (detailLine.startsWith('warnings:')) {
    if (summary.operatorWarnings.length === 0) {
      return {
        sourceReferences: [],
        evidenceState: 'no_evidence',
        noEvidenceReason: 'not_applicable'
      };
    }
    return {
      sourceReferences: [summary.summaryId && `summary:${summary.summaryId}`].filter((value): value is string => Boolean(value)),
      evidenceState: 'bound'
    };
  }

  return {
    sourceReferences: [],
    evidenceState: 'no_evidence',
    noEvidenceReason: 'not_applicable'
  };
}

function warningEvidenceFor(summary: HeldRoutingOperatorReviewSummary, warning: string): PresentationEvidenceItem {
  if (!warning.trim()) {
    return {
      sourceReferences: [],
      evidenceState: 'no_evidence',
      noEvidenceReason: 'source_unavailable'
    };
  }

  if (warning === 'packet_mismatch') {
    if (summary.packetId.trim()) {
      return {
        sourceReferences: [`packet:${summary.packetId}`],
        evidenceState: 'bound'
      };
    }
    return {
      sourceReferences: [],
      evidenceState: 'no_evidence',
      noEvidenceReason: 'source_unavailable'
    };
  }

  if (summary.summaryId.trim()) {
    return {
      sourceReferences: [`summary:${summary.summaryId}`],
      evidenceState: 'bound'
    };
  }

  return {
    sourceReferences: [],
    evidenceState: 'no_evidence',
    noEvidenceReason: 'source_unavailable'
  };
}

function noActionReasonCodeFor(summary: HeldRoutingOperatorReviewSummary):
  | 'current_status_ready_no_action_surface'
  | 'current_status_blocked_no_action_surface'
  | 'current_status_incomplete_no_action_surface' {
  if (summary.currentStatus === 'ready') return 'current_status_ready_no_action_surface';
  if (summary.currentStatus === 'blocked') return 'current_status_blocked_no_action_surface';
  return 'current_status_incomplete_no_action_surface';
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

  const detailLines = detailLinesFor(normalizedSummary);
  const warningEvidenceRows =
    normalizedSummary.operatorWarnings.length > 0
      ? normalizedSummary.operatorWarnings.map((warning) => {
          const evidence = warningEvidenceFor(normalizedSummary, warning);
          return {
            warning,
            sourceReferences: [...evidence.sourceReferences],
            evidenceState: evidence.evidenceState,
            noEvidenceReason: evidence.noEvidenceReason
          };
        })
      : [
          {
            warning: 'none',
            sourceReferences: [],
            evidenceState: 'no_evidence' as const,
            noEvidenceReason: 'not_applicable' as const
          }
        ];

  const detailBoundCount = detailLines
    .map((line) => detailEvidenceFor(normalizedSummary, line))
    .filter((entry) => entry.evidenceState === 'bound').length;
  const warningBoundCount = warningEvidenceRows.filter((entry) => entry.evidenceState === 'bound').length;

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
      detailLines: [...detailLines]
    },
    evidenceBindings: {
      detailLines: detailLines.map((line) => {
        const evidence = detailEvidenceFor(normalizedSummary, line);
        return {
          line,
          sourceReferences: [...evidence.sourceReferences],
          evidenceState: evidence.evidenceState,
          noEvidenceReason: evidence.noEvidenceReason
        };
      }),
      warnings: warningEvidenceRows
    },
    decisionLedgerPreview: {
      kind: 'operator_review_decision_ledger_preview',
      presentationId,
      packetId: normalizedSummary.packetId,
      summaryId: normalizedSummary.summaryId,
      wouldRecordEventType: 'held_routing_operator_review_decision_preview',
      noActionStatus: 'preview_only_no_mutation',
      noActionReasonCode: noActionReasonCodeFor(normalizedSummary),
      evidenceSummary: {
        detailLines: {
          total: detailLines.length,
          bound: detailBoundCount,
          noEvidence: detailLines.length - detailBoundCount
        },
        warnings: {
          total: warningEvidenceRows.length,
          bound: warningBoundCount,
          noEvidence: warningEvidenceRows.length - warningBoundCount
        }
      },
      authoritySnapshot: {
        mutationAllowed: false,
        implementationAllowed: false,
        executionAllowed: false
      },
      timestampPolicy: {
        mode: 'deterministic_static',
        previewedAt: LEDGER_PREVIEW_STATIC_TIMESTAMP
      }
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
    evidenceBindings: {
      detailLines: presentation.evidenceBindings.detailLines.map((entry) => ({
        line: entry.line,
        sourceReferences: [...entry.sourceReferences],
        evidenceState: entry.evidenceState,
        noEvidenceReason: entry.noEvidenceReason
      })),
      warnings: presentation.evidenceBindings.warnings.map((entry) => ({
        warning: entry.warning,
        sourceReferences: [...entry.sourceReferences],
        evidenceState: entry.evidenceState,
        noEvidenceReason: entry.noEvidenceReason
      }))
    },
    decisionLedgerPreview: {
      kind: presentation.decisionLedgerPreview.kind,
      presentationId: presentation.decisionLedgerPreview.presentationId,
      packetId: presentation.decisionLedgerPreview.packetId,
      summaryId: presentation.decisionLedgerPreview.summaryId,
      wouldRecordEventType: presentation.decisionLedgerPreview.wouldRecordEventType,
      noActionStatus: presentation.decisionLedgerPreview.noActionStatus,
      noActionReasonCode: presentation.decisionLedgerPreview.noActionReasonCode,
      evidenceSummary: {
        detailLines: {
          total: presentation.decisionLedgerPreview.evidenceSummary.detailLines.total,
          bound: presentation.decisionLedgerPreview.evidenceSummary.detailLines.bound,
          noEvidence: presentation.decisionLedgerPreview.evidenceSummary.detailLines.noEvidence
        },
        warnings: {
          total: presentation.decisionLedgerPreview.evidenceSummary.warnings.total,
          bound: presentation.decisionLedgerPreview.evidenceSummary.warnings.bound,
          noEvidence: presentation.decisionLedgerPreview.evidenceSummary.warnings.noEvidence
        }
      },
      authoritySnapshot: {
        mutationAllowed: presentation.decisionLedgerPreview.authoritySnapshot.mutationAllowed,
        implementationAllowed: presentation.decisionLedgerPreview.authoritySnapshot.implementationAllowed,
        executionAllowed: presentation.decisionLedgerPreview.authoritySnapshot.executionAllowed
      },
      timestampPolicy: {
        mode: presentation.decisionLedgerPreview.timestampPolicy.mode,
        previewedAt: presentation.decisionLedgerPreview.timestampPolicy.previewedAt
      }
    },
    summary: presentation.summary,
    mutationAllowed: presentation.mutationAllowed,
    implementationAllowed: presentation.implementationAllowed,
    executionAllowed: presentation.executionAllowed
  });
}
