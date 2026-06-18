import type { MerlinUniversalProductUpdatePacketPreview } from './universalProductUpdatePacketPreview.js';

export type MerlinBrand = 'MEALSCOUT' | 'HOMEID' | 'TRADESCOUT' | 'MERLIN';
export type MerlinActorScope = 'owner' | 'customer' | 'homeowner' | 'contractor' | 'staff' | 'admin' | 'rep' | 'system';
export type MerlinEntityType = 'food_truck' | 'restaurant' | 'home' | 'contractor' | 'host_location' | 'event' | 'unknown';
export type MerlinIntakeStatus =
  | 'CREATED'
  | 'FILES_ATTACHED'
  | 'ROUTED'
  | 'PREVIEW_READY'
  | 'EDITED'
  | 'APPROVED'
  | 'APPLIED'
  | 'REJECTED'
  | 'HELD_FOR_REVIEW'
  | 'ERROR';
export type MerlinImplementationMode = 'draft_only' | 'approval_required' | 'admin_review_required';
export type MerlinRiskLevel = 'low' | 'medium' | 'high';
export type MerlinRoutedDestination = 'menu' | 'schedule' | 'logo' | 'photo' | 'document';
export type MerlinRoutingOperatorAction = 'approve_route' | 'change_destination' | 'request_more_info' | 'reject_upload' | 'defer';
export type HeldRoutingDecisionStatus =
  | 'approved_for_apply'
  | 'destination_changed_for_apply'
  | 'pending_more_info'
  | 'rejected'
  | 'deferred'
  | 'invalid_action';

export type IntentActionDefinition = {
  actionId: string;
  brand: MerlinBrand;
  actorScope: MerlinActorScope;
  label: string;
  description: string;
  entityTypesAllowed: MerlinEntityType[];
  expectedFileTypes: string[];
  allowedOutputTypes: string[];
  allowedFieldPaths: string[];
  forbiddenFieldPaths: string[];
  requiresEntityContext: boolean;
  requiresUserHint: boolean;
  previewRequired: true;
  approvalRequired: true;
  implementationMode: MerlinImplementationMode;
  riskLevel: MerlinRiskLevel;
};

export type UploadIntentFileRef = {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  driveFolderId?: string;
  extractedText?: string;
  metadata?: Record<string, unknown>;
};

export type RoutingDecision = UploadIntentFileRef & {
  routedType: MerlinRoutedDestination | 'unknown' | 'held';
  proposedDestination?: MerlinRoutedDestination;
  confidence: number;
  reasons: string[];
  holdReason?: 'ambiguous' | 'unrelated' | 'insufficient_evidence' | 'INTENT_EVIDENCE_CONFLICT' | 'AMBIGUOUS_OR_WRONG_DOMAIN';
};

export type HeldRoutingReviewPacket = {
  packetId: string;
  uploadId: string;
  fileId: string;
  fileName?: string;
  declaredIntent: {
    brand: MerlinBrand;
    actionId: string;
    actorScope: MerlinActorScope;
    entityType: MerlinEntityType;
    entityId?: string;
  };
  detectedEvidenceSignals: string[];
  proposedDestination?: MerlinRoutedDestination;
  holdReason: NonNullable<RoutingDecision['holdReason']>;
  confidence: {
    score: number;
    reasons: string[];
  };
  operatorActionOptions: MerlinRoutingOperatorAction[];
  mutationAllowed: false;
  implementationAllowed: false;
};

export type HeldRoutingOperatorDecision = {
  decisionId: string;
  packetId: string;
  action: MerlinRoutingOperatorAction | 'invalid_action';
  operatorId: string;
  note: string;
  resultingStatus: HeldRoutingDecisionStatus;
  resolvedDestination?: MerlinRoutedDestination;
  stillRequiresApply: boolean;
  mutationAllowed: false;
  implementationAllowed: false;
};

export type HeldRoutingApplyEligibility = {
  applyEligible: boolean;
  reason:
    | 'apply_ready_requires_explicit_approval'
    | 'invalid_action'
    | 'packet_mismatch'
    | 'decision_not_apply_ready'
    | 'still_requires_apply_false'
    | 'mutation_not_allowed'
    | 'implementation_not_allowed'
    | 'missing_resolved_destination'
    | 'missing_operator_id'
    | 'missing_decision_id';
  packetId: string;
  decisionId?: string;
  resolvedDestination?: MerlinRoutedDestination;
  requiresExplicitApplyApproval: true;
  mutationAllowed: false;
  implementationAllowed: false;
};

export type HeldRoutingExplicitApplyApproval = {
  approvalId: string;
  packetId: string;
  decisionId: string;
  operatorId: string;
  approvedAt: string;
  resolvedDestination?: MerlinRoutedDestination;
  applyApproved: boolean;
  reason:
    | 'explicit_apply_approval_recorded'
    | 'ineligible_decision'
    | 'packet_mismatch'
    | 'decision_mismatch'
    | 'missing_resolved_destination'
    | 'missing_operator_id'
    | 'mutation_not_allowed'
    | 'implementation_not_allowed'
    | 'missing_approval_id';
  requiresFinalExecutor: true;
  mutationAllowed: false;
  implementationAllowed: false;
};

export type HeldRoutingFinalExecutorPreview = {
  previewId: string;
  packetId: string;
  decisionId: string;
  approvalId: string;
  resolvedDestination?: MerlinRoutedDestination;
  readyForFinalExecutor: boolean;
  reason:
    | 'final_executor_preview_ready'
    | 'missing_preview_id'
    | 'packet_mismatch'
    | 'decision_mismatch'
    | 'approval_mismatch'
    | 'ineligible_eligibility'
    | 'approval_not_applied'
    | 'approval_not_final_executor_ready'
    | 'missing_resolved_destination'
    | 'mutation_not_allowed'
    | 'implementation_not_allowed'
    | 'execution_not_allowed';
  requiresFinalExecution: true;
  mutationAllowed: false;
  implementationAllowed: false;
  executionAllowed: false;
};

export type HeldRoutingFinalExecutorDryRunPlan = {
  dryRunId: string;
  packetId: string;
  decisionId: string;
  approvalId: string;
  previewId: string;
  resolvedDestination?: MerlinRoutedDestination;
  plannedOperation: 'route_to_resolved_destination' | 'hold_for_manual_destination_review' | 'refuse_invalid_preview';
  preconditions: string[];
  blockedMutations: string[];
  readyForExecution: false;
  requiresLiveExecutor: true;
  mutationAllowed: false;
  implementationAllowed: false;
  executionAllowed: false;
  reason:
    | 'dry_run_ready_for_live_executor'
    | 'missing_dry_run_id'
    | 'packet_mismatch'
    | 'decision_mismatch'
    | 'approval_mismatch'
    | 'preview_mismatch'
    | 'preview_not_ready'
    | 'preview_does_not_require_final_execution'
    | 'missing_resolved_destination'
    | 'mutation_not_allowed'
    | 'implementation_not_allowed'
    | 'execution_not_allowed';
};

export type HeldRoutingOperatorReviewNextRequiredAction =
  | 'operator_decision_required'
  | 'apply_eligibility_required'
  | 'explicit_apply_approval_required'
  | 'final_executor_preview_required'
  | 'dry_run_required'
  | 'ready_for_live_executor'
  | 'blocked';

export type HeldRoutingOperatorReviewSummary = {
  summaryId: string;
  packetId: string;
  currentStatus: 'incomplete' | 'ready' | 'blocked';
  decisionSummary: {
    present: boolean;
    decisionId?: string;
    resultingStatus?: HeldRoutingDecisionStatus;
    resolvedDestination?: MerlinRoutedDestination;
    valid: boolean;
  };
  eligibilitySummary: {
    present: boolean;
    decisionId?: string;
    applyEligible?: boolean;
    reason?: HeldRoutingApplyEligibility['reason'];
    valid: boolean;
  };
  explicitApprovalSummary: {
    present: boolean;
    approvalId?: string;
    decisionId?: string;
    applyApproved?: boolean;
    reason?: HeldRoutingExplicitApplyApproval['reason'];
    valid: boolean;
  };
  finalExecutorPreviewSummary: {
    present: boolean;
    previewId?: string;
    approvalId?: string;
    readyForFinalExecutor?: boolean;
    reason?: HeldRoutingFinalExecutorPreview['reason'];
    valid: boolean;
  };
  dryRunPlanSummary: {
    present: boolean;
    dryRunId?: string;
    previewId?: string;
    plannedOperation?: HeldRoutingFinalExecutorDryRunPlan['plannedOperation'];
    reason?: HeldRoutingFinalExecutorDryRunPlan['reason'];
    valid: boolean;
  };
  nextRequiredAction: HeldRoutingOperatorReviewNextRequiredAction;
  operatorWarnings: string[];
  mutationAllowed: false;
  implementationAllowed: false;
  executionAllowed: false;
};

export type HeldRoutingOperatorReviewPresentation = {
  presentationId: string;
  status: 'ok';
  mode: 'read_only';
  advisoryOnly: true;
  summaryId: string;
  packetId: string;
  currentStatus: HeldRoutingOperatorReviewSummary['currentStatus'];
  nextRequiredAction: HeldRoutingOperatorReviewSummary['nextRequiredAction'];
  operatorWarnings: string[];
  display: {
    title: string;
    subtitle: string;
    detailLines: string[];
  };
  evidenceBindings: {
    detailLines: Array<{
      line: string;
      sourceReferences: string[];
      evidenceState: 'bound' | 'no_evidence';
      noEvidenceReason?: 'not_applicable' | 'source_unavailable';
    }>;
    warnings: Array<{
      warning: string;
      sourceReferences: string[];
      evidenceState: 'bound' | 'no_evidence';
      noEvidenceReason?: 'not_applicable' | 'source_unavailable';
    }>;
  };
  decisionLedgerPreview: {
    kind: 'operator_review_decision_ledger_preview';
    presentationId: string;
    packetId: string;
    summaryId: string;
    wouldRecordEventType: 'held_routing_operator_review_decision_preview';
    noActionStatus: 'preview_only_no_mutation';
    noActionReasonCode:
      | 'current_status_ready_no_action_surface'
      | 'current_status_blocked_no_action_surface'
      | 'current_status_incomplete_no_action_surface';
    evidenceSummary: {
      detailLines: {
        total: number;
        bound: number;
        noEvidence: number;
      };
      warnings: {
        total: number;
        bound: number;
        noEvidence: number;
      };
    };
    authoritySnapshot: {
      mutationAllowed: false;
      implementationAllowed: false;
      executionAllowed: false;
    };
    timestampPolicy: {
      mode: 'deterministic_static';
      previewedAt: string;
    };
  };
  approvalGatePreview: {
    kind: 'operator_review_approval_gate_preview';
    presentationId: string;
    packetId: string;
    summaryId: string;
    gateStatus: 'eligible_preview_only' | 'blocked';
    gateReasonCode:
      | 'eligible_preview_only_read_only_prereqs_met'
      | 'missing_required_references'
      | 'missing_evidence_bindings'
      | 'missing_decision_ledger_preview'
      | 'authority_flags_not_hard_false'
      | 'malformed_evidence_binding_state';
    evidenceBindingStatus: {
      detailLines: {
        total: number;
        bound: number;
        noEvidence: number;
        malformed: number;
      };
      warnings: {
        total: number;
        bound: number;
        noEvidence: number;
        malformed: number;
      };
    };
    decisionLedgerPreviewStatus: {
      present: boolean;
      kind?: 'operator_review_decision_ledger_preview';
      noActionStatus?: 'preview_only_no_mutation';
    };
    authoritySnapshot: {
      mutationAllowed: false;
      implementationAllowed: false;
      executionAllowed: false;
    };
    noActionStatus: 'preview_only_no_mutation';
    noActionReasonCode: 'approval_gate_preview_only';
    futureArtifactRequirements: string[];
    timestampPolicy: {
      mode: 'deterministic_static';
      previewedAt: string;
    };
  };
  approvalArtifactPreview: {
    kind: 'operator_review_approval_artifact_preview';
    presentationId: string;
    packetId: string;
    summaryId: string;
    artifactStatus: 'required_not_created' | 'blocked_by_gate';
    artifactReasonCode:
      | 'required_future_approval_artifact_not_created'
      | 'approval_gate_preview_missing'
      | 'approval_gate_blocked'
      | 'authority_flags_not_hard_false';
    requiredFields: Array<
      | 'operatorIdentity'
      | 'approvalDecision'
      | 'approvalTimestamp'
      | 'evidenceBindingSummary'
      | 'decisionLedgerPreviewReference'
      | 'approvalGatePreviewReference'
      | 'authoritySnapshot'
    >;
    missingFields: Array<'operatorIdentity' | 'approvalDecision' | 'approvalTimestamp'>;
    references: {
      decisionLedgerPreviewReference: {
        kind: 'operator_review_decision_ledger_preview';
        presentationId: string;
        packetId: string;
        summaryId: string;
        noActionStatus: 'preview_only_no_mutation';
      };
      approvalGatePreviewReference: {
        kind?: 'operator_review_approval_gate_preview';
        gateStatus?: 'eligible_preview_only' | 'blocked';
        gateReasonCode?: HeldRoutingOperatorReviewPresentation['approvalGatePreview']['gateReasonCode'];
        noActionStatus?: 'preview_only_no_mutation';
      };
      evidenceBindingSummary: HeldRoutingOperatorReviewPresentation['decisionLedgerPreview']['evidenceSummary'];
    };
    futureArtifactPolicy: {
      generation: 'must_be_generated_only_by_explicit_future_approval_action';
      bindings: Array<
        | 'must_bind_evidence_hash_or_summary'
        | 'must_bind_decision_ledger_preview'
        | 'must_bind_approval_gate_preview'
        | 'must_bind_operator_identity'
      >;
    };
    noActionStatus: 'preview_only_no_mutation';
    authoritySnapshot: {
      mutationAllowed: false;
      implementationAllowed: false;
      executionAllowed: false;
    };
    timestampPolicy: {
      mode: 'deterministic_static';
      previewedAt: string;
    };
  };
  summary: HeldRoutingOperatorReviewSummary;
  mutationAllowed: false;
  implementationAllowed: false;
  executionAllowed: false;
};

export type PreviewPacket = {
  draftId: string;
  uploadId: string;
  brand: MerlinBrand;
  actionId: string;
  detectedChanges: Record<string, unknown>;
  sourceFiles: Array<{ fileId: string; fileName?: string }>;
  linkedEvidenceIds: string[];
  confidence: number;
  fieldsNeedingConfirmation: string[];
  allowedFieldsApplied: string[];
  forbiddenFieldsIgnored: string[];
  holdReasons: string[];
  universalProductUpdatePacketPreview?: MerlinUniversalProductUpdatePacketPreview;
  mutationAllowed: false;
  implementationAllowed: false;
};

export type UploadIntent = {
  uploadId: string;
  userId: string;
  accountId: string;
  brand: MerlinBrand;
  actorScope: MerlinActorScope;
  entityType: MerlinEntityType;
  entityId?: string;
  actionId: string;
  sourceChannel?: string;
  repId?: string;
  affiliateCode?: string;
  operatorNote?: string;
  actionSnapshot: IntentActionDefinition;
  userHint?: string;
  files: UploadIntentFileRef[];
  routing: RoutingDecision[];
  preview?: PreviewPacket;
  status: MerlinIntakeStatus;
  implementationAllowed: false;
  mutationAllowed: false;
  previewRequired: true;
  approvalRequired: true;
  createdAt: string;
  updatedAt: string;
};

export type ProductAdapter = {
  brand: MerlinBrand;
  actions: IntentActionDefinition[];
  entityTypes: MerlinEntityType[];
  actorScopes: MerlinActorScope[];
  getActionDefinition(actionId: string, actorScope: MerlinActorScope): IntentActionDefinition | undefined;
  validateIntent(input: {
    brand: MerlinBrand;
    actionId: string;
    actorScope: MerlinActorScope;
    entityType: MerlinEntityType;
    entityId?: string;
    userHint?: string;
  }): { ok: true; action: IntentActionDefinition } | { ok: false; code: string; message: string };
  buildPreviewContext(intent: UploadIntent): Record<string, unknown>;
};
