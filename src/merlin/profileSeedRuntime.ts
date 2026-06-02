import { randomUUID } from 'node:crypto';
import { createMealScoutEvidenceFromScreenshotInput, type MealScoutScreenshotInput } from '../mealscoutScreenshotExtraction.js';
import { createMealScoutProfileFromPlanRecord, updateMealScoutProfileFromPlanRecord, listMealScoutTrucks } from '../mealscoutProfileImport.js';
import type { MealScoutPublishPlanRecord } from '../mealscoutPublishPlan.js';
import { upsertAffiliateTrackingLedgerRow } from '../mealscoutAffiliateTrackingLedger.js';
import { sendProductVerificationEmail } from '../productVerificationEmail.js';

export type MerlinProfileSeedBrand = 'MEALSCOUT' | 'TRADESCOUT';
export type MerlinSeedStatus = 'seeded' | 'blocked';

export type MerlinExistingScreenshotSeedInput = MealScoutScreenshotInput & {
  sourceFileAttribution?: MealScoutScreenshotInput['sourceFileAttribution'];
};

export type TradeScoutSeededProfile = {
  id: string;
  businessName?: string;
  phone?: string;
  email?: string;
  serviceArea?: string;
  claim_status: 'unclaimed';
  email_verified: false;
  insurance_verified: false;
  affiliate_attribution_email?: string;
  affiliate_attribution_source?: 'folder_email_token';
  affiliate_attribution_folder?: string;
  affiliate_attribution_folder_path?: string;
  sourceFileIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type VerificationEmailRecord = {
  id: string;
  brand_lane: MerlinProfileSeedBrand;
  profile_id: string;
  profile_type: 'food_truck' | 'contractor_business';
  profile_name?: string;
  recipient_email: string;
  status: 'sent' | 'failed';
  sent_at?: string;
  attempted_at: string;
  failure_reason?: string;
  provider_message_id?: string;
  source_file_id: string;
};

export type MerlinProfileSeedResult = {
  seedId: string;
  brand_lane?: MerlinProfileSeedBrand;
  sourceFileId: string;
  sourceFileName: string;
  seed_status: MerlinSeedStatus;
  profile_action?: 'create' | 'update';
  target_profile_id?: string;
  target_profile_type?: 'food_truck' | 'contractor_business';
  profile_name?: string;
  profile_email?: string;
  verification_email_status: 'sent' | 'failed' | 'not_available' | 'blocked';
  blockedReason?: string;
  mutationAllowed: boolean;
};

const tradeScoutProfiles = new Map<string, TradeScoutSeededProfile>();
const verificationEmails: VerificationEmailRecord[] = [];

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeEmail(value: string | undefined): string {
  return (value || '').trim().toLowerCase();
}

function normalizePhone(value: string | undefined): string {
  return (value || '').replace(/[^0-9]/g, '');
}

function isEmail(value: string | undefined): boolean {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test((value || '').trim());
}

function detectBrandFromEvidence(input: MerlinExistingScreenshotSeedInput): MerlinProfileSeedBrand | undefined {
  const text = `${input.extractedText || ''} ${(input.visualLabels || []).join(' ')}`.toLowerCase();
  const mealSignals = [
    'food truck',
    'menu',
    'cuisine',
    'taco',
    'burger',
    'bbq',
    'plate',
    'pop up',
    'schedule'
  ].filter((signal) => text.includes(signal)).length;
  const tradeSignals = [
    'contractor',
    'license',
    'insurance',
    'estimate',
    'invoice',
    'roofing',
    'plumbing',
    'hvac',
    'electrician',
    'landscaping'
  ].filter((signal) => text.includes(signal)).length;
  if (mealSignals > 0 && tradeSignals === 0) return 'MEALSCOUT';
  if (tradeSignals > 0 && mealSignals === 0) return 'TRADESCOUT';
  return undefined;
}

function extractLineValue(text: string, labels: string[]): string | undefined {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const lower = line.toLowerCase();
    for (const label of labels) {
      if (lower.startsWith(`${label}:`)) return line.slice(line.indexOf(':') + 1).trim();
    }
  }
  return undefined;
}

function extractEmail(text: string): string | undefined {
  return text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
}

function extractPhone(text: string): string | undefined {
  return text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0];
}

function extractTradeScoutBusinessName(text: string): string | undefined {
  return extractLineValue(text, ['business', 'contractor', 'company', 'name']) || text.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function findExistingTradeScoutProfile(input: { email?: string; phone?: string; businessName?: string }): TradeScoutSeededProfile | undefined {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const name = (input.businessName || '').trim().toLowerCase();
  return Array.from(tradeScoutProfiles.values()).find((profile) => {
    if (email && normalizeEmail(profile.email) === email) return true;
    if (phone && normalizePhone(profile.phone) === phone) return true;
    return Boolean(name && profile.businessName?.trim().toLowerCase() === name);
  });
}

function findExistingMealScoutProfile(input: { email?: string; phone?: string; truckName?: string }) {
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const name = (input.truckName || '').trim().toLowerCase();
  return listMealScoutTrucks().find((profile) => {
    if (email && normalizeEmail(profile.email) === email) return true;
    if (phone && normalizePhone(profile.phone) === phone) return true;
    return Boolean(name && profile.truckName?.trim().toLowerCase() === name);
  });
}

async function recordVerificationEmail(input: {
  brand: MerlinProfileSeedBrand;
  profileId: string;
  profileType: 'food_truck' | 'contractor_business';
  profileName?: string;
  email?: string;
  sourceFileId: string;
}): Promise<'sent' | 'failed' | 'not_available'> {
  const email = normalizeEmail(input.email);
  if (!isEmail(email)) return 'not_available';
  const attemptedAt = nowIso();
  const sendResult = await sendProductVerificationEmail({
    brand: input.brand,
    profileId: input.profileId,
    profileType: input.profileType,
    profileName: input.profileName,
    recipientEmail: email,
    sourceFileId: input.sourceFileId,
    source: 'screenshot_profile_seed'
  });
  verificationEmails.push({
    id: `verification-email-${randomUUID()}`,
    brand_lane: input.brand,
    profile_id: input.profileId,
    profile_type: input.profileType,
    profile_name: input.profileName,
    recipient_email: email,
    status: sendResult.status,
    sent_at: sendResult.status === 'sent' ? attemptedAt : undefined,
    attempted_at: attemptedAt,
    failure_reason: sendResult.status === 'failed' ? sendResult.failureReason : undefined,
    provider_message_id: sendResult.status === 'sent' ? sendResult.providerMessageId : undefined,
    source_file_id: input.sourceFileId
  });
  return sendResult.status;
}

function sourceAttribution(input: MerlinExistingScreenshotSeedInput): NonNullable<MealScoutScreenshotInput['sourceFileAttribution']> | undefined {
  return input.sourceFileAttribution;
}

function upsertLedgerForSeed(input: {
  seedId: string;
  brand: MerlinProfileSeedBrand | 'UNKNOWN';
  source: MerlinExistingScreenshotSeedInput;
  targetProfileId?: string;
  targetProfileType: 'food_truck' | 'contractor_business';
  profileAction?: string;
  profileName?: string;
  profileEmail?: string;
  verificationEmailStatus: string;
  seedStatus: string;
}): void {
  const attribution = sourceAttribution(input.source);
  const affiliateEmail = attribution?.affiliate_attribution_email;
  if (!affiliateEmail) return;
  upsertAffiliateTrackingLedgerRow({
    affiliate_attribution_email: affiliateEmail,
    affiliate_source_folder_id: input.source.sourceFolderId || '',
    affiliate_source_folder_name: attribution?.affiliate_attribution_folder || affiliateEmail,
    attribution_method: attribution?.affiliate_attribution_source || 'folder_email_token',
    attribution_confidence: '1',
    submitted_by_staff: attribution?.sourceChannel === 'admin_import' ? 'true' : 'false',
    staff_placed_in_affiliate_folder: attribution?.sourceChannel === 'admin_import' ? 'true' : 'false',
    brand_lane: input.brand,
    source_file_id: input.source.fileId,
    source_file_name: input.source.fileName,
    source_file_path: input.source.drivePath || '',
    profile_seed_id: input.seedId,
    target_profile_id: input.targetProfileId || '',
    target_profile_type: input.targetProfileType,
    profile_action: input.profileAction || '',
    profile_name: input.profileName || '',
    profile_email: input.profileEmail || '',
    verification_email_status: input.verificationEmailStatus,
    seed_status: input.seedStatus,
    audit_notes:
      'folder email is affiliate attribution only; profile_email comes from screenshot evidence; no verified flags changed'
  });
}

function blockedResult(input: {
  source: MerlinExistingScreenshotSeedInput;
  brand?: MerlinProfileSeedBrand;
  reason: string;
}): MerlinProfileSeedResult {
  const seedId = `profile-seed-${randomUUID()}`;
  upsertLedgerForSeed({
    seedId,
    brand: input.brand || 'UNKNOWN',
    source: input.source,
    targetProfileType: input.brand === 'TRADESCOUT' ? 'contractor_business' : 'food_truck',
    profileAction: 'blocked',
    verificationEmailStatus: 'blocked',
    seedStatus: 'blocked'
  });
  return {
    seedId,
    brand_lane: input.brand,
    sourceFileId: input.source.fileId,
    sourceFileName: input.source.fileName,
    seed_status: 'blocked',
    verification_email_status: 'blocked',
    blockedReason: input.reason,
    mutationAllowed: false
  };
}

async function seedMealScout(input: MerlinExistingScreenshotSeedInput): Promise<MerlinProfileSeedResult> {
  const evidence = createMealScoutEvidenceFromScreenshotInput(input);
  const signals = evidence.extractedSignals;
  if (!signals.truckName || !(signals.phone || signals.email || signals.website || signals.facebook || signals.instagram)) {
    return blockedResult({ source: input, brand: 'MEALSCOUT', reason: 'missing_required_identity' });
  }
  const seedId = `profile-seed-${randomUUID()}`;
  const existing = findExistingMealScoutProfile({
    email: signals.email,
    phone: signals.phone,
    truckName: signals.truckName
  });
  const record: MealScoutPublishPlanRecord = {
    recordId: seedId,
    plannedAction: existing ? 'update_existing' : 'create_new',
    publishReady: true,
    draftIds: [seedId],
    existingTruckId: existing?.id,
    profileFields: {
      truckName: { value: signals.truckName, evidenceRefs: [input.fileName], sourceFileIds: [input.fileId] }
    },
    menuItems: [],
    sourceAttribution: {
      contributingRepIds: [],
      sourceFileIds: [input.fileId],
      attributionPolicy: 'folder_email_token_profile_seed',
      affiliate_attribution_email: input.sourceFileAttribution?.affiliate_attribution_email,
      affiliate_attribution_source: input.sourceFileAttribution?.affiliate_attribution_source,
      affiliate_attribution_folder: input.sourceFileAttribution?.affiliate_attribution_folder,
      affiliate_attribution_folder_path: input.sourceFileAttribution?.affiliate_attribution_folder_path,
      affiliate_attribution_warnings: input.sourceFileAttribution?.affiliate_attribution_warnings
    }
  };
  if (signals.phone) record.profileFields.phone = { value: signals.phone, evidenceRefs: [input.fileName], sourceFileIds: [input.fileId] };
  if (signals.email) record.profileFields.email = { value: signals.email, evidenceRefs: [input.fileName], sourceFileIds: [input.fileId] };
  if (signals.website) record.profileFields.website = { value: signals.website, evidenceRefs: [input.fileName], sourceFileIds: [input.fileId] };
  if (signals.cityArea) record.profileFields.cityArea = { value: signals.cityArea, evidenceRefs: [input.fileName], sourceFileIds: [input.fileId] };
  if (signals.facebook) record.profileFields.facebook = { value: signals.facebook, evidenceRefs: [input.fileName], sourceFileIds: [input.fileId] };
  if (signals.instagram) record.profileFields.instagram = { value: signals.instagram, evidenceRefs: [input.fileName], sourceFileIds: [input.fileId] };

  const profile = existing
    ? updateMealScoutProfileFromPlanRecord(existing.id, record) || existing
    : createMealScoutProfileFromPlanRecord(record);
  const verificationStatus = await recordVerificationEmail({
    brand: 'MEALSCOUT',
    profileId: profile.id,
    profileType: 'food_truck',
    profileName: profile.truckName,
    email: signals.email,
    sourceFileId: input.fileId
  });
  upsertLedgerForSeed({
    seedId,
    brand: 'MEALSCOUT',
    source: input,
    targetProfileId: profile.id,
    targetProfileType: 'food_truck',
    profileAction: existing ? 'update' : 'create',
    profileName: profile.truckName,
    profileEmail: profile.email,
    verificationEmailStatus: verificationStatus,
    seedStatus: 'seeded'
  });
  return {
    seedId,
    brand_lane: 'MEALSCOUT',
    sourceFileId: input.fileId,
    sourceFileName: input.fileName,
    seed_status: 'seeded',
    profile_action: existing ? 'update' : 'create',
    target_profile_id: profile.id,
    target_profile_type: 'food_truck',
    profile_name: profile.truckName,
    profile_email: profile.email,
    verification_email_status: verificationStatus,
    mutationAllowed: true
  };
}

async function seedTradeScout(input: MerlinExistingScreenshotSeedInput): Promise<MerlinProfileSeedResult> {
  const text = input.extractedText || '';
  const businessName = extractTradeScoutBusinessName(text);
  const email = extractEmail(text);
  const phone = extractPhone(text);
  if (!businessName || !(email || phone)) {
    return blockedResult({ source: input, brand: 'TRADESCOUT', reason: 'missing_required_identity' });
  }
  const seedId = `profile-seed-${randomUUID()}`;
  const existing = findExistingTradeScoutProfile({ businessName, email, phone });
  const now = nowIso();
  const profile: TradeScoutSeededProfile = existing
    ? {
        ...existing,
        businessName: businessName || existing.businessName,
        email: email || existing.email,
        phone: phone || existing.phone,
        sourceFileIds: Array.from(new Set([...existing.sourceFileIds, input.fileId])),
        updatedAt: now
      }
    : {
        id: `ts-profile-${randomUUID()}`,
        businessName,
        email,
        phone,
        claim_status: 'unclaimed',
        email_verified: false,
        insurance_verified: false,
        affiliate_attribution_email: input.sourceFileAttribution?.affiliate_attribution_email,
        affiliate_attribution_source: input.sourceFileAttribution?.affiliate_attribution_source,
        affiliate_attribution_folder: input.sourceFileAttribution?.affiliate_attribution_folder,
        affiliate_attribution_folder_path: input.sourceFileAttribution?.affiliate_attribution_folder_path,
        sourceFileIds: [input.fileId],
        createdAt: now,
        updatedAt: now
      };
  tradeScoutProfiles.set(profile.id, profile);
  const verificationStatus = await recordVerificationEmail({
    brand: 'TRADESCOUT',
    profileId: profile.id,
    profileType: 'contractor_business',
    profileName: profile.businessName,
    email,
    sourceFileId: input.fileId
  });
  upsertLedgerForSeed({
    seedId,
    brand: 'TRADESCOUT',
    source: input,
    targetProfileId: profile.id,
    targetProfileType: 'contractor_business',
    profileAction: existing ? 'update' : 'create',
    profileName: profile.businessName,
    profileEmail: profile.email,
    verificationEmailStatus: verificationStatus,
    seedStatus: 'seeded'
  });
  return {
    seedId,
    brand_lane: 'TRADESCOUT',
    sourceFileId: input.fileId,
    sourceFileName: input.fileName,
    seed_status: 'seeded',
    profile_action: existing ? 'update' : 'create',
    target_profile_id: profile.id,
    target_profile_type: 'contractor_business',
    profile_name: profile.businessName,
    profile_email: profile.email,
    verification_email_status: verificationStatus,
    mutationAllowed: true
  };
}

export async function processExistingScreenshotsIntoSeededProfiles(input: {
  screenshots: MerlinExistingScreenshotSeedInput[];
}): Promise<{ status: 'ok'; mutationAllowed: boolean; results: MerlinProfileSeedResult[]; verificationEmails: VerificationEmailRecord[] }> {
  const results = await Promise.all(input.screenshots.map((screenshot) => {
    const brand = detectBrandFromEvidence(screenshot);
    if (!brand) {
      return blockedResult({ source: screenshot, reason: 'ambiguous_or_unsupported_brand' });
    }
    return brand === 'MEALSCOUT' ? seedMealScout(screenshot) : seedTradeScout(screenshot);
  }));
  return {
    status: 'ok',
    mutationAllowed: results.some((result) => result.mutationAllowed),
    results,
    verificationEmails: [...verificationEmails]
  };
}

export function listTradeScoutSeededProfiles(): TradeScoutSeededProfile[] {
  return Array.from(tradeScoutProfiles.values());
}

export function listVerificationEmailRecords(): VerificationEmailRecord[] {
  return [...verificationEmails];
}

export function resetMerlinProfileSeedRuntimeForTest(): void {
  tradeScoutProfiles.clear();
  verificationEmails.length = 0;
}
