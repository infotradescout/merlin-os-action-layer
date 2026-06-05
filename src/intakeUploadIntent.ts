import { randomUUID } from 'node:crypto';

export type UploadIntentBrand = 'MEALSCOUT' | 'HOMEID' | 'TRADESCOUT' | 'MERLIN';
export type UploadIntentActorScope = 'owner' | 'customer' | 'homeowner' | 'contractor' | 'staff' | 'admin' | 'rep' | 'system';
export type UploadIntentEntityType = 'food_truck' | 'restaurant' | 'home' | 'contractor' | 'host_location' | 'event' | 'unknown';
export type UploadIntentStatus =
  | 'CREATED'
  | 'FILES_ATTACHED'
  | 'ROUTED'
  | 'PREVIEW_READY'
  | 'EDITED'
  | 'APPROVED'
  | 'APPLIED'
  | 'REJECTED'
  | 'HELD_FOR_REVIEW'
  | 'ERROR';
export type ImplementationMode = 'draft_only' | 'approval_required' | 'admin_review_required';
export type RiskLevel = 'low' | 'medium' | 'high';

export type IntentButtonRegistryEntry = {
  actionId: string;
  brand: UploadIntentBrand;
  actorScope: UploadIntentActorScope;
  label: string;
  description: string;
  entityTypesAllowed: UploadIntentEntityType[];
  expectedFileTypes: string[];
  allowedOutputTypes: string[];
  allowedFieldPaths: string[];
  forbiddenFieldPaths: string[];
  requiresEntityContext: boolean;
  requiresUserHint: boolean;
  previewRequired: true;
  approvalRequired: true;
  implementationMode: ImplementationMode;
  riskLevel: RiskLevel;
};

const MEALSCOUT_OWNER_FIELDS_ALLOWED = [
  'menu.sections',
  'menu.items',
  'menu.prices',
  'menu.notes',
  'schedule.hours',
  'schedule.windows',
  'location.cityArea',
  'contact.socialHandle',
  'media.logo',
  'media.photos'
];
const MEALSCOUT_OWNER_FIELDS_FORBIDDEN = [
  'identity.businessName',
  'identity.owner',
  'identity.verifiedStatus',
  'contact.phone',
  'contact.email',
  'billing.*',
  'bank.*'
];
const MEALSCOUT_STAFF_FIELDS_ALLOWED = [
  'evidence.attachments',
  'review.corrections',
  'review.routing',
  'media.attachments',
  'menu.sections',
  'schedule.hours'
];
const MEALSCOUT_STAFF_FIELDS_FORBIDDEN = ['billing.*', 'bank.*', 'identity.owner'];
const HOMEID_ALLOWED = [
  'documents.receipts',
  'documents.warranties',
  'documents.manuals',
  'repairs.history',
  'permits.records',
  'insurance.documents',
  'home.facts'
];
const HOMEID_FORBIDDEN = ['ownership.*', 'valuation.*', 'bank.*'];
const TRADESCOUT_ALLOWED = ['profile.contractor', 'documents.license', 'documents.insurance', 'jobs.photos', 'estimates', 'invoices'];
const TRADESCOUT_FORBIDDEN = ['bank.*', 'billing.*'];

function entry(input: IntentButtonRegistryEntry): IntentButtonRegistryEntry {
  return input;
}

export const INTENT_BUTTON_REGISTRY: IntentButtonRegistryEntry[] = [
  entry({
    actionId: 'update_menu',
    brand: 'MEALSCOUT',
    actorScope: 'owner',
    label: 'Update Menu',
    description: 'Update menu sections, items, and prices.',
    entityTypesAllowed: ['food_truck', 'restaurant'],
    expectedFileTypes: ['image/*', 'application/pdf'],
    allowedOutputTypes: ['menu_update'],
    allowedFieldPaths: MEALSCOUT_OWNER_FIELDS_ALLOWED,
    forbiddenFieldPaths: MEALSCOUT_OWNER_FIELDS_FORBIDDEN,
    requiresEntityContext: true,
    requiresUserHint: false,
    previewRequired: true,
    approvalRequired: true,
    implementationMode: 'approval_required',
    riskLevel: 'medium'
  }),
  entry({
    actionId: 'update_schedule',
    brand: 'MEALSCOUT',
    actorScope: 'owner',
    label: 'Update Schedule',
    description: 'Update service windows, dates, and locations.',
    entityTypesAllowed: ['food_truck', 'restaurant'],
    expectedFileTypes: ['image/*', 'application/pdf'],
    allowedOutputTypes: ['schedule_update'],
    allowedFieldPaths: ['schedule.hours', 'schedule.windows', 'schedule.locations', 'schedule.notes'],
    forbiddenFieldPaths: ['identity.*', 'contact.phone', 'contact.email', 'billing.*', 'bank.*'],
    requiresEntityContext: true,
    requiresUserHint: false,
    previewRequired: true,
    approvalRequired: true,
    implementationMode: 'approval_required',
    riskLevel: 'medium'
  }),
  ...['add_food_photos', 'upload_logo', 'add_event_flyer', 'add_deal', 'update_hours', 'update_location', 'update_contact_info', 'upload_everything']
    .map((actionId) =>
      entry({
        actionId,
        brand: 'MEALSCOUT',
        actorScope: 'owner',
        label: actionId,
        description: 'MealScout owner action.',
        entityTypesAllowed: ['food_truck', 'restaurant'],
        expectedFileTypes: ['image/*', 'application/pdf'],
        allowedOutputTypes: ['media_update', 'profile_update'],
        allowedFieldPaths: MEALSCOUT_OWNER_FIELDS_ALLOWED,
        forbiddenFieldPaths: MEALSCOUT_OWNER_FIELDS_FORBIDDEN,
        requiresEntityContext: actionId !== 'upload_everything',
        requiresUserHint: false,
        previewRequired: true,
        approvalRequired: true,
        implementationMode: 'approval_required',
        riskLevel: 'medium'
      })
    ),
  ...[
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
  ].map((actionId) =>
    entry({
      actionId,
      brand: 'MEALSCOUT',
      actorScope: actionId.includes('bulk') || actionId.includes('review') || actionId.includes('correct') ? 'admin' : 'staff',
      label: actionId,
      description: 'MealScout staff/admin action.',
      entityTypesAllowed: ['food_truck', 'restaurant', 'unknown'],
      expectedFileTypes: ['image/*', 'application/pdf', 'text/*'],
      allowedOutputTypes: ['review_update', 'evidence_attachment'],
      allowedFieldPaths: MEALSCOUT_STAFF_FIELDS_ALLOWED,
      forbiddenFieldPaths: MEALSCOUT_STAFF_FIELDS_FORBIDDEN,
      requiresEntityContext: false,
      requiresUserHint: false,
      previewRequired: true,
      approvalRequired: true,
      implementationMode: 'admin_review_required',
      riskLevel: 'high'
    })
  ),
  ...[
    'upload_everything',
    'add_repair_record',
    'add_appliance',
    'add_receipt',
    'add_warranty',
    'add_manual',
    'add_inspection_report',
    'add_permit',
    'add_insurance_document',
    'add_contractor_estimate',
    'add_photos',
    'update_home_facts'
  ].map((actionId) =>
    entry({
      actionId,
      brand: 'HOMEID',
      actorScope: 'homeowner',
      label: actionId,
      description: 'HomeID user action.',
      entityTypesAllowed: ['home'],
      expectedFileTypes: ['image/*', 'application/pdf', 'text/*'],
      allowedOutputTypes: ['home_document_update'],
      allowedFieldPaths: HOMEID_ALLOWED,
      forbiddenFieldPaths: HOMEID_FORBIDDEN,
      requiresEntityContext: actionId !== 'upload_everything',
      requiresUserHint: false,
      previewRequired: true,
      approvalRequired: true,
      implementationMode: 'approval_required',
      riskLevel: 'medium'
    })
  ),
  ...[
    'update_contractor_profile',
    'add_business_card',
    'add_license_insurance',
    'add_job_photos',
    'add_before_after_photos',
    'add_estimate',
    'add_invoice',
    'add_service_area_proof',
    'add_review_reference'
  ].map((actionId) =>
    entry({
      actionId,
      brand: 'TRADESCOUT',
      actorScope: 'contractor',
      label: actionId,
      description: 'TradeScout contractor action.',
      entityTypesAllowed: ['contractor'],
      expectedFileTypes: ['image/*', 'application/pdf'],
      allowedOutputTypes: ['contractor_profile_update'],
      allowedFieldPaths: TRADESCOUT_ALLOWED,
      forbiddenFieldPaths: TRADESCOUT_FORBIDDEN,
      requiresEntityContext: actionId !== 'add_business_card',
      requiresUserHint: false,
      previewRequired: true,
      approvalRequired: true,
      implementationMode: 'approval_required',
      riskLevel: 'medium'
    })
  )
];

const registryKey = (brand: UploadIntentBrand, actionId: string, actorScope: UploadIntentActorScope) =>
  `${brand}::${actionId}::${actorScope}`;
const registryMap = new Map<string, IntentButtonRegistryEntry>(
  INTENT_BUTTON_REGISTRY.map((row) => [registryKey(row.brand, row.actionId, row.actorScope), row])
);

export function resolveIntentRegistryAction(
  brand: UploadIntentBrand,
  actionId: string,
  actorScope: UploadIntentActorScope
): IntentButtonRegistryEntry | undefined {
  return registryMap.get(registryKey(brand, actionId, actorScope));
}

export type UploadIntentFileRef = {
  fileId: string;
  fileName?: string;
  mimeType?: string;
  driveFolderId?: string;
  extractedText?: string;
  metadata?: Record<string, unknown>;
};

export type UploadIntentRoutedFile = UploadIntentFileRef & {
  routedType: 'menu' | 'schedule' | 'logo' | 'photo' | 'document' | 'unknown' | 'held';
  confidence: number;
  holdReason?:
    | 'ambiguous'
    | 'unrelated'
    | 'insufficient_evidence'
    | 'invalid_intent'
    | 'intent_evidence_conflict'
    | 'ambiguous_or_wrong_domain';
  reasons: string[];
};

export type UploadIntentPreviewDraft = {
  draftId: string;
  brand: UploadIntentBrand;
  entityType: UploadIntentEntityType;
  entityId?: string;
  actionId: string;
  changes: Record<string, unknown>;
  confidence: number;
  sourceFileRefs: Array<{ fileId: string; fileName?: string }>;
  fieldsNeedingConfirmation: string[];
  allowedFieldsApplied: string[];
  forbiddenFieldsIgnored: string[];
  holdReasons: string[];
  heldFiles: UploadIntentRoutedFile[];
};

export type UploadIntentRecord = {
  uploadId: string;
  userId: string;
  accountId: string;
  brand: UploadIntentBrand;
  actorScope: UploadIntentActorScope;
  entityType: UploadIntentEntityType;
  entityId?: string;
  actionId: string;
  actionSnapshot: IntentButtonRegistryEntry;
  userHint?: string;
  files: UploadIntentFileRef[];
  routedFiles: UploadIntentRoutedFile[];
  previewDraft?: UploadIntentPreviewDraft;
  status: UploadIntentStatus;
  implementationAllowed: false;
  previewRequired: true;
  approvalRequired: true;
  createdAt: string;
  updatedAt: string;
};

const store = new Map<string, UploadIntentRecord>();
const nowIso = () => new Date().toISOString();

export function createUploadIntent(input: {
  userId: string;
  accountId: string;
  brand: UploadIntentBrand;
  actorScope: UploadIntentActorScope;
  entityType: UploadIntentEntityType;
  entityId?: string;
  actionId: string;
  userHint?: string;
  actionSnapshot: IntentButtonRegistryEntry;
}): UploadIntentRecord {
  const timestamp = nowIso();
  const record: UploadIntentRecord = {
    uploadId: `upload-intent-${randomUUID()}`,
    userId: input.userId,
    accountId: input.accountId,
    brand: input.brand,
    actorScope: input.actorScope,
    entityType: input.entityType,
    entityId: input.entityId,
    actionId: input.actionId,
    actionSnapshot: input.actionSnapshot,
    userHint: input.userHint,
    files: [],
    routedFiles: [],
    status: 'CREATED',
    implementationAllowed: false,
    previewRequired: true,
    approvalRequired: true,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  store.set(record.uploadId, record);
  return record;
}

export const getUploadIntent = (uploadId: string) => store.get(uploadId);

export function attachUploadIntentFiles(uploadId: string, files: UploadIntentFileRef[]): UploadIntentRecord | undefined {
  const current = store.get(uploadId);
  if (!current) return undefined;
  const nextFiles = [...current.files];
  for (const file of files) {
    if (!file.fileId) continue;
    const index = nextFiles.findIndex((row) => row.fileId === file.fileId);
    if (index >= 0) nextFiles[index] = { ...nextFiles[index], ...file };
    else nextFiles.push(file);
  }
  const next: UploadIntentRecord = {
    ...current,
    files: nextFiles,
    status: nextFiles.length > 0 ? 'FILES_ATTACHED' : current.status,
    updatedAt: nowIso()
  };
  store.set(uploadId, next);
  return next;
}

export function setUploadIntentRoutedFiles(
  uploadId: string,
  routedFiles: UploadIntentRoutedFile[],
  status: UploadIntentStatus
): UploadIntentRecord | undefined {
  const current = store.get(uploadId);
  if (!current) return undefined;
  const next: UploadIntentRecord = { ...current, routedFiles, status, updatedAt: nowIso() };
  store.set(uploadId, next);
  return next;
}

export function setUploadIntentPreviewDraft(
  uploadId: string,
  previewDraft: UploadIntentPreviewDraft,
  status: UploadIntentStatus
): UploadIntentRecord | undefined {
  const current = store.get(uploadId);
  if (!current) return undefined;
  const next: UploadIntentRecord = { ...current, previewDraft, status, updatedAt: nowIso() };
  store.set(uploadId, next);
  return next;
}

export const resetUploadIntentStoreForTest = () => store.clear();
