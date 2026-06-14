import type {
  MealScoutDraftPacket,
  MealScoutDraftPacketConflict,
  MealScoutDraftPacketHeldRow
} from './mealscoutDraftPacketGeneration.js';

export type ThomasReviewDecision =
  | 'approve_draft'
  | 'hold_for_more_evidence'
  | 'wrong_business_name'
  | 'duplicate_existing_profile'
  | 'quarantine';

export type ThomasReviewVisibleFacts = {
  businessName?: string;
  phone?: string;
  website?: string;
  socials: {
    facebook?: string;
    instagram?: string;
    other?: string;
  };
  cuisineCategory?: string[];
  locationAddress?: string;
  scheduleHours?: string[];
  menuItems: Array<{ name: string; price?: string }>;
  logoCoverEvidenceIds: string[];
};

export type ThomasDraftReviewItem = {
  draftPacketId: string;
  trackerRowId?: string;
  candidateBusinessName: string;
  sourceEvidenceIds: string[];
  sourceFilenames: string[];
  extractedVisibleFacts: ThomasReviewVisibleFacts;
  missingFacts: string[];
  confidence: number;
  conflicts: MealScoutDraftPacketConflict[];
  ownerConfirmationRequired: boolean;
  ownerConfirmationReasons: string[];
  recommendedThomasDecision: ThomasReviewDecision;
  reasonForRecommendation: string;
  whySafeAsDraft: string;
};

export type ThomasHeldEvidenceItem = {
  driveFileId: string;
  sourceRowNumber?: number;
  finalFilename?: string;
  reason: string;
  artifactType?: string;
  detectedSignals: string[];
};

export type ThomasReviewQueue = {
  queueType: 'mealscout_thomas_review_queue';
  mode: 'review_queue_export_only';
  targetProduct: 'MealScout';
  liveMealScoutMutation: false;
  generatedAt: string;
  sourceArtifacts: {
    draftPackets: string;
    manifestSummary: string;
    unknownHeld: string;
    nonFoodQuarantine: string;
  };
  summary: {
    draftPacketsReviewed: number;
    cleanDraftCandidates: number;
    blockedByConflict: number;
    ownerConfirmationRequired: number;
    ownerConfirmationBucket: number;
    lowConfidenceOrVisualReview: number;
    unknownHeld: number;
    nonFoodQuarantine: number;
    uniqueDraftPacketsBucketed: number;
    conflictsFound: number;
  };
  buckets: {
    clean_draft_candidates: ThomasDraftReviewItem[];
    blocked_by_conflict: ThomasDraftReviewItem[];
    owner_confirmation_required: ThomasDraftReviewItem[];
    low_confidence_or_visual_review: ThomasDraftReviewItem[];
    unknown_held: ThomasHeldEvidenceItem[];
    non_food_quarantine: ThomasHeldEvidenceItem[];
  };
  safetyNotes: string[];
};

export type ThomasReviewQueueInput = {
  draftPackets: MealScoutDraftPacket[];
  manifestSummary?: {
    draftPacketsCreated?: number;
    conflictsFound?: number;
    ownerConfirmationsRequired?: number;
    unknownHeld?: number;
    nonFoodQuarantined?: number;
  };
  unknownHeldRows: MealScoutDraftPacketHeldRow[];
  nonFoodQuarantineRows: MealScoutDraftPacketHeldRow[];
  generatedAt?: string;
  sourceArtifacts?: Partial<ThomasReviewQueue['sourceArtifacts']>;
  lowConfidenceThreshold?: number;
};

const DEFAULT_LOW_CONFIDENCE_THRESHOLD = 0.6;
const REQUIRED_FACTS = ['businessName', 'contactOrSocial', 'cuisineCategory', 'locationAddress', 'scheduleHours', 'menuItems'] as const;

function unique(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean)));
}

function visibleFacts(packet: MealScoutDraftPacket): ThomasReviewVisibleFacts {
  return {
    businessName: packet.businessName?.value,
    phone: packet.phone?.value,
    website: packet.website?.value,
    socials: {
      facebook: packet.socials.facebook?.value,
      instagram: packet.socials.instagram?.value,
      other: packet.socials.other?.value
    },
    cuisineCategory: packet.cuisineCategory?.value,
    locationAddress: packet.locationAddress?.value,
    scheduleHours: packet.scheduleHours?.value,
    menuItems: packet.menuItems.map((item) => ({ name: item.name, price: item.price })),
    logoCoverEvidenceIds: packet.logoCoverEvidence.map((source) => source.driveFileId)
  };
}

function missingFacts(packet: MealScoutDraftPacket): string[] {
  const missing: string[] = [];
  if (!packet.businessName?.value) missing.push('businessName');
  if (!packet.phone?.value && !packet.website?.value && !packet.socials.facebook?.value && !packet.socials.instagram?.value && !packet.socials.other?.value) {
    missing.push('contactOrSocial');
  }
  if (!packet.cuisineCategory?.value?.length) missing.push('cuisineCategory');
  if (!packet.locationAddress?.value) missing.push('locationAddress');
  if (!packet.scheduleHours?.value?.length) missing.push('scheduleHours');
  if (packet.menuItems.length === 0) missing.push('menuItems');
  return REQUIRED_FACTS.filter((fact) => missing.includes(fact));
}

function recommendedDecision(packet: MealScoutDraftPacket, missing: string[], lowConfidence: boolean): {
  decision: ThomasReviewDecision;
  reason: string;
} {
  if (packet.conflicts.length > 0) {
    const nameConflict = packet.conflicts.some((conflict) => conflict.field === 'businessName');
    return {
      decision: nameConflict ? 'wrong_business_name' : 'hold_for_more_evidence',
      reason: `Conflict review required before this can be treated as a clean draft: ${packet.conflicts.map((conflict) => conflict.field).join(', ')}.`
    };
  }
  if (packet.ownerConfirmationRequired) {
    return {
      decision: 'hold_for_more_evidence',
      reason: `Owner confirmation is required for: ${packet.ownerConfirmationReasons.join(', ')}.`
    };
  }
  if (lowConfidence || packet.reviewStatus === 'missing_required_visible_fact') {
    return {
      decision: 'hold_for_more_evidence',
      reason: `Needs visual review before approval because ${lowConfidence ? `confidence is ${packet.confidence}` : 'required visible facts are missing'}${missing.length ? `; missing ${missing.join(', ')}` : ''}.`
    };
  }
  return {
    decision: 'approve_draft',
    reason: 'Visible evidence supports a clean review-only draft packet with no conflicts or owner-confirmation blockers.'
  };
}

function toDraftReviewItem(packet: MealScoutDraftPacket, lowConfidenceThreshold: number): ThomasDraftReviewItem {
  const sourceEvidenceIds = packet.sourceScreenshots.map((source) => source.driveFileId);
  const sourceFilenames = unique(packet.sourceScreenshots.map((source) => source.finalFilename));
  const missing = missingFacts(packet);
  const lowConfidence = packet.confidence < lowConfidenceThreshold;
  const recommendation = recommendedDecision(packet, missing, lowConfidence);

  return {
    draftPacketId: packet.packetId,
    trackerRowId: packet.trackerRowId,
    candidateBusinessName: packet.businessName?.value || 'missing visible business name',
    sourceEvidenceIds,
    sourceFilenames,
    extractedVisibleFacts: visibleFacts(packet),
    missingFacts: missing,
    confidence: packet.confidence,
    conflicts: packet.conflicts,
    ownerConfirmationRequired: packet.ownerConfirmationRequired,
    ownerConfirmationReasons: packet.ownerConfirmationReasons,
    recommendedThomasDecision: recommendation.decision,
    reasonForRecommendation: recommendation.reason,
    whySafeAsDraft:
      'This queue is generated from visible OCR-backed packet facts only and is review-only; it does not create, publish, or apply MealScout profile data.'
  };
}

function toHeldEvidenceItem(row: MealScoutDraftPacketHeldRow): ThomasHeldEvidenceItem {
  return {
    driveFileId: row.driveFileId,
    sourceRowNumber: row.sourceRowNumber,
    finalFilename: row.finalFilename,
    reason: row.reason,
    artifactType: row.artifactType,
    detectedSignals: row.detectedSignals
  };
}

export function buildThomasMealScoutReviewQueue(input: ThomasReviewQueueInput): ThomasReviewQueue {
  const lowConfidenceThreshold = input.lowConfidenceThreshold ?? DEFAULT_LOW_CONFIDENCE_THRESHOLD;
  const buckets: ThomasReviewQueue['buckets'] = {
    clean_draft_candidates: [],
    blocked_by_conflict: [],
    owner_confirmation_required: [],
    low_confidence_or_visual_review: [],
    unknown_held: input.unknownHeldRows.map(toHeldEvidenceItem),
    non_food_quarantine: input.nonFoodQuarantineRows.map(toHeldEvidenceItem)
  };

  for (const packet of input.draftPackets) {
    const item = toDraftReviewItem(packet, lowConfidenceThreshold);
    if (packet.conflicts.length > 0 || packet.reviewStatus === 'blocked_by_conflict') {
      buckets.blocked_by_conflict.push(item);
    } else if (packet.ownerConfirmationRequired) {
      buckets.owner_confirmation_required.push(item);
    } else if (packet.confidence < lowConfidenceThreshold || packet.reviewStatus === 'missing_required_visible_fact') {
      buckets.low_confidence_or_visual_review.push(item);
    } else {
      buckets.clean_draft_candidates.push(item);
    }
  }

  const uniqueDraftPacketsBucketed = new Set(
    [
      ...buckets.clean_draft_candidates,
      ...buckets.blocked_by_conflict,
      ...buckets.owner_confirmation_required,
      ...buckets.low_confidence_or_visual_review
    ].map((item) => item.draftPacketId)
  ).size;
  const ownerConfirmationRequired =
    input.manifestSummary?.ownerConfirmationsRequired ?? input.draftPackets.filter((packet) => packet.ownerConfirmationRequired).length;
  const conflictsFound = input.manifestSummary?.conflictsFound ?? input.draftPackets.reduce((acc, packet) => acc + packet.conflicts.length, 0);

  return {
    queueType: 'mealscout_thomas_review_queue',
    mode: 'review_queue_export_only',
    targetProduct: 'MealScout',
    liveMealScoutMutation: false,
    generatedAt: input.generatedAt || new Date().toISOString(),
    sourceArtifacts: {
      draftPackets: input.sourceArtifacts?.draftPackets || 'artifacts/mealscout-draft-profile-packets/draft-packets.json',
      manifestSummary: input.sourceArtifacts?.manifestSummary || 'artifacts/mealscout-draft-profile-packets/manifest-summary.json',
      unknownHeld: input.sourceArtifacts?.unknownHeld || 'artifacts/mealscout-draft-profile-packets/unknown-held.json',
      nonFoodQuarantine: input.sourceArtifacts?.nonFoodQuarantine || 'artifacts/mealscout-draft-profile-packets/non-food-quarantine.json'
    },
    summary: {
      draftPacketsReviewed: input.draftPackets.length,
      cleanDraftCandidates: buckets.clean_draft_candidates.length,
      blockedByConflict: buckets.blocked_by_conflict.length,
      ownerConfirmationRequired,
      ownerConfirmationBucket: buckets.owner_confirmation_required.length,
      lowConfidenceOrVisualReview: buckets.low_confidence_or_visual_review.length,
      unknownHeld: input.unknownHeldRows.length,
      nonFoodQuarantine: input.nonFoodQuarantineRows.length,
      uniqueDraftPacketsBucketed,
      conflictsFound
    },
    buckets,
    safetyNotes: [
      'Thomas review queue is export-only and does not create live MealScout profiles.',
      'Conflict-blocked drafts are excluded from clean draft candidates.',
      'Owner-confirmation facts remain review blockers until Thomas or the owner confirms them.',
      'Unknown-held evidence stays held for manual review.',
      'Non-food evidence remains quarantined for TradeScout or later routing.'
    ]
  };
}

export function renderThomasMealScoutReviewQueueMarkdown(queue: ThomasReviewQueue): string {
  const lines: string[] = [
    '# Thomas MealScout Draft Review Queue',
    '',
    `- Mode: ${queue.mode}`,
    `- Live MealScout mutation: ${queue.liveMealScoutMutation}`,
    `- Draft packets reviewed: ${queue.summary.draftPacketsReviewed}`,
    `- Clean draft candidates: ${queue.summary.cleanDraftCandidates}`,
    `- Blocked by conflict: ${queue.summary.blockedByConflict}`,
    `- Owner confirmation required: ${queue.summary.ownerConfirmationRequired}`,
    `- Owner confirmation bucket: ${queue.summary.ownerConfirmationBucket}`,
    `- Low confidence / visual review: ${queue.summary.lowConfidenceOrVisualReview}`,
    `- Unknown held: ${queue.summary.unknownHeld}`,
    `- Non-food quarantine: ${queue.summary.nonFoodQuarantine}`,
    '',
    '## Clean Draft Candidates',
    ''
  ];

  const renderItem = (item: ThomasDraftReviewItem): string[] => [
    `### ${item.candidateBusinessName}`,
    '',
    `- Draft packet: ${item.draftPacketId}`,
    `- Source evidence: ${item.sourceEvidenceIds.join(', ') || 'none'}`,
    `- Source files: ${item.sourceFilenames.join(', ') || 'none'}`,
    `- Confidence: ${item.confidence}`,
    `- Missing facts: ${item.missingFacts.join(', ') || 'none'}`,
    `- Recommended Thomas decision: ${item.recommendedThomasDecision}`,
    `- Reason: ${item.reasonForRecommendation}`,
    `- Visible facts: ${[
      item.extractedVisibleFacts.phone ? `phone ${item.extractedVisibleFacts.phone}` : '',
      item.extractedVisibleFacts.website ? `website ${item.extractedVisibleFacts.website}` : '',
      item.extractedVisibleFacts.socials.instagram ? `instagram ${item.extractedVisibleFacts.socials.instagram}` : '',
      item.extractedVisibleFacts.locationAddress ? `location ${item.extractedVisibleFacts.locationAddress}` : '',
      item.extractedVisibleFacts.cuisineCategory?.length ? `category ${item.extractedVisibleFacts.cuisineCategory.join('|')}` : '',
      item.extractedVisibleFacts.scheduleHours?.length ? `schedule ${item.extractedVisibleFacts.scheduleHours.join('|')}` : '',
      item.extractedVisibleFacts.menuItems.length ? `menu items ${item.extractedVisibleFacts.menuItems.length}` : ''
    ].filter(Boolean).join('; ') || 'business identity only'}`,
    ''
  ];

  for (const item of queue.buckets.clean_draft_candidates) lines.push(...renderItem(item));
  lines.push('## Blocked By Conflict', '');
  for (const item of queue.buckets.blocked_by_conflict) {
    lines.push(...renderItem(item));
    for (const conflict of item.conflicts) {
      lines.push(`- Thomas must decide ${conflict.field}: ${conflict.values.join(' vs ')} from ${conflict.sourceFileIds.join(', ')}`);
    }
    lines.push('');
  }
  lines.push('## Owner Confirmation Required', '');
  for (const item of queue.buckets.owner_confirmation_required) lines.push(...renderItem(item));
  lines.push('## Low Confidence Or Visual Review', '');
  for (const item of queue.buckets.low_confidence_or_visual_review) lines.push(...renderItem(item));
  lines.push('## Unknown Held Evidence', '');
  for (const item of queue.buckets.unknown_held.slice(0, 100)) {
    lines.push(`- ${item.driveFileId}: ${item.finalFilename || 'unknown file'}; reason=${item.reason}; artifact=${item.artifactType || 'unknown'}`);
  }
  if (queue.buckets.unknown_held.length > 100) lines.push(`- ... ${queue.buckets.unknown_held.length - 100} more unknown-held rows in JSON`);
  lines.push('', '## Non-Food Quarantine', '');
  for (const item of queue.buckets.non_food_quarantine.slice(0, 100)) {
    lines.push(`- ${item.driveFileId}: ${item.finalFilename || 'unknown file'}; reason=${item.reason}; artifact=${item.artifactType || 'unknown'}`);
  }
  if (queue.buckets.non_food_quarantine.length > 100) lines.push(`- ... ${queue.buckets.non_food_quarantine.length - 100} more quarantined rows in JSON`);
  lines.push('', '## Safety', '', ...queue.safetyNotes.map((note) => `- ${note}`), '');
  return lines.join('\n');
}
