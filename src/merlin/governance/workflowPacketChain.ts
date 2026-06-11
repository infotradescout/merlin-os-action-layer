import { createHash } from 'node:crypto';

const GOVERNANCE_NAMESPACE = 'merlin_governance';
const DETERMINISTIC_TIMESTAMP = 'deterministic_static';

type PacketStatus =
  | 'draft'
  | 'blocked'
  | 'incomplete'
  | 'pending_evidence'
  | 'pending_review'
  | 'pending_approval'
  | 'pending'
  | 'merge_ready';

type PacketFactBuckets = {
  confirmedFacts: string[];
  operatorProvidedClaims: string[];
  assumptions: string[];
  missingEvidence: string[];
  requiredApprovals: string[];
};

type ValidationResult = {
  requirement: string;
  status: 'pass' | 'fail';
  evidenceRef: string;
};

type ReviewDecision = {
  reviewedBy: string;
  disposition: 'approve' | 'request_changes' | 'block';
  evidenceRefs: string[];
};

type GawainApproval = {
  approvedBy: string;
  disposition: 'approve' | 'hold';
  note?: string;
};

type BasePacket = PacketFactBuckets & {
  packetId: string;
  packetKind:
    | 'customer_request_packet'
    | 'route_packet'
    | 'slice_packet'
    | 'evidence_packet'
    | 'review_packet'
    | 'reconciliation_packet'
    | 'ledger_event_draft';
  governanceNamespace: typeof GOVERNANCE_NAMESPACE;
  status: PacketStatus;
  statusReasonCodes: string[];
  createdAtLocal: string;
  mutationAllowed: false;
};

export type GovernanceCustomerRequestPacket = BasePacket & {
  packetKind: 'customer_request_packet';
  customer_request_packet_id: string;
  repoName: string;
  laneName: string;
  operatorRequest: string;
  routeContext: string;
};

export type GovernanceRoutePacket = BasePacket & {
  packetKind: 'route_packet';
  route_packet_id: string;
  baselineSha: string | null;
  allowedFiles: string[];
  bannedFiles: string[];
  validationRequirements: string[];
  evidenceRequirements: string[];
  reviewRequirements: string[];
};

export type GovernanceSlicePacket = BasePacket & {
  packetKind: 'slice_packet';
  slice_id: string;
  executionRecordStatus: 'no_execution_claim' | 'evidence_supplied';
  requiredFiles: string[];
  bannedFiles: string[];
};

export type GovernanceEvidencePacket = BasePacket & {
  packetKind: 'evidence_packet';
  evidence_packet_id: string;
  validationRequirements: string[];
  validationResults: ValidationResult[];
  suppliedEvidenceRefs: string[];
  completionEligible: boolean;
};

export type GovernanceReviewPacket = BasePacket & {
  packetKind: 'review_packet';
  review_packet_id: string;
  reviewRequirements: string[];
  reviewDecision: ReviewDecision | null;
  autoApprovalBlocked: boolean;
  mergeReady: false;
};

export type GovernanceReconciliationPacket = BasePacket & {
  packetKind: 'reconciliation_packet';
  reconciliation_packet_id: string;
  reviewAccepted: boolean;
  gawainApprovalRequired: true;
  gawainApproval: GawainApproval | null;
  mergeReady: boolean;
};

export type GovernanceLedgerEventDraft = BasePacket & {
  packetKind: 'ledger_event_draft';
  ledger_event_id: string;
  route_packet_id: string;
  slice_id: string;
  customer_request_packet_id: string;
  status: 'pending' | 'blocked' | 'merge_ready';
  customerVisibleStatus: 'Blocked' | 'Needs Approval' | 'Ready';
  commitSha: string | null;
  executedBy: {
    actor_id: string | null;
    reason?: string;
  };
};

export type GovernanceWorkflowPacketChain = {
  governanceNamespace: typeof GOVERNANCE_NAMESPACE;
  baselineSha: string | null;
  customerRequestPacket: GovernanceCustomerRequestPacket;
  routePacket: GovernanceRoutePacket;
  slicePacket: GovernanceSlicePacket;
  evidencePacket: GovernanceEvidencePacket;
  reviewPacket: GovernanceReviewPacket;
  reconciliationPacket: GovernanceReconciliationPacket;
  ledgerEventDraft: GovernanceLedgerEventDraft;
};

export type GovernanceWorkflowPacketChainInput = {
  operatorRequest: string;
  repoName: string;
  laneName: string;
  routeContext: string;
  baselineSha?: string;
  allowedFiles: string[];
  bannedFiles: string[];
  validationRequirements: string[];
  evidenceRequirements: string[];
  reviewRequirements: string[];
  generatedAt?: string;
  suppliedEvidenceRefs?: string[];
  validationResults?: ValidationResult[];
  reviewDecision?: ReviewDecision;
  gawainApproval?: GawainApproval;
  commitSha?: string;
};

function normalizeString(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`invalid_${label}`);
  }
  return normalized;
}

function normalizeStringList(values: string[], label: string): string[] {
  if (!Array.isArray(values)) {
    throw new Error(`invalid_${label}`);
  }

  return [...new Set(values.map((value) => normalizeString(value, label)).sort())];
}

function normalizeValidationResults(values: ValidationResult[] | undefined): ValidationResult[] {
  if (!values) return [];
  return values
    .map((entry) => ({
      requirement: normalizeString(entry.requirement, 'validation_result_requirement'),
      status: entry.status,
      evidenceRef: normalizeString(entry.evidenceRef, 'validation_result_evidence_ref')
    }))
    .sort((a, b) => a.requirement.localeCompare(b.requirement) || a.evidenceRef.localeCompare(b.evidenceRef));
}

function normalizeReviewDecision(value: ReviewDecision | undefined): ReviewDecision | null {
  if (!value) return null;
  return {
    reviewedBy: normalizeString(value.reviewedBy, 'reviewed_by'),
    disposition: value.disposition,
    evidenceRefs: normalizeStringList(value.evidenceRefs, 'review_evidence_refs')
  };
}

function normalizeGawainApproval(value: GawainApproval | undefined): GawainApproval | null {
  if (!value) return null;
  return {
    approvedBy: normalizeString(value.approvedBy, 'approved_by'),
    disposition: value.disposition,
    note: value.note?.trim() || undefined
  };
}

function createDeterministicId(prefix: string, snapshot: Record<string, unknown>): string {
  const hash = createHash('sha1').update(JSON.stringify(snapshot)).digest('hex').slice(0, 12);
  return `${prefix}-${hash}`;
}

function packetSnapshot(input: {
  repoName: string;
  laneName: string;
  routeContext: string;
  operatorRequest: string;
  baselineSha: string | null;
  allowedFiles: string[];
  bannedFiles: string[];
  validationRequirements: string[];
  evidenceRequirements: string[];
  reviewRequirements: string[];
}): Record<string, unknown> {
  return {
    governanceNamespace: GOVERNANCE_NAMESPACE,
    repoName: input.repoName,
    laneName: input.laneName,
    routeContext: input.routeContext,
    operatorRequest: input.operatorRequest,
    baselineSha: input.baselineSha,
    allowedFiles: input.allowedFiles,
    bannedFiles: input.bannedFiles,
    validationRequirements: input.validationRequirements,
    evidenceRequirements: input.evidenceRequirements,
    reviewRequirements: input.reviewRequirements
  };
}

function buildFactBuckets(input: {
  repoName: string;
  laneName: string;
  routeContext: string;
  operatorRequest: string;
  baselineSha: string | null;
  validationRequirements: string[];
  evidenceRequirements: string[];
  reviewRequirements: string[];
  validationMissing: string[];
  evidenceMissing: string[];
  reviewMissing: string[];
  requireGawainApproval: boolean;
}): PacketFactBuckets {
  const confirmedFacts = [
    `repo_name:${input.repoName}`,
    `lane_name:${input.laneName}`,
    `route_context:${input.routeContext}`,
    `governance_namespace:${GOVERNANCE_NAMESPACE}`
  ];
  if (input.baselineSha) {
    confirmedFacts.push(`baseline_sha:${input.baselineSha}`);
  }

  return {
    confirmedFacts,
    operatorProvidedClaims: [
      `operator_request:${input.operatorRequest}`,
      ...input.validationRequirements.map((value) => `validation_requirement:${value}`),
      ...input.evidenceRequirements.map((value) => `evidence_requirement:${value}`),
      ...input.reviewRequirements.map((value) => `review_requirement:${value}`)
    ],
    assumptions: input.baselineSha
      ? ['generated_packets_remain_drafts_until_evidence_review_and_approval_complete']
      : [
          'generated_packets_remain_drafts_until_evidence_review_and_approval_complete',
          'baseline_sha_not_supplied_by_operator'
        ],
    missingEvidence: [
      ...(input.baselineSha ? [] : ['baseline_sha']),
      ...input.validationMissing,
      ...input.evidenceMissing,
      ...input.reviewMissing
    ],
    requiredApprovals: [
      ...input.reviewRequirements.map((value) => `review:${value}`),
      ...(input.requireGawainApproval ? ['merge:gawain_approval'] : [])
    ]
  };
}

function validationMissingRequirements(
  requirements: string[],
  validationResults: ValidationResult[]
): string[] {
  return requirements
    .filter((requirement) => !validationResults.some((result) => result.requirement === requirement && result.status === 'pass'))
    .map((requirement) => `validation_evidence:${requirement}`);
}

export function createGovernanceWorkflowPacketChain(
  input: GovernanceWorkflowPacketChainInput
): GovernanceWorkflowPacketChain {
  const repoName = normalizeString(input.repoName, 'repo_name');
  const laneName = normalizeString(input.laneName, 'lane_name');
  const routeContext = normalizeString(input.routeContext, 'route_context');
  const operatorRequest = normalizeString(input.operatorRequest, 'operator_request');
  const baselineSha = input.baselineSha?.trim() || null;
  const allowedFiles = normalizeStringList(input.allowedFiles, 'allowed_files');
  const bannedFiles = normalizeStringList(input.bannedFiles, 'banned_files');
  const validationRequirements = normalizeStringList(input.validationRequirements, 'validation_requirements');
  const evidenceRequirements = normalizeStringList(input.evidenceRequirements, 'evidence_requirements');
  const reviewRequirements = normalizeStringList(input.reviewRequirements, 'review_requirements');
  const suppliedEvidenceRefs = normalizeStringList(input.suppliedEvidenceRefs ?? [], 'supplied_evidence_refs');
  const validationResults = normalizeValidationResults(input.validationResults);
  const reviewDecision = normalizeReviewDecision(input.reviewDecision);
  const gawainApproval = normalizeGawainApproval(input.gawainApproval);
  const commitSha = input.commitSha?.trim() || null;
  const createdAtLocal = input.generatedAt?.trim() || DETERMINISTIC_TIMESTAMP;

  const validationMissing = validationMissingRequirements(validationRequirements, validationResults);
  const evidenceMissing = evidenceRequirements
    .filter((requirement) => !suppliedEvidenceRefs.includes(requirement))
    .map((requirement) => `evidence_ref:${requirement}`);

  const codexAutoApprovalBlocked =
    reviewDecision?.disposition === 'approve' && reviewDecision.reviewedBy.toLowerCase().includes('codex');
  const reviewMissing = reviewDecision
    ? codexAutoApprovalBlocked
      ? ['review_decision:codex_cannot_auto_approve']
      : []
    : ['review_decision'];

  const requireGawainApproval = true;
  const factBuckets = buildFactBuckets({
    repoName,
    laneName,
    routeContext,
    operatorRequest,
    baselineSha,
    validationRequirements,
    evidenceRequirements,
    reviewRequirements,
    validationMissing,
    evidenceMissing,
    reviewMissing,
    requireGawainApproval
  });

  const snapshot = packetSnapshot({
    repoName,
    laneName,
    routeContext,
    operatorRequest,
    baselineSha,
    allowedFiles,
    bannedFiles,
    validationRequirements,
    evidenceRequirements,
    reviewRequirements
  });

  const customerRequestPacketId = createDeterministicId('customer-request', snapshot);
  const routePacketId = createDeterministicId('route-packet', snapshot);
  const sliceId = createDeterministicId('slice', snapshot);
  const evidencePacketId = createDeterministicId('evidence-packet', snapshot);
  const reviewPacketId = createDeterministicId('review-packet', snapshot);
  const reconciliationPacketId = createDeterministicId('reconciliation-packet', snapshot);
  const ledgerEventId = createDeterministicId('ledger-event', snapshot);

  const customerRequestPacket: GovernanceCustomerRequestPacket = {
    packetKind: 'customer_request_packet',
    packetId: customerRequestPacketId,
    customer_request_packet_id: customerRequestPacketId,
    governanceNamespace: GOVERNANCE_NAMESPACE,
    status: baselineSha ? 'draft' : 'incomplete',
    statusReasonCodes: baselineSha ? [] : ['missing_baseline_sha'],
    createdAtLocal,
    repoName,
    laneName,
    operatorRequest,
    routeContext,
    mutationAllowed: false,
    ...factBuckets
  };

  const routePacket: GovernanceRoutePacket = {
    packetKind: 'route_packet',
    packetId: routePacketId,
    route_packet_id: routePacketId,
    governanceNamespace: GOVERNANCE_NAMESPACE,
    status: baselineSha ? 'draft' : 'blocked',
    statusReasonCodes: baselineSha ? [] : ['missing_baseline_sha'],
    createdAtLocal,
    baselineSha,
    allowedFiles,
    bannedFiles,
    validationRequirements,
    evidenceRequirements,
    reviewRequirements,
    mutationAllowed: false,
    ...factBuckets
  };

  const evidenceSupplied = suppliedEvidenceRefs.length > 0 || validationResults.length > 0;
  const slicePacket: GovernanceSlicePacket = {
    packetKind: 'slice_packet',
    packetId: sliceId,
    slice_id: sliceId,
    governanceNamespace: GOVERNANCE_NAMESPACE,
    status: baselineSha ? 'draft' : 'blocked',
    statusReasonCodes: baselineSha ? [] : ['missing_baseline_sha'],
    createdAtLocal,
    executionRecordStatus: evidenceSupplied ? 'evidence_supplied' : 'no_execution_claim',
    requiredFiles: allowedFiles,
    bannedFiles,
    mutationAllowed: false,
    ...factBuckets
  };

  const completionEligible = baselineSha !== null && validationMissing.length === 0 && evidenceMissing.length === 0;
  const evidencePacket: GovernanceEvidencePacket = {
    packetKind: 'evidence_packet',
    packetId: evidencePacketId,
    evidence_packet_id: evidencePacketId,
    governanceNamespace: GOVERNANCE_NAMESPACE,
    status: completionEligible ? 'draft' : 'pending_evidence',
    statusReasonCodes: completionEligible
      ? []
      : [...(baselineSha ? [] : ['missing_baseline_sha']), ...validationMissing, ...evidenceMissing],
    createdAtLocal,
    validationRequirements,
    validationResults,
    suppliedEvidenceRefs,
    completionEligible,
    mutationAllowed: false,
    ...factBuckets
  };

  const reviewAccepted =
    reviewDecision !== null &&
    !codexAutoApprovalBlocked &&
    reviewDecision.disposition === 'approve' &&
    reviewDecision.evidenceRefs.length > 0;

  const reviewPacket: GovernanceReviewPacket = {
    packetKind: 'review_packet',
    packetId: reviewPacketId,
    review_packet_id: reviewPacketId,
    governanceNamespace: GOVERNANCE_NAMESPACE,
    status: reviewAccepted ? 'pending_approval' : 'pending_review',
    statusReasonCodes: reviewAccepted
      ? ['gawain_approval_required']
      : [...(codexAutoApprovalBlocked ? ['codex_cannot_auto_approve_review'] : []), ...reviewMissing],
    createdAtLocal,
    reviewRequirements,
    reviewDecision,
    autoApprovalBlocked: codexAutoApprovalBlocked,
    mergeReady: false,
    mutationAllowed: false,
    ...factBuckets
  };

  const mergeReady =
    baselineSha !== null &&
    completionEligible &&
    reviewAccepted &&
    gawainApproval?.disposition === 'approve';

  const reconciliationPacket: GovernanceReconciliationPacket = {
    packetKind: 'reconciliation_packet',
    packetId: reconciliationPacketId,
    reconciliation_packet_id: reconciliationPacketId,
    governanceNamespace: GOVERNANCE_NAMESPACE,
    status: mergeReady ? 'merge_ready' : 'pending_approval',
    statusReasonCodes: mergeReady
      ? []
      : [
          ...(baselineSha ? [] : ['missing_baseline_sha']),
          ...(completionEligible ? [] : ['validation_or_evidence_incomplete']),
          ...(reviewAccepted ? [] : ['review_not_complete']),
          ...(gawainApproval?.disposition === 'approve' ? [] : ['gawain_approval_required'])
        ],
    createdAtLocal,
    reviewAccepted,
    gawainApprovalRequired: true,
    gawainApproval,
    mergeReady,
    mutationAllowed: false,
    ...factBuckets
  };

  const ledgerEventDraft: GovernanceLedgerEventDraft = {
    packetKind: 'ledger_event_draft',
    packetId: ledgerEventId,
    ledger_event_id: ledgerEventId,
    governanceNamespace: GOVERNANCE_NAMESPACE,
    status: mergeReady ? 'merge_ready' : baselineSha ? 'pending' : 'blocked',
    statusReasonCodes: mergeReady
      ? []
      : [
          ...(baselineSha ? [] : ['missing_baseline_sha']),
          ...(completionEligible ? [] : ['validation_or_evidence_incomplete']),
          ...(reviewAccepted ? [] : ['review_not_complete']),
          ...(gawainApproval?.disposition === 'approve' ? [] : ['gawain_approval_required'])
        ],
    createdAtLocal,
    route_packet_id: routePacketId,
    slice_id: sliceId,
    customer_request_packet_id: customerRequestPacketId,
    customerVisibleStatus: mergeReady ? 'Ready' : baselineSha ? 'Needs Approval' : 'Blocked',
    commitSha: mergeReady ? commitSha : null,
    executedBy: evidenceSupplied
      ? {
          actor_id: 'evidence_supplied'
        }
      : {
          actor_id: null,
          reason: 'No packet may claim execution happened unless evidence is supplied.'
        },
    mutationAllowed: false,
    ...factBuckets
  };

  return {
    governanceNamespace: GOVERNANCE_NAMESPACE,
    baselineSha,
    customerRequestPacket,
    routePacket,
    slicePacket,
    evidencePacket,
    reviewPacket,
    reconciliationPacket,
    ledgerEventDraft
  };
}
