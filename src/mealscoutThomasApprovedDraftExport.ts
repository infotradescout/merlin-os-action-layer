import type { ThomasApprovalSweep, ThomasApprovalSweepItem } from './mealscoutThomasApprovalSweep.js';

export type ThomasFinalDecision = 'approve_draft' | 'hold_for_more_evidence' | 'wrong_business_name' | 'duplicate_existing_profile' | 'quarantine';

export type ThomasAnnotatedApprovalSweepItem = ThomasApprovalSweepItem & {
  thomasDecision?: ThomasFinalDecision;
  thomasApprovalDecision?: ThomasFinalDecision;
  finalThomasDecision?: ThomasFinalDecision;
  decision?: ThomasFinalDecision;
  thomasDecisionReason?: string;
};

export type ThomasApprovedDraftExportItem = {
  candidateNumber: number;
  draftPacketId: string;
  businessName: string;
  thomasDecision: 'approve_draft';
  sourceEvidenceIds: string[];
  sourceScreenshots: Array<{
    driveFileId: string;
    finalFilename?: string;
  }>;
  extractedVisibleFacts: ThomasApprovalSweepItem['extractedVisibleFacts'];
  missingFacts: string[];
  confidence: number;
  nonProductionWarning: string;
  mutationAllowed: false;
  productionApplied: false;
};

export type ThomasApprovedDraftExport = {
  exportType: 'mealscout_thomas_approved_draft_export';
  mode: 'approved_draft_export_only';
  targetProduct: 'MealScout';
  mutationAllowed: false;
  productionApplied: false;
  generatedAt: string;
  sourceArtifacts: {
    approvalSweep: string;
  };
  summary: {
    candidatesReviewed: number;
    approvedDraftCount: number;
    excludedCount: number;
    excludedByDecisionType: Record<Exclude<ThomasFinalDecision, 'approve_draft'>, number>;
  };
  approvedDrafts: ThomasApprovedDraftExportItem[];
  safetyNotes: string[];
};

export type ThomasApprovedDraftExportInput = {
  approvalSweep: ThomasApprovalSweep & { candidates: ThomasAnnotatedApprovalSweepItem[] };
  generatedAt?: string;
  sourceArtifacts?: Partial<ThomasApprovedDraftExport['sourceArtifacts']>;
};

const NON_PRODUCTION_WARNING =
  'Approved draft export is review-only; mutationAllowed=false and productionApplied=false. It does not create, publish, or apply live MealScout data.';

function resolveThomasDecision(item: ThomasAnnotatedApprovalSweepItem): ThomasFinalDecision {
  const decision = item.thomasDecision || item.thomasApprovalDecision || item.finalThomasDecision || item.decision;
  if (!decision) {
    throw new Error(`explicit_thomas_decision_required:${item.draftPacketId}`);
  }
  return decision;
}

function initialExcludedCounts(): Record<Exclude<ThomasFinalDecision, 'approve_draft'>, number> {
  return {
    hold_for_more_evidence: 0,
    wrong_business_name: 0,
    duplicate_existing_profile: 0,
    quarantine: 0
  };
}

export function buildThomasApprovedDraftExport(input: ThomasApprovedDraftExportInput): ThomasApprovedDraftExport {
  const excludedByDecisionType = initialExcludedCounts();
  const approvedDrafts: ThomasApprovedDraftExportItem[] = [];

  for (const item of input.approvalSweep.candidates) {
    const decision = resolveThomasDecision(item);
    if (decision !== 'approve_draft') {
      excludedByDecisionType[decision] += 1;
      continue;
    }

    approvedDrafts.push({
      candidateNumber: item.candidateNumber,
      draftPacketId: item.draftPacketId,
      businessName: item.businessName,
      thomasDecision: 'approve_draft',
      sourceEvidenceIds: item.sourceScreenshots.map((source) => source.driveFileId),
      sourceScreenshots: item.sourceScreenshots,
      extractedVisibleFacts: item.extractedVisibleFacts,
      missingFacts: item.missingFacts,
      confidence: item.confidence,
      nonProductionWarning: NON_PRODUCTION_WARNING,
      mutationAllowed: false,
      productionApplied: false
    });
  }

  const excludedCount = Object.values(excludedByDecisionType).reduce((total, count) => total + count, 0);

  return {
    exportType: 'mealscout_thomas_approved_draft_export',
    mode: 'approved_draft_export_only',
    targetProduct: 'MealScout',
    mutationAllowed: false,
    productionApplied: false,
    generatedAt: input.generatedAt || new Date().toISOString(),
    sourceArtifacts: {
      approvalSweep: input.sourceArtifacts?.approvalSweep || 'artifacts/mealscout-draft-profile-packets/thomas-clean-candidate-approval-sweep.json'
    },
    summary: {
      candidatesReviewed: input.approvalSweep.candidates.length,
      approvedDraftCount: approvedDrafts.length,
      excludedCount,
      excludedByDecisionType
    },
    approvedDrafts,
    safetyNotes: [
      'Only candidates with Thomas decision approve_draft are included.',
      'Held, wrong-business-name, duplicate, and quarantine decisions are excluded.',
      'This export is non-production and cannot create live MealScout profiles.',
      'No menus, schedules, logos, covers, or profile fields are applied by this artifact.'
    ]
  };
}

function formatVisibleFacts(item: ThomasApprovedDraftExportItem): string {
  const facts = item.extractedVisibleFacts;
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
    facts.menuItems.length ? `menu items ${facts.menuItems.map((menuItem) => `${menuItem.name}${menuItem.price ? ` ${menuItem.price}` : ''}`).join('|')}` : '',
    facts.logoCoverEvidenceIds.length ? `logo/cover evidence ${facts.logoCoverEvidenceIds.join('|')}` : ''
  ]
    .filter(Boolean)
    .join('; ');
}

export function renderThomasApprovedDraftExportMarkdown(exportPacket: ThomasApprovedDraftExport): string {
  const lines: string[] = [
    '# Thomas Approved Draft Export',
    '',
    `- Mode: ${exportPacket.mode}`,
    `- Mutation allowed: ${exportPacket.mutationAllowed}`,
    `- Production applied: ${exportPacket.productionApplied}`,
    `- Candidates reviewed: ${exportPacket.summary.candidatesReviewed}`,
    `- Approved draft count: ${exportPacket.summary.approvedDraftCount}`,
    `- Excluded count: ${exportPacket.summary.excludedCount}`,
    `- Excluded hold for more evidence: ${exportPacket.summary.excludedByDecisionType.hold_for_more_evidence}`,
    `- Excluded wrong business name: ${exportPacket.summary.excludedByDecisionType.wrong_business_name}`,
    `- Excluded duplicate existing profile: ${exportPacket.summary.excludedByDecisionType.duplicate_existing_profile}`,
    `- Excluded quarantine: ${exportPacket.summary.excludedByDecisionType.quarantine}`,
    '',
    '## Approved Drafts',
    ''
  ];

  for (const item of exportPacket.approvedDrafts) {
    lines.push(
      `### ${item.candidateNumber}. ${item.businessName}`,
      '',
      `- Draft packet: ${item.draftPacketId}`,
      `- Source evidence IDs: ${item.sourceEvidenceIds.join(', ')}`,
      `- Source screenshots: ${item.sourceScreenshots.map((source) => `${source.driveFileId}${source.finalFilename ? ` (${source.finalFilename})` : ''}`).join(', ')}`,
      `- Extracted visible facts: ${formatVisibleFacts(item) || 'none'}`,
      `- Missing facts: ${item.missingFacts.join(', ') || 'none'}`,
      `- Confidence: ${item.confidence}`,
      `- Mutation allowed: ${item.mutationAllowed}`,
      `- Production applied: ${item.productionApplied}`,
      `- Warning: ${item.nonProductionWarning}`,
      ''
    );
  }

  lines.push('## Safety', '', ...exportPacket.safetyNotes.map((note) => `- ${note}`), '');
  return lines.join('\n');
}
