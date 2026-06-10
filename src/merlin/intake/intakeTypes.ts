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
