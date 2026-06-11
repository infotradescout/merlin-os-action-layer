import type {
  HeldRoutingOperatorReviewPresentation,
  HeldRoutingOperatorReviewSummary
} from './intakeTypes.js';

type HeldRoutingOperatorReviewPresentationInput = {
  presentationId?: string;
};

const LEDGER_PREVIEW_STATIC_TIMESTAMP = '2026-06-10T00:00:00.000Z';
const APPROVAL_GATE_PREVIEW_STATIC_TIMESTAMP = '2026-06-10T00:00:00.000Z';
const APPROVAL_ARTIFACT_PREVIEW_STATIC_TIMESTAMP = '2026-06-10T00:00:00.000Z';

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

function isValidNoEvidenceReason(value: unknown): value is 'not_applicable' | 'source_unavailable' {
  return value === 'not_applicable' || value === 'source_unavailable';
}

function determineApprovalGatePreview(input: {
  presentationId: string;
  packetId: string;
  summaryId: string;
  evidenceBindings: HeldRoutingOperatorReviewPresentation['evidenceBindings'];
  decisionLedgerPreview: HeldRoutingOperatorReviewPresentation['decisionLedgerPreview'];
  mutationAllowed: boolean;
  implementationAllowed: boolean;
  executionAllowed: boolean;
}): HeldRoutingOperatorReviewPresentation['approvalGatePreview'] {
  const detailMalformed = input.evidenceBindings.detailLines.filter((entry) => {
    if (entry.evidenceState !== 'bound' && entry.evidenceState !== 'no_evidence') return true;
    if (entry.evidenceState === 'bound' && entry.sourceReferences.length === 0) return true;
    if (entry.evidenceState === 'no_evidence' && !isValidNoEvidenceReason(entry.noEvidenceReason)) return true;
    return false;
  }).length;

  const warningMalformed = input.evidenceBindings.warnings.filter((entry) => {
    if (entry.evidenceState !== 'bound' && entry.evidenceState !== 'no_evidence') return true;
    if (entry.evidenceState === 'bound' && entry.sourceReferences.length === 0) return true;
    if (entry.evidenceState === 'no_evidence' && !isValidNoEvidenceReason(entry.noEvidenceReason)) return true;
    return false;
  }).length;

  const referencesMissing =
    !input.presentationId.trim() ||
    !input.packetId.trim() ||
    !input.summaryId.trim();

  const evidenceMissing =
    input.evidenceBindings.detailLines.length === 0 ||
    input.evidenceBindings.warnings.length === 0;

  const authorityContaminated =
    input.mutationAllowed ||
    input.implementationAllowed ||
    input.executionAllowed ||
    input.decisionLedgerPreview.authoritySnapshot.mutationAllowed ||
    input.decisionLedgerPreview.authoritySnapshot.implementationAllowed ||
    input.decisionLedgerPreview.authoritySnapshot.executionAllowed;

  const ledgerMissing =
    !input.decisionLedgerPreview.kind ||
    !input.decisionLedgerPreview.presentationId.trim() ||
    !input.decisionLedgerPreview.packetId.trim() ||
    !input.decisionLedgerPreview.summaryId.trim();

  let gateStatus: 'eligible_preview_only' | 'blocked' = 'eligible_preview_only';
  let gateReasonCode:
    | 'eligible_preview_only_read_only_prereqs_met'
    | 'missing_required_references'
    | 'missing_evidence_bindings'
    | 'missing_decision_ledger_preview'
    | 'authority_flags_not_hard_false'
    | 'malformed_evidence_binding_state' = 'eligible_preview_only_read_only_prereqs_met';

  if (referencesMissing) {
    gateStatus = 'blocked';
    gateReasonCode = 'missing_required_references';
  } else if (evidenceMissing) {
    gateStatus = 'blocked';
    gateReasonCode = 'missing_evidence_bindings';
  } else if (ledgerMissing) {
    gateStatus = 'blocked';
    gateReasonCode = 'missing_decision_ledger_preview';
  } else if (authorityContaminated) {
    gateStatus = 'blocked';
    gateReasonCode = 'authority_flags_not_hard_false';
  } else if (detailMalformed > 0 || warningMalformed > 0) {
    gateStatus = 'blocked';
    gateReasonCode = 'malformed_evidence_binding_state';
  }

  return {
    kind: 'operator_review_approval_gate_preview',
    presentationId: input.presentationId,
    packetId: input.packetId,
    summaryId: input.summaryId,
    gateStatus,
    gateReasonCode,
    evidenceBindingStatus: {
      detailLines: {
        total: input.evidenceBindings.detailLines.length,
        bound: input.evidenceBindings.detailLines.filter((entry) => entry.evidenceState === 'bound').length,
        noEvidence: input.evidenceBindings.detailLines.filter((entry) => entry.evidenceState === 'no_evidence').length,
        malformed: detailMalformed
      },
      warnings: {
        total: input.evidenceBindings.warnings.length,
        bound: input.evidenceBindings.warnings.filter((entry) => entry.evidenceState === 'bound').length,
        noEvidence: input.evidenceBindings.warnings.filter((entry) => entry.evidenceState === 'no_evidence').length,
        malformed: warningMalformed
      }
    },
    decisionLedgerPreviewStatus: {
      present: !ledgerMissing,
      kind: input.decisionLedgerPreview.kind,
      noActionStatus: input.decisionLedgerPreview.noActionStatus
    },
    authoritySnapshot: {
      mutationAllowed: false,
      implementationAllowed: false,
      executionAllowed: false
    },
    noActionStatus: 'preview_only_no_mutation',
    noActionReasonCode: 'approval_gate_preview_only',
    futureArtifactRequirements: [
      'approval_artifact_record_required',
      'operator_identity_attestation_required',
      'approval_timestamp_attestation_required'
    ],
    timestampPolicy: {
      mode: 'deterministic_static',
      previewedAt: APPROVAL_GATE_PREVIEW_STATIC_TIMESTAMP
    }
  };
}

function determineApprovalArtifactPreview(input: {
  presentationId: string;
  packetId: string;
  summaryId: string;
  decisionLedgerPreview: HeldRoutingOperatorReviewPresentation['decisionLedgerPreview'];
  approvalGatePreview?: HeldRoutingOperatorReviewPresentation['approvalGatePreview'];
  mutationAllowed: boolean;
  implementationAllowed: boolean;
  executionAllowed: boolean;
}): HeldRoutingOperatorReviewPresentation['approvalArtifactPreview'] {
  const gateMissing =
    !input.approvalGatePreview ||
    input.approvalGatePreview.kind !== 'operator_review_approval_gate_preview';
  const authorityContaminated =
    input.mutationAllowed ||
    input.implementationAllowed ||
    input.executionAllowed ||
    input.decisionLedgerPreview.authoritySnapshot.mutationAllowed ||
    input.decisionLedgerPreview.authoritySnapshot.implementationAllowed ||
    input.decisionLedgerPreview.authoritySnapshot.executionAllowed ||
    input.approvalGatePreview?.authoritySnapshot.mutationAllowed ||
    input.approvalGatePreview?.authoritySnapshot.implementationAllowed ||
    input.approvalGatePreview?.authoritySnapshot.executionAllowed;
  const gateBlocked = gateMissing || input.approvalGatePreview?.gateStatus !== 'eligible_preview_only';

  let artifactStatus: 'required_not_created' | 'blocked_by_gate' = 'required_not_created';
  let artifactReasonCode:
    | 'required_future_approval_artifact_not_created'
    | 'approval_gate_preview_missing'
    | 'approval_gate_blocked'
    | 'authority_flags_not_hard_false' = 'required_future_approval_artifact_not_created';

  if (gateMissing) {
    artifactStatus = 'blocked_by_gate';
    artifactReasonCode = 'approval_gate_preview_missing';
  } else if (authorityContaminated) {
    artifactStatus = 'blocked_by_gate';
    artifactReasonCode = 'authority_flags_not_hard_false';
  } else if (gateBlocked) {
    artifactStatus = 'blocked_by_gate';
    artifactReasonCode = 'approval_gate_blocked';
  }

  return {
    kind: 'operator_review_approval_artifact_preview',
    presentationId: input.presentationId,
    packetId: input.packetId,
    summaryId: input.summaryId,
    artifactStatus,
    artifactReasonCode,
    requiredFields: [
      'operatorIdentity',
      'approvalDecision',
      'approvalTimestamp',
      'evidenceBindingSummary',
      'decisionLedgerPreviewReference',
      'approvalGatePreviewReference',
      'authoritySnapshot'
    ],
    missingFields: ['operatorIdentity', 'approvalDecision', 'approvalTimestamp'],
    references: {
      decisionLedgerPreviewReference: {
        kind: input.decisionLedgerPreview.kind,
        presentationId: input.decisionLedgerPreview.presentationId,
        packetId: input.decisionLedgerPreview.packetId,
        summaryId: input.decisionLedgerPreview.summaryId,
        noActionStatus: input.decisionLedgerPreview.noActionStatus
      },
      approvalGatePreviewReference: {
        kind: input.approvalGatePreview?.kind,
        gateStatus: input.approvalGatePreview?.gateStatus,
        gateReasonCode: input.approvalGatePreview?.gateReasonCode,
        noActionStatus: input.approvalGatePreview?.noActionStatus
      },
      evidenceBindingSummary: {
        detailLines: {
          total: input.decisionLedgerPreview.evidenceSummary.detailLines.total,
          bound: input.decisionLedgerPreview.evidenceSummary.detailLines.bound,
          noEvidence: input.decisionLedgerPreview.evidenceSummary.detailLines.noEvidence
        },
        warnings: {
          total: input.decisionLedgerPreview.evidenceSummary.warnings.total,
          bound: input.decisionLedgerPreview.evidenceSummary.warnings.bound,
          noEvidence: input.decisionLedgerPreview.evidenceSummary.warnings.noEvidence
        }
      }
    },
    futureArtifactPolicy: {
      generation: 'must_be_generated_only_by_explicit_future_approval_action',
      bindings: [
        'must_bind_evidence_hash_or_summary',
        'must_bind_decision_ledger_preview',
        'must_bind_approval_gate_preview',
        'must_bind_operator_identity'
      ]
    },
    noActionStatus: 'preview_only_no_mutation',
    authoritySnapshot: {
      mutationAllowed: false,
      implementationAllowed: false,
      executionAllowed: false
    },
    timestampPolicy: {
      mode: 'deterministic_static',
      previewedAt: APPROVAL_ARTIFACT_PREVIEW_STATIC_TIMESTAMP
    }
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

  const detailBoundCount = detailLines
    .map((line) => detailEvidenceFor(normalizedSummary, line))
    .filter((entry) => entry.evidenceState === 'bound').length;
  const warningBoundCount = warningEvidenceRows.filter((entry) => entry.evidenceState === 'bound').length;

  const decisionLedgerPreview: HeldRoutingOperatorReviewPresentation['decisionLedgerPreview'] = {
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
  };

  const approvalGatePreview = determineApprovalGatePreview({
    presentationId,
    packetId: normalizedSummary.packetId,
    summaryId: normalizedSummary.summaryId,
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
    decisionLedgerPreview,
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false
  });
  const approvalArtifactPreview = determineApprovalArtifactPreview({
    presentationId,
    packetId: normalizedSummary.packetId,
    summaryId: normalizedSummary.summaryId,
    decisionLedgerPreview,
    approvalGatePreview,
    mutationAllowed: false,
    implementationAllowed: false,
    executionAllowed: false
  });

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
    decisionLedgerPreview,
    approvalGatePreview,
    approvalArtifactPreview,
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
    approvalGatePreview: {
      kind: presentation.approvalGatePreview.kind,
      presentationId: presentation.approvalGatePreview.presentationId,
      packetId: presentation.approvalGatePreview.packetId,
      summaryId: presentation.approvalGatePreview.summaryId,
      gateStatus: presentation.approvalGatePreview.gateStatus,
      gateReasonCode: presentation.approvalGatePreview.gateReasonCode,
      evidenceBindingStatus: {
        detailLines: {
          total: presentation.approvalGatePreview.evidenceBindingStatus.detailLines.total,
          bound: presentation.approvalGatePreview.evidenceBindingStatus.detailLines.bound,
          noEvidence: presentation.approvalGatePreview.evidenceBindingStatus.detailLines.noEvidence,
          malformed: presentation.approvalGatePreview.evidenceBindingStatus.detailLines.malformed
        },
        warnings: {
          total: presentation.approvalGatePreview.evidenceBindingStatus.warnings.total,
          bound: presentation.approvalGatePreview.evidenceBindingStatus.warnings.bound,
          noEvidence: presentation.approvalGatePreview.evidenceBindingStatus.warnings.noEvidence,
          malformed: presentation.approvalGatePreview.evidenceBindingStatus.warnings.malformed
        }
      },
      decisionLedgerPreviewStatus: {
        present: presentation.approvalGatePreview.decisionLedgerPreviewStatus.present,
        kind: presentation.approvalGatePreview.decisionLedgerPreviewStatus.kind,
        noActionStatus: presentation.approvalGatePreview.decisionLedgerPreviewStatus.noActionStatus
      },
      authoritySnapshot: {
        mutationAllowed: presentation.approvalGatePreview.authoritySnapshot.mutationAllowed,
        implementationAllowed: presentation.approvalGatePreview.authoritySnapshot.implementationAllowed,
        executionAllowed: presentation.approvalGatePreview.authoritySnapshot.executionAllowed
      },
      noActionStatus: presentation.approvalGatePreview.noActionStatus,
      noActionReasonCode: presentation.approvalGatePreview.noActionReasonCode,
      futureArtifactRequirements: [...presentation.approvalGatePreview.futureArtifactRequirements],
      timestampPolicy: {
        mode: presentation.approvalGatePreview.timestampPolicy.mode,
        previewedAt: presentation.approvalGatePreview.timestampPolicy.previewedAt
      }
    },
    approvalArtifactPreview: {
      kind: presentation.approvalArtifactPreview.kind,
      presentationId: presentation.approvalArtifactPreview.presentationId,
      packetId: presentation.approvalArtifactPreview.packetId,
      summaryId: presentation.approvalArtifactPreview.summaryId,
      artifactStatus: presentation.approvalArtifactPreview.artifactStatus,
      artifactReasonCode: presentation.approvalArtifactPreview.artifactReasonCode,
      requiredFields: [...presentation.approvalArtifactPreview.requiredFields],
      missingFields: [...presentation.approvalArtifactPreview.missingFields],
      references: {
        decisionLedgerPreviewReference: {
          kind: presentation.approvalArtifactPreview.references.decisionLedgerPreviewReference.kind,
          presentationId: presentation.approvalArtifactPreview.references.decisionLedgerPreviewReference.presentationId,
          packetId: presentation.approvalArtifactPreview.references.decisionLedgerPreviewReference.packetId,
          summaryId: presentation.approvalArtifactPreview.references.decisionLedgerPreviewReference.summaryId,
          noActionStatus: presentation.approvalArtifactPreview.references.decisionLedgerPreviewReference.noActionStatus
        },
        approvalGatePreviewReference: {
          kind: presentation.approvalArtifactPreview.references.approvalGatePreviewReference.kind,
          gateStatus: presentation.approvalArtifactPreview.references.approvalGatePreviewReference.gateStatus,
          gateReasonCode: presentation.approvalArtifactPreview.references.approvalGatePreviewReference.gateReasonCode,
          noActionStatus: presentation.approvalArtifactPreview.references.approvalGatePreviewReference.noActionStatus
        },
        evidenceBindingSummary: {
          detailLines: {
            total: presentation.approvalArtifactPreview.references.evidenceBindingSummary.detailLines.total,
            bound: presentation.approvalArtifactPreview.references.evidenceBindingSummary.detailLines.bound,
            noEvidence: presentation.approvalArtifactPreview.references.evidenceBindingSummary.detailLines.noEvidence
          },
          warnings: {
            total: presentation.approvalArtifactPreview.references.evidenceBindingSummary.warnings.total,
            bound: presentation.approvalArtifactPreview.references.evidenceBindingSummary.warnings.bound,
            noEvidence: presentation.approvalArtifactPreview.references.evidenceBindingSummary.warnings.noEvidence
          }
        }
      },
      futureArtifactPolicy: {
        generation: presentation.approvalArtifactPreview.futureArtifactPolicy.generation,
        bindings: [...presentation.approvalArtifactPreview.futureArtifactPolicy.bindings]
      },
      noActionStatus: presentation.approvalArtifactPreview.noActionStatus,
      authoritySnapshot: {
        mutationAllowed: presentation.approvalArtifactPreview.authoritySnapshot.mutationAllowed,
        implementationAllowed: presentation.approvalArtifactPreview.authoritySnapshot.implementationAllowed,
        executionAllowed: presentation.approvalArtifactPreview.authoritySnapshot.executionAllowed
      },
      timestampPolicy: {
        mode: presentation.approvalArtifactPreview.timestampPolicy.mode,
        previewedAt: presentation.approvalArtifactPreview.timestampPolicy.previewedAt
      }
    },
    summary: presentation.summary,
    mutationAllowed: presentation.mutationAllowed,
    implementationAllowed: presentation.implementationAllowed,
    executionAllowed: presentation.executionAllowed
  });
}
