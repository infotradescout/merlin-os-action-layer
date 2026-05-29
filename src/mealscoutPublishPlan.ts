import { randomUUID } from 'node:crypto';
import type { MealScoutProfileDraft } from './mealscoutProfileImport.js';
import type { MealScoutReviewDecisionRecord } from './mealscoutReviewDecisions.js';

type PlannedAction = 'create_new' | 'update_existing' | 'needs_review' | 'blocked';

type PlannedField = {
  value: string;
  confidence?: number;
  evidenceRefs: string[];
  sourceFileIds: string[];
};

type PlannedMenuItem = {
  name: string;
  price?: string;
  description?: string;
  evidenceRefs: string[];
  sourceFileIds: string[];
};

export type MealScoutPublishPlanRecord = {
  plannedAction: PlannedAction;
  publishReady: boolean;
  draftIds: string[];
  existingTruckId?: string;
  profileFields: Record<string, PlannedField>;
  menuItems: PlannedMenuItem[];
  blockedReasons?: string[];
  warnings?: string[];
  conflicts?: Array<{
    field: string;
    values: string[];
    sourceDraftIds: string[];
  }>;
};

export type MealScoutPublishPlanPreview = {
  planId: string;
  generatedAt: string;
  mutationAllowed: false;
  records: MealScoutPublishPlanRecord[];
};

type DecisionType = MealScoutReviewDecisionRecord['decision'];

function normalizeText(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function normalizePhone(value: string | undefined): string {
  return (value || '').replace(/[^0-9]/g, '');
}

function normalizeWebsite(value: string | undefined): string {
  return normalizeText(value).replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function latestDecisionByDraft(
  drafts: MealScoutProfileDraft[],
  decisions: MealScoutReviewDecisionRecord[]
): Map<string, DecisionType> {
  const map = new Map<string, { decision: DecisionType; decidedAt: string }>();
  for (const decision of decisions) {
    for (const draftId of decision.draftIds) {
      const existing = map.get(draftId);
      if (!existing || decision.decidedAt > existing.decidedAt) {
        map.set(draftId, { decision: decision.decision, decidedAt: decision.decidedAt });
      }
    }
  }
  const out = new Map<string, DecisionType>();
  for (const draft of drafts) {
    const found = map.get(draft.draftId);
    if (found) out.set(draft.draftId, found.decision);
  }
  return out;
}

class UnionFind {
  private readonly parent = new Map<string, string>();
  constructor(ids: string[]) {
    for (const id of ids) this.parent.set(id, id);
  }
  find(id: string): string {
    const parent = this.parent.get(id) || id;
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(rb, ra);
  }
  groups(ids: string[]): string[][] {
    const byRoot = new Map<string, string[]>();
    for (const id of ids) {
      const root = this.find(id);
      const list = byRoot.get(root) || [];
      list.push(id);
      byRoot.set(root, list);
    }
    return Array.from(byRoot.values());
  }
}

function collectFieldEvidence(
  drafts: MealScoutProfileDraft[],
  field: keyof NonNullable<MealScoutProfileDraft['extractedFieldEvidence']>
): Array<{ value: string; confidence?: number; evidenceRef: string; sourceFileId: string; sourceDraftId: string }> {
  const rows: Array<{ value: string; confidence?: number; evidenceRef: string; sourceFileId: string; sourceDraftId: string }> = [];
  for (const draft of drafts) {
    const entry = draft.extractedFieldEvidence[field];
    if (!entry || Array.isArray(entry)) continue;
    const value = (entry.value || '').trim();
    if (!value) continue;
    rows.push({
      value,
      confidence: entry.confidence,
      evidenceRef: entry.rawSnippet || field,
      sourceFileId: entry.sourceFileId,
      sourceDraftId: draft.draftId
    });
  }
  return rows;
}

function pickConflictComparator(field: string, value: string): string {
  if (field === 'phone') return normalizePhone(value);
  if (field === 'website') return normalizeWebsite(value);
  return normalizeText(value);
}

function buildProfileField(
  drafts: MealScoutProfileDraft[],
  field: string
): {
  plannedField?: PlannedField;
  conflict?: { field: string; values: string[]; sourceDraftIds: string[] };
} {
  const rows = collectFieldEvidence(drafts, field as keyof MealScoutProfileDraft['extractedFieldEvidence']);
  if (rows.length === 0) return {};
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = pickConflictComparator(field, row.value);
    const list = grouped.get(key) || [];
    list.push(row);
    grouped.set(key, list);
  }
  if (grouped.size > 1) {
    return {
      conflict: {
        field,
        values: Array.from(new Set(rows.map((row) => row.value))),
        sourceDraftIds: Array.from(new Set(rows.map((row) => row.sourceDraftId)))
      }
    };
  }
  const winner = rows[0];
  return {
    plannedField: {
      value: winner.value,
      confidence: winner.confidence,
      evidenceRefs: Array.from(new Set(rows.map((row) => row.evidenceRef))),
      sourceFileIds: Array.from(new Set(rows.map((row) => row.sourceFileId)))
    }
  };
}

function buildMenuItems(drafts: MealScoutProfileDraft[]): PlannedMenuItem[] {
  const map = new Map<string, PlannedMenuItem>();
  for (const draft of drafts) {
    const evidenceRows = draft.extractedFieldEvidence.menuItems || [];
    for (const item of draft.menu) {
      const key = `${normalizeText(item.name)}|${normalizeText(item.price)}|${normalizeText(item.description)}`;
      const evidence = evidenceRows.find((row) => normalizeText(row.value).includes(normalizeText(item.name)));
      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          name: item.name,
          price: item.price,
          description: item.description,
          evidenceRefs: [evidence?.rawSnippet || item.name],
          sourceFileIds: [item.sourceFileId]
        });
      } else {
        existing.evidenceRefs = Array.from(new Set([...existing.evidenceRefs, evidence?.rawSnippet || item.name]));
        existing.sourceFileIds = Array.from(new Set([...existing.sourceFileIds, item.sourceFileId]));
      }
    }
  }
  return Array.from(map.values());
}

export function buildMealScoutPublishPlanPreview(
  drafts: MealScoutProfileDraft[],
  decisions: MealScoutReviewDecisionRecord[]
): MealScoutPublishPlanPreview {
  const draftMap = new Map(drafts.map((draft) => [draft.draftId, draft]));
  const latestByDraft = latestDecisionByDraft(drafts, decisions);
  const ids = drafts.map((draft) => draft.draftId);
  const uf = new UnionFind(ids);

  for (const decision of decisions) {
    if (decision.decision !== 'same_truck') continue;
    const eligible = decision.draftIds
      .filter((id) => draftMap.has(id))
      .filter((id) => latestByDraft.get(id) === 'same_truck');
    for (let index = 1; index < eligible.length; index += 1) {
      uf.union(eligible[0], eligible[index]);
    }
  }

  const groups = uf.groups(ids);
  const records: MealScoutPublishPlanRecord[] = [];

  for (const groupIds of groups) {
    const groupDrafts = groupIds.map((id) => draftMap.get(id)).filter(Boolean) as MealScoutProfileDraft[];
    const blockedReasons: string[] = [];
    const warnings = Array.from(new Set(groupDrafts.flatMap((draft) => draft.warnings || [])));
    const conflicts: MealScoutPublishPlanRecord['conflicts'] = [];
    const profileFields: MealScoutPublishPlanRecord['profileFields'] = {};

    const decisionStates = groupIds.map((id) => latestByDraft.get(id)).filter(Boolean) as DecisionType[];
    const anyNeedsReview = decisionStates.includes('needs_review');
    if (anyNeedsReview) {
      blockedReasons.push('needs_review_decision_present');
    }

    const fieldNames = ['truckName', 'phone', 'email', 'website', 'facebook', 'instagram', 'cityArea', 'cuisine'];
    for (const field of fieldNames) {
      const { plannedField, conflict } = buildProfileField(groupDrafts, field);
      if (plannedField) profileFields[field] = plannedField;
      if (conflict) conflicts.push(conflict);
    }

    if (conflicts.some((item) => ['phone', 'email', 'website', 'facebook', 'instagram'].includes(item.field))) {
      blockedReasons.push('conflicting_identity_fields');
    }

    const menuItems = buildMenuItems(groupDrafts);
    const menuDeferred = groupDrafts.some((draft) => draft.menuDeferred === true);

    if (!profileFields.truckName?.value) blockedReasons.push('missing_truck_name');
    if (!profileFields.cityArea?.value) blockedReasons.push('missing_city_or_service_area');
    const hasContact =
      Boolean(profileFields.phone?.value) ||
      Boolean(profileFields.email?.value) ||
      Boolean(profileFields.website?.value) ||
      Boolean(profileFields.facebook?.value) ||
      Boolean(profileFields.instagram?.value);
    if (!hasContact) blockedReasons.push('missing_contact_or_web_or_social');
    if (menuItems.length === 0 && !menuDeferred) blockedReasons.push('missing_menu_or_menu_deferred');

    const existingTruckIds = Array.from(new Set(groupDrafts.map((draft) => draft.existingTruckId).filter(Boolean))) as string[];
    if (existingTruckIds.length > 1) blockedReasons.push('conflicting_existing_truck_match');

    const publishReady = blockedReasons.length === 0;
    let plannedAction: PlannedAction = 'create_new';
    if (anyNeedsReview) plannedAction = 'needs_review';
    else if (!publishReady) plannedAction = 'blocked';
    else if (existingTruckIds.length === 1 || groupDrafts.some((draft) => draft.draftType === 'update_existing')) plannedAction = 'update_existing';

    records.push({
      plannedAction,
      publishReady,
      draftIds: groupIds,
      existingTruckId: existingTruckIds[0],
      profileFields,
      menuItems,
      blockedReasons: blockedReasons.length ? blockedReasons : undefined,
      warnings: warnings.length ? warnings : undefined,
      conflicts: conflicts.length ? conflicts : undefined
    });
  }

  return {
    planId: `ms-plan-${randomUUID()}`,
    generatedAt: new Date().toISOString(),
    mutationAllowed: false,
    records
  };
}
