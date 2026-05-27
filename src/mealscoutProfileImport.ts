import { randomUUID } from 'node:crypto';
import type { MealScoutEvidenceCluster } from './mealscoutEvidenceClustering.js';

export type MealScoutExtractedSignal = {
  sourceFileId: string;
  sourcePath?: string;
  sourceType: 'screenshot' | 'menu' | 'logo' | 'unknown';
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
};

export type MealScoutDuplicateCandidate = {
  existingProfileId: string;
  truckName?: string;
  reason: string;
  confidence: number;
};

export type MealScoutProfileDraft = {
  draftId: string;
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
    sourceType: 'screenshot' | 'menu' | 'logo' | 'unknown';
  }>;
  missingFields: string[];
  warnings: string[];
  duplicateCandidates: MealScoutDuplicateCandidate[];
  confidence: number;
  reviewStatus: 'ready_for_review' | 'missing_required' | 'duplicate_possible' | 'uncertain_match';
  mutationAllowed: false;
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

function resolveReviewStatus(missingFields: string[], duplicateCandidates: MealScoutDuplicateCandidate[], warnings: string[]): MealScoutProfileDraft['reviewStatus'] {
  if (missingFields.length > 0) return 'missing_required';
  if (duplicateCandidates.length > 0) return 'duplicate_possible';
  if (warnings.some((item) => item.includes('uncertain'))) return 'uncertain_match';
  return 'ready_for_review';
}

export function buildMealScoutProfileDraft(
  signals: MealScoutExtractedSignal[],
  profiles: MealScoutExistingProfile[] = []
): MealScoutProfileDraft {
  const safeSignals = signals.filter((signal) => Boolean(signal?.sourceFileId));
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
    draftId: `ms-draft-${randomUUID()}`,
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
      sourceType: signal.sourceType
    })),
    missingFields: [],
    warnings: [],
    duplicateCandidates: [],
    confidence: scoreConfidence(safeSignals),
    reviewStatus: 'ready_for_review',
    mutationAllowed: false
  };

  draft.missingFields = buildMissingFields(draft);
  draft.duplicateCandidates = buildDuplicateCandidates(draft, profiles);

  if (safeSignals.some((signal) => signal.sourceType === 'unknown')) {
    draft.warnings.push('uncertain source type present');
  }
  if (draft.menu.length === 0 && !draft.menuDeferred) {
    draft.warnings.push('menu missing and not deferred');
  }

  draft.reviewStatus = resolveReviewStatus(draft.missingFields, draft.duplicateCandidates, draft.warnings);
  return draft;
}

export function buildMealScoutDraftsFromClusters(
  clusters: MealScoutEvidenceCluster[],
  profiles: MealScoutExistingProfile[] = []
): MealScoutProfileDraft[] {
  return clusters.map((cluster) => {
    const signals: MealScoutExtractedSignal[] = cluster.files.map((file) => ({
      sourceFileId: file.fileId,
      sourcePath: file.drivePath,
      sourceType:
        file.detectedType === 'menu'
          ? 'menu'
          : file.detectedType === 'logo'
            ? 'logo'
            : file.detectedType === 'unknown'
              ? 'unknown'
              : 'screenshot',
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
      website: file.extractedSignals.website
    }));
    const draft = buildMealScoutProfileDraft(signals, profiles);
    if (cluster.reviewStatus === 'uncertain_match' && draft.reviewStatus === 'ready_for_review') {
      draft.reviewStatus = 'uncertain_match';
      if (!draft.warnings.includes('uncertain cluster match')) {
        draft.warnings.push('uncertain cluster match');
      }
    }
    return draft;
  });
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

export function seedMealScoutTruck(input: Omit<MealScoutExistingProfile, 'id'>): MealScoutExistingProfile {
  const profile: MealScoutExistingProfile = {
    ...input,
    id: `ms-profile-${randomUUID()}`
  };
  existingProfiles.set(profile.id, profile);
  return profile;
}

export function resetMealScoutProfileImportForTest(): void {
  batches.clear();
  drafts.clear();
  clusterToDraftId.clear();
  evidenceById.clear();
  existingProfiles.clear();
}
