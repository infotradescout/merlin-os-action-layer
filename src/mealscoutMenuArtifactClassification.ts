import { parseCsvRows, toCsv, type MealScoutScreenshotProcessingSourceRow } from './mealscoutScreenshotProcessingValidation.js';

export type MealScoutArtifactType = 'profile' | 'menu' | 'possible_menu' | 'schedule' | 'logo' | 'post' | 'contact' | 'review' | 'unknown';

export type MealScoutMenuItemCandidate = {
  item_name: string;
  item_description?: string;
  price?: string;
  category?: string;
  raw_ocr_lines: string[];
  confidence: number;
  extraction_warnings: string[];
};

export type MealScoutArtifactClassificationRow = {
  source_drive_file_id: string;
  source_drive_url?: string;
  source_final_filename: string;
  source_row_number: number;
  drive_file_id: string;
  drive_url?: string;
  final_filename: string;
  filename_before_final_pass?: string;
  raw_ocr_snippet: string;
  artifact_type: MealScoutArtifactType;
  artifact_signals: string[];
  business_name_candidate?: string;
  linked_business_candidate?: string;
  menu_items: MealScoutMenuItemCandidate[];
  confidence: number;
  warnings: string[];
  phone?: string;
  email?: string;
  website?: string;
  social?: string;
};

export type MealScoutMenuDuplicateGroup = {
  duplicate_group_id: string;
  group_key: string;
  linked_business_candidate: string;
  evidence_drive_file_ids: string[];
  artifact_types: MealScoutArtifactType[];
  phones: string[];
  emails: string[];
  websites: string[];
  final_filenames: string[];
};

export type MealScoutMenuArtifactClassificationResult = {
  status: 'ok';
  mode: 'artifact_classification_export_only';
  mutationAllowed: false;
  source: {
    title: 'MealScout Screenshot Processing Final Sheet 2026-06-09';
    evidenceRowCount: number;
    uniqueEvidenceRowCount: number;
  };
  artifactRows: MealScoutArtifactClassificationRow[];
  menuCandidates: MealScoutArtifactClassificationRow[];
  menuReviewRequired: MealScoutArtifactClassificationRow[];
  duplicateEvidenceGroups: MealScoutMenuDuplicateGroup[];
  summary: {
    totalRows: number;
    profileCount: number;
    menuCount: number;
    possibleMenuCount: number;
    scheduleCount: number;
    logoCount: number;
    postCount: number;
    contactCount: number;
    reviewCount: number;
    unknownCount: number;
    menuCandidateCount: number;
    menuReviewRequiredCount: number;
    duplicateGroupCount: number;
    mutationAllowed: false;
    examples: string[];
  };
};

const PRICE_PATTERN = /(?:\$\s?\d{1,3}(?:\.\d{2})?|\b\d{1,3}\.\d{2}\b|\b\d{1,3}(?=\s*$))/;
const MENU_HEADING_PATTERN = /\b(menu|specials?|combos?|plates?|entrees?|sides?|drinks?|desserts?|breakfast|lunch|dinner)\b/i;
const FOOD_TERMS = [
  'taco',
  'tacos',
  'burger',
  'burgers',
  'bbq',
  'barbecue',
  'wings',
  'plate',
  'plates',
  'combo',
  'combos',
  'side',
  'sides',
  'drink',
  'drinks',
  'dessert',
  'desserts',
  'shake',
  'shakes',
  'coffee',
  'lemonade',
  'birria',
  'empanada',
  'empanadas',
  'ramen',
  'pizza',
  'burrito',
  'burritos',
  'brisket',
  'ribs',
  'pulled pork',
  'fries',
  'sandwich',
  'sandwiches',
  'chicken',
  'fish',
  'shrimp',
  'oreo',
  'oreos',
  'pretzel',
  'pancake'
];
const PROFILE_PATTERN = /\b(followers?|following|posts about photos|all photos|details|page -|recommend|reviews?|contact info)\b/i;
const SCHEDULE_PATTERN = /\b(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hours?|schedule|open|closed|location varies|mobile and our location varies)\b/i;
const LOGO_PATTERN = /\b(logo|profile picture|updated their profile|cover photo)\b/i;
const POST_PATTERN = /\b(pinned|posted|comment|like|share|see more|is at|updated their status)\b/i;
const CONTACT_PATTERN = /\b(contact info|phone|email|gmail|yahoo|outlook|instagram|facebook|www\.|https?:\/\/)\b/i;
const REVIEW_PATTERN = /\b(reviews?|recommend|rating|not yet rated)\b/i;

const GENERIC_NAME_PATTERNS = [
  /^follow @ message$/i,
  /^a & gs & @$/i,
  /^catering$/i,
  /^add a comment$/i,
  /^are mobile and our location varies\.?$/i,
  /^pace,\s*fl and servicing surrounding areas\.?$/i,
  /^food truck\s*,\s*trailer for sale and/i,
  /^panama city downtown,\s*fl/i,
  /^page - /i,
  /^contact info$/i,
  /^all posts$/i,
  /^all photos/i,
  /^menu$/i,
  /^specials?$/i,
  /^combos?$/i,
  /^plates?$/i,
  /^sides?$/i,
  /^drinks?$/i,
  /^desserts?$/i,
  /\b(street|avenue|ave|road|rd|blvd|drive|dr|hwy|highway)\b/i,
  /\b[A-Z][a-z]+,\s*(FL|AL|MS|LA|GA|TX|TN)\b/
];

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stripExtension(value: string): string {
  return value.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(llc|inc|co|company|food truck|restaurant|cafe|truck|catering)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function cleanBusinessName(value: string): string {
  return value
    .replace(/^[<€?*\s]+/, '')
    .replace(/\s*(?:[~\-–]+|«\+?|\+)?\s*(?:Q|OQ|QQ)\s*$/i, '')
    .replace(/\s+eee\s*$/i, '')
    .replace(/[\\/:*?"<>|#%{}~]/g, ' ')
    .replace(/[«»€©®™✓]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericBusinessName(value: string): boolean {
  const safe = cleanBusinessName(value);
  if (safe.length < 3) return true;
  if ((safe.match(/[a-z]/gi) || []).length < 3) return true;
  if (/^\d+$/.test(safe)) return true;
  return GENERIC_NAME_PATTERNS.some((pattern) => pattern.test(safe));
}

function contactFields(text: string): { phone?: string; email?: string; website?: string; social?: string } {
  const phone = text.match(/(?:\+?1[\s.-]*)?\(?([2-9]\d{2})\)?[\s.-]*([2-9]\d{2})[\s.-]*(\d{4})/);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const website = text.match(/https?:\/\/[^\s)]+|(?:www\.)[^\s)]+|(?:^|[^@a-z0-9.-])([a-z0-9.-]+\.(?:com|net|org|co|biz)\b[^\s)]*)/i);
  const social = text.match(/(?:instagram|facebook|tiktok)(?:\.com\/|[:\s]+@?)([a-z0-9._-]+)/i) || text.match(/@([a-z0-9._]{3,})/i);
  return {
    phone: phone ? `${phone[1]}-${phone[2]}-${phone[3]}` : undefined,
    email: email?.[0],
    website: website?.[1] || website?.[0],
    social: social ? `@${social[1].replace(/^@/, '')}` : undefined
  };
}

function foodTermCount(text: string): number {
  const lower = text.toLowerCase();
  return FOOD_TERMS.filter((term) => lower.includes(term)).length;
}

function foodLineCount(lines: string[]): number {
  return lines.filter((line) => foodTermCount(line) > 0 && !/\b(food truck|restaurant|catering service|dessert shop|page -)\b/i.test(line)).length;
}

function priceLineCount(lines: string[]): number {
  return lines.filter((line) => PRICE_PATTERN.test(line)).length;
}

function chooseArtifactType(text: string, menuItems: MealScoutMenuItemCandidate[]): { type: MealScoutArtifactType; signals: string[]; confidence: number } {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const prices = priceLineCount(lines);
  const foods = foodTermCount(text);
  const foodLines = foodLineCount(lines);
  const hasMenuHeading = MENU_HEADING_PATTERN.test(text);
  const signals: string[] = [];
  if (prices > 0) signals.push('price_signal');
  if (foods >= 2 || foodLines >= 2) signals.push('food_terms');
  if (hasMenuHeading) signals.push('menu_heading');
  if (PROFILE_PATTERN.test(text)) signals.push('profile_page');
  if (SCHEDULE_PATTERN.test(text)) signals.push('schedule_location_hours');
  if (LOGO_PATTERN.test(text)) signals.push('logo_signal');
  if (POST_PATTERN.test(text)) signals.push('post_signal');
  if (CONTACT_PATTERN.test(text)) signals.push('contact_signal');
  if (REVIEW_PATTERN.test(text)) signals.push('review_signal');

  if (menuItems.length >= 2 || (prices >= 2 && foodLines >= 1) || (hasMenuHeading && (prices >= 1 || foodLines >= 3))) {
    return { type: 'menu', signals, confidence: Math.min(0.95, 0.55 + menuItems.length * 0.08 + prices * 0.05) };
  }
  if (prices >= 1 || (hasMenuHeading && foodLines >= 2) || foodLines >= 4) return { type: 'possible_menu', signals, confidence: 0.55 };
  if (LOGO_PATTERN.test(text)) return { type: 'logo', signals, confidence: 0.5 };
  if (PROFILE_PATTERN.test(text)) return { type: 'profile', signals, confidence: 0.7 };
  if (SCHEDULE_PATTERN.test(text)) return { type: 'schedule', signals, confidence: 0.5 };
  if (CONTACT_PATTERN.test(text)) return { type: 'contact', signals, confidence: 0.45 };
  if (REVIEW_PATTERN.test(text)) return { type: 'review', signals, confidence: 0.45 };
  if (POST_PATTERN.test(text)) return { type: 'post', signals, confidence: 0.4 };
  return { type: 'unknown', signals, confidence: 0.2 };
}

function likelyCategory(line: string): string | undefined {
  const lower = line.toLowerCase();
  if (/\b(drink|lemonade|coffee|tea|soda|shake)\b/.test(lower)) return 'drinks';
  if (/\b(dessert|oreo|cake|cookie|pancake|funnel)\b/.test(lower)) return 'desserts';
  if (/\b(side|fries|chips)\b/.test(lower)) return 'sides';
  if (/\b(combo|plate|entree|taco|burger|pizza|ramen|burrito|brisket|ribs|pork|wings|empanada)\b/.test(lower)) return 'entrees';
  return undefined;
}

function extractMenuItems(text: string): MealScoutMenuItemCandidate[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const items: MealScoutMenuItemCandidate[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const price = line.match(PRICE_PATTERN);
    const foods = foodTermCount(line);
    if (!price && foods === 0) continue;
    if (/followers?|following|reviews?|contact info|closed now|open now|united states|food truck|dessert shop|page -/i.test(line)) continue;
    if (!price && (line.split(/\s+/).length > 7 || /[.,;]$/.test(line))) continue;
    const priceValue = price?.[0]?.replace(/\s+/g, '');
    const name = cleanBusinessName(line.replace(price?.[0] || '', ' ').replace(/[-–:]+$/g, '').trim());
    if (!name || isGenericBusinessName(name)) continue;
    const warnings: string[] = [];
    if (!priceValue) warnings.push('missing_price');
    if (name.length < 4) warnings.push('short_item_name');
    items.push({
      item_name: name,
      price: priceValue ? (priceValue.startsWith('$') ? priceValue : `$${priceValue}`) : undefined,
      category: likelyCategory(line),
      raw_ocr_lines: [line],
      confidence: priceValue ? 0.75 : 0.45,
      extraction_warnings: warnings
    });
  }
  return items;
}

function extractHeaderBusinessName(text: string): string | undefined {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 50);
  for (let index = 0; index < lines.length; index += 1) {
    const cleaned = cleanBusinessName(lines[index]);
    if (isGenericBusinessName(cleaned)) continue;
    const next = lines[index + 1] || '';
    const titleLike = /^[<€?]/.test(lines[index]);
    const beforeFollowers = /followers?|following|posts/i.test(next);
    if (titleLike || beforeFollowers) return cleaned;
  }
  return undefined;
}

function findPossibleFullBusinessName(name: string, text: string): string | undefined {
  if (/\bBB$/i.test(name)) {
    const bbqCandidate = name.replace(/\bBB$/i, 'BBQ');
    if (new RegExp(bbqCandidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(text)) return bbqCandidate;
  }
  return undefined;
}

function businessNameCandidate(row: MealScoutScreenshotProcessingSourceRow, text: string): { name?: string; warnings: string[] } {
  const warnings: string[] = [];
  const header = extractHeaderBusinessName(text);
  const sheetName = cleanBusinessName(clean(row.business_name));
  const filenameName = cleanBusinessName(stripExtension(clean(row.final_filename)));
  const candidates = [header, sheetName, filenameName].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const possibleFullName = findPossibleFullBusinessName(candidate, text);
    if (possibleFullName) {
      warnings.push('possible_truncated_business_name_repaired');
      return { name: possibleFullName, warnings };
    }
    if (!isGenericBusinessName(candidate)) return { name: candidate, warnings };
  }
  warnings.push('missing_valid_business_name');
  return { warnings };
}

function groupKeyFor(row: MealScoutArtifactClassificationRow): string {
  if (row.email) return `email:${row.email.toLowerCase()}`;
  if (row.phone) return `phone:${row.phone}`;
  if (row.website) return `website:${row.website.toLowerCase()}`;
  if (row.social) return `social:${row.social.toLowerCase()}`;
  if (row.linked_business_candidate) return `name:${normalizeName(row.linked_business_candidate)}`;
  return `file:${normalizeName(stripExtension(row.final_filename))}`;
}

function duplicateGroups(rows: MealScoutArtifactClassificationRow[]): MealScoutMenuDuplicateGroup[] {
  const groups = new Map<string, MealScoutArtifactClassificationRow[]>();
  for (const row of rows) {
    const key = groupKeyFor(row);
    groups.set(key, [...(groups.get(key) || []), row]);
  }
  const out: MealScoutMenuDuplicateGroup[] = [];
  for (const [key, groupRows] of groups) {
    if (groupRows.length < 2) continue;
    out.push({
      duplicate_group_id: `menu-evidence-group-${String(out.length + 1).padStart(4, '0')}`,
      group_key: key,
      linked_business_candidate: groupRows.find((row) => row.linked_business_candidate)?.linked_business_candidate || 'unknown',
      evidence_drive_file_ids: groupRows.map((row) => row.drive_file_id),
      artifact_types: Array.from(new Set(groupRows.map((row) => row.artifact_type))),
      phones: Array.from(new Set(groupRows.map((row) => row.phone).filter(Boolean) as string[])),
      emails: Array.from(new Set(groupRows.map((row) => row.email).filter(Boolean) as string[])),
      websites: Array.from(new Set(groupRows.map((row) => row.website).filter(Boolean) as string[])),
      final_filenames: Array.from(new Set(groupRows.map((row) => row.final_filename)))
    });
  }
  return out;
}

export function parseMenuArtifactCsv(content: string): MealScoutScreenshotProcessingSourceRow[] {
  return parseCsvRows(content) as MealScoutScreenshotProcessingSourceRow[];
}

export function classifyMealScoutMenuArtifacts(rows: MealScoutScreenshotProcessingSourceRow[]): MealScoutMenuArtifactClassificationResult {
  const artifactRows = rows.map((row, index) => {
    const text = clean(row.ocr_snippet);
    const menuItems = extractMenuItems(text);
    const artifact = chooseArtifactType(text, menuItems);
    const contacts = contactFields(text);
    const business = businessNameCandidate(row, text);
    const warnings = [...business.warnings];
    if ((artifact.type === 'menu' || artifact.type === 'possible_menu') && menuItems.length === 0) warnings.push('menu_extraction_failed');
    if (business.name && clean(row.business_name) && isGenericBusinessName(clean(row.business_name))) warnings.push('generic_sheet_business_name_ignored');
    return {
      source_drive_file_id: row.drive_file_id,
      source_drive_url: row.drive_url,
      source_final_filename: clean(row.final_filename),
      source_row_number: Number(row.row || index + 1),
      drive_file_id: row.drive_file_id,
      drive_url: row.drive_url,
      final_filename: clean(row.final_filename),
      filename_before_final_pass: clean(row.filename_before_final_pass),
      raw_ocr_snippet: text,
      artifact_type: artifact.type,
      artifact_signals: artifact.signals,
      business_name_candidate: business.name,
      linked_business_candidate: business.name,
      menu_items: menuItems,
      confidence: artifact.confidence,
      warnings,
      phone: contacts.phone,
      email: contacts.email,
      website: contacts.website,
      social: contacts.social
    } satisfies MealScoutArtifactClassificationRow;
  });

  const menuLike = artifactRows.filter((row) => row.artifact_type === 'menu' || row.artifact_type === 'possible_menu');
  const menuCandidates = menuLike.filter((row) => row.menu_items.length > 0 && row.business_name_candidate && !row.warnings.includes('missing_valid_business_name'));
  const menuReviewRequired = menuLike.filter((row) => !menuCandidates.includes(row));
  const groups = duplicateGroups(artifactRows.filter((row) => row.linked_business_candidate || row.phone || row.email || row.website || row.social));
  const counts = (type: MealScoutArtifactType): number => artifactRows.filter((row) => row.artifact_type === type).length;
  return {
    status: 'ok',
    mode: 'artifact_classification_export_only',
    mutationAllowed: false,
    source: {
      title: 'MealScout Screenshot Processing Final Sheet 2026-06-09',
      evidenceRowCount: rows.length,
      uniqueEvidenceRowCount: new Set(rows.map((row) => row.drive_file_id)).size
    },
    artifactRows,
    menuCandidates,
    menuReviewRequired,
    duplicateEvidenceGroups: groups,
    summary: {
      totalRows: rows.length,
      profileCount: counts('profile'),
      menuCount: counts('menu'),
      possibleMenuCount: counts('possible_menu'),
      scheduleCount: counts('schedule'),
      logoCount: counts('logo'),
      postCount: counts('post'),
      contactCount: counts('contact'),
      reviewCount: counts('review'),
      unknownCount: counts('unknown'),
      menuCandidateCount: menuCandidates.length,
      menuReviewRequiredCount: menuReviewRequired.length,
      duplicateGroupCount: groups.length,
      mutationAllowed: false,
      examples: [
        ...menuReviewRequired.slice(0, 3).map((row) => `${row.drive_file_id}: ${row.warnings.join('|') || 'review_required'}`),
        ...menuCandidates.slice(0, 3).map((row) => `${row.drive_file_id}: ${row.linked_business_candidate}`)
      ]
    }
  };
}

export function menuArtifactRowsToCsv(rows: MealScoutArtifactClassificationRow[]): string {
  return toCsv(
    rows.map((row) => ({
      source_drive_file_id: row.drive_file_id,
      source_drive_url: row.drive_url || '',
      source_final_filename: row.final_filename,
      filename_before_final_pass: row.filename_before_final_pass || '',
      raw_ocr_snippet: row.raw_ocr_snippet,
      classified_artifact_type: row.artifact_type,
      artifact_signals: row.artifact_signals.join('|'),
      linked_business_candidate: row.linked_business_candidate || '',
      menu_items: JSON.stringify(row.menu_items),
      confidence: row.confidence,
      warnings: row.warnings.join('|')
    })),
    [
      'source_drive_file_id',
      'source_drive_url',
      'source_final_filename',
      'filename_before_final_pass',
      'raw_ocr_snippet',
      'classified_artifact_type',
      'artifact_signals',
      'linked_business_candidate',
      'menu_items',
      'confidence',
      'warnings'
    ]
  );
}

export function duplicateMenuGroupsToCsv(rows: MealScoutMenuDuplicateGroup[]): string {
  return toCsv(
    rows.map((row) => ({
      duplicate_group_id: row.duplicate_group_id,
      group_key: row.group_key,
      linked_business_candidate: row.linked_business_candidate,
      evidence_drive_file_ids: row.evidence_drive_file_ids.join('|'),
      artifact_types: row.artifact_types.join('|'),
      phones: row.phones.join('|'),
      emails: row.emails.join('|'),
      websites: row.websites.join('|'),
      final_filenames: row.final_filenames.join('|')
    })),
    ['duplicate_group_id', 'group_key', 'linked_business_candidate', 'evidence_drive_file_ids', 'artifact_types', 'phones', 'emails', 'websites', 'final_filenames']
  );
}
