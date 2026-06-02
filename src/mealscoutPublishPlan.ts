import { randomUUID } from 'node:crypto';
import type { MealScoutProfileDraft } from './mealscoutProfileImport.js';
import type { MealScoutReviewDecisionRecord } from './mealscoutReviewDecisions.js';
import { getMealScoutReviewDecisionVersion } from './mealscoutReviewDecisions.js';
import type { MealScoutFieldCorrectionRecord } from './mealscoutReviewCorrections.js';
import { getMealScoutFieldCorrectionVersion } from './mealscoutReviewCorrections.js';
import type { MealScoutAttachmentDecisionRecord } from './mealscoutAttachmentDecisions.js';
import { getMealScoutAttachmentDecisionVersion } from './mealscoutAttachmentDecisions.js';

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

type PlannedMediaItem = {
  mediaType: 'logo' | 'truck_photo' | 'food_photo' | 'unknown_media' | 'menu';
  sourceFileId: string;
  sourceFileName?: string;
  attribution?: {
    primarySourceRepId?: string;
    contributingRepIds: string[];
    sourceFileIds: string[];
    attributionPolicy: string;
    createdFromBatchId?: string;
    affiliate_attribution_email?: string;
    affiliate_attribution_source?: 'folder_email_token';
    affiliate_attribution_folder?: string;
    affiliate_attribution_folder_path?: string;
    affiliate_attribution_warnings?: string[];
  };
  evidenceRefs: string[];
  confidence: number;
};

export type MealScoutPublishPlanRecord = {
  recordId: string;
  plannedAction: PlannedAction;
  publishReady: boolean;
  draftIds: string[];
  existingTruckId?: string;
  profileFields: Record<string, PlannedField>;
  menuItems: PlannedMenuItem[];
  attachedMedia?: PlannedMediaItem[];
  menuEvidenceAttached?: boolean;
  menuEvidenceSourceFileIds?: string[];
  menuEvidenceRefs?: string[];
  blockedReasons?: string[];
  warnings?: string[];
  conflicts?: Array<{
    field: string;
    values: string[];
    sourceDraftIds: string[];
  }>;
  sourceAttribution?: {
    primarySourceRepId?: string;
    contributingRepIds: string[];
    sourceFileIds: string[];
    attributionPolicy: string;
    createdFromBatchId?: string;
    affiliate_attribution_email?: string;
    affiliate_attribution_source?: 'folder_email_token';
    affiliate_attribution_folder?: string;
    affiliate_attribution_folder_path?: string;
    affiliate_attribution_warnings?: string[];
  };
  appliedCorrectionIds?: string[];
  appliedAttachmentDecisionIds?: string[];
};

export type MealScoutPublishPlanPreview = {
  planId: string;
  signature: string;
  reviewDecisionVersion: number;
  correctionVersion?: number;
  attachmentDecisionVersion?: number;
  generatedAt: string;
  mutationAllowed: false;
  records: MealScoutPublishPlanRecord[];
};

const publishPlans = new Map<string, MealScoutPublishPlanPreview>();

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

function buildAttachedMedia(drafts: MealScoutProfileDraft[]): PlannedMediaItem[] {
  const media: PlannedMediaItem[] = [];
  for (const draft of drafts) {
    for (const item of draft.attachedMedia || []) {
      media.push({
        mediaType: item.mediaType,
        sourceFileId: item.sourceFileId,
        sourceFileName: item.sourceFileName,
        attribution: draft.sourceAttribution,
        evidenceRefs: [item.sourcePath || item.sourceFileName || item.sourceFileId],
        confidence: item.confidence
      });
    }
  }
  return media;
}

export function buildMealScoutPublishPlanPreview(
  drafts: MealScoutProfileDraft[],
  decisions: MealScoutReviewDecisionRecord[],
  options?: {
    corrections?: MealScoutFieldCorrectionRecord[];
    attachmentDecisions?: MealScoutAttachmentDecisionRecord[];
  }
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
    const attachedMedia = buildAttachedMedia(groupDrafts);
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
    const contributingRepIds = Array.from(
      new Set(groupDrafts.flatMap((draft) => draft.sourceAttribution?.contributingRepIds || []).filter(Boolean))
    );
    const sourceFileIds = Array.from(
      new Set(groupDrafts.flatMap((draft) => draft.sourceAttribution?.sourceFileIds || []).filter(Boolean))
    );
    const primarySourceRepId =
      groupDrafts.map((draft) => draft.sourceAttribution?.primarySourceRepId).find((value) => Boolean(value)) || undefined;
    const createdFromBatchId =
      groupDrafts.map((draft) => draft.sourceAttribution?.createdFromBatchId).find((value) => Boolean(value)) || undefined;
    const folderAttribution = groupDrafts
      .map((draft) => draft.sourceAttribution)
      .find((item) => Boolean(item?.affiliate_attribution_email));
    const affiliateAttributionWarnings = Array.from(
      new Set(groupDrafts.flatMap((draft) => draft.sourceAttribution?.affiliate_attribution_warnings || []))
    );

    records.push({
      recordId: `ms-plan-record-${groupIds.slice().sort().join('__')}`,
      plannedAction,
      publishReady,
      draftIds: groupIds,
      existingTruckId: existingTruckIds[0],
      profileFields,
      menuItems,
      attachedMedia: attachedMedia.length ? attachedMedia : undefined,
      blockedReasons: blockedReasons.length ? blockedReasons : undefined,
      warnings: warnings.length ? warnings : undefined,
      conflicts: conflicts.length ? conflicts : undefined,
      sourceAttribution: {
        primarySourceRepId,
        contributingRepIds,
        sourceFileIds,
        attributionPolicy: 'first_required_field_contributor',
        createdFromBatchId,
        affiliate_attribution_email: folderAttribution?.affiliate_attribution_email,
        affiliate_attribution_source: folderAttribution?.affiliate_attribution_source,
        affiliate_attribution_folder: folderAttribution?.affiliate_attribution_folder,
        affiliate_attribution_folder_path: folderAttribution?.affiliate_attribution_folder_path,
        affiliate_attribution_warnings: affiliateAttributionWarnings
      }
    });
  }

  const correctionRows = options?.corrections || [];
  const attachmentRows = options?.attachmentDecisions || [];
  const correctionByRecord = new Map<string, MealScoutFieldCorrectionRecord[]>();
  for (const row of correctionRows) {
    const list = correctionByRecord.get(row.recordId) || [];
    list.push(row);
    correctionByRecord.set(row.recordId, list);
  }
  const attachmentByDraft = new Map<string, MealScoutAttachmentDecisionRecord[]>();
  for (const row of attachmentRows) {
    const list = attachmentByDraft.get(row.draftId) || [];
    list.push(row);
    attachmentByDraft.set(row.draftId, list);
  }
  for (const record of records) {
    const corrections = (correctionByRecord.get(record.recordId) || []).sort((a, b) => a.correctedAt.localeCompare(b.correctedAt));
    if (corrections.length > 0) {
      record.appliedCorrectionIds = corrections.map((row) => row.correctionId);
    }
    for (const correction of corrections) {
      if (correction.action === 'reject_field' || correction.action === 'remove_field') {
        delete record.profileFields[correction.fieldName];
      } else if (correction.action === 'replace_field' || correction.action === 'add_field_with_evidence_note') {
        if (!correction.correctedValue) continue;
        record.profileFields[correction.fieldName] = {
          value: correction.correctedValue,
          confidence: 1,
          evidenceRefs: [correction.evidenceRef || correction.reason],
          sourceFileIds: [correction.sourceFileId || 'operator-correction']
        };
      }
    }

    // operator media attachment visibility for plan
    const draftAttachmentRows = record.draftIds.flatMap((draftId) => attachmentByDraft.get(draftId) || []);
    const menuEvidenceSourceFileIds = new Set<string>();
    const menuEvidenceRefs = new Set<string>();
    if (draftAttachmentRows.length > 0) {
      record.appliedAttachmentDecisionIds = draftAttachmentRows.map((row) => row.attachmentDecisionId);
      const mediaMap = new Map<string, PlannedMediaItem>();
      for (const item of record.attachedMedia || []) {
        mediaMap.set(item.sourceFileId, item);
      }
      for (const decision of draftAttachmentRows.sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))) {
        if (decision.action === 'reject_logo' || decision.action === 'detach_file_from_draft' || decision.action === 'leave_unattached') {
          mediaMap.delete(decision.sourceFileId);
          continue;
        }
        if (
          decision.action === 'mark_as_logo_candidate' ||
          decision.action === 'approve_logo' ||
          decision.action === 'attach_file_to_draft' ||
          decision.action === 'mark_as_menu' ||
          decision.action === 'mark_as_profile_evidence'
        ) {
          if (
            decision.action === 'mark_as_menu'
          ) {
            menuEvidenceSourceFileIds.add(decision.sourceFileId);
            menuEvidenceRefs.add(decision.reason);
          }
          const mediaType =
            decision.action === 'mark_as_menu'
              ? 'menu'
              : decision.mediaType === 'logo'
              ? 'logo'
              : decision.mediaType === 'truck_photo'
                ? 'truck_photo'
                : decision.mediaType === 'food_photo'
                  ? 'food_photo'
                  : 'unknown_media';
          mediaMap.set(decision.sourceFileId, {
            mediaType,
            sourceFileId: decision.sourceFileId,
            sourceFileName: decision.sourceFileName,
            attribution: record.sourceAttribution,
            evidenceRefs: [decision.reason],
            confidence: decision.action === 'approve_logo' ? 1 : 0.7
          });
        }
      }
      record.attachedMedia = Array.from(mediaMap.values());
    }
    if (menuEvidenceSourceFileIds.size > 0) {
      record.menuEvidenceAttached = true;
      record.menuEvidenceSourceFileIds = Array.from(menuEvidenceSourceFileIds);
      record.menuEvidenceRefs = Array.from(menuEvidenceRefs);
      if (!record.warnings?.includes('menu_image_attached_pending_structuring')) {
        record.warnings = [...(record.warnings || []), 'menu_image_attached_pending_structuring'];
      }
    }

    // Recompute full blocked/publish status after corrections and manual attachments
    const nextBlocked = new Set(record.blockedReasons || []);
    if (!record.profileFields.truckName?.value) nextBlocked.add('missing_truck_name');
    else nextBlocked.delete('missing_truck_name');
    if (!record.profileFields.cityArea?.value) nextBlocked.add('missing_city_or_service_area');
    else nextBlocked.delete('missing_city_or_service_area');
    const hasContact =
      Boolean(record.profileFields.phone?.value) ||
      Boolean(record.profileFields.email?.value) ||
      Boolean(record.profileFields.website?.value) ||
      Boolean(record.profileFields.facebook?.value) ||
      Boolean(record.profileFields.instagram?.value);
    if (!hasContact) nextBlocked.add('missing_contact_or_web_or_social');
    else nextBlocked.delete('missing_contact_or_web_or_social');
    const hasMenuSupport = (record.menuItems || []).length > 0 || record.menuEvidenceAttached === true;
    if (!hasMenuSupport) nextBlocked.add('missing_menu_or_menu_deferred');
    else nextBlocked.delete('missing_menu_or_menu_deferred');
    record.blockedReasons = Array.from(nextBlocked);
    record.publishReady = record.blockedReasons.length === 0 && record.plannedAction !== 'needs_review';
    if (!record.publishReady && record.plannedAction !== 'needs_review') {
      record.plannedAction = 'blocked';
    } else if (record.publishReady && record.plannedAction !== 'needs_review') {
      record.plannedAction = record.existingTruckId ? 'update_existing' : 'create_new';
    }
  }

  const reviewDecisionVersion = getMealScoutReviewDecisionVersion();
  const correctionVersion = getMealScoutFieldCorrectionVersion();
  const attachmentDecisionVersion = getMealScoutAttachmentDecisionVersion();
  const signature = JSON.stringify(
    records.map((record) => ({
      recordId: record.recordId,
      plannedAction: record.plannedAction,
      publishReady: record.publishReady,
      draftIds: record.draftIds,
      existingTruckId: record.existingTruckId,
      profileFields: record.profileFields,
      menuItems: record.menuItems,
      attachedMedia: record.attachedMedia,
      menuEvidenceAttached: record.menuEvidenceAttached,
      menuEvidenceSourceFileIds: record.menuEvidenceSourceFileIds,
      menuEvidenceRefs: record.menuEvidenceRefs,
      blockedReasons: record.blockedReasons,
      conflicts: record.conflicts,
      correctionVersion,
      attachmentDecisionVersion
    }))
  );

  return {
    planId: `ms-plan-${randomUUID()}`,
    signature,
    reviewDecisionVersion,
    correctionVersion,
    attachmentDecisionVersion,
    generatedAt: new Date().toISOString(),
    mutationAllowed: false,
    records
  };
}

export function rememberMealScoutPublishPlan(plan: MealScoutPublishPlanPreview): MealScoutPublishPlanPreview {
  publishPlans.set(plan.planId, plan);
  return plan;
}

export function getMealScoutPublishPlan(planId: string): MealScoutPublishPlanPreview | undefined {
  return publishPlans.get(planId);
}

export function resetMealScoutPublishPlansForTest(): void {
  publishPlans.clear();
}
