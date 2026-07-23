export type MealScoutScreenshotProcessingSourceRow = {
  row?: string;
  drive_file_id: string;
  final_filename?: string;
  business_name?: string;
  status?: string;
  drive_url?: string;
  mime_type?: string;
  ocr_snippet?: string;
  [key: string]: string | undefined;
};

export type MealScoutScreenshotProcessingEvidenceRow = {
  sourceRowNumber: number;
  driveFileId: string;
  finalFilename: string;
  originalBusinessName: string;
  normalizedBusinessName?: string;
  validationStatus: 'candidate' | 'manual_review' | 'rejected';
  reasons: string[];
  contacts: ExtractedContactFields;
  categorySignals: string[];
  driveUrl?: string;
};

export type ExtractedContactFields = {
  phone?: string;
  email?: string;
  website?: string;
  instagram?: string;
  facebook?: string;
  address?: string;
};

export type MealScoutCleanImportCandidate = {
  candidateId: string;
  businessName: string;
  evidenceDriveFileIds: string[];
  evidenceRowNumbers: number[];
  contacts: ExtractedContactFields;
  categorySignals: string[];
  duplicateEvidenceCount: number;
  mutationAllowed: false;
};

export type MealScoutManualReviewRow = MealScoutScreenshotProcessingEvidenceRow & {
  suggestedBusinessName?: string;
};

export type MealScoutRejectedRow = MealScoutScreenshotProcessingEvidenceRow & {
  quarantineReason: string;
};

export type MealScoutDuplicateGroup = {
  duplicateGroupId: string;
  groupKey: string;
  evidenceDriveFileIds: string[];
  businessNames: string[];
  phones: string[];
  emails: string[];
  websites: string[];
  finalFilenames: string[];
  collapsedCandidateId?: string;
};

export type MealScoutScreenshotProcessingValidationResult = {
  status: 'ok';
  mode: 'validation_export_only';
  mutationAllowed: false;
  source: {
    title: 'MealScout Screenshot Processing Final Sheet 2026-06-09';
    evidenceRowCount: number;
    uniqueEvidenceRowCount: number;
  };
  evidenceRows: MealScoutScreenshotProcessingEvidenceRow[];
  cleanCandidates: MealScoutCleanImportCandidate[];
  manualReviewRows: MealScoutManualReviewRow[];
  rejectedRows: MealScoutRejectedRow[];
  duplicateGroups: MealScoutDuplicateGroup[];
  summary: {
    totalRows: number;
    cleanCandidateCount: number;
    manualReviewCount: number;
    rejectedCount: number;
    duplicateGroupCount: number;
    phoneDetectedCount: number;
    emailDetectedCount: number;
    examples: string[];
  };
};

const FOOD_SIGNALS: Array<{ pattern: RegExp; signal: string }> = [
  { pattern: /\b(?:food|taco|burger|bbq|coffee|dessert)\s*truck\b/i, signal: 'food_truck' },
  { pattern: /\brestaurant\b/i, signal: 'restaurant' },
  { pattern: /\bdessert|bakery|cake|cupcake|cookie|pancake|funnel cake|ice cream|milkshake\b/i, signal: 'dessert_bakery' },
  { pattern: /\bcatering|mobile catering|commissary\b/i, signal: 'catering' },
  { pattern: /\bbbq|barbecue\b/i, signal: 'bbq' },
  { pattern: /\btaco|taqueria|burrito|mexican\b/i, signal: 'taco_mexican' },
  { pattern: /\bcoffee|espresso|latte\b/i, signal: 'coffee' },
  { pattern: /\bdrink|smoothie|lemonade|tea|juice|shaved ice|snow cone\b/i, signal: 'drink_shaved_ice' },
  { pattern: /\bgrill|burger|pizza|seafood|soul food|sandwich|kitchen|cafe\b/i, signal: 'food_service' }
];

const NON_FOOD_SIGNALS: Array<{ pattern: RegExp; signal: string }> = [
  { pattern: /\bhvac|heating|air conditioning|ventilating\b/i, signal: 'hvac' },
  { pattern: /\bgutter|seamless gutter\b/i, signal: 'gutters' },
  { pattern: /\bproperty management|real estate|property\b/i, signal: 'property_real_estate' },
  { pattern: /\broofing|roof\b/i, signal: 'roofing' },
  { pattern: /\bplumbing|plumber\b/i, signal: 'plumbing' },
  { pattern: /\bpainting|paint\b/i, signal: 'painting' },
  { pattern: /\bhome improvement|handyman|construction|concrete|fencing|window installation|masonry|brick\b/i, signal: 'home_services' }
];

const SUSPICIOUS_NAME_PATTERNS: RegExp[] = [
  /^$/i,
  /^follow\b/i,
  /^follow @ message$/i,
  /^add a comment$/i,
  /^a neighborly company$/i,
  /^see .+ about info$/i,
  /^page - /i,
  /^outdoor seating/i,
  /^takeout/i,
  /^delivery/i,
  /^dine-in/i,
  /^in-store/i,
  /^closed now$/i,
  /^open now$/i,
  /^always open$/i,
  /^contact info$/i,
  /^all posts$/i,
  /^all photos/i,
  /\bservicing surrounding areas\b/i,
  /\b[Pp]ace,\s*FL\b/,
  /\b[A-Z][a-z]+,\s*(FL|AL|MS|LA|GA|TX|TN)\b/,
  /\b(street|avenue|ave|road|rd|blvd|drive|dr)\b/i
];

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseCsvRows(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let current = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      row.push(current);
      current = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(current);
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      current = '';
    } else {
      current += char;
    }
  }
  if (current.length > 0 || row.length > 0) {
    row.push(current);
    rows.push(row);
  }
  const header = rows[0] || [];
  return rows.slice(1).map((cells) => {
    const out: Record<string, string> = {};
    header.forEach((key, index) => {
      out[key] = cells[index] || '';
    });
    return out;
  });
}

export function toCsv(rows: Array<Record<string, unknown>>, headers: string[]): string {
  const escape = (value: unknown): string => {
    const safe = String(value ?? '');
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return `${[headers, ...rows.map((row) => headers.map((header) => escape(row[header])))].map((row) => row.join(',')).join('\n')}\n`;
}

function normalizeBusinessKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(llc|inc|co|company|food truck|restaurant|cafe)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function stripExtension(value: string): string {
  return value.replace(/\.[a-z0-9]{2,5}$/i, '').trim();
}

function extractContacts(text: string): ExtractedContactFields {
  const phoneMatch = text.match(/(?:\+?1[\s.-]*)?\(?([2-9]\d{2})\)?[\s.-]*([2-9]\d{2})[\s.-]*(\d{4})/);
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const explicitWebsiteMatch = text.match(/https?:\/\/[^\s)]+|(?:www\.)[^\s)]+/i);
  const bareWebsiteMatch = text.match(/(?:^|[^@a-z0-9.-])([a-z0-9.-]+\.(?:com|net|org|co|biz)\b[^\s)]*)/i);
  const instagramMatch = text.match(/instagram(?:\.com\/|[:\s]+@?)([a-z0-9._]+)/i) || text.match(/@([a-z0-9._]{3,})/i);
  const facebookMatch = text.match(/facebook(?:\.com\/|[:\s]+@?)([a-z0-9._-]+)/i);
  const addressMatch = text.match(/\b\d{1,6}\s+[A-Z0-9][A-Z0-9 .'-]+\s+(?:St|Street|Rd|Road|Ave|Avenue|Blvd|Drive|Dr|Hwy|Highway)\b[^\n]*/i);
  return {
    phone: phoneMatch ? `${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}` : undefined,
    email: emailMatch?.[0],
    website: explicitWebsiteMatch?.[0] || bareWebsiteMatch?.[1],
    instagram: instagramMatch ? `@${instagramMatch[1].replace(/^@/, '')}` : undefined,
    facebook: facebookMatch?.[1],
    address: addressMatch?.[0]?.trim()
  };
}

function detectSignals(text: string, rules: Array<{ pattern: RegExp; signal: string }>): string[] {
  return Array.from(new Set(rules.filter((rule) => rule.pattern.test(text)).map((rule) => rule.signal)));
}

function isSuspiciousName(name: string): boolean {
  const safe = cleanString(name);
  if (safe.length < 3) return true;
  if (/^\d/.test(safe)) return true;
  if ((safe.match(/[a-z]/gi) || []).length < 3) return true;
  return SUSPICIOUS_NAME_PATTERNS.some((pattern) => pattern.test(safe));
}

function findPossibleFullName(name: string, ocr: string): string | undefined {
  const safe = cleanString(name);
  if (/\bBB$/i.test(safe)) {
    const bbqCandidate = safe.replace(/\bBB$/i, 'BBQ');
    if (new RegExp(bbqCandidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(ocr)) return bbqCandidate;
  }
  return undefined;
}

function mergeContacts(rows: MealScoutScreenshotProcessingEvidenceRow[]): ExtractedContactFields {
  const out: ExtractedContactFields = {};
  for (const field of ['phone', 'email', 'website', 'instagram', 'facebook', 'address'] as const) {
    out[field] = rows.find((row) => row.contacts[field])?.contacts[field];
  }
  return out;
}

function groupCandidates(rows: MealScoutScreenshotProcessingEvidenceRow[]): {
  candidates: MealScoutCleanImportCandidate[];
  duplicateGroups: MealScoutDuplicateGroup[];
} {
  const groups = new Map<string, MealScoutScreenshotProcessingEvidenceRow[]>();
  for (const row of rows) {
    const contactKey =
      row.contacts.email?.toLowerCase() ||
      row.contacts.phone ||
      row.contacts.website?.toLowerCase() ||
      row.contacts.instagram?.toLowerCase() ||
      row.contacts.facebook?.toLowerCase();
    const nameKey = normalizeBusinessKey(row.normalizedBusinessName || row.originalBusinessName);
    const weakFilenameKey = normalizeBusinessKey(stripExtension(row.finalFilename));
    const key = contactKey ? `contact:${contactKey}` : nameKey ? `name:${nameKey}` : `filename:${weakFilenameKey}`;
    groups.set(key, [...(groups.get(key) || []), row]);
  }

  const candidates: MealScoutCleanImportCandidate[] = [];
  const duplicateGroups: MealScoutDuplicateGroup[] = [];
  let index = 1;
  for (const [key, groupRows] of groups) {
    const candidateId = `mealscout-sheet-candidate-${String(index).padStart(4, '0')}`;
    const names = Array.from(new Set(groupRows.map((row) => row.normalizedBusinessName || row.originalBusinessName).filter(Boolean)));
    const businessName = names[0] || 'unknown';
    candidates.push({
      candidateId,
      businessName,
      evidenceDriveFileIds: groupRows.map((row) => row.driveFileId),
      evidenceRowNumbers: groupRows.map((row) => row.sourceRowNumber),
      contacts: mergeContacts(groupRows),
      categorySignals: Array.from(new Set(groupRows.flatMap((row) => row.categorySignals))),
      duplicateEvidenceCount: groupRows.length,
      mutationAllowed: false
    });
    if (groupRows.length > 1) {
      duplicateGroups.push({
        duplicateGroupId: `mealscout-sheet-duplicate-${String(duplicateGroups.length + 1).padStart(4, '0')}`,
        groupKey: key,
        evidenceDriveFileIds: groupRows.map((row) => row.driveFileId),
        businessNames: names,
        phones: Array.from(new Set(groupRows.map((row) => row.contacts.phone).filter(Boolean) as string[])),
        emails: Array.from(new Set(groupRows.map((row) => row.contacts.email).filter(Boolean) as string[])),
        websites: Array.from(new Set(groupRows.map((row) => row.contacts.website).filter(Boolean) as string[])),
        finalFilenames: Array.from(new Set(groupRows.map((row) => row.finalFilename).filter(Boolean))),
        collapsedCandidateId: candidateId
      });
    }
    index += 1;
  }
  return { candidates, duplicateGroups };
}

export function validateMealScoutScreenshotProcessingRows(
  rows: MealScoutScreenshotProcessingSourceRow[]
): MealScoutScreenshotProcessingValidationResult {
  const evidenceRows: MealScoutScreenshotProcessingEvidenceRow[] = [];
  const manualReviewRows: MealScoutManualReviewRow[] = [];
  const rejectedRows: MealScoutRejectedRow[] = [];
  const acceptedRows: MealScoutScreenshotProcessingEvidenceRow[] = [];

  rows.forEach((row, index) => {
    const ocr = cleanString(row.ocr_snippet);
    const originalName = cleanString(row.business_name) || stripExtension(cleanString(row.final_filename));
    const finalFilename = cleanString(row.final_filename);
    const contacts = extractContacts(ocr);
    const combinedText = `${originalName}\n${finalFilename}\n${ocr}`;
    const foodSignals = detectSignals(combinedText, FOOD_SIGNALS);
    const nonFoodSignals = detectSignals(combinedText, NON_FOOD_SIGNALS);
    const reasons: string[] = [];
    const possibleFullName = findPossibleFullName(originalName, ocr);
    const suspicious = isSuspiciousName(originalName);

    if (nonFoodSignals.length > 0) reasons.push(`non_food_scope:${nonFoodSignals.join('|')}`);
    if (foodSignals.length === 0) reasons.push('missing_food_scope_signal');
    if (suspicious) reasons.push('suspicious_business_name');
    if (possibleFullName) reasons.push('possible_truncated_business_name');

    let validationStatus: MealScoutScreenshotProcessingEvidenceRow['validationStatus'] = 'candidate';
    if (nonFoodSignals.length > 0 || foodSignals.length === 0) validationStatus = 'rejected';
    else if (suspicious || possibleFullName) validationStatus = 'manual_review';

    const evidence: MealScoutScreenshotProcessingEvidenceRow = {
      sourceRowNumber: Number(row.row || index + 1),
      driveFileId: row.drive_file_id,
      finalFilename,
      originalBusinessName: originalName,
      normalizedBusinessName: possibleFullName || originalName,
      validationStatus,
      reasons,
      contacts,
      categorySignals: foodSignals,
      driveUrl: row.drive_url
    };
    evidenceRows.push(evidence);
    if (validationStatus === 'candidate') acceptedRows.push(evidence);
    else if (validationStatus === 'manual_review') manualReviewRows.push({ ...evidence, suggestedBusinessName: possibleFullName });
    else rejectedRows.push({ ...evidence, quarantineReason: reasons[0] || 'rejected' });
  });

  const { candidates, duplicateGroups } = groupCandidates(acceptedRows);
  const examples = [
    ...manualReviewRows.slice(0, 3).map((row) => `${row.driveFileId}: ${row.reasons.join(',')}`),
    ...rejectedRows.slice(0, 3).map((row) => `${row.driveFileId}: ${row.quarantineReason}`)
  ];
  return {
    status: 'ok',
    mode: 'validation_export_only',
    mutationAllowed: false,
    source: {
      title: 'MealScout Screenshot Processing Final Sheet 2026-06-09',
      evidenceRowCount: rows.length,
      uniqueEvidenceRowCount: new Set(rows.map((row) => row.drive_file_id)).size
    },
    evidenceRows,
    cleanCandidates: candidates,
    manualReviewRows,
    rejectedRows,
    duplicateGroups,
    summary: {
      totalRows: rows.length,
      cleanCandidateCount: candidates.length,
      manualReviewCount: manualReviewRows.length,
      rejectedCount: rejectedRows.length,
      duplicateGroupCount: duplicateGroups.length,
      phoneDetectedCount: evidenceRows.filter((row) => row.contacts.phone).length,
      emailDetectedCount: evidenceRows.filter((row) => row.contacts.email).length,
      examples
    }
  };
}
