export type MerlinApprovalStatus = 'APPROVED' | 'REJECTED' | 'EDITED' | 'APPLIED';

export type MerlinApprovalDecision = {
  uploadId: string;
  status: MerlinApprovalStatus;
  decidedBy: string;
  reason?: string;
  decidedAt: string;
};

// Placeholder only in v1. Final apply/publish execution is intentionally out of scope.
