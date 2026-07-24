import type { UploadIntentFileRef } from './intake/intakeTypes.js';
import {
  createUniversalProductUpdatePacket,
  type MerlinPacketEvidenceReference,
  type MealScoutAccountIntakeType
} from './intake/universalProductUpdatePacket.js';

export type MerlinThreadIntentInference = {
  brand?: 'MEALSCOUT';
  actorScope?: 'owner' | 'staff' | 'admin';
  entityType?: 'food_truck' | 'restaurant' | 'host_location' | 'unknown';
  actionId?: string;
  userHint?: string;
  reasons: string[];
};

function normalizeText(value: string | undefined): string {
  return String(value || '').trim();
}

function combinedThreadText(messageText: string, files: UploadIntentFileRef[]): string {
  return [messageText, ...files.map((file) => file.extractedText || '' )].filter(Boolean).join('\n').trim();
}

export function inferMerlinThreadIntent(input: {
  messageText: string;
  files: UploadIntentFileRef[];
  brand?: string;
  actorScope?: string;
  entityType?: string;
  actionId?: string;
}): MerlinThreadIntentInference {
  const reasons: string[] = [];
  const text = combinedThreadText(input.messageText, input.files).toLowerCase();

  if ((input.brand || '').toUpperCase() === 'MEALSCOUT' || /mealscout|food truck|restaurant|menu|logo|schedule|account/.test(text)) {
    reasons.push('brand_mealscout_detected');
  }

  const explicitActionId = normalizeText(input.actionId);
  if (explicitActionId) {
    return {
      brand: 'MEALSCOUT',
      actorScope: (normalizeText(input.actorScope).toLowerCase() as MerlinThreadIntentInference['actorScope']) || 'owner',
      entityType: (normalizeText(input.entityType).toLowerCase() as MerlinThreadIntentInference['entityType']) || 'unknown',
      actionId: explicitActionId,
      userHint: normalizeText(input.messageText) || undefined,
      reasons: reasons.concat('explicit_action_id_supplied')
    };
  }

  const accountFirst = /account|business info|contact info|location|service area|process accounts first|account intake|profile facts/.test(text);
  const skipMenus = /\bskip menus?\b/.test(text);
  const skipLogos = /\bskip logos?\b/.test(text);
  const scheduleIntent = /schedule|hours|open|closed|event/.test(text);
  const menuIntent = /menu|prices|specials|combo/.test(text);
  const logoIntent = /logo|brand image|avatar/.test(text);
  const photoIntent = /photo|gallery|pictures|images/.test(text);

  if (accountFirst && (skipMenus || skipLogos || /review/.test(text))) {
    reasons.push('account_first_language_detected');
    return {
      brand: 'MEALSCOUT',
      actorScope: 'staff',
      entityType: /restaurant/.test(text) ? 'restaurant' : /host location/.test(text) ? 'host_location' : 'food_truck',
      actionId: 'account_intake_review',
      userHint: normalizeText(input.messageText) || 'Process account facts first',
      reasons
    };
  }

  if (menuIntent) {
    reasons.push('menu_language_detected');
    return {
      brand: 'MEALSCOUT',
      actorScope: 'owner',
      entityType: /restaurant/.test(text) ? 'restaurant' : 'food_truck',
      actionId: 'update_menu',
      userHint: normalizeText(input.messageText) || 'Update menu',
      reasons
    };
  }

  if (scheduleIntent) {
    reasons.push('schedule_language_detected');
    return {
      brand: 'MEALSCOUT',
      actorScope: 'owner',
      entityType: /restaurant/.test(text) ? 'restaurant' : 'food_truck',
      actionId: 'update_schedule',
      userHint: normalizeText(input.messageText) || 'Update schedule',
      reasons
    };
  }

  if (logoIntent) {
    reasons.push('logo_language_detected');
    return {
      brand: 'MEALSCOUT',
      actorScope: 'owner',
      entityType: /restaurant/.test(text) ? 'restaurant' : 'food_truck',
      actionId: 'upload_logo',
      userHint: normalizeText(input.messageText) || 'Upload logo',
      reasons
    };
  }

  if (photoIntent) {
    reasons.push('photo_language_detected');
    return {
      brand: 'MEALSCOUT',
      actorScope: 'owner',
      entityType: /restaurant/.test(text) ? 'restaurant' : 'food_truck',
      actionId: 'add_food_photos',
      userHint: normalizeText(input.messageText) || 'Add food photos',
      reasons
    };
  }

  return {
    brand: 'MEALSCOUT',
    actorScope: 'staff',
    entityType: 'unknown',
    actionId: 'attach_menu_evidence',
    userHint: normalizeText(input.messageText) || undefined,
    reasons: reasons.concat('fallback_attach_evidence')
  };
}

function extractBusinessName(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (/food truck|restaurant|phone|email|www\.|http|address|service area/i.test(line)) continue;
    if (/[a-z]/i.test(line) && line.length >= 3 && line.length <= 80) {
      return line.replace(/\s{2,}/g, ' ');
    }
  }
  return undefined;
}

function extractPhone(text: string): string | undefined {
  const match = text.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/);
  return match?.[0]?.trim();
}

function extractEmail(text: string): string | undefined {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim().toLowerCase();
}

function extractWebsite(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s]+|www\.[^\s]+/i);
  return match?.[0]?.trim();
}

function extractServiceArea(text: string): string | undefined {
  const match = text.match(/service area[:\s-]+([^\n\r]+)/i);
  return match?.[1]?.trim();
}

function extractAddressBlock(text: string): { address?: string; city?: string; state?: string; postalCode?: string } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const cityStateZip = line.match(/^([A-Za-z .'-]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
    if (cityStateZip) {
      return {
        address: lines[i - 1] && /\d+/.test(lines[i - 1]) ? lines[i - 1] : undefined,
        city: cityStateZip[1].trim(),
        state: cityStateZip[2].trim(),
        postalCode: cityStateZip[3].trim()
      };
    }
  }
  return {};
}

function inferAccountType(text: string): MealScoutAccountIntakeType {
  if (/food truck/.test(text)) return 'food_truck';
  if (/restaurant/.test(text)) return 'restaurant';
  if (/host location/.test(text)) return 'host_location';
  return 'other';
}

function inferCuisineType(text: string): string | undefined {
  const match = text.match(/cuisine[:\s-]+([^\n\r]+)/i);
  return match?.[1]?.trim();
}

function buildEvidenceReferences(files: UploadIntentFileRef[]): MerlinPacketEvidenceReference[] {
  return files.map((file) => ({
    sourceFileName: file.fileName || file.fileId,
    sourceMimeType: file.mimeType || 'application/octet-stream',
    sourceReference: `thread:${file.fileId}`,
    sourceFolderReference: typeof file.driveFolderId === 'string' ? `drive-folder:${file.driveFolderId}` : undefined
  }));
}

export function buildAccountIntakePacketFromThread(input: {
  files: UploadIntentFileRef[];
  actorScope: 'owner' | 'staff' | 'admin';
  entityId?: string;
  businessNameHint?: string;
}): unknown | undefined {
  const text = input.files.map((file) => file.extractedText || '').filter(Boolean).join('\n').trim();
  if (!text) return undefined;
  const businessName = input.businessNameHint || extractBusinessName(text);
  if (!businessName) return undefined;

  const phone = extractPhone(text);
  const email = extractEmail(text);
  const website = extractWebsite(text);
  const serviceArea = extractServiceArea(text);
  const addressBlock = extractAddressBlock(text);
  const evidenceReferences = buildEvidenceReferences(input.files);

  return createUniversalProductUpdatePacket({
    sourceActor: {
      actorScope: input.actorScope,
      actorId: 'merlin-thread-parser',
      actorLabel: 'Merlin Thread Parser'
    },
    targetProduct: 'MealScout',
    targetBusinessName: businessName,
    targetProfileId: input.entityId || undefined,
    targetResolutionStatus: input.entityId ? 'resolved_exact_target_id' : 'resolved_name_only',
    updateType: 'account_intake',
    evidenceReferences,
    confidence: 0.72,
    accountIntake: {
      accountType: inferAccountType(text),
      cuisineType: inferCuisineType(text),
      phone,
      email,
      website,
      address: addressBlock.address,
      city: addressBlock.city,
      state: addressBlock.state,
      postalCode: addressBlock.postalCode,
      serviceArea,
      requiredNextStep: 'Operator review before any future account creation',
      safetyFlags: ['operator_review_required', 'thread_intent_inferred']
    }
  });
}
