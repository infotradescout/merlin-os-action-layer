import { randomUUID } from 'node:crypto';

export type MealScoutAttachmentAction =
  | 'attach_file_to_draft'
  | 'detach_file_from_draft'
  | 'mark_as_logo_candidate'
  | 'approve_logo'
  | 'reject_logo'
  | 'mark_as_menu'
  | 'mark_as_profile_evidence'
  | 'leave_unattached'
  | 'needs_review';

export type MealScoutAttachmentDecisionRecord = {
  attachmentDecisionId: string;
  draftId: string;
  sourceFileId: string;
  sourceFileName?: string;
  action: MealScoutAttachmentAction;
  mediaType?: 'logo' | 'menu' | 'profile' | 'truck_photo' | 'food_photo' | 'unknown_media';
  reason: string;
  operatorId?: string;
  decidedAt: string;
  attribution?: {
    attributionSource?: 'drive_metadata' | 'request_context' | 'unknown';
    repId?: string;
    affiliateCode?: string;
    sourceChannel?: 'drive_upload' | 'manual_upload' | 'admin_import';
  };
  mutationAllowed: false;
};

const decisions = new Map<string, MealScoutAttachmentDecisionRecord>();
let decisionVersion = 0;

function nowIso(): string {
  return new Date().toISOString();
}

export function createMealScoutAttachmentDecision(input: {
  draftId: string;
  sourceFileId: string;
  sourceFileName?: string;
  action: MealScoutAttachmentAction;
  mediaType?: MealScoutAttachmentDecisionRecord['mediaType'];
  reason?: string;
  operatorId?: string;
  attribution?: MealScoutAttachmentDecisionRecord['attribution'];
}): MealScoutAttachmentDecisionRecord {
  const row: MealScoutAttachmentDecisionRecord = {
    attachmentDecisionId: `ms-attach-${randomUUID()}`,
    draftId: input.draftId.trim(),
    sourceFileId: input.sourceFileId.trim(),
    sourceFileName: input.sourceFileName?.trim() || undefined,
    action: input.action,
    mediaType: input.mediaType,
    reason: input.reason?.trim() || 'operator_attachment_decision',
    operatorId: input.operatorId?.trim() || undefined,
    decidedAt: nowIso(),
    attribution: input.attribution,
    mutationAllowed: false
  };
  decisions.set(row.attachmentDecisionId, row);
  decisionVersion += 1;
  return row;
}

export function listMealScoutAttachmentDecisions(filters?: {
  draftId?: string;
  sourceFileId?: string;
}): MealScoutAttachmentDecisionRecord[] {
  return Array.from(decisions.values())
    .filter((row) => {
      if (filters?.draftId && row.draftId !== filters.draftId) return false;
      if (filters?.sourceFileId && row.sourceFileId !== filters.sourceFileId) return false;
      return true;
    })
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
}

export function getMealScoutAttachmentDecisionVersion(): number {
  return decisionVersion;
}

export function resetMealScoutAttachmentDecisionsForTest(): void {
  decisions.clear();
  decisionVersion = 0;
}

