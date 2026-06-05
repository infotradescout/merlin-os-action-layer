import type { IntentActionDefinition, MerlinActorScope, MerlinEntityType, ProductAdapter } from '../intake/intakeTypes.js';

const ownerActions = [
  'update_schedule',
  'update_menu',
  'add_food_photos',
  'upload_logo',
  'add_event_flyer',
  'add_deal',
  'update_hours',
  'update_location',
  'update_contact_info',
  'upload_everything'
] as const;

const staffAdminActions = [
  'import_food_truck_evidence',
  'import_restaurant_evidence',
  'attach_menu_evidence',
  'attach_schedule_evidence',
  'attach_logo_media',
  'attach_event_flyer',
  'attach_deal_evidence',
  'correct_existing_profile',
  'review_unknown_uploads',
  'bulk_intake_review'
] as const;

const ownerAllowed = ['menu.sections', 'menu.items', 'menu.prices', 'menu.descriptions', 'menu.availabilityNotes', 'schedule.date', 'schedule.startTime', 'schedule.endTime', 'schedule.location', 'schedule.eventName', 'schedule.notes', 'media.logo', 'media.photos'];
const ownerForbidden = ['businessName', 'ownerIdentity', 'verifiedStatus', 'subscription', 'payment', 'banking', 'phone'];
const staffAllowed = ['evidence.attachments', 'review.corrections', 'review.routing', 'menu.sections', 'schedule.date', 'media.logo', 'media.photos'];
const staffForbidden = ['billing.*', 'bank.*', 'ownerIdentity'];

function action(input: {
  actionId: string;
  actorScope: MerlinActorScope;
  allowed: string[];
  forbidden: string[];
  implementationMode: 'approval_required' | 'admin_review_required';
  riskLevel: 'medium' | 'high';
  requiresEntityContext?: boolean;
}): IntentActionDefinition {
  return {
    actionId: input.actionId,
    brand: 'MEALSCOUT',
    actorScope: input.actorScope,
    label: input.actionId,
    description: `MealScout action: ${input.actionId}`,
    entityTypesAllowed: ['food_truck', 'restaurant', 'unknown'],
    expectedFileTypes: ['image/*', 'application/pdf', 'text/*'],
    allowedOutputTypes: ['menu_update', 'schedule_update', 'media_update', 'review_update'],
    allowedFieldPaths: input.allowed,
    forbiddenFieldPaths: input.forbidden,
    requiresEntityContext: input.requiresEntityContext !== false,
    requiresUserHint: false,
    previewRequired: true,
    approvalRequired: true,
    implementationMode: input.implementationMode,
    riskLevel: input.riskLevel
  };
}

const actions: IntentActionDefinition[] = [
  ...ownerActions.map((id) =>
    action({
      actionId: id,
      actorScope: 'owner',
      allowed: ownerAllowed,
      forbidden: ownerForbidden,
      implementationMode: id === 'update_contact_info' ? 'admin_review_required' : 'approval_required',
      riskLevel: id === 'update_contact_info' ? 'high' : 'medium',
      requiresEntityContext: id !== 'upload_everything'
    })
  ),
  ...staffAdminActions.map((id) =>
    action({
      actionId: id,
      actorScope: id.includes('bulk') || id.includes('review') || id.includes('correct') ? 'admin' : 'staff',
      allowed: staffAllowed,
      forbidden: staffForbidden,
      implementationMode: 'admin_review_required',
      riskLevel: 'high',
      requiresEntityContext: false
    })
  )
];

export const mealscoutAdapter: ProductAdapter = {
  brand: 'MEALSCOUT',
  actions,
  entityTypes: ['food_truck', 'restaurant', 'unknown'],
  actorScopes: ['owner', 'staff', 'admin'],
  getActionDefinition(actionId: string, actorScope: MerlinActorScope): IntentActionDefinition | undefined {
    return actions.find((row) => row.actionId === actionId && row.actorScope === actorScope);
  },
  validateIntent(input) {
    if (input.brand !== 'MEALSCOUT') return { ok: false, code: 'INVALID_BRAND', message: 'MealScout adapter only supports MEALSCOUT brand' };
    const actionDef = this.getActionDefinition(input.actionId, input.actorScope);
    if (!actionDef) return { ok: false, code: 'INVALID_INTENT', message: 'actionId is not registered for actorScope' };
    if (!actionDef.entityTypesAllowed.includes(input.entityType)) return { ok: false, code: 'INVALID_ENTITY_TYPE', message: 'entityType not allowed for action' };
    if (actionDef.requiresEntityContext && !input.entityId) return { ok: false, code: 'ENTITY_CONTEXT_REQUIRED', message: 'entityId is required for this action' };
    if (actionDef.requiresUserHint && !input.userHint) return { ok: false, code: 'USER_HINT_REQUIRED', message: 'userHint is required for this action' };
    return { ok: true, action: actionDef };
  },
  buildPreviewContext(intent) {
    return {
      brand: intent.brand,
      actionId: intent.actionId,
      entityType: intent.entityType,
      entityId: intent.entityId
    };
  }
};
