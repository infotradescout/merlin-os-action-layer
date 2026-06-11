import type {
  HeldRoutingOperatorReviewPresentation,
  HeldRoutingOperatorReviewSummary
} from './intakeTypes.js';

type HeldRoutingOperatorReviewPresentationInput = {
  presentationId?: string;
};

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
    summary: presentation.summary,
    mutationAllowed: presentation.mutationAllowed,
    implementationAllowed: presentation.implementationAllowed,
    executionAllowed: presentation.executionAllowed
  });
}
