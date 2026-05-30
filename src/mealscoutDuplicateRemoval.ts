import { randomUUID } from 'node:crypto';

export type MealScoutDuplicateRemovalMode = 'quarantine' | 'mark_only' | 'trash';
export type MealScoutDuplicateRemovalAction = 'quarantined' | 'marked_duplicate' | 'trashed' | 'skipped' | 'failed';

export type MealScoutDuplicateRemovalRecord = {
  fileId: string;
  originalFileName: string;
  duplicateGroupId: string;
  primaryFileId: string;
  duplicateType: string;
  confidence: number;
  action: MealScoutDuplicateRemovalAction;
  removalMode: MealScoutDuplicateRemovalMode;
  operatorId: string;
  executedAt: string;
  uploaderEmail?: string;
  affiliateCode?: string;
  attributionConflict?: boolean;
  result: 'success' | 'failed' | 'skipped';
  failureReason?: string;
};

export type MealScoutDuplicateRemovalAuditEntry = MealScoutDuplicateRemovalRecord & {
  auditId: string;
  removalExecutionId: string;
};

const duplicateSuppression = new Map<string, {
  status: 'duplicate_removed_pending' | 'quarantined' | 'trashed';
  updatedAt: string;
  removalExecutionId: string;
  auditId: string;
}>();

const duplicateRemovalAudit: MealScoutDuplicateRemovalAuditEntry[] = [];

export function markMealScoutDuplicateSuppressed(input: {
  fileId: string;
  status: 'duplicate_removed_pending' | 'quarantined' | 'trashed';
  removalExecutionId: string;
  auditId: string;
}): void {
  duplicateSuppression.set(input.fileId, {
    status: input.status,
    updatedAt: new Date().toISOString(),
    removalExecutionId: input.removalExecutionId,
    auditId: input.auditId
  });
}

export function getMealScoutDuplicateSuppression(fileId: string): {
  status: 'duplicate_removed_pending' | 'quarantined' | 'trashed';
  updatedAt: string;
  removalExecutionId: string;
  auditId: string;
} | undefined {
  return duplicateSuppression.get(fileId);
}

export function appendMealScoutDuplicateRemovalAudit(input: MealScoutDuplicateRemovalRecord & { removalExecutionId: string }): MealScoutDuplicateRemovalAuditEntry {
  const row: MealScoutDuplicateRemovalAuditEntry = {
    auditId: `ms-dup-audit-${randomUUID()}`,
    ...input
  };
  duplicateRemovalAudit.unshift(row);
  if (duplicateRemovalAudit.length > 1000) {
    duplicateRemovalAudit.splice(1000);
  }
  return row;
}

export function listMealScoutDuplicateRemovalAudit(): MealScoutDuplicateRemovalAuditEntry[] {
  return [...duplicateRemovalAudit];
}

export function resetMealScoutDuplicateRemovalForTest(): void {
  duplicateSuppression.clear();
  duplicateRemovalAudit.length = 0;
}

