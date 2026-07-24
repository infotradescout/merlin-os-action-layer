import type { MealScoutPublishPlanRecord } from '../../mealscoutPublishPlan.js';
import {
  createMealScoutProfileFromPlanRecord,
  getMealScoutTruckById,
  updateMealScoutProfileFromPlanRecord,
  type MealScoutExistingProfile
} from '../../mealscoutProfileImport.js';
import { getActionCard, type StoredActionCard } from '../intake/actionCardQueue.js';

/**
 * MealScout's concrete implementation of the apply-adapter seam described in
 * docs/merlin/MERLIN_REPO_BOUNDARY_AUDIT_2026-07-01.md: buildApplyPlan ->
 * validateApplyPlan -> executeApplyPlan -> normalizeApplyResult.
 *
 * This module owns plan construction and orchestration only. Actual writes
 * stay delegated to mealscoutProfileImport.ts / mealscoutProfilesStore.ts so
 * there is exactly one place that persists MealScout profile rows.
 *
 * The generic execution chain (approvalRuntime/executionPlanRuntime/
 * dryRunExecutorRuntime/liveExecutionGateRuntime) is not wired in here:
 * liveExecutionGateRuntime hardcodes LIVE_EXECUTION_ENABLED = false and can
 * never authorize a live write, so it is a simulation/audit trail, not a
 * gate this seam can wait on. validateApplyPlan below is the real authority
 * for whether a write is allowed to happen.
 */

export type MealScoutApplyPlannedAction = 'create_new' | 'update_existing';

export interface MealScoutApplyFieldDiffEntry {
  field: string;
  before: unknown;
  after: unknown;
}

export interface MealScoutApplyPlan {
  cardId: string;
  plannedAction: MealScoutApplyPlannedAction;
  record: MealScoutPublishPlanRecord;
  existingProfileId?: string;
  fieldDiff: MealScoutApplyFieldDiffEntry[];
  duplicateWarnings: string[];
}

export interface MealScoutApplyValidation {
  ok: boolean;
  blockedReason?: string;
}

export type MealScoutApplyExecutionResult =
  | { status: 'created'; profile: MealScoutExistingProfile }
  | { status: 'updated'; profile: MealScoutExistingProfile }
  | { status: 'failed'; failureReason: string };

export interface MealScoutNormalizedApplyResult {
  createdEntity?: { id: string; fields: Record<string, unknown> };
  updatedEntity?: { id: string; fields: Record<string, unknown> };
  fieldDiff?: MealScoutApplyFieldDiffEntry[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildField(sourceFileIds: string[], value: string | undefined): MealScoutPublishPlanRecord['profileFields'][string] | undefined {
  const trimmed = (value || '').trim();
  if (!trimmed) return undefined;
  return {
    value: trimmed,
    evidenceRefs: sourceFileIds,
    sourceFileIds
  };
}

function buildPlanRecord(card: StoredActionCard, plannedAction: MealScoutApplyPlannedAction): MealScoutPublishPlanRecord {
  const fields = card.extractedFields as Record<string, unknown>;
  const socials = (fields.socials && typeof fields.socials === 'object' ? fields.socials : {}) as Record<string, unknown>;
  const sourceFileIds = card.sourceFileIds || [];
  const profileFields: MealScoutPublishPlanRecord['profileFields'] = {};

  const truckName = buildField(sourceFileIds, asString(fields.truckName));
  const phone = buildField(sourceFileIds, asString(fields.phone));
  const email = buildField(sourceFileIds, asString(fields.email));
  const website = buildField(sourceFileIds, asString(fields.website));
  const cityArea = buildField(sourceFileIds, asString(fields.cityArea));
  const facebook = buildField(sourceFileIds, asString(socials.facebook));
  const instagram = buildField(sourceFileIds, asString(socials.instagram));

  if (truckName) profileFields.truckName = truckName;
  if (phone) profileFields.phone = phone;
  if (email) profileFields.email = email;
  if (website) profileFields.website = website;
  if (cityArea) profileFields.cityArea = cityArea;
  if (facebook) profileFields.facebook = facebook;
  if (instagram) profileFields.instagram = instagram;

  return {
    recordId: `action-card-record-${card.id}`,
    plannedAction,
    publishReady: false,
    draftIds: [card.id],
    existingTruckId: card.existingEntityMatch?.entityId,
    profileFields,
    menuItems: [],
    attachedMedia: [],
    blockedReasons: [],
    warnings: [...(card.duplicateWarnings || []), ...(card.conflictWarnings || [])],
    conflicts: [],
    sourceAttribution: {
      contributingRepIds: [],
      sourceFileIds,
      attributionPolicy: 'merlin_mealscout_action_card_route_surface'
    }
  };
}

export function resolveExistingProfile(card: StoredActionCard): MealScoutExistingProfile | undefined {
  const targetId = card.existingEntityMatch?.entityId;
  if (!targetId) return undefined;

  const direct = getMealScoutTruckById(targetId);
  if (direct) return direct;

  if (targetId.startsWith('ms-runtime-')) {
    const sourceCardId = targetId.slice('ms-runtime-'.length);
    const sourceCard = getActionCard(sourceCardId);
    const createdEntityId =
      sourceCard?.applyResult && typeof sourceCard.applyResult === 'object'
        ? asString((sourceCard.applyResult as Record<string, unknown>).createdEntity && typeof (sourceCard.applyResult as Record<string, unknown>).createdEntity === 'object'
            ? ((sourceCard.applyResult as Record<string, unknown>).createdEntity as Record<string, unknown>).id
            : undefined)
        : '';
    if (createdEntityId) {
      return getMealScoutTruckById(createdEntityId);
    }
  }

  return undefined;
}

export function duplicateWarningsForCard(card: StoredActionCard): string[] {
  if ((card.duplicateWarnings || []).length > 0) return card.duplicateWarnings || [];
  if (card.type === 'create_profile_draft' && card.existingEntityMatch) {
    return ['possible_duplicate_existing_entity_match'];
  }
  return [];
}

function buildFieldDiff(
  card: StoredActionCard,
  existing: MealScoutExistingProfile | undefined
): MealScoutApplyFieldDiffEntry[] {
  const record = buildPlanRecord(card, 'update_existing');
  const nextFields = record.profileFields;
  const currentSocials = existing?.socials || {};
  const diff: MealScoutApplyFieldDiffEntry[] = [];
  const fieldSpecs: Array<{ key: string; before: unknown; after: string | undefined }> = [
    { key: 'truckName', before: existing?.truckName, after: nextFields.truckName?.value },
    { key: 'phone', before: existing?.phone, after: nextFields.phone?.value },
    { key: 'email', before: existing?.email, after: nextFields.email?.value },
    { key: 'website', before: existing?.website, after: nextFields.website?.value },
    { key: 'cityArea', before: existing?.cityArea, after: nextFields.cityArea?.value },
    { key: 'facebook', before: currentSocials.facebook, after: nextFields.facebook?.value },
    { key: 'instagram', before: currentSocials.instagram, after: nextFields.instagram?.value }
  ];

  for (const field of fieldSpecs) {
    if (!field.after) continue;
    if (String(field.before || '') === field.after) continue;
    diff.push({ field: field.key, before: field.before ?? '', after: field.after });
  }
  return diff;
}

export function buildApplyPlan(card: StoredActionCard, plannedAction: MealScoutApplyPlannedAction): MealScoutApplyPlan {
  const existing = plannedAction === 'update_existing' ? resolveExistingProfile(card) : undefined;
  return {
    cardId: card.id,
    plannedAction,
    record: buildPlanRecord(card, plannedAction),
    existingProfileId: existing?.id,
    fieldDiff: plannedAction === 'update_existing' ? buildFieldDiff(card, existing) : [],
    duplicateWarnings: duplicateWarningsForCard(card)
  };
}

export function validateApplyPlan(
  plan: MealScoutApplyPlan,
  options: { allowDuplicateCreate: boolean } = { allowDuplicateCreate: false }
): MealScoutApplyValidation {
  if (plan.plannedAction === 'create_new') {
    if (plan.duplicateWarnings.length > 0 && !options.allowDuplicateCreate) {
      return { ok: false, blockedReason: 'duplicate_override_required' };
    }
    return { ok: true };
  }

  if (!plan.existingProfileId) {
    return { ok: false, blockedReason: 'stale_before_state_conflict' };
  }
  return { ok: true };
}

export function executeApplyPlan(plan: MealScoutApplyPlan): MealScoutApplyExecutionResult {
  if (plan.plannedAction === 'create_new') {
    const profile = createMealScoutProfileFromPlanRecord(plan.record);
    return { status: 'created', profile };
  }

  if (!plan.existingProfileId) {
    return { status: 'failed', failureReason: 'stale_before_state_conflict' };
  }
  const profile = updateMealScoutProfileFromPlanRecord(plan.existingProfileId, plan.record);
  if (!profile) {
    return { status: 'failed', failureReason: 'stale_before_state_conflict' };
  }
  return { status: 'updated', profile };
}

function profileFieldSnapshot(profile: MealScoutExistingProfile): Record<string, unknown> {
  return {
    truckName: profile.truckName,
    phone: profile.phone,
    email: profile.email,
    website: profile.website,
    cityArea: profile.cityArea
  };
}

export function normalizeApplyResult(
  execution: MealScoutApplyExecutionResult,
  fieldDiff: MealScoutApplyFieldDiffEntry[] = []
): MealScoutNormalizedApplyResult {
  if (execution.status === 'created') {
    return { createdEntity: { id: execution.profile.id, fields: profileFieldSnapshot(execution.profile) } };
  }
  if (execution.status === 'updated') {
    return {
      updatedEntity: { id: execution.profile.id, fields: profileFieldSnapshot(execution.profile) },
      fieldDiff
    };
  }
  return {};
}
