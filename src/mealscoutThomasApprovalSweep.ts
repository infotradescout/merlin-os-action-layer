import type { ThomasDraftReviewItem, ThomasReviewDecision, ThomasReviewQueue, ThomasReviewVisibleFacts } from './mealscoutThomasReviewQueue.js';

export type ThomasApprovalSweepItem = {
  candidateNumber: number;
  draftPacketId: string;
  businessName: string;
  sourceScreenshots: Array<{
    driveFileId: string;
    finalFilename?: string;
  }>;
  extractedVisibleFacts: ThomasReviewVisibleFacts;
  missingFacts: string[];
  confidence: number;
  recommendedDecision: Extract<ThomasReviewDecision, 'approve_draft' | 'hold_for_more_evidence'>;
  reasonForRecommendation: string;
  draftOnlyWarning: string;
};

export type ThomasApprovalSweep = {
  sweepType: 'mealscout_thomas_clean_candidate_approval_sweep';
  mode: 'approval_sweep_export_only';
  targetProduct: 'MealScout';
  liveMealScoutMutation: false;
  generatedAt: string;
  sourceArtifacts: {
    thomasReviewQueue: string;
    draftPackets: string;
  };
  summary: {
    cleanCandidatesIncluded: number;
    excludedBlockedConflicts: number;
    excludedOwnerConfirmationRecords: number;
    excludedUnknownHeld: number;
    excludedNonFoodQuarantine: number;
  };
  candidates: ThomasApprovalSweepItem[];
  safetyNotes: string[];
};

export type ThomasApprovalSweepInput = {
  reviewQueue: ThomasReviewQueue;
  generatedAt?: string;
  sourceArtifacts?: Partial<ThomasApprovalSweep['sourceArtifacts']>;
};

const DRAFT_ONLY_WARNING = 'Approval creates a draft plan only; it does not create, publish, or apply live MealScout production data.';

function sourceScreenshots(item: ThomasDraftReviewItem): ThomasApprovalSweepItem['sourceScreenshots'] {
  return item.sourceEvidenceIds.map((driveFileId, index) => ({
    driveFileId,
    finalFilename: item.sourceFilenames[index] || item.sourceFilenames[0]
  }));
}

function approvalDecision(item: ThomasDraftReviewItem): ThomasApprovalSweepItem['recommendedDecision'] {
  if (item.recommendedThomasDecision === 'approve_draft') return 'approve_draft';
  return 'hold_for_more_evidence';
}

export function buildThomasCleanCandidateApprovalSweep(input: ThomasApprovalSweepInput): ThomasApprovalSweep {
  const cleanCandidates = input.reviewQueue.buckets.clean_draft_candidates;
  const candidates = cleanCandidates.map((item, index) => ({
    candidateNumber: index + 1,
    draftPacketId: item.draftPacketId,
    businessName: item.candidateBusinessName,
    sourceScreenshots: sourceScreenshots(item),
    extractedVisibleFacts: item.extractedVisibleFacts,
    missingFacts: item.missingFacts,
    confidence: item.confidence,
    recommendedDecision: approvalDecision(item),
    reasonForRecommendation: item.reasonForRecommendation,
    draftOnlyWarning: DRAFT_ONLY_WARNING
  }));

  return {
    sweepType: 'mealscout_thomas_clean_candidate_approval_sweep',
    mode: 'approval_sweep_export_only',
    targetProduct: 'MealScout',
    liveMealScoutMutation: false,
    generatedAt: input.generatedAt || new Date().toISOString(),
    sourceArtifacts: {
      thomasReviewQueue: input.sourceArtifacts?.thomasReviewQueue || 'artifacts/mealscout-draft-profile-packets/thomas-review-queue.json',
      draftPackets: input.sourceArtifacts?.draftPackets || 'artifacts/mealscout-draft-profile-packets/draft-packets.json'
    },
    summary: {
      cleanCandidatesIncluded: candidates.length,
      excludedBlockedConflicts: input.reviewQueue.buckets.blocked_by_conflict.length,
      excludedOwnerConfirmationRecords: input.reviewQueue.buckets.owner_confirmation_required.length,
      excludedUnknownHeld: input.reviewQueue.buckets.unknown_held.length,
      excludedNonFoodQuarantine: input.reviewQueue.buckets.non_food_quarantine.length
    },
    candidates,
    safetyNotes: [
      'This sweep includes only Thomas review queue clean_draft_candidates.',
      'Blocked conflicts, owner-confirmation records, unknown-held evidence, and non-food quarantine rows are excluded.',
      'Approval in this sweep creates a draft plan only and does not mutate live MealScout production data.',
      'No menus, schedules, logos, covers, or profile fields are applied by this artifact.'
    ]
  };
}

function formatVisibleFacts(facts: ThomasReviewVisibleFacts): string {
  return [
    facts.businessName ? `business ${facts.businessName}` : '',
    facts.phone ? `phone ${facts.phone}` : '',
    facts.website ? `website ${facts.website}` : '',
    facts.socials.facebook ? `facebook ${facts.socials.facebook}` : '',
    facts.socials.instagram ? `instagram ${facts.socials.instagram}` : '',
    facts.socials.other ? `social ${facts.socials.other}` : '',
    facts.cuisineCategory?.length ? `category ${facts.cuisineCategory.join('|')}` : '',
    facts.locationAddress ? `location ${facts.locationAddress}` : '',
    facts.scheduleHours?.length ? `schedule ${facts.scheduleHours.join('|')}` : '',
    facts.menuItems.length ? `menu items ${facts.menuItems.map((item) => `${item.name}${item.price ? ` ${item.price}` : ''}`).join('|')}` : '',
    facts.logoCoverEvidenceIds.length ? `logo/cover evidence ${facts.logoCoverEvidenceIds.join('|')}` : ''
  ]
    .filter(Boolean)
    .join('; ');
}

export function renderThomasCleanCandidateApprovalSweepMarkdown(sweep: ThomasApprovalSweep): string {
  const lines: string[] = [
    '# Thomas Clean Candidate Approval Sweep',
    '',
    `- Mode: ${sweep.mode}`,
    `- Live MealScout mutation: ${sweep.liveMealScoutMutation}`,
    `- Clean candidates included: ${sweep.summary.cleanCandidatesIncluded}`,
    `- Excluded blocked conflicts: ${sweep.summary.excludedBlockedConflicts}`,
    `- Excluded owner-confirmation records: ${sweep.summary.excludedOwnerConfirmationRecords}`,
    `- Excluded unknown-held evidence: ${sweep.summary.excludedUnknownHeld}`,
    `- Excluded non-food quarantine: ${sweep.summary.excludedNonFoodQuarantine}`,
    '',
    '## Candidates',
    ''
  ];

  for (const item of sweep.candidates) {
    lines.push(
      `### ${item.candidateNumber}. ${item.businessName}`,
      '',
      `- Draft packet: ${item.draftPacketId}`,
      `- Source screenshots: ${item.sourceScreenshots.map((source) => `${source.driveFileId}${source.finalFilename ? ` (${source.finalFilename})` : ''}`).join(', ')}`,
      `- Extracted visible facts: ${formatVisibleFacts(item.extractedVisibleFacts) || 'none'}`,
      `- Missing facts: ${item.missingFacts.join(', ') || 'none'}`,
      `- Confidence: ${item.confidence}`,
      `- Recommended decision: ${item.recommendedDecision}`,
      `- Reason: ${item.reasonForRecommendation}`,
      `- Warning: ${item.draftOnlyWarning}`,
      ''
    );
  }

  lines.push('## Safety', '', ...sweep.safetyNotes.map((note) => `- ${note}`), '');
  return lines.join('\n');
}
