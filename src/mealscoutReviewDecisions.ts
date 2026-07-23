import { randomUUID } from 'node:crypto';

export type MealScoutReviewDecisionType = 'same_truck' | 'keep_separate' | 'needs_review';

export type MealScoutReviewDecisionRecord = {
  decisionId: string;
  draftIds: string[];
  decision: MealScoutReviewDecisionType;
  reason?: string;
  sourceFileIds: string[];
  evidenceRefs: string[];
  decidedBy?: string;
  decidedAt: string;
  mutationAllowed: false;
};

const reviewDecisions = new Map<string, MealScoutReviewDecisionRecord>();
let reviewDecisionVersion = 0;

function nowIso(): string {
  return new Date().toISOString();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export function listMealScoutReviewDecisions(filters?: { draftId?: string }): MealScoutReviewDecisionRecord[] {
  const records = Array.from(reviewDecisions.values());
  if (!filters?.draftId) {
    return records.sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  }
  return records
    .filter((record) => record.draftIds.includes(filters.draftId || ''))
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
}

export function createMealScoutReviewDecision(input: {
  draftIds: string[];
  decision: MealScoutReviewDecisionType;
  reason?: string;
  sourceFileIds?: string[];
  evidenceRefs?: string[];
  decidedBy?: string;
}): MealScoutReviewDecisionRecord {
  const record: MealScoutReviewDecisionRecord = {
    decisionId: `ms-review-${randomUUID()}`,
    draftIds: unique(input.draftIds),
    decision: input.decision,
    reason: input.reason?.trim() || undefined,
    sourceFileIds: unique(input.sourceFileIds || []),
    evidenceRefs: unique(input.evidenceRefs || []),
    decidedBy: input.decidedBy?.trim() || undefined,
    decidedAt: nowIso(),
    mutationAllowed: false
  };
  reviewDecisions.set(record.decisionId, record);
  reviewDecisionVersion += 1;
  return record;
}

export function updateMealScoutReviewDecision(
  decisionId: string,
  updates: {
    draftIds?: string[];
    decision?: MealScoutReviewDecisionType;
    reason?: string;
    sourceFileIds?: string[];
    evidenceRefs?: string[];
    decidedBy?: string;
  }
): MealScoutReviewDecisionRecord | undefined {
  const existing = reviewDecisions.get(decisionId);
  if (!existing) return undefined;
  const next: MealScoutReviewDecisionRecord = {
    ...existing,
    draftIds: updates.draftIds ? unique(updates.draftIds) : existing.draftIds,
    decision: updates.decision || existing.decision,
    reason: updates.reason !== undefined ? updates.reason.trim() || undefined : existing.reason,
    sourceFileIds: updates.sourceFileIds ? unique(updates.sourceFileIds) : existing.sourceFileIds,
    evidenceRefs: updates.evidenceRefs ? unique(updates.evidenceRefs) : existing.evidenceRefs,
    decidedBy: updates.decidedBy !== undefined ? updates.decidedBy.trim() || undefined : existing.decidedBy,
    decidedAt: nowIso(),
    mutationAllowed: false
  };
  reviewDecisions.set(decisionId, next);
  reviewDecisionVersion += 1;
  return next;
}

export function getMealScoutReviewDecisionVersion(): number {
  return reviewDecisionVersion;
}

export function resetMealScoutReviewDecisionsForTest(): void {
  reviewDecisions.clear();
  reviewDecisionVersion = 0;
}
