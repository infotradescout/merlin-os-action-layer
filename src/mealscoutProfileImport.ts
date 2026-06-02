import { createHash, randomUUID } from 'node:crypto';
import type { MealScoutEvidenceCluster } from './mealscoutEvidenceClustering.js';
import type { MealScoutPublishPlanRecord } from './mealscoutPublishPlan.js';
import { isMenuLikeTruckName } from './mealscoutTruckNameGuardrail.js';

export type MealScoutExtractedSignal = {
  sourceFileId: string;
  sourceFileName?: string;
  sourcePath?: string;
  sourceType: 'screenshot' | 'menu' | 'logo' | 'truck_photo' | 'food_photo' | 'unknown' | 'unknown_media';
  rawExtractedText?: string;
  truckName?: string;
  phone?: string;
  email?: string;
  cityArea?: string;
  cuisine?: string;
  menuItems?: Array<{
    name: string;
    price?: string;
    description?: string;
  }>;
  menuDeferred?: boolean;
  socials?: {
    facebook?: string;
    instagram?: string;
  };
  website?: string;
  notes?: string;
  sourceFileAttribution?: {
    attributionSource: 'drive_metadata' | 'folder_context' | 'request_context' | 'unknown';
    attributionStatus?:
      | 'matched_affiliate'
      | 'matched_affiliate_folder'
      | 'matched_owner_affiliate'
      | 'matched_last_modifier_affiliate'
      | 'request_context'
      | 'ambiguous'
      | 'unmatched'
      | 'unknown';
    driveUploaderEmail?: string;
    driveUploaderName?: string;
    ownerEmail?: string;
    ownerDisplayName?: string;
    lastModifyingUserEmail?: string;
    lastModifyingUserName?: string;
    uploadedAt?: string;
    modifiedAt?: string;
    intakeSubmittedBy?: string;
    affiliateId?: string;
    affiliateEmail?: string;
    affiliateCode?: string;
    affiliate_attribution_email?: string;
    affiliate_attribution_source?: 'folder_email_token';
    affiliate_attribution_folder?: string;
    affiliate_attribution_folder_path?: string;
    affiliate_attribution_warnings?: string[];
    repId?: string;
    needsAttributionReview?: boolean;
    sourceChannel?: 'drive_upload' | 'manual_upload' | 'admin_import';
    batchId?: string;
    capturedAt?: string;
  };
};

export type MealScoutDuplicateCandidate = {
  existingProfileId: string;
  truckName?: string;
  reason: string;
  confidence: number;
};

export type MealScoutProfileDraft = {
  draftId: string;
  draftType: 'create_new' | 'update_existing' | 'uncertain_match';
  existingTruckId?: string;
  truckName?: string;
  phone?: string;
  email?: string;
  cityArea?: string;
  cuisine?: string;
  menu: Array<{
    name: string;
    price?: string;
    description?: string;
    sourceFileId: string;
  }>;
  menuDeferred: boolean;
  socials: {
    facebook?: string;
    instagram?: string;
  };
  website?: string;
  sourceFiles: Array<{
    sourceFileId: string;
    sourcePath?: string;
    sourceType: 'screenshot' | 'menu' | 'logo' | 'truck_photo' | 'food_photo' | 'unknown' | 'unknown_media';
    sourceAttribution?: MealScoutExtractedSignal['sourceFileAttribution'];
  }>;
  attachedMedia: Array<{
    mediaType: 'logo' | 'truck_photo' | 'food_photo' | 'unknown_media';
    sourceFileId: string;
    sourceFileName?: string;
    sourcePath?: string;
    confidence: number;
    sourceAttribution?: MealScoutExtractedSignal['sourceFileAttribution'];
  }>;
  missingFields: string[];
  warnings: string[];
  duplicateCandidates: MealScoutDuplicateCandidate[];
  confidence: number;
  reviewStatus: 'ready_for_review' | 'missing_required' | 'duplicate_possible' | 'uncertain_match';
  extractedFieldEvidence: Partial<
    Record<
      'truckName' | 'phone' | 'email' | 'website' | 'facebook' | 'instagram' | 'cityArea' | 'cuisine' | 'hours' | 'serviceArea' | 'notesBio',
      {
        value: string;
        sourceFileId: string;
        sourceFileName?: string;
        extractionMethod: 'ocr';
        confidence: number;
        rawSnippet: string;
        sourceAttribution?: MealScoutExtractedSignal['sourceFileAttribution'];
      }
    >
  > & {
    menuItems?: Array<{
      value: string;
      sourceFileId: string;
      sourceFileName?: string;
      extractionMethod: 'ocr';
      confidence: number;
      rawSnippet: string;
      sourceAttribution?: MealScoutExtractedSignal['sourceFileAttribution'];
    }>;
  };
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
  mutationAllowed: false;
};

export type MealScoutMergeRecommendation = 'merge_recommended' | 'possible_match' | 'keep_separate';

export type MealScoutMergeReasonType =
  | 'same_phone'
  | 'same_email'
  | 'same_website'
  | 'same_social'
  | 'same_exact_name'
  | 'similar_name'
  | 'shared_file_context'
  | 'menu_profile_link'
  | 'weak_text_overlap';

export type MealScoutMergeReason = {
  type: MealScoutMergeReasonType;
  detail: string;
  sourceDraftIds: string[];
  sourceFileIds: string[];
};

export type MealScoutMergeConflict = {
  field: string;
  values: string[];
  sourceDraftIds: string[];
};

export type MealScoutMergeAssistCandidateGroup = {
  groupId: string;
  draftIds: string[];
  recommendation: MealScoutMergeRecommendation;
  confidence: number;
  reasons: MealScoutMergeReason[];
  conflicts: MealScoutMergeConflict[];
};

export type MealScoutMergeAssist = {
  candidateGroups: MealScoutMergeAssistCandidateGroup[];
};

export type MealScoutUnattachedMedia = {
  mediaType: 'logo' | 'truck_photo' | 'food_photo' | 'unknown_media';
  sourceFileId: string;
  sourceFileName?: string;
  sourcePath?: string;
  reason: 'weak_linkage' | 'logo_only' | 'unknown_media';
  sourceAttribution?: MealScoutExtractedSignal['sourceFileAttribution'];
};

export type MealScoutExistingProfile = {
  id: string;
  truckName?: string;
  phone?: string;
  email?: string;
  website?: string;
  cityArea?: string;
  socials?: {
    facebook?: string;
    instagram?: string;
  };
  affiliate_attribution_email?: string;
  affiliate_attribution_source?: 'folder_email_token';
  affiliate_attribution_folder?: string;
  affiliate_attribution_folder_path?: string;
  affiliate_attribution_warnings?: string[];
  email_verified?: boolean;
  insurance_verified?: boolean;
  claim_status?: 'unclaimed' | 'claimed';
};

export type MealScoutCaptureBatch = {
  id: string;
  brand: 'mealscout';
  status: 'uploaded' | 'needs_review';
  uploadedFileCount: number;
  processedFileCount: number;
  createdAt: string;
};

const batches = new Map<string, MealScoutCaptureBatch>();
const drafts = new Map<string, MealScoutProfileDraft>();
const clusterToDraftId = new Map<string, string>();
const evidenceById = new Map<string, MealScoutExtractedSignal>();
const existingProfiles = new Map<string, MealScoutExistingProfile>();

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeText(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function normalizePhone(value: string | undefined): string {
  return (value || '').replace(/[^0-9]/g, '');
}

function normalizeHandle(value: string | undefined): string {
  return normalizeText(value).replace(/^@/, '');
}

function normalizeWebsite(value: string | undefined): string {
  return normalizeText(value).replace(/^https?:\/\//, '').replace(/\/+$/, '');
}

function normalizeName(value: string | undefined): string {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function sourceFileIdsForDraft(draft: MealScoutProfileDraft): string[] {
  return Array.from(new Set(draft.sourceFiles.map((item) => item.sourceFileId).filter(Boolean)));
}

function sourceFolderTokensForDraft(draft: MealScoutProfileDraft): string[] {
  const tokens = new Set<string>();
  for (const sourceFile of draft.sourceFiles) {
    const path = (sourceFile.sourcePath || '').trim();
    if (!path) continue;
    const parts = path.split(/[\\/]+/).map((item) => item.trim().toLowerCase()).filter(Boolean);
    for (const part of parts) {
      tokens.add(part);
    }
  }
  return Array.from(tokens);
}

function scoreConfidence(signals: MealScoutExtractedSignal[]): number {
  const fieldHits = new Set<string>();
  let menuCount = 0;
  for (const signal of signals) {
    if (signal.truckName) fieldHits.add('truckName');
    if (signal.phone || signal.email) fieldHits.add('contact');
    if (signal.cityArea) fieldHits.add('cityArea');
    if (signal.cuisine) fieldHits.add('cuisine');
    if (signal.website) fieldHits.add('website');
    if (signal.socials?.facebook || signal.socials?.instagram) fieldHits.add('socials');
    menuCount += signal.menuItems?.filter((item) => item.name?.trim()).length || 0;
  }
  const base = fieldHits.size / 6;
  const menuBoost = Math.min(0.25, menuCount * 0.05);
  return Math.max(0, Math.min(1, Number((base + menuBoost).toFixed(2))));
}

function buildMissingFields(draft: Pick<MealScoutProfileDraft, 'truckName' | 'phone' | 'email' | 'cityArea' | 'cuisine' | 'menu' | 'menuDeferred'>): string[] {
  const missing: string[] = [];
  if (!draft.truckName) missing.push('truckName');
  if (!draft.phone && !draft.email) missing.push('phone_or_email');
  if (!draft.cityArea) missing.push('cityArea');
  if (!draft.cuisine) missing.push('cuisine');
  if (draft.menu.length === 0 && !draft.menuDeferred) missing.push('menu');
  return missing;
}

function similarName(left: string | undefined, right: string | undefined): boolean {
  const a = normalizeText(left).replace(/[^a-z0-9]/g, '');
  const b = normalizeText(right).replace(/[^a-z0-9]/g, '');
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const leftTokens = normalizeText(left).split(/[^a-z0-9]+/).filter(Boolean);
  const rightTokens = normalizeText(right).split(/[^a-z0-9]+/).filter(Boolean);
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.includes(token)) overlap += 1;
  }
  return overlap >= 2;
}

function buildDuplicateCandidates(
  draft: Pick<MealScoutProfileDraft, 'truckName' | 'phone' | 'email' | 'website' | 'cityArea' | 'socials'>,
  profiles: MealScoutExistingProfile[]
): MealScoutDuplicateCandidate[] {
  const out: MealScoutDuplicateCandidate[] = [];
  for (const profile of profiles) {
    const reasons: string[] = [];
    let confidence = 0;

    if (normalizePhone(draft.phone) && normalizePhone(draft.phone) === normalizePhone(profile.phone)) {
      reasons.push('phone_match');
      confidence = Math.max(confidence, 0.98);
    }
    if (normalizeText(draft.email) && normalizeText(draft.email) === normalizeText(profile.email)) {
      reasons.push('email_match');
      confidence = Math.max(confidence, 0.98);
    }
    if (normalizeText(draft.website) && normalizeText(draft.website) === normalizeText(profile.website)) {
      reasons.push('website_match');
      confidence = Math.max(confidence, 0.95);
    }
    if (
      normalizeHandle(draft.socials?.facebook) &&
      normalizeHandle(draft.socials?.facebook) === normalizeHandle(profile.socials?.facebook)
    ) {
      reasons.push('facebook_match');
      confidence = Math.max(confidence, 0.95);
    }
    if (
      normalizeHandle(draft.socials?.instagram) &&
      normalizeHandle(draft.socials?.instagram) === normalizeHandle(profile.socials?.instagram)
    ) {
      reasons.push('instagram_match');
      confidence = Math.max(confidence, 0.95);
    }

    if (reasons.length === 0 && similarName(draft.truckName, profile.truckName) && normalizeText(draft.cityArea) && normalizeText(draft.cityArea) === normalizeText(profile.cityArea)) {
      reasons.push('name_city_similarity');
      confidence = Math.max(confidence, 0.7);
    }

    if (reasons.length > 0) {
      out.push({
        existingProfileId: profile.id,
        truckName: profile.truckName,
        reason: reasons.join(','),
        confidence: Number(confidence.toFixed(2))
      });
    }
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

function pickFirst<T>(signals: MealScoutExtractedSignal[], selector: (s: MealScoutExtractedSignal) => T | undefined): T | undefined {
  for (const signal of signals) {
    const value = selector(signal);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function buildRawSnippet(rawText: string | undefined, value: string | undefined): string {
  if (!value) return '';
  const safeRaw = (rawText || '').trim();
  if (!safeRaw) return value.slice(0, 120);
  const index = safeRaw.toLowerCase().indexOf(value.toLowerCase());
  if (index < 0) return safeRaw.slice(0, 120);
  const start = Math.max(0, index - 30);
  const end = Math.min(safeRaw.length, index + value.length + 30);
  return safeRaw.slice(start, end);
}

function buildFieldEvidence(
  signals: MealScoutExtractedSignal[],
  selector: (signal: MealScoutExtractedSignal) => string | undefined,
  confidence: number
):
  | {
      value: string;
      sourceFileId: string;
      sourceFileName?: string;
      extractionMethod: 'ocr';
      confidence: number;
      rawSnippet: string;
      sourceAttribution?: MealScoutExtractedSignal['sourceFileAttribution'];
    }
  | undefined {
  for (const signal of signals) {
    const value = (selector(signal) || '').trim();
    if (!value) continue;
    return {
      value,
      sourceFileId: signal.sourceFileId,
      sourceFileName: signal.sourceFileName,
      extractionMethod: 'ocr',
      confidence,
      rawSnippet: buildRawSnippet(signal.rawExtractedText, value),
      sourceAttribution: signal.sourceFileAttribution
    };
  }
  return undefined;
}

function resolveReviewStatus(missingFields: string[], duplicateCandidates: MealScoutDuplicateCandidate[], warnings: string[]): MealScoutProfileDraft['reviewStatus'] {
  if (missingFields.length > 0) return 'missing_required';
  if (duplicateCandidates.length > 0) return 'duplicate_possible';
  if (warnings.some((item) => item.includes('uncertain'))) return 'uncertain_match';
  return 'ready_for_review';
}

function buildDraftAttribution(signals: MealScoutExtractedSignal[]): MealScoutProfileDraft['sourceAttribution'] {
  const contributingRepIds = Array.from(
    new Set(
      signals
        .map((signal) => signal.sourceFileAttribution?.repId || signal.sourceFileAttribution?.affiliateEmail || signal.sourceFileAttribution?.driveUploaderEmail || '')
        .filter(Boolean)
    )
  );
  const sourceFileIds = Array.from(new Set(signals.map((signal) => signal.sourceFileId).filter(Boolean)));
  const folderAttribution = signals
    .map((signal) => signal.sourceFileAttribution)
    .find((item) => Boolean(item?.affiliate_attribution_email));
  const affiliateAttributionWarnings = Array.from(
    new Set(signals.flatMap((signal) => signal.sourceFileAttribution?.affiliate_attribution_warnings || []))
  );
  let primarySourceRepId: string | undefined;
  for (const signal of signals) {
    const contributor = signal.sourceFileAttribution?.repId || signal.sourceFileAttribution?.affiliateEmail || signal.sourceFileAttribution?.driveUploaderEmail;
    const hasRequiredEvidence = Boolean(
      signal.truckName ||
        signal.cityArea ||
        signal.phone ||
        signal.email ||
        signal.website ||
        signal.socials?.facebook ||
        signal.socials?.instagram ||
        (signal.menuItems || []).length > 0
    );
    if (contributor && hasRequiredEvidence) {
      primarySourceRepId = contributor;
      break;
    }
  }
  return {
    primarySourceRepId,
    contributingRepIds,
    sourceFileIds,
    attributionPolicy: 'first_required_field_contributor',
    createdFromBatchId: signals.find((signal) => signal.sourceFileAttribution?.batchId)?.sourceFileAttribution?.batchId,
    affiliate_attribution_email: folderAttribution?.affiliate_attribution_email,
    affiliate_attribution_source: folderAttribution?.affiliate_attribution_source,
    affiliate_attribution_folder: folderAttribution?.affiliate_attribution_folder,
    affiliate_attribution_folder_path: folderAttribution?.affiliate_attribution_folder_path,
    affiliate_attribution_warnings: affiliateAttributionWarnings
  };
}

export function buildMealScoutProfileDraft(
  signals: MealScoutExtractedSignal[],
  profiles: MealScoutExistingProfile[] = []
): MealScoutProfileDraft {
  const safeSignals = signals.filter((signal) => Boolean(signal?.sourceFileId));
  const draftSeed = safeSignals
    .map((signal) => signal.sourceFileId)
    .filter(Boolean)
    .sort()
    .join('|');
  const stableDraftId = draftSeed
    ? `ms-draft-${createHash('sha1').update(draftSeed).digest('hex').slice(0, 16)}`
    : `ms-draft-${randomUUID()}`;
  const menu = safeSignals.flatMap((signal) =>
    (signal.menuItems || [])
      .filter((item) => item.name && item.name.trim().length > 0)
      .map((item) => ({
        name: item.name,
        price: item.price,
        description: item.description,
        sourceFileId: signal.sourceFileId
      }))
  );

  const draft: MealScoutProfileDraft = {
    draftId: stableDraftId,
    draftType: 'create_new',
    truckName: pickFirst(safeSignals, (s) => (s.truckName || '').trim() || undefined),
    phone: pickFirst(safeSignals, (s) => (s.phone || '').trim() || undefined),
    email: pickFirst(safeSignals, (s) => (s.email || '').trim() || undefined),
    cityArea: pickFirst(safeSignals, (s) => (s.cityArea || '').trim() || undefined),
    cuisine: pickFirst(safeSignals, (s) => (s.cuisine || '').trim() || undefined),
    menu,
    menuDeferred: safeSignals.some((s) => s.menuDeferred === true),
    socials: {
      facebook: pickFirst(safeSignals, (s) => (s.socials?.facebook || '').trim() || undefined),
      instagram: pickFirst(safeSignals, (s) => (s.socials?.instagram || '').trim() || undefined)
    },
    website: pickFirst(safeSignals, (s) => (s.website || '').trim() || undefined),
    sourceFiles: safeSignals.map((signal) => ({
      sourceFileId: signal.sourceFileId,
      sourcePath: signal.sourcePath,
      sourceType: signal.sourceType,
      sourceAttribution: signal.sourceFileAttribution
    })),
    attachedMedia: safeSignals
      .filter((signal) => ['logo', 'truck_photo', 'food_photo', 'unknown_media'].includes(signal.sourceType))
      .map((signal) => ({
        mediaType: signal.sourceType === 'unknown' ? 'unknown_media' : (signal.sourceType as 'logo' | 'truck_photo' | 'food_photo' | 'unknown_media'),
        sourceFileId: signal.sourceFileId,
        sourceFileName: signal.sourceFileName,
        sourcePath: signal.sourcePath,
        confidence: 0.7,
        sourceAttribution: signal.sourceFileAttribution
      })),
    missingFields: [],
    warnings: [],
    duplicateCandidates: [],
    confidence: scoreConfidence(safeSignals),
    reviewStatus: 'ready_for_review',
    extractedFieldEvidence: {},
    sourceAttribution: buildDraftAttribution(safeSignals),
    mutationAllowed: false
  };

  if (isMenuLikeTruckName(draft.truckName)) {
    draft.truckName = undefined;
    if (!draft.warnings.includes('menu_like_truck_name')) {
      draft.warnings.push('menu_like_truck_name');
    }
    if (!draft.warnings.includes('missing_required_identity')) {
      draft.warnings.push('missing_required_identity');
    }
  }

  draft.missingFields = buildMissingFields(draft);
  draft.duplicateCandidates = buildDuplicateCandidates(draft, profiles);

  if (safeSignals.some((signal) => signal.sourceType === 'unknown')) {
    draft.warnings.push('uncertain source type present');
  }
  if (draft.menu.length === 0 && !draft.menuDeferred) {
    draft.warnings.push('menu missing and not deferred');
  }

  draft.reviewStatus = resolveReviewStatus(draft.missingFields, draft.duplicateCandidates, draft.warnings);

  const topDuplicate = draft.duplicateCandidates[0];
  const secondDuplicate = draft.duplicateCandidates[1];
  if (topDuplicate && topDuplicate.confidence >= 0.95 && (!secondDuplicate || topDuplicate.confidence - secondDuplicate.confidence >= 0.05)) {
    draft.draftType = 'update_existing';
    draft.existingTruckId = topDuplicate.existingProfileId;
  } else if (topDuplicate) {
    draft.draftType = 'uncertain_match';
    draft.reviewStatus = 'uncertain_match';
    if (!draft.warnings.includes('ambiguous existing match')) {
      draft.warnings.push('ambiguous existing match');
    }
  }

  draft.extractedFieldEvidence.truckName = buildFieldEvidence(
    safeSignals,
    (s) => (isMenuLikeTruckName(s.truckName) ? undefined : s.truckName),
    0.85
  );
  draft.extractedFieldEvidence.phone = buildFieldEvidence(safeSignals, (s) => s.phone, 0.98);
  draft.extractedFieldEvidence.email = buildFieldEvidence(safeSignals, (s) => s.email, 0.98);
  draft.extractedFieldEvidence.website = buildFieldEvidence(safeSignals, (s) => s.website, 0.9);
  draft.extractedFieldEvidence.facebook = buildFieldEvidence(safeSignals, (s) => s.socials?.facebook, 0.9);
  draft.extractedFieldEvidence.instagram = buildFieldEvidence(safeSignals, (s) => s.socials?.instagram, 0.9);
  draft.extractedFieldEvidence.cityArea = buildFieldEvidence(safeSignals, (s) => s.cityArea, 0.75);
  draft.extractedFieldEvidence.cuisine = buildFieldEvidence(safeSignals, (s) => s.cuisine, 0.7);

  const menuEvidence = safeSignals.flatMap((signal) =>
    (signal.menuItems || []).map((item) => ({
      value: `${item.name}${item.price ? ` ${item.price}` : ''}`.trim(),
      sourceFileId: signal.sourceFileId,
      sourceFileName: signal.sourceFileName,
      extractionMethod: 'ocr' as const,
      confidence: 0.8,
      rawSnippet: buildRawSnippet(signal.rawExtractedText, item.name),
      sourceAttribution: signal.sourceFileAttribution
    }))
  );
  if (menuEvidence.length > 0) {
    draft.extractedFieldEvidence.menuItems = menuEvidence;
  }

  return draft;
}

export function buildMealScoutDraftsFromClusters(
  clusters: MealScoutEvidenceCluster[],
  profiles: MealScoutExistingProfile[] = []
): MealScoutProfileDraft[] {
  const drafts: MealScoutProfileDraft[] = [];
  for (const cluster of clusters) {
    const singleton = cluster.files.length === 1 ? cluster.files[0] : undefined;
    if (singleton) {
      const mediaOnlyType = ['logo', 'truck_photo', 'food_photo', 'unknown'].includes(singleton.detectedType);
      const hasIdentity = Boolean(
        (singleton.extractedSignals.truckName || '').trim() ||
          (singleton.extractedSignals.phone || '').trim() ||
          (singleton.extractedSignals.email || '').trim() ||
          (singleton.extractedSignals.website || '').trim() ||
          (singleton.extractedSignals.facebook || '').trim() ||
          (singleton.extractedSignals.instagram || '').trim()
      );
      if (mediaOnlyType && !hasIdentity) {
        continue;
      }
    }
    const signals: MealScoutExtractedSignal[] = cluster.files.map((file) => ({
      sourceFileId: file.fileId,
      sourcePath: file.drivePath,
      sourceType:
        file.detectedType === 'menu'
          ? 'menu'
          : file.detectedType === 'logo'
            ? 'logo'
            : file.detectedType === 'truck_photo'
              ? 'truck_photo'
              : file.detectedType === 'food_photo'
                ? 'food_photo'
            : file.detectedType === 'unknown'
              ? 'unknown'
              : 'screenshot',
      sourceFileName: file.fileName,
      rawExtractedText: file.rawExtractedText,
      truckName: file.extractedSignals.truckName,
      phone: file.extractedSignals.phone,
      email: file.extractedSignals.email,
      cityArea: file.extractedSignals.cityArea,
      cuisine: file.extractedSignals.cuisine,
      menuItems: file.extractedSignals.menuItems,
      socials: {
        facebook: file.extractedSignals.facebook,
        instagram: file.extractedSignals.instagram
      },
      website: file.extractedSignals.website,
      sourceFileAttribution: file.sourceFileAttribution
    }));
    const draft = buildMealScoutProfileDraft(signals, profiles);
    if (cluster.reviewStatus === 'uncertain_match' && draft.reviewStatus === 'ready_for_review') {
      draft.reviewStatus = 'uncertain_match';
      if (!draft.warnings.includes('uncertain cluster match')) {
        draft.warnings.push('uncertain cluster match');
      }
    }
    drafts.push(draft);
  }
  return drafts;
}

export function buildMealScoutUnattachedMediaFromClusters(clusters: MealScoutEvidenceCluster[]): MealScoutUnattachedMedia[] {
  const out: MealScoutUnattachedMedia[] = [];
  for (const cluster of clusters) {
    if (cluster.files.length !== 1) continue;
    const file = cluster.files[0];
    if (!['logo', 'truck_photo', 'food_photo', 'unknown'].includes(file.detectedType)) continue;
    const hasIdentity = Boolean(
      (file.extractedSignals.truckName || '').trim() ||
        (file.extractedSignals.phone || '').trim() ||
        (file.extractedSignals.email || '').trim() ||
        (file.extractedSignals.website || '').trim() ||
        (file.extractedSignals.facebook || '').trim() ||
        (file.extractedSignals.instagram || '').trim()
    );
    if (hasIdentity) continue;
    out.push({
      mediaType:
        file.detectedType === 'unknown'
          ? 'unknown_media'
          : (file.detectedType as 'logo' | 'truck_photo' | 'food_photo'),
      sourceFileId: file.fileId,
      sourceFileName: file.fileName,
      sourcePath: file.drivePath,
      reason: file.detectedType === 'logo' ? 'logo_only' : file.detectedType === 'unknown' ? 'unknown_media' : 'weak_linkage',
      sourceAttribution: file.sourceFileAttribution
    });
  }
  return out;
}

export function buildMealScoutMergeAssist(drafts: MealScoutProfileDraft[]): MealScoutMergeAssist {
  const candidateGroups: MealScoutMergeAssistCandidateGroup[] = [];

  for (let leftIndex = 0; leftIndex < drafts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < drafts.length; rightIndex += 1) {
      const left = drafts[leftIndex];
      const right = drafts[rightIndex];
      const sourceDraftIds = [left.draftId, right.draftId];
      const sourceFileIds = Array.from(new Set([...sourceFileIdsForDraft(left), ...sourceFileIdsForDraft(right)]));
      const reasons: MealScoutMergeReason[] = [];
      const conflicts: MealScoutMergeConflict[] = [];
      let strongestReasonConfidence = 0;

      const leftPhone = normalizePhone(left.phone);
      const rightPhone = normalizePhone(right.phone);
      if (leftPhone && rightPhone) {
        if (leftPhone === rightPhone) {
          reasons.push({
            type: 'same_phone',
            detail: 'Drafts share the same normalized phone number.',
            sourceDraftIds,
            sourceFileIds
          });
          strongestReasonConfidence = Math.max(strongestReasonConfidence, 0.99);
        } else {
          conflicts.push({ field: 'phone', values: [left.phone || '', right.phone || ''].filter(Boolean), sourceDraftIds });
        }
      }

      const leftEmail = normalizeText(left.email);
      const rightEmail = normalizeText(right.email);
      if (leftEmail && rightEmail) {
        if (leftEmail === rightEmail) {
          reasons.push({
            type: 'same_email',
            detail: 'Drafts share the same email address.',
            sourceDraftIds,
            sourceFileIds
          });
          strongestReasonConfidence = Math.max(strongestReasonConfidence, 0.99);
        } else {
          conflicts.push({ field: 'email', values: [left.email || '', right.email || ''].filter(Boolean), sourceDraftIds });
        }
      }

      const leftWebsite = normalizeWebsite(left.website);
      const rightWebsite = normalizeWebsite(right.website);
      if (leftWebsite && rightWebsite) {
        if (leftWebsite === rightWebsite) {
          reasons.push({
            type: 'same_website',
            detail: 'Drafts share the same website.',
            sourceDraftIds,
            sourceFileIds
          });
          strongestReasonConfidence = Math.max(strongestReasonConfidence, 0.96);
        } else {
          conflicts.push({ field: 'website', values: [left.website || '', right.website || ''].filter(Boolean), sourceDraftIds });
        }
      }

      const leftHandles = [normalizeHandle(left.socials.facebook), normalizeHandle(left.socials.instagram)].filter(Boolean);
      const rightHandles = [normalizeHandle(right.socials.facebook), normalizeHandle(right.socials.instagram)].filter(Boolean);
      const sharedHandle = leftHandles.find((handle) => rightHandles.includes(handle));
      if (sharedHandle) {
        reasons.push({
          type: 'same_social',
          detail: 'Drafts share the same normalized social handle.',
          sourceDraftIds,
          sourceFileIds
        });
        strongestReasonConfidence = Math.max(strongestReasonConfidence, 0.95);
      } else if (leftHandles.length > 0 && rightHandles.length > 0) {
        conflicts.push({
          field: 'social',
          values: Array.from(new Set([...leftHandles, ...rightHandles])),
          sourceDraftIds
        });
      }

      const leftName = normalizeName(left.truckName);
      const rightName = normalizeName(right.truckName);
      if (leftName && rightName) {
        if (leftName === rightName) {
          reasons.push({
            type: 'same_exact_name',
            detail: 'Drafts share the same normalized truck name.',
            sourceDraftIds,
            sourceFileIds
          });
          strongestReasonConfidence = Math.max(strongestReasonConfidence, 0.94);
        } else if (similarName(left.truckName, right.truckName)) {
          reasons.push({
            type: 'similar_name',
            detail: 'Draft truck names are similar but not exact matches.',
            sourceDraftIds,
            sourceFileIds
          });
          strongestReasonConfidence = Math.max(strongestReasonConfidence, 0.66);
        }
      }

      const leftPathTokens = sourceFolderTokensForDraft(left);
      const rightPathTokens = sourceFolderTokensForDraft(right);
      if (leftPathTokens.some((token) => rightPathTokens.includes(token))) {
        reasons.push({
          type: 'shared_file_context',
          detail: 'Drafts share folder or filename context from source paths.',
          sourceDraftIds,
          sourceFileIds
        });
        strongestReasonConfidence = Math.max(strongestReasonConfidence, 0.62);
      }

      const leftHasMenu = left.sourceFiles.some((item) => item.sourceType === 'menu');
      const rightHasMenu = right.sourceFiles.some((item) => item.sourceType === 'menu');
      const leftHasProfileLike = left.sourceFiles.some((item) => item.sourceType === 'screenshot');
      const rightHasProfileLike = right.sourceFiles.some((item) => item.sourceType === 'screenshot');
      if ((leftHasMenu && rightHasProfileLike) || (rightHasMenu && leftHasProfileLike)) {
        reasons.push({
          type: 'menu_profile_link',
          detail: 'One draft appears menu-focused while the other appears profile-focused.',
          sourceDraftIds,
          sourceFileIds
        });
        strongestReasonConfidence = Math.max(strongestReasonConfidence, 0.58);
      }

      if (reasons.length === 0 && conflicts.length === 0) continue;

      const hasStrongReason = reasons.some((reason) =>
        ['same_phone', 'same_email', 'same_website', 'same_social', 'same_exact_name'].includes(reason.type)
      );
      let recommendation: MealScoutMergeRecommendation = 'keep_separate';
      if (hasStrongReason && conflicts.length === 0) {
        recommendation = 'merge_recommended';
      } else if (reasons.length > 0 && conflicts.length === 0) {
        recommendation = 'possible_match';
      } else if (reasons.length > 0) {
        recommendation = 'keep_separate';
      }

      const confidence =
        recommendation === 'merge_recommended'
          ? Math.max(0.85, strongestReasonConfidence)
          : recommendation === 'possible_match'
            ? Math.max(0.5, Math.min(0.84, strongestReasonConfidence || 0.55))
            : Math.min(0.49, strongestReasonConfidence || 0.35);

      candidateGroups.push({
        groupId: `merge-${left.draftId}-${right.draftId}`,
        draftIds: sourceDraftIds,
        recommendation,
        confidence: Number(confidence.toFixed(2)),
        reasons,
        conflicts
      });
    }
  }

  return {
    candidateGroups: candidateGroups.sort((a, b) => b.confidence - a.confidence)
  };
}

export function createMealScoutBatch(): MealScoutCaptureBatch {
  const batch: MealScoutCaptureBatch = {
    id: `ms-batch-${randomUUID()}`,
    brand: 'mealscout',
    status: 'uploaded',
    uploadedFileCount: 0,
    processedFileCount: 0,
    createdAt: nowIso()
  };
  batches.set(batch.id, batch);
  return batch;
}

export function getMealScoutBatch(batchId: string): MealScoutCaptureBatch | undefined {
  return batches.get(batchId);
}

export function addMealScoutScreenshotEvidence(input: {
  batchId: string;
  fileName: string;
  imageStorageKey?: string;
  rawExtractedText?: string;
  extractedFacts?: Array<{ field: string; value: string; confidence?: number; evidenceText?: string }>;
  detectedEntityHints?: Record<string, string | undefined>;
}): { id: string; clusterId: string; draftId: string } {
  const batch = batches.get(input.batchId);
  if (!batch) throw new Error('Batch not found');

  const sourceFileId = `ms-evidence-${randomUUID()}`;
  const clusterId = `ms-cluster-${randomUUID()}`;

  const signal: MealScoutExtractedSignal = {
    sourceFileId,
    sourcePath: input.imageStorageKey || input.fileName,
    sourceType: 'screenshot'
  };

  const facts = input.extractedFacts || [];
  for (const fact of facts) {
    const value = fact.value;
    if (fact.field === 'truckName' || fact.field === 'businessName') signal.truckName = value;
    if (fact.field === 'phone') signal.phone = value;
    if (fact.field === 'email') signal.email = value;
    if (fact.field === 'cityArea' || fact.field === 'city' || fact.field === 'serviceArea') signal.cityArea = value;
    if (fact.field === 'cuisine' || fact.field === 'cuisineType') signal.cuisine = value;
    if (fact.field === 'website') signal.website = value;
    if (fact.field === 'facebook') {
      signal.socials = signal.socials || {};
      signal.socials.facebook = value;
    }
    if (fact.field === 'instagram') {
      signal.socials = signal.socials || {};
      signal.socials.instagram = value;
    }
    if (fact.field === 'menuItemName') {
      signal.menuItems = signal.menuItems || [];
      signal.menuItems.push({ name: value });
    }
  }

  evidenceById.set(sourceFileId, signal);
  const draft = buildMealScoutProfileDraft([signal], Array.from(existingProfiles.values()));
  drafts.set(draft.draftId, draft);
  clusterToDraftId.set(clusterId, draft.draftId);

  batch.uploadedFileCount += 1;
  batch.processedFileCount += 1;
  batch.status = 'needs_review';

  return { id: sourceFileId, clusterId, draftId: draft.draftId };
}

export function getMealScoutBatchDrafts(batchId: string): MealScoutProfileDraft[] {
  return Array.from(drafts.values()).filter((draft) => draft.draftId.includes('ms-draft-'));
}

export function getMealScoutDraft(draftId: string): MealScoutProfileDraft | undefined {
  return drafts.get(draftId);
}

export function getMealScoutDraftProposedChanges(draftId: string): {
  draftId: string;
  missingFields: string[];
  warnings: string[];
  duplicateCandidates: MealScoutDuplicateCandidate[];
  menu: MealScoutProfileDraft['menu'];
} | undefined {
  const draft = drafts.get(draftId);
  if (!draft) return undefined;
  return {
    draftId: draft.draftId,
    missingFields: draft.missingFields,
    warnings: draft.warnings,
    duplicateCandidates: draft.duplicateCandidates,
    menu: draft.menu
  };
}

export function getMealScoutClusterMatches(clusterId: string): {
  clusterId: string;
  classification: 'new_profile_candidate' | 'possible_existing_match';
  possibleMatches: Array<{ truckId: string; truckName?: string; confidence: number }>;
} | undefined {
  const draftId = clusterToDraftId.get(clusterId);
  if (!draftId) return undefined;
  const draft = drafts.get(draftId);
  if (!draft) return undefined;

  const possibleMatches = draft.duplicateCandidates.map((item) => ({
    truckId: item.existingProfileId,
    truckName: item.truckName,
    confidence: item.confidence
  }));

  return {
    clusterId,
    classification: possibleMatches.length > 0 ? 'possible_existing_match' : 'new_profile_candidate',
    possibleMatches
  };
}

export function linkClusterToExistingTruck(clusterId: string, truckId: string): MealScoutProfileDraft | undefined {
  const draftId = clusterToDraftId.get(clusterId);
  const profile = existingProfiles.get(truckId);
  if (!draftId || !profile) return undefined;
  const draft = drafts.get(draftId);
  if (!draft) return undefined;

  draft.duplicateCandidates = [
    {
      existingProfileId: profile.id,
      truckName: profile.truckName,
      reason: 'manually_linked',
      confidence: 1
    }
  ];
  draft.reviewStatus = resolveReviewStatus(draft.missingFields, draft.duplicateCandidates, draft.warnings);
  return draft;
}

export function createNewDraftFromCluster(clusterId: string): MealScoutProfileDraft | undefined {
  const draftId = clusterToDraftId.get(clusterId);
  if (!draftId) return undefined;
  return drafts.get(draftId);
}

export function moveEvidenceToCluster(_evidenceId: string, _clusterId: string): MealScoutProfileDraft | undefined {
  return undefined;
}

export function mergeDraftIntoCluster(_draftId: string, _fromClusterId: string): MealScoutProfileDraft | undefined {
  return undefined;
}

export function splitDraftByEvidence(_draftId: string, _evidenceId: string): MealScoutProfileDraft | undefined {
  return undefined;
}

export function approveMealScoutDraft(draftId: string, options?: { menuDeferred?: boolean }): MealScoutProfileDraft | undefined {
  const draft = drafts.get(draftId);
  if (!draft) return undefined;
  if (options?.menuDeferred !== undefined) {
    draft.menuDeferred = Boolean(options.menuDeferred);
    draft.missingFields = buildMissingFields(draft);
    draft.reviewStatus = resolveReviewStatus(draft.missingFields, draft.duplicateCandidates, draft.warnings);
  }
  return draft;
}

export function rejectMealScoutDraft(draftId: string): MealScoutProfileDraft | undefined {
  return drafts.get(draftId);
}

export function publishMealScoutDraft(_draftId: string): MealScoutProfileDraft | undefined {
  return undefined;
}

export function listMealScoutTrucks(): MealScoutExistingProfile[] {
  return Array.from(existingProfiles.values());
}

export function getMealScoutTruckById(id: string): MealScoutExistingProfile | undefined {
  return existingProfiles.get(id);
}

export function seedMealScoutTruck(input: Omit<MealScoutExistingProfile, 'id'>): MealScoutExistingProfile {
  const profile: MealScoutExistingProfile = {
    ...input,
    id: `ms-profile-${randomUUID()}`
  };
  existingProfiles.set(profile.id, profile);
  return profile;
}

export function createMealScoutProfileFromPlanRecord(record: MealScoutPublishPlanRecord): MealScoutExistingProfile {
  const profile: MealScoutExistingProfile = {
    id: `ms-profile-${randomUUID()}`,
    truckName: record.profileFields.truckName?.value,
    phone: record.profileFields.phone?.value,
    email: record.profileFields.email?.value,
    website: record.profileFields.website?.value,
    cityArea: record.profileFields.cityArea?.value,
    socials: {
      facebook: record.profileFields.facebook?.value,
      instagram: record.profileFields.instagram?.value
    },
    affiliate_attribution_email: record.sourceAttribution?.affiliate_attribution_email,
    affiliate_attribution_source: record.sourceAttribution?.affiliate_attribution_source,
    affiliate_attribution_folder: record.sourceAttribution?.affiliate_attribution_folder,
    affiliate_attribution_folder_path: record.sourceAttribution?.affiliate_attribution_folder_path,
    affiliate_attribution_warnings: record.sourceAttribution?.affiliate_attribution_warnings,
    email_verified: false,
    insurance_verified: false,
    claim_status: 'unclaimed'
  };
  existingProfiles.set(profile.id, profile);
  return profile;
}

export function updateMealScoutProfileFromPlanRecord(
  existingTruckId: string,
  record: MealScoutPublishPlanRecord
): MealScoutExistingProfile | undefined {
  const existing = existingProfiles.get(existingTruckId);
  if (!existing) return undefined;
  const next: MealScoutExistingProfile = {
    ...existing,
    truckName: record.profileFields.truckName?.value || existing.truckName,
    phone: record.profileFields.phone?.value || existing.phone,
    email: record.profileFields.email?.value || existing.email,
    website: record.profileFields.website?.value || existing.website,
    cityArea: record.profileFields.cityArea?.value || existing.cityArea,
    socials: {
      facebook: record.profileFields.facebook?.value || existing.socials?.facebook,
      instagram: record.profileFields.instagram?.value || existing.socials?.instagram
    },
    affiliate_attribution_email: record.sourceAttribution?.affiliate_attribution_email || existing.affiliate_attribution_email,
    affiliate_attribution_source: record.sourceAttribution?.affiliate_attribution_source || existing.affiliate_attribution_source,
    affiliate_attribution_folder: record.sourceAttribution?.affiliate_attribution_folder || existing.affiliate_attribution_folder,
    affiliate_attribution_folder_path: record.sourceAttribution?.affiliate_attribution_folder_path || existing.affiliate_attribution_folder_path,
    affiliate_attribution_warnings: record.sourceAttribution?.affiliate_attribution_warnings || existing.affiliate_attribution_warnings,
    email_verified: existing.email_verified === true ? true : false,
    insurance_verified: existing.insurance_verified === true ? true : false,
    claim_status: existing.claim_status || 'unclaimed'
  };
  existingProfiles.set(existingTruckId, next);
  return next;
}

export function resetMealScoutProfileImportForTest(): void {
  batches.clear();
  drafts.clear();
  clusterToDraftId.clear();
  evidenceById.clear();
  existingProfiles.clear();
}
