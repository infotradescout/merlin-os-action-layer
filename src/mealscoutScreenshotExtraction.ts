import {
  createMealScoutEvidenceFile,
  type MealScoutEvidenceFile,
  type MealScoutExtractedMenuItem
} from './mealscoutEvidenceClustering.js';
import { isMenuLikeTruckName } from './mealscoutTruckNameGuardrail.js';

export type MealScoutScreenshotInput = {
  fileId: string;
  fileName: string;
  drivePath?: string;
  sourceFolder?: string;
  sourceFolderId?: string;
  mimeType?: string;
  modifiedTime?: string;
  extractedText?: string;
  visualLabels?: string[];
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
    repId?: string;
    affiliate_attribution_email?: string;
    affiliate_attribution_source?: 'folder_email_token' | 'admin_unattributed';
    affiliate_attribution_folder?: string;
    affiliate_attribution_folder_path?: string;
    affiliate_attribution_warnings?: string[];
    needsAttributionReview?: boolean;
    sourceChannel?: 'drive_upload' | 'manual_upload' | 'admin_import';
    batchId?: string;
    capturedAt?: string;
  };
};

const CUISINE_KEYWORDS: Array<{ keyword: RegExp; value: string }> = [
  { keyword: /\bcajun\b/i, value: 'Cajun' },
  { keyword: /\bbbq\b|\bbarbecue\b/i, value: 'BBQ' },
  { keyword: /\bmexican\b|\btaco\b/i, value: 'Mexican' },
  { keyword: /\bfilipino\b/i, value: 'Filipino' },
  { keyword: /\bseafood\b/i, value: 'Seafood' },
  { keyword: /\bburger\b/i, value: 'Burgers' },
  { keyword: /\bitalian\b/i, value: 'Italian' },
  { keyword: /\bdessert\b|\bcake\b|\bcupcake\b|\bcookie\b|\bice\s*cream\b/i, value: 'Desserts' },
  { keyword: /\bcoffee\b|\bespresso\b|\blatte\b/i, value: 'Coffee' },
  { keyword: /\basian\b|\bsushi\b|\bramen\b/i, value: 'Asian' },
  { keyword: /\bpizza\b/i, value: 'Pizza' },
  { keyword: /\bfusion\b/i, value: 'Fusion' }
];

const WEEKDAY_PATTERN = /\b(mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)\b/i;

function uniqueStrings(values: Array<string | undefined>): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const trimmed = (value || '').trim();
    if (trimmed) out.add(trimmed);
  }
  return Array.from(out);
}

function extractPhone(text: string): string | undefined {
  const match = text.match(/(?:\+?1[\s.-]*)?\(?([2-9]\d{2})\)?[\s.-]*([2-9]\d{2})[\s.-]*(\d{4})/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function extractEmail(text: string): string | undefined {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : undefined;
}

function extractWebsite(text: string): string | undefined {
  const match = text.match(/https?:\/\/[^\s)]+|(?:www\.)[^\s)]+/i);
  return match ? match[0] : undefined;
}

function extractSocial(text: string): { facebook?: string; instagram?: string } {
  const instagramHandle = text.match(/instagram[:\s]*@([a-z0-9._]+)/i) || text.match(/@([a-z0-9._]{3,})/i);
  const facebookHandle = text.match(/facebook[:\s]*@?([a-z0-9._-]+)/i) || text.match(/facebook\.com\/([a-z0-9._-]+)/i);
  return {
    instagram: instagramHandle ? `@${instagramHandle[1].replace(/^@/, '')}` : undefined,
    facebook: facebookHandle ? facebookHandle[1].replace(/^@/, '') : undefined
  };
}

function extractCuisine(text: string): string | undefined {
  for (const rule of CUISINE_KEYWORDS) {
    if (rule.keyword.test(text)) return rule.value;
  }
  return undefined;
}

function looksLikeLocationPhrase(value: string): boolean {
  const safe = (value || '').trim();
  if (!safe) return false;
  if (/\b(authentic|fresh|homemade|delicious|best|family|owned|since)\b/i.test(safe)) return false;
  if (/\b(menu|special|deal|plate|combo|order)\b/i.test(safe)) return false;
  if (extractCuisine(safe)) return false;
  if (/\b(\d{1,6}\s+[a-z0-9.'-]+\s+(st|street|rd|road|ave|avenue|blvd|lane|ln|dr|drive)\b)/i.test(safe)) return true;
  if (/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*),\s*([A-Z]{2})\b/.test(safe)) return true;
  if (/\b(serving|located in|location|city|service area|based in)\b/i.test(safe)) return true;
  return false;
}

function extractCityArea(text: string): string | undefined {
  const marker = text.match(/\b(city|location|area|serving|service area)[:\s]+([^\n]+)/i);
  if (marker) {
    const candidate = marker[2].trim();
    if (looksLikeLocationPhrase(candidate)) return candidate;
  }
  const cityState = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s*,\s*([A-Z]{2})\b/);
  if (cityState) return `${cityState[1]}, ${cityState[2]}`;
  return undefined;
}

function cleanupTruckName(value: string): string {
  return value
    .replace(/[^a-z0-9 '&.-]/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractTruckName(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (line.length < 3 || line.length > 60) continue;
    if (!/[a-z]/i.test(line)) continue;
    const alphaCount = (line.match(/[a-z]/gi) || []).length;
    if (alphaCount < 3) continue;
    if (/[@]|https?:\/\/|www\.|^\$/.test(line)) continue;
    if (/\$?\s?\d{1,3}(?:\.\d{2})\b/.test(line)) continue;
    if (/phone|email|menu|hours|location|city|facebook|instagram|tiktok/i.test(line)) continue;
    const cleaned = cleanupTruckName(line.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '').trim());
    if (!cleaned) continue;
    if (isMenuLikeTruckName(cleaned)) continue;
    return cleaned;
  }
  return undefined;
}

function looksNoisyMenuLine(value: string): boolean {
  const safe = value.trim();
  if (!safe) return true;
  const alphaChars = (safe.match(/[a-z]/gi) || []).length;
  const symbolChars = (safe.match(/[^a-z0-9\s$.,'-]/gi) || []).length;
  if (alphaChars < 4) return true;
  if (symbolChars > Math.max(3, Math.floor(alphaChars * 0.35))) return true;
  return false;
}

function extractMenuItems(text: string): MealScoutExtractedMenuItem[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const out: MealScoutExtractedMenuItem[] = [];
  for (const line of lines) {
    const price = line.match(/(?:^|[\s-])(\$?\s?\d{1,3}(?:\.\d{2}))(?:\b|$)/);
    if (!price) continue;
    const priceValue = price[1].replace(/\s+/g, '');
    const name = line.replace(price[0], ' ').replace(/[-–:]+$/, '').trim();
    if (!name) continue;
    if (looksNoisyMenuLine(name)) continue;
    out.push({ name, price: priceValue.startsWith('$') ? priceValue : `$${priceValue}` });
  }
  return out;
}

function hasScheduleHints(text: string, labels: string[]): boolean {
  if (WEEKDAY_PATTERN.test(text)) return true;
  return labels.some((item) => /schedule|hours|calendar/i.test(item));
}

function labelsToHints(labels: string[]): { hasLogo?: boolean; hasMenuLayout?: boolean; hasHoursGrid?: boolean; hasSocialUi?: boolean } {
  const lower = labels.map((item) => item.toLowerCase());
  return {
    hasLogo: lower.some((item) => item.includes('logo') || item.includes('brand')),
    hasMenuLayout: lower.some((item) => item.includes('menu') || item.includes('food item') || item.includes('price')),
    hasHoursGrid: lower.some((item) => item.includes('hours') || item.includes('schedule') || item.includes('calendar')),
    hasSocialUi: lower.some((item) => item.includes('instagram') || item.includes('facebook') || item.includes('social'))
  };
}

export function parseMealScoutSignalsFromText(text: string, visualLabels: string[] = []): {
  extractedSignals: {
    truckName?: string;
    phone?: string;
    email?: string;
    website?: string;
    facebook?: string;
    instagram?: string;
    cityArea?: string;
    cuisine?: string;
    menuItems?: MealScoutExtractedMenuItem[];
  };
  scheduleHints: string[];
} {
  const safeText = text || '';
  const socials = extractSocial(safeText);
  const menuItems = extractMenuItems(safeText);
  const schedule = hasScheduleHints(safeText, visualLabels);

  const extractedSignals = {
    truckName: extractTruckName(safeText),
    phone: extractPhone(safeText),
    email: extractEmail(safeText),
    website: extractWebsite(safeText),
    facebook: socials.facebook,
    instagram: socials.instagram,
    cityArea: extractCityArea(safeText),
    cuisine: extractCuisine(safeText),
    menuItems: menuItems.length > 0 ? menuItems : undefined
  };

  return {
    extractedSignals,
    scheduleHints: schedule ? ['schedule_detected'] : []
  };
}

export function createMealScoutEvidenceFromScreenshotInput(input: MealScoutScreenshotInput): MealScoutEvidenceFile {
  const visualLabels = uniqueStrings(input.visualLabels || []);
  const parsed = parseMealScoutSignalsFromText(input.extractedText || '', visualLabels);
  const hints = labelsToHints(visualLabels);

  return createMealScoutEvidenceFile({
    fileId: input.fileId,
    fileName: input.fileName,
    drivePath: input.drivePath || input.fileName,
    sourceFolder: input.sourceFolder || '',
    extractedSignals: parsed.extractedSignals,
    rawExtractedText: input.extractedText,
    visualHints: hints,
    sourceFileAttribution: input.sourceFileAttribution
  });
}
