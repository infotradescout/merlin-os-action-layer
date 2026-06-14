import { createHash } from 'node:crypto';
import { parseMealScoutSignalsFromText } from './mealscoutScreenshotExtraction.js';
import type { MealScoutArtifactClassificationRow } from './mealscoutMenuArtifactClassification.js';

export type MealScoutDraftPacketSourceScreenshot = {
  driveFileId: string;
  driveUrl?: string;
  finalFilename?: string;
  sourceRowNumber?: number;
  artifactType?: string;
  confidence?: number;
};

export type MealScoutDraftPacketField<T> = {
  value: T;
  sourceFileIds: string[];
  confidence: number;
  evidenceSnippets: string[];
};

export type MealScoutDraftPacketConflict = {
  field: string;
  values: string[];
  sourceFileIds: string[];
};

export type MealScoutScreenshotProfileCompletionTrackerRow = {
  duplicateGroupId?: string;
  duplicate_group_id?: string;
  groupKey?: string;
  group_key?: string;
  evidenceDriveFileIds?: string[];
  evidence_drive_file_ids?: string[];
  businessNames?: string[];
  business_names?: string[];
  phones?: string[];
  emails?: string[];
  websites?: string[];
  finalFilenames?: string[];
  final_filenames?: string[];
  collapsedCandidateId?: string;
  collapsed_candidate_id?: string;
  status?: string;
  reviewStatus?: string;
  review_status?: string;
};

export type MealScoutDraftPacket = {
  packetId: string;
  packetType: 'mealscout_draft_profile_packet';
  targetProduct: 'MealScout';
  productionApplied: false;
  mutationAllowed: false;
  trackerRowId?: string;
  trackerGroupKey?: string;
  businessName?: MealScoutDraftPacketField<string>;
  phone?: MealScoutDraftPacketField<string>;
  website?: MealScoutDraftPacketField<string>;
  socials: {
    facebook?: MealScoutDraftPacketField<string>;
    instagram?: MealScoutDraftPacketField<string>;
    other?: MealScoutDraftPacketField<string>;
  };
  cuisineCategory?: MealScoutDraftPacketField<string[]>;
  locationAddress?: MealScoutDraftPacketField<string>;
  scheduleHours?: MealScoutDraftPacketField<string[]>;
  menuItems: Array<{
    name: string;
    price?: string;
    sourceFileIds: string[];
    confidence: number;
    evidenceSnippets: string[];
  }>;
  logoCoverEvidence: MealScoutDraftPacketSourceScreenshot[];
  sourceScreenshots: MealScoutDraftPacketSourceScreenshot[];
  confidence: number;
  conflicts: MealScoutDraftPacketConflict[];
  ownerConfirmationRequired: boolean;
  ownerConfirmationReasons: string[];
  reviewStatus: 'review_ready' | 'blocked_by_conflict' | 'missing_required_visible_fact';
  visibleEvidenceOnly: true;
};

export type MealScoutDraftPacketHeldRow = {
  driveFileId: string;
  sourceRowNumber?: number;
  finalFilename?: string;
  reason: string;
  artifactType?: string;
  detectedSignals: string[];
};

export type MealScoutDraftPacketGenerationResult = {
  status: 'ok';
  mode: 'draft_packet_export_only';
  mutationAllowed: false;
  productionApplied: false;
  trackerRowsProcessed: number;
  foodVendorsProcessed: number;
  nonFoodQuarantined: number;
  unknownHeld: number;
  draftPacketsCreated: number;
  conflictsFound: number;
  ownerConfirmationsRequired: number;
  draftPackets: MealScoutDraftPacket[];
  nonFoodQuarantine: MealScoutDraftPacketHeldRow[];
  unknownHeldRows: MealScoutDraftPacketHeldRow[];
  manifestSummary: {
    generatedAt: string;
    source: string;
    trackerSource?: string;
    evidenceRowsRead: number;
    trackerRowsProcessed: number;
    foodVendorsProcessed: number;
    nonFoodQuarantined: number;
    unknownHeld: number;
    draftPacketsCreated: number;
    conflictsFound: number;
    ownerConfirmationsRequired: number;
    notes: string[];
  };
};

const NON_FOOD_PATTERN =
  /\b(hvac|heating|air conditioning|construction|contractor|gutter|roof|roofing|plumb|painting|property|real estate|fence|fencing|electric|garage door|insulation|handyman|lawn|maintenance)\b/i;
const FOOD_PATTERN =
  /\b(food truck|restaurant|dessert|bakery|cake|cupcake|cookie|ice cream|milkshake|smoothie|juice|coffee|taco|taqueria|bbq|barbecue|deli|kitchen|catering|grill|burger|pizza|seafood|cajun|sandwich|wings|brat|sausage)\b/i;
const SCHEDULE_LINE_PATTERN =
  /\b(mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday|hours?|schedule|open|closed|am|pm)\b/i;
const ADDRESS_PATTERN =
  /\b\d{1,6}\s+[A-Z0-9][A-Z0-9 .'-]+\s+(?:St|Street|Rd|Road|Ave|Avenue|Blvd|Boulevard|Drive|Dr|Hwy|Highway|Pkwy|Parkway|Ct|Court|Ln|Lane)\b[^\n]*/i;
const CITY_STATE_PATTERN = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*(?:AL|FL|GA|LA|MS|SC|TN|TX)\b/;

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function isGenericBusinessIdentity(value: string | undefined): boolean {
  const safe = normalizeKey(value || '');
  return (
    !safe ||
    /\bfollowers?\b/.test(safe) ||
    /\bfollowing\b/.test(safe) ||
    /\bposts?\b/.test(safe) ||
    safe === 'food truck' ||
    safe === 'restaurant' ||
    safe === 'kitchen' ||
    safe === 'catering' ||
    safe === 'page food truck' ||
    safe === 'page food drink' ||
    safe === 'follow message' ||
    safe === 'all photos reels mentions'
  );
}

function cleanMenuItemName(value: string): string {
  return clean(value).replace(/\s*[-–:]+\s*$/, '').trim();
}

function stableId(prefix: string, values: string[]): string {
  return `${prefix}-${createHash('sha1').update(values.join('|')).digest('hex').slice(0, 16)}`;
}

function sourceRef(row: MealScoutArtifactClassificationRow): MealScoutDraftPacketSourceScreenshot {
  return {
    driveFileId: row.drive_file_id || row.source_drive_file_id,
    driveUrl: row.drive_url || row.source_drive_url,
    finalFilename: row.final_filename || row.source_final_filename,
    sourceRowNumber: row.source_row_number,
    artifactType: row.artifact_type,
    confidence: row.confidence
  };
}

function sourceFileId(row: MealScoutArtifactClassificationRow): string {
  return row.drive_file_id || row.source_drive_file_id;
}

function visibleInOcr(value: string | undefined, ocr: string): boolean {
  const safe = clean(value);
  if (!safe) return false;
  if (isGenericBusinessIdentity(safe)) return false;
  return normalizeKey(ocr).includes(normalizeKey(safe));
}

function evidenceSnippet(ocr: string, value: string): string {
  const safe = clean(ocr);
  const target = clean(value);
  if (!safe || !target) return target;
  const index = safe.toLowerCase().indexOf(target.toLowerCase());
  if (index < 0) return safe.slice(0, 180);
  return safe.slice(Math.max(0, index - 45), Math.min(safe.length, index + target.length + 75));
}

function pushFieldValue(
  map: Map<string, { value: string; sourceFileIds: Set<string>; confidence: number; evidenceSnippets: Set<string> }>,
  value: string | undefined,
  row: MealScoutArtifactClassificationRow,
  confidence = row.confidence || 0.5
): void {
  const safe = clean(value);
  if (!safe) return;
  const key = normalizeKey(safe);
  const current = map.get(key) || {
    value: safe,
    sourceFileIds: new Set<string>(),
    confidence,
    evidenceSnippets: new Set<string>()
  };
  current.sourceFileIds.add(row.drive_file_id || row.source_drive_file_id);
  current.confidence = Math.max(current.confidence, confidence);
  current.evidenceSnippets.add(evidenceSnippet(row.raw_ocr_snippet || '', safe));
  map.set(key, current);
}

function toField<T extends string | string[]>(
  values: Map<string, { value: string; sourceFileIds: Set<string>; confidence: number; evidenceSnippets: Set<string> }>,
  transform?: (value: string) => T
): MealScoutDraftPacketField<T> | undefined {
  const first = Array.from(values.values()).sort((a, b) => b.confidence - a.confidence)[0];
  if (!first) return undefined;
  return {
    value: transform ? transform(first.value) : (first.value as T),
    sourceFileIds: Array.from(first.sourceFileIds),
    confidence: Number(Math.min(1, first.confidence).toFixed(2)),
    evidenceSnippets: Array.from(first.evidenceSnippets).filter(Boolean).slice(0, 5)
  };
}

function conflictFor(
  field: string,
  values: Map<string, { value: string; sourceFileIds: Set<string> }>
): MealScoutDraftPacketConflict | undefined {
  const rows = Array.from(values.values());
  if (rows.length <= 1) return undefined;
  return {
    field,
    values: rows.map((row) => row.value),
    sourceFileIds: Array.from(new Set(rows.flatMap((row) => Array.from(row.sourceFileIds))))
  };
}

function extractScheduleLines(ocr: string): string[] {
  return Array.from(
    new Set(
      clean(ocr)
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length >= 4 && line.length <= 160 && SCHEDULE_LINE_PATTERN.test(line))
    )
  ).slice(0, 12);
}

function extractLocation(ocr: string, parsedCity?: string): string | undefined {
  return ocr.match(ADDRESS_PATTERN)?.[0]?.trim() || ocr.match(CITY_STATE_PATTERN)?.[0]?.trim() || parsedCity;
}

function isNonFood(row: MealScoutArtifactClassificationRow): boolean {
  const text = `${row.raw_ocr_snippet || ''}\n${row.business_name_candidate || ''}\n${row.linked_business_candidate || ''}`;
  return NON_FOOD_PATTERN.test(text) && !FOOD_PATTERN.test(text);
}

function isFood(row: MealScoutArtifactClassificationRow): boolean {
  const text = `${row.raw_ocr_snippet || ''}\n${row.business_name_candidate || ''}\n${row.linked_business_candidate || ''}`;
  return (
    FOOD_PATTERN.test(text) ||
    (row.artifact_signals || []).some((signal) => /food_terms|menu_heading/i.test(signal)) ||
    ['menu', 'possible_menu'].includes(row.artifact_type)
  );
}

function groupKeyFor(row: MealScoutArtifactClassificationRow): string | undefined {
  const ocr = row.raw_ocr_snippet || '';
  for (const candidate of [row.linked_business_candidate, row.business_name_candidate]) {
    if (visibleInOcr(candidate, ocr)) return normalizeKey(candidate || '');
  }
  const parsed = parseMealScoutSignalsFromText(ocr);
  if (visibleInOcr(parsed.extractedSignals.truckName, ocr)) return normalizeKey(parsed.extractedSignals.truckName || '');
  return undefined;
}

function trackerRowId(row: MealScoutScreenshotProfileCompletionTrackerRow, index: number): string {
  return row.duplicateGroupId || row.duplicate_group_id || row.collapsedCandidateId || row.collapsed_candidate_id || `tracker-row-${index + 1}`;
}

function trackerGroupKey(row: MealScoutScreenshotProfileCompletionTrackerRow, index: number): string {
  return row.groupKey || row.group_key || trackerRowId(row, index);
}

function trackerEvidenceIds(row: MealScoutScreenshotProfileCompletionTrackerRow): string[] {
  const raw = row.evidenceDriveFileIds || row.evidence_drive_file_ids || [];
  return Array.from(new Set(raw.map((value) => clean(value)).filter(Boolean)));
}

function isDraftReadyTrackerRow(row: MealScoutScreenshotProfileCompletionTrackerRow): boolean {
  const status = normalizeKey(row.status || row.reviewStatus || row.review_status || '');
  return !status || status === 'draft ready' || status === 'review ready' || status === 'ready';
}

function heldRowFor(row: MealScoutArtifactClassificationRow, reason: string): MealScoutDraftPacketHeldRow {
  return {
    driveFileId: row.drive_file_id || row.source_drive_file_id,
    sourceRowNumber: row.source_row_number,
    finalFilename: row.final_filename || row.source_final_filename,
    reason,
    artifactType: row.artifact_type,
    detectedSignals: Array.from(new Set([...(row.artifact_signals || []), row.artifact_type].filter(Boolean)))
  };
}

function buildPacket(
  groupKey: string,
  rows: MealScoutArtifactClassificationRow[],
  tracker?: { rowId: string; groupKey: string }
): MealScoutDraftPacket {
  const names = new Map<string, { value: string; sourceFileIds: Set<string>; confidence: number; evidenceSnippets: Set<string> }>();
  const phones = new Map<string, { value: string; sourceFileIds: Set<string>; confidence: number; evidenceSnippets: Set<string> }>();
  const websites = new Map<string, { value: string; sourceFileIds: Set<string>; confidence: number; evidenceSnippets: Set<string> }>();
  const facebook = new Map<string, { value: string; sourceFileIds: Set<string>; confidence: number; evidenceSnippets: Set<string> }>();
  const instagram = new Map<string, { value: string; sourceFileIds: Set<string>; confidence: number; evidenceSnippets: Set<string> }>();
  const otherSocial = new Map<string, { value: string; sourceFileIds: Set<string>; confidence: number; evidenceSnippets: Set<string> }>();
  const locations = new Map<string, { value: string; sourceFileIds: Set<string>; confidence: number; evidenceSnippets: Set<string> }>();
  const cuisines = new Map<string, { value: string; sourceFileIds: Set<string>; confidence: number; evidenceSnippets: Set<string> }>();
  const schedules = new Map<string, { value: string; sourceFileIds: Set<string>; confidence: number; evidenceSnippets: Set<string> }>();
  const menuItems = new Map<string, { name: string; price?: string; sourceFileIds: Set<string>; confidence: number; evidenceSnippets: Set<string> }>();

  for (const row of rows) {
    const ocr = row.raw_ocr_snippet || '';
    const parsed = parseMealScoutSignalsFromText(ocr);
    const visibleName = [row.linked_business_candidate, row.business_name_candidate, parsed.extractedSignals.truckName].find((candidate) =>
      visibleInOcr(candidate, ocr)
    );
    pushFieldValue(names, visibleName, row);
    pushFieldValue(phones, row.phone || parsed.extractedSignals.phone, row);
    pushFieldValue(websites, row.website || parsed.extractedSignals.website, row);
    pushFieldValue(instagram, parsed.extractedSignals.instagram, row);
    pushFieldValue(facebook, parsed.extractedSignals.facebook, row);
    if (row.social && !parsed.extractedSignals.instagram && !parsed.extractedSignals.facebook) pushFieldValue(otherSocial, row.social, row);
    pushFieldValue(locations, extractLocation(ocr, parsed.extractedSignals.cityArea), row);
    pushFieldValue(cuisines, parsed.extractedSignals.cuisine || row.artifact_signals?.find((signal) => FOOD_PATTERN.test(signal)), row);

    for (const line of extractScheduleLines(ocr)) pushFieldValue(schedules, line, row, 0.62);

    const parsedMenuItems = parsed.extractedSignals.menuItems || [];
    for (const item of parsedMenuItems) {
      const itemName = cleanMenuItemName(item.name);
      if (!itemName) continue;
      const key = `${normalizeKey(itemName)}|${item.price || ''}`;
      const current = menuItems.get(key) || {
        name: itemName,
        price: item.price,
        sourceFileIds: new Set<string>(),
        confidence: 0.72,
        evidenceSnippets: new Set<string>()
      };
    current.sourceFileIds.add(sourceFileId(row));
      current.evidenceSnippets.add(evidenceSnippet(ocr, item.name));
      menuItems.set(key, current);
    }

    for (const item of row.menu_items || []) {
      if (!item.price) continue;
      const itemName = cleanMenuItemName(item.item_name);
      if (!itemName) continue;
      const key = `${normalizeKey(itemName)}|${item.price}`;
      const current = menuItems.get(key) || {
        name: itemName,
        price: item.price,
        sourceFileIds: new Set<string>(),
        confidence: item.confidence || 0.65,
        evidenceSnippets: new Set<string>()
      };
      current.sourceFileIds.add(sourceFileId(row));
      for (const line of item.raw_ocr_lines || []) current.evidenceSnippets.add(line);
      menuItems.set(key, current);
    }
  }

  const conflicts = [
    conflictFor('businessName', names),
    conflictFor('phone', phones),
    conflictFor('website', websites),
    conflictFor('facebook', facebook),
    conflictFor('instagram', instagram),
    conflictFor('locationAddress', locations)
  ].filter(Boolean) as MealScoutDraftPacketConflict[];
  const ownerConfirmationReasons = [
    ...conflicts.map((conflict) => `conflict:${conflict.field}`),
    ...(names.size === 0 ? ['missing_visible_business_name'] : []),
    ...(phones.size === 0 && websites.size === 0 && facebook.size === 0 && instagram.size === 0 && otherSocial.size === 0
      ? ['missing_visible_contact_or_social']
      : []),
    ...(schedules.size > 0 ? ['schedule_currentness_requires_confirmation'] : [])
  ];
  const sourceScreenshots = rows.map(sourceRef);
  const logoCoverEvidence = sourceScreenshots.filter((source) => /logo|cover/i.test(source.artifactType || source.finalFilename || ''));
  const confidence = Number(
    Math.min(
      1,
      rows.reduce((acc, row) => acc + (row.confidence || 0.5), 0) / Math.max(1, rows.length) +
        (conflicts.length === 0 ? 0.08 : -0.15)
    ).toFixed(2)
  );

  return {
    packetId: stableId('ms-draft-packet', [groupKey, ...sourceScreenshots.map((source) => source.driveFileId).sort()]),
    packetType: 'mealscout_draft_profile_packet',
    targetProduct: 'MealScout',
    productionApplied: false,
    mutationAllowed: false,
    trackerRowId: tracker?.rowId,
    trackerGroupKey: tracker?.groupKey,
    businessName: toField(names),
    phone: toField(phones),
    website: toField(websites),
    socials: {
      facebook: toField(facebook),
      instagram: toField(instagram),
      other: toField(otherSocial)
    },
    cuisineCategory: toField(cuisines, (value) => [value]),
    locationAddress: toField(locations),
    scheduleHours: toField(schedules, (value) => Array.from(schedules.values()).map((row) => row.value)),
    menuItems: Array.from(menuItems.values()).map((item) => ({
      name: item.name,
      price: item.price,
      sourceFileIds: Array.from(item.sourceFileIds),
      confidence: Number(item.confidence.toFixed(2)),
      evidenceSnippets: Array.from(item.evidenceSnippets).filter(Boolean).slice(0, 5)
    })),
    logoCoverEvidence,
    sourceScreenshots,
    confidence,
    conflicts,
    ownerConfirmationRequired: ownerConfirmationReasons.length > 0,
    ownerConfirmationReasons,
    reviewStatus:
      conflicts.length > 0
        ? 'blocked_by_conflict'
        : ownerConfirmationReasons.some((reason) => reason.startsWith('missing_'))
          ? 'missing_required_visible_fact'
          : 'review_ready',
    visibleEvidenceOnly: true
  };
}

export function generateMealScoutDraftProfilePackets(
  rows: MealScoutArtifactClassificationRow[],
  options: {
    source?: string;
    trackerSource?: string;
    generatedAt?: string;
    trackerRows?: MealScoutScreenshotProfileCompletionTrackerRow[];
  } = {}
): MealScoutDraftPacketGenerationResult {
  const groups = new Map<string, MealScoutArtifactClassificationRow[]>();
  const nonFoodQuarantine: MealScoutDraftPacketHeldRow[] = [];
  const unknownHeldRows: MealScoutDraftPacketHeldRow[] = [];
  const usedTrackerEvidenceIds = new Set<string>();

  if (options.trackerRows) {
    const rowsByFileId = new Map(rows.map((row) => [sourceFileId(row), row]));
    const draftTrackerRows = options.trackerRows.filter(isDraftReadyTrackerRow);
    const draftPackets: MealScoutDraftPacket[] = [];

    for (let index = 0; index < draftTrackerRows.length; index += 1) {
      const trackerRow = draftTrackerRows[index];
      const evidenceIds = trackerEvidenceIds(trackerRow);
      const evidenceRows = evidenceIds.map((id) => rowsByFileId.get(id)).filter(Boolean) as MealScoutArtifactClassificationRow[];
      evidenceRows.forEach((row) => usedTrackerEvidenceIds.add(sourceFileId(row)));

      if (evidenceRows.length === 0) {
        unknownHeldRows.push({
          driveFileId: trackerRowId(trackerRow, index),
          reason: 'tracker_row_missing_evidence',
          detectedSignals: []
        });
        continue;
      }

      const foodRows = evidenceRows.filter((row) => isFood(row) && !isNonFood(row));
      if (foodRows.length === 0 && evidenceRows.every(isNonFood)) {
        nonFoodQuarantine.push(...evidenceRows.map((row) => heldRowFor(row, 'non_food_scope')));
        continue;
      }
      if (foodRows.length === 0) {
        unknownHeldRows.push(...evidenceRows.map((row) => heldRowFor(row, 'unknown_or_unreadable_food_scope')));
        continue;
      }

      const rowId = trackerRowId(trackerRow, index);
      const rowGroupKey = trackerGroupKey(trackerRow, index);
      draftPackets.push(buildPacket(rowGroupKey, foodRows, { rowId, groupKey: rowGroupKey }));
    }

    for (const row of rows) {
      if (usedTrackerEvidenceIds.has(sourceFileId(row))) continue;
      if (isNonFood(row)) {
        nonFoodQuarantine.push(heldRowFor(row, 'non_food_scope'));
      } else if (!isFood(row)) {
        unknownHeldRows.push(heldRowFor(row, 'unknown_or_unreadable_food_scope'));
      }
    }

    draftPackets.sort((a, b) => (a.businessName?.value || a.trackerRowId || '').localeCompare(b.businessName?.value || b.trackerRowId || ''));
    const conflictsFound = draftPackets.reduce((acc, packet) => acc + packet.conflicts.length, 0);
    const ownerConfirmationsRequired = draftPackets.filter((packet) => packet.ownerConfirmationRequired).length;

    return {
      status: 'ok',
      mode: 'draft_packet_export_only',
      mutationAllowed: false,
      productionApplied: false,
      trackerRowsProcessed: draftTrackerRows.length,
      foodVendorsProcessed: draftPackets.length,
      nonFoodQuarantined: nonFoodQuarantine.length,
      unknownHeld: unknownHeldRows.length,
      draftPacketsCreated: draftPackets.length,
      conflictsFound,
      ownerConfirmationsRequired,
      draftPackets,
      nonFoodQuarantine,
      unknownHeldRows,
      manifestSummary: {
        generatedAt: options.generatedAt || new Date().toISOString(),
        source: options.source || 'local_artifact_rows',
        trackerSource: options.trackerSource,
        evidenceRowsRead: rows.length,
        trackerRowsProcessed: draftTrackerRows.length,
        foodVendorsProcessed: draftPackets.length,
        nonFoodQuarantined: nonFoodQuarantine.length,
        unknownHeld: unknownHeldRows.length,
        draftPacketsCreated: draftPackets.length,
        conflictsFound,
        ownerConfirmationsRequired,
        notes: [
          'Draft packets are review artifacts only.',
          'No live MealScout profiles, menus, schedules, logos, covers, or profile fields are created or applied.',
          'Tracker rows define packet boundaries; facts still require visible OCR evidence.',
          'Business identity is accepted only when visible in OCR evidence.',
          'Non-food rows are quarantined for TradeScout later.',
          'Unknown or unreadable rows are held for manual review.'
        ]
      }
    };
  }

  for (const row of rows) {
    const detectedSignals = Array.from(new Set([...(row.artifact_signals || []), row.artifact_type].filter(Boolean)));
    if (isNonFood(row)) {
      nonFoodQuarantine.push({
        driveFileId: row.drive_file_id || row.source_drive_file_id,
        sourceRowNumber: row.source_row_number,
        finalFilename: row.final_filename || row.source_final_filename,
        reason: 'non_food_scope',
        artifactType: row.artifact_type,
        detectedSignals
      });
      continue;
    }
    if (!isFood(row)) {
      unknownHeldRows.push({
        driveFileId: row.drive_file_id || row.source_drive_file_id,
        sourceRowNumber: row.source_row_number,
        finalFilename: row.final_filename || row.source_final_filename,
        reason: 'unknown_or_unreadable_food_scope',
        artifactType: row.artifact_type,
        detectedSignals
      });
      continue;
    }
    const groupKey = groupKeyFor(row);
    if (!groupKey) {
      unknownHeldRows.push({
        driveFileId: row.drive_file_id || row.source_drive_file_id,
        sourceRowNumber: row.source_row_number,
        finalFilename: row.final_filename || row.source_final_filename,
        reason: 'missing_visible_business_identity',
        artifactType: row.artifact_type,
        detectedSignals
      });
      continue;
    }
    groups.set(groupKey, [...(groups.get(groupKey) || []), row]);
  }

  const draftPackets = Array.from(groups.entries())
    .map(([groupKey, groupRows]) => buildPacket(groupKey, groupRows))
    .sort((a, b) => (a.businessName?.value || '').localeCompare(b.businessName?.value || ''));
  const conflictsFound = draftPackets.reduce((acc, packet) => acc + packet.conflicts.length, 0);
  const ownerConfirmationsRequired = draftPackets.filter((packet) => packet.ownerConfirmationRequired).length;

  return {
    status: 'ok',
    mode: 'draft_packet_export_only',
    mutationAllowed: false,
    productionApplied: false,
    trackerRowsProcessed: rows.length,
    foodVendorsProcessed: draftPackets.length,
    nonFoodQuarantined: nonFoodQuarantine.length,
    unknownHeld: unknownHeldRows.length,
    draftPacketsCreated: draftPackets.length,
    conflictsFound,
    ownerConfirmationsRequired,
    draftPackets,
    nonFoodQuarantine,
    unknownHeldRows,
      manifestSummary: {
        generatedAt: options.generatedAt || new Date().toISOString(),
        source: options.source || 'local_artifact_rows',
        trackerSource: options.trackerSource,
        evidenceRowsRead: rows.length,
        trackerRowsProcessed: rows.length,
      foodVendorsProcessed: draftPackets.length,
      nonFoodQuarantined: nonFoodQuarantine.length,
      unknownHeld: unknownHeldRows.length,
      draftPacketsCreated: draftPackets.length,
      conflictsFound,
      ownerConfirmationsRequired,
      notes: [
        'Draft packets are review artifacts only.',
        'No live MealScout profiles, menus, schedules, logos, covers, or profile fields are created or applied.',
        'Business identity is accepted only when visible in OCR evidence.',
        'Non-food rows are quarantined for TradeScout later.',
        'Unknown or unreadable rows are held for manual review.'
      ]
    }
  };
}
