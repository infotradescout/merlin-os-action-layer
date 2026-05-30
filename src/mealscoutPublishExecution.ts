import { randomUUID } from 'node:crypto';
import type { MealScoutPublishPlanPreview, MealScoutPublishPlanRecord } from './mealscoutPublishPlan.js';
import { getMealScoutPublishPlan } from './mealscoutPublishPlan.js';
import {
  createMealScoutProfileFromPlanRecord,
  getMealScoutTruckById,
  listMealScoutTrucks,
  updateMealScoutProfileFromPlanRecord
} from './mealscoutProfileImport.js';
import { getMealScoutReviewDecisionVersion } from './mealscoutReviewDecisions.js';

export type MealScoutPublishExecutionResult = {
  recordId: string;
  plannedAction: 'create_new' | 'update_existing';
  result: 'success' | 'failed' | 'skipped' | 'already_executed';
  targetId?: string;
  auditId: string;
  failureReason?: string;
  priorAuditId?: string;
};

export type MealScoutPublishAuditEntry = {
  auditId: string;
  executionId: string;
  planId: string;
  recordId: string;
  draftIds: string[];
  sourceFileIds: string[];
  action: 'create_new' | 'update_existing';
  fieldsWritten: string[];
  evidenceRefs: string[];
  sourceAttribution?: MealScoutPublishPlanRecord['sourceAttribution'];
  previousValues?: Record<string, string | undefined>;
  newValues?: Record<string, string | undefined>;
  attachedMedia?: Array<{
    mediaType: 'logo' | 'truck_photo' | 'food_photo' | 'unknown_media';
    sourceFileId: string;
    sourceFileName?: string;
  }>;
  targetId?: string;
  operatorId?: string;
  executedAt: string;
  result: 'success' | 'failed' | 'skipped' | 'already_executed';
  failureReason?: string;
};

export type MealScoutPublishExecutionResponse = {
  executionId: string;
  planId: string;
  mutationAllowed: true;
  executedAt: string;
  results: MealScoutPublishExecutionResult[];
  auditEntries: MealScoutPublishAuditEntry[];
};

const auditEntries: MealScoutPublishAuditEntry[] = [];
const idempotencyIndex = new Map<string, { auditId: string; targetId?: string }>();

function flattenEvidenceRefs(record: MealScoutPublishPlanRecord): string[] {
  const refs = new Set<string>();
  for (const field of Object.values(record.profileFields || {})) {
    for (const ref of field.evidenceRefs || []) refs.add(ref);
  }
  for (const item of record.menuItems || []) {
    for (const ref of item.evidenceRefs || []) refs.add(ref);
  }
  return Array.from(refs);
}

function flattenSourceFileIds(record: MealScoutPublishPlanRecord): string[] {
  const refs = new Set<string>();
  for (const field of Object.values(record.profileFields || {})) {
    for (const ref of field.sourceFileIds || []) refs.add(ref);
  }
  for (const item of record.menuItems || []) {
    for (const ref of item.sourceFileIds || []) refs.add(ref);
  }
  return Array.from(refs);
}

function validateRecord(record: MealScoutPublishPlanRecord): string | undefined {
  if (!record.publishReady) return 'record_not_publish_ready';
  if (record.plannedAction === 'blocked') return 'record_blocked';
  if (record.plannedAction === 'needs_review') return 'record_needs_review';
  if (!['create_new', 'update_existing'].includes(record.plannedAction)) return 'record_action_not_executable';
  if ((record.conflicts || []).length > 0) return 'record_has_unresolved_conflicts';
  if ((record.blockedReasons || []).length > 0) return 'record_has_blocked_reasons';
  if (!record.profileFields.truckName?.value) return 'missing_truck_name';
  if (!record.profileFields.cityArea?.value) return 'missing_city_or_service_area';
  const hasContact =
    Boolean(record.profileFields.phone?.value) ||
    Boolean(record.profileFields.email?.value) ||
    Boolean(record.profileFields.website?.value) ||
    Boolean(record.profileFields.facebook?.value) ||
    Boolean(record.profileFields.instagram?.value);
  if (!hasContact) return 'missing_contact_or_web_or_social';
  if ((record.menuItems || []).length === 0) return 'missing_menu_items';
  for (const [fieldName, field] of Object.entries(record.profileFields || {})) {
    if (!field.value) continue;
    if (!Array.isArray(field.evidenceRefs) || field.evidenceRefs.length === 0) return `missing_field_evidence:${fieldName}`;
    if (!Array.isArray(field.sourceFileIds) || field.sourceFileIds.length === 0) return `missing_field_source:${fieldName}`;
  }
  for (const item of record.menuItems || []) {
    if (!Array.isArray(item.evidenceRefs) || item.evidenceRefs.length === 0) return 'missing_menu_evidence';
    if (!Array.isArray(item.sourceFileIds) || item.sourceFileIds.length === 0) return 'missing_menu_source';
  }
  return undefined;
}

export function executeMealScoutPublishPlan(input: {
  planId: string;
  recordIds: string[];
  confirmation: boolean;
  operatorId?: string;
  expectedSignature?: string;
}): MealScoutPublishExecutionResponse {
  if (!input.confirmation) {
    throw new Error('confirmation_required');
  }
  if (!input.planId.trim()) {
    throw new Error('plan_id_required');
  }
  if (!Array.isArray(input.recordIds) || input.recordIds.length === 0) {
    throw new Error('record_ids_required');
  }
  const plan = getMealScoutPublishPlan(input.planId);
  if (!plan) {
    throw new Error('plan_not_found_or_stale');
  }
  if (input.expectedSignature && input.expectedSignature !== plan.signature) {
    throw new Error('stale_plan');
  }
  if (plan.reviewDecisionVersion !== getMealScoutReviewDecisionVersion()) {
    throw new Error('stale_plan');
  }

  const executionId = `ms-exec-${randomUUID()}`;
  const executedAt = new Date().toISOString();
  const recordMap = new Map(plan.records.map((record) => [record.recordId, record]));
  const results: MealScoutPublishExecutionResult[] = [];
  const audits: MealScoutPublishAuditEntry[] = [];

  for (const recordId of input.recordIds) {
    const record = recordMap.get(recordId);
    const auditId = `ms-audit-${randomUUID()}`;
    const action = (record?.plannedAction || 'create_new') as 'create_new' | 'update_existing';
    if (!record) {
      const failed: MealScoutPublishExecutionResult = {
        recordId,
        plannedAction: action,
        result: 'failed',
        auditId,
        failureReason: 'record_not_found_in_plan'
      };
      const audit: MealScoutPublishAuditEntry = {
        auditId,
        executionId,
        planId: input.planId,
        recordId,
        draftIds: [],
        sourceFileIds: [],
        action,
        fieldsWritten: [],
        evidenceRefs: [],
        sourceAttribution: undefined,
        operatorId: input.operatorId,
        executedAt,
        result: 'failed',
        failureReason: failed.failureReason
      };
      results.push(failed);
      audits.push(audit);
      continue;
    }

    const validationError = validateRecord(record);
    if (validationError) {
      const failed: MealScoutPublishExecutionResult = {
        recordId,
        plannedAction: record.plannedAction as 'create_new' | 'update_existing',
        result: 'skipped',
        auditId,
        failureReason: validationError
      };
      const audit: MealScoutPublishAuditEntry = {
        auditId,
        executionId,
        planId: input.planId,
        recordId,
        draftIds: record.draftIds,
        sourceFileIds: flattenSourceFileIds(record),
        action: record.plannedAction as 'create_new' | 'update_existing',
        fieldsWritten: [],
        evidenceRefs: flattenEvidenceRefs(record),
        sourceAttribution: record.sourceAttribution,
        operatorId: input.operatorId,
        executedAt,
        result: 'skipped',
        failureReason: validationError
      };
      results.push(failed);
      audits.push(audit);
      continue;
    }

    const idempotencyKey = `${input.planId}::${record.recordId}::${flattenEvidenceRefs(record).join('|')}::${flattenSourceFileIds(record).join('|')}`;
    const prior = idempotencyIndex.get(idempotencyKey);
    if (prior) {
      const already: MealScoutPublishExecutionResult = {
        recordId,
        plannedAction: record.plannedAction as 'create_new' | 'update_existing',
        result: 'already_executed',
        targetId: prior.targetId,
        auditId,
        failureReason: 'already_executed',
        priorAuditId: prior.auditId
      };
      const audit: MealScoutPublishAuditEntry = {
        auditId,
        executionId,
        planId: input.planId,
        recordId,
        draftIds: record.draftIds,
        sourceFileIds: flattenSourceFileIds(record),
        action: record.plannedAction as 'create_new' | 'update_existing',
        fieldsWritten: [],
        evidenceRefs: flattenEvidenceRefs(record),
        sourceAttribution: record.sourceAttribution,
        operatorId: input.operatorId,
        executedAt,
        result: 'already_executed',
        failureReason: 'already_executed',
        targetId: prior.targetId
      };
      results.push(already);
      audits.push(audit);
      continue;
    }

    let targetId: string | undefined;
    const fieldsWritten = Object.keys(record.profileFields || {});
    let previousValues: Record<string, string | undefined> | undefined;
    const newValues: Record<string, string | undefined> = {};
    for (const [fieldName, field] of Object.entries(record.profileFields || {})) {
      newValues[fieldName] = field.value;
    }
    try {
      if (record.plannedAction === 'update_existing') {
        if (!record.existingTruckId) {
          throw new Error('missing_existing_truck_id');
        }
        const previous = getMealScoutTruckById(record.existingTruckId);
        if (previous) {
          previousValues = {
            truckName: previous.truckName,
            phone: previous.phone,
            email: previous.email,
            website: previous.website,
            cityArea: previous.cityArea,
            facebook: previous.socials?.facebook,
            instagram: previous.socials?.instagram
          };
        }
        const updated = updateMealScoutProfileFromPlanRecord(record.existingTruckId, record);
        if (!updated) throw new Error('existing_truck_not_found');
        targetId = updated.id;
      } else {
        const created = createMealScoutProfileFromPlanRecord(record);
        targetId = created.id;
      }
      const success: MealScoutPublishExecutionResult = {
        recordId,
        plannedAction: record.plannedAction as 'create_new' | 'update_existing',
        result: 'success',
        targetId,
        auditId
      };
      const audit: MealScoutPublishAuditEntry = {
        auditId,
        executionId,
        planId: input.planId,
        recordId,
        draftIds: record.draftIds,
        sourceFileIds: flattenSourceFileIds(record),
        action: record.plannedAction as 'create_new' | 'update_existing',
        fieldsWritten,
        evidenceRefs: flattenEvidenceRefs(record),
        sourceAttribution: record.sourceAttribution,
        previousValues,
        newValues,
        targetId,
        operatorId: input.operatorId,
        executedAt,
        result: 'success'
        ,
        attachedMedia: (record.attachedMedia || []).map((item) => ({
          mediaType: item.mediaType,
          sourceFileId: item.sourceFileId,
          sourceFileName: item.sourceFileName
        }))
      };
      results.push(success);
      audits.push(audit);
      idempotencyIndex.set(idempotencyKey, { auditId, targetId });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'execution_failed';
      const failed: MealScoutPublishExecutionResult = {
        recordId,
        plannedAction: record.plannedAction as 'create_new' | 'update_existing',
        result: 'failed',
        auditId,
        failureReason: reason
      };
      const audit: MealScoutPublishAuditEntry = {
        auditId,
        executionId,
        planId: input.planId,
        recordId,
        draftIds: record.draftIds,
        sourceFileIds: flattenSourceFileIds(record),
        action: record.plannedAction as 'create_new' | 'update_existing',
        fieldsWritten: [],
        evidenceRefs: flattenEvidenceRefs(record),
        sourceAttribution: record.sourceAttribution,
        operatorId: input.operatorId,
        executedAt,
        result: 'failed',
        failureReason: reason
      };
      results.push(failed);
      audits.push(audit);
    }
  }

  auditEntries.push(...audits);
  return {
    executionId,
    planId: input.planId,
    mutationAllowed: true,
    executedAt,
    results,
    auditEntries: audits
  };
}

export function listMealScoutPublishExecutionAudit(): MealScoutPublishAuditEntry[] {
  return [...auditEntries];
}

export function queryMealScoutPublishExecutionAudit(filters?: {
  planId?: string;
  executionId?: string;
  recordId?: string;
}): MealScoutPublishAuditEntry[] {
  const rows = [...auditEntries].sort((a, b) => b.executedAt.localeCompare(a.executedAt));
  return rows.filter((row) => {
    if (filters?.planId && row.planId !== filters.planId) return false;
    if (filters?.executionId && row.executionId !== filters.executionId) return false;
    if (filters?.recordId && row.recordId !== filters.recordId) return false;
    return true;
  });
}

export function resetMealScoutPublishExecutionForTest(): void {
  auditEntries.length = 0;
  idempotencyIndex.clear();
}

export function detectSafeMealScoutWritePath(): {
  mode: 'existing_profile_import_store';
  description: string;
  currentProfileCount: number;
} {
  const trucks = listMealScoutTrucks();
  return {
    mode: 'existing_profile_import_store',
    description: 'Uses in-repo MealScout profile import store as guarded write adapter; no uncontrolled external DB writes.',
    currentProfileCount: trucks.length
  };
}
