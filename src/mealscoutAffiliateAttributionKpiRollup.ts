import { listMealScoutBatchProcessedRecords, type MealScoutBatchProcessedRecord } from './mealscoutBatchIntakeState.js';
import { listMealScoutPublishExecutionAudit, type MealScoutPublishAuditEntry } from './mealscoutPublishExecution.js';

export type MealScoutAffiliateAttributionKpiRollup = {
  affiliate_attributed_screenshot_count: number;
  affiliate_unattributed_screenshot_count: number;
  affiliate_profile_seed_created_count: number;
  affiliate_profile_seed_updated_count: number;
  affiliate_attribution_warning_count: number;
  affiliate_verification_email_sent_count: number;
};

export type MealScoutAffiliateAttributionOperatorReportRow = {
  affiliate_attribution_email: string;
  attributed_screenshot_count: number;
  profile_seed_created_count: number;
  profile_seed_updated_count: number;
  attribution_warning_count: number;
  verification_email_sent_count: number;
  latest_processed_at?: string;
  latest_audit_at?: string;
  top_warning_codes: Array<{ code: string; count: number }>;
};

export type MealScoutAffiliateAttributionActionCard = {
  cardId: string;
  type:
    | 'affiliate_warning_review'
    | 'affiliate_unattributed_review'
    | 'affiliate_high_output_followup'
    | 'affiliate_verification_ready_followup'
    | 'affiliate_low_quality_review';
  affiliate_attribution_email: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  reason: string;
  sourceReportMetric: string;
  recommendedAction: string;
  status: 'open';
  createdAt: string;
  mutationAllowed: false;
  decisionStatus: MealScoutAffiliateAttributionActionCardDecisionStatus;
  decisionReason?: string;
  decisionNotes?: string;
  decidedAt?: string;
  decidedByUserId?: string;
};

export type MealScoutAffiliateAttributionActionCardDecisionStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'deferred'
  | 'completed_manually';

export type MealScoutAffiliateAttributionActionCardDecisionRecord = {
  cardId: string;
  decisionStatus: MealScoutAffiliateAttributionActionCardDecisionStatus;
  decisionReason?: string;
  decisionNotes?: string;
  decidedAt: string;
  decidedByUserId?: string;
  affiliate_attribution_email: string;
};

export type MealScoutAffiliateAttributionDecisionRollupGroup = {
  key: string;
  affiliate_attribution_email?: string;
  cardType?: MealScoutAffiliateAttributionActionCard['type'];
  priority?: MealScoutAffiliateAttributionActionCard['priority'];
  decisionStatus?: MealScoutAffiliateAttributionActionCardDecisionStatus;
  total: number;
  pending: number;
  accepted: number;
  rejected: number;
  deferred: number;
  completed_manually: number;
};

export type MealScoutAffiliateAttributionDecisionRollup = {
  affiliateActionCardsTotal: number;
  affiliateActionCardsPending: number;
  affiliateActionCardsAccepted: number;
  affiliateActionCardsRejected: number;
  affiliateActionCardsDeferred: number;
  affiliateActionCardsCompletedManually: number;
  affiliateActionCardDecisionRate: number;
  affiliateActionCardManualCompletionRate: number;
  affiliateHighPriorityPendingCount: number;
  byAffiliate: MealScoutAffiliateAttributionDecisionRollupGroup[];
  byCardType: MealScoutAffiliateAttributionDecisionRollupGroup[];
  byPriority: MealScoutAffiliateAttributionDecisionRollupGroup[];
  byDecisionStatus: MealScoutAffiliateAttributionDecisionRollupGroup[];
};

export const MEALSCOUT_AFFILIATE_ACTION_CARD_DECISION_STATUSES: MealScoutAffiliateAttributionActionCardDecisionStatus[] = [
  'pending',
  'accepted',
  'rejected',
  'deferred',
  'completed_manually'
];

const actionCardDecisions = new Map<string, MealScoutAffiliateAttributionActionCardDecisionRecord>();

function emptyDecisionGroup(
  key: string,
  extra: Partial<MealScoutAffiliateAttributionDecisionRollupGroup> = {}
): MealScoutAffiliateAttributionDecisionRollupGroup {
  return {
    key,
    total: 0,
    pending: 0,
    accepted: 0,
    rejected: 0,
    deferred: 0,
    completed_manually: 0,
    ...extra
  };
}

function addCardToDecisionGroup(
  group: MealScoutAffiliateAttributionDecisionRollupGroup,
  card: Pick<MealScoutAffiliateAttributionActionCard, 'decisionStatus'>
): void {
  group.total += 1;
  if (card.decisionStatus === 'pending') group.pending += 1;
  if (card.decisionStatus === 'accepted') group.accepted += 1;
  if (card.decisionStatus === 'rejected') group.rejected += 1;
  if (card.decisionStatus === 'deferred') group.deferred += 1;
  if (card.decisionStatus === 'completed_manually') group.completed_manually += 1;
}

function roundedRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function hasFolderAttribution(value: { affiliate_attribution_email?: string } | undefined): boolean {
  return Boolean(value?.affiliate_attribution_email?.trim());
}

function attributionKey(value: { affiliate_attribution_email?: string } | undefined): string {
  return value?.affiliate_attribution_email?.trim().toLowerCase() || 'unattributed';
}

function warningCount(value: { affiliate_attribution_warnings?: string[] } | undefined): number {
  return Array.isArray(value?.affiliate_attribution_warnings)
    ? value.affiliate_attribution_warnings.filter((item) => item.trim()).length
    : 0;
}

function addWarnings(
  warningCodes: Map<string, number>,
  value: { affiliate_attribution_warnings?: string[] } | undefined
): void {
  for (const warning of value?.affiliate_attribution_warnings || []) {
    const code = warning.trim();
    if (!code) continue;
    warningCodes.set(code, (warningCodes.get(code) || 0) + 1);
  }
}

function latestTimestamp(current: string | undefined, candidate: string | undefined): string | undefined {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate.localeCompare(current) > 0 ? candidate : current;
}

export function buildMealScoutAffiliateAttributionKpiRollup(input: {
  processedFiles?: MealScoutBatchProcessedRecord[];
  audits?: MealScoutPublishAuditEntry[];
} = {}): MealScoutAffiliateAttributionKpiRollup {
  const processedFiles = input.processedFiles || [];
  const audits = input.audits || [];
  const successfulAttributedAudits = audits.filter((entry) => entry.result === 'success' && hasFolderAttribution(entry.sourceAttribution));

  return {
    affiliate_attributed_screenshot_count: processedFiles.filter((record) => hasFolderAttribution(record.sourceFileAttribution)).length,
    affiliate_unattributed_screenshot_count: processedFiles.filter((record) => !hasFolderAttribution(record.sourceFileAttribution)).length,
    affiliate_profile_seed_created_count: successfulAttributedAudits.filter((entry) => entry.action === 'create_new').length,
    affiliate_profile_seed_updated_count: successfulAttributedAudits.filter((entry) => entry.action === 'update_existing').length,
    affiliate_attribution_warning_count:
      processedFiles.reduce((total, record) => total + warningCount(record.sourceFileAttribution), 0) +
      successfulAttributedAudits.reduce((total, entry) => total + warningCount(entry.sourceAttribution), 0),
    affiliate_verification_email_sent_count: successfulAttributedAudits.filter((entry) => Boolean(entry.newValues?.email?.trim())).length
  };
}

export function getMealScoutAffiliateAttributionKpiRollup(): MealScoutAffiliateAttributionKpiRollup {
  return buildMealScoutAffiliateAttributionKpiRollup({
    processedFiles: listMealScoutBatchProcessedRecords(),
    audits: listMealScoutPublishExecutionAudit()
  });
}

export function buildMealScoutAffiliateAttributionOperatorReport(input: {
  processedFiles?: MealScoutBatchProcessedRecord[];
  audits?: MealScoutPublishAuditEntry[];
  includeUnattributed?: boolean;
} = {}): MealScoutAffiliateAttributionOperatorReportRow[] {
  const processedFiles = input.processedFiles || [];
  const audits = input.audits || [];
  const includeUnattributed = input.includeUnattributed !== false;
  const groups = new Map<string, MealScoutAffiliateAttributionOperatorReportRow & { warningCodes: Map<string, number> }>();

  const ensureGroup = (email: string) => {
    const key = email || 'unattributed';
    if (!groups.has(key)) {
      groups.set(key, {
        affiliate_attribution_email: key,
        attributed_screenshot_count: 0,
        profile_seed_created_count: 0,
        profile_seed_updated_count: 0,
        attribution_warning_count: 0,
        verification_email_sent_count: 0,
        top_warning_codes: [],
        warningCodes: new Map<string, number>()
      });
    }
    return groups.get(key)!;
  };

  for (const record of processedFiles) {
    const key = attributionKey(record.sourceFileAttribution);
    if (key === 'unattributed' && !includeUnattributed) continue;
    const group = ensureGroup(key);
    if (key !== 'unattributed') group.attributed_screenshot_count += 1;
    group.latest_processed_at = latestTimestamp(group.latest_processed_at, record.processedAt);
    const warnings = warningCount(record.sourceFileAttribution);
    group.attribution_warning_count += warnings;
    addWarnings(group.warningCodes, record.sourceFileAttribution);
  }

  for (const entry of audits) {
    if (entry.result !== 'success') continue;
    const key = attributionKey(entry.sourceAttribution);
    if (key === 'unattributed' && !includeUnattributed) continue;
    const group = ensureGroup(key);
    if (entry.action === 'create_new') group.profile_seed_created_count += 1;
    if (entry.action === 'update_existing') group.profile_seed_updated_count += 1;
    if (entry.newValues?.email?.trim()) group.verification_email_sent_count += 1;
    group.latest_audit_at = latestTimestamp(group.latest_audit_at, entry.executedAt);
    const warnings = warningCount(entry.sourceAttribution);
    group.attribution_warning_count += warnings;
    addWarnings(group.warningCodes, entry.sourceAttribution);
  }

  return Array.from(groups.values())
    .map((group) => {
      const { warningCodes, ...row } = group;
      return {
        ...row,
        top_warning_codes: Array.from(warningCodes.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([code, count]) => ({ code, count }))
      };
    })
    .sort((a, b) => {
      if (a.affiliate_attribution_email === 'unattributed') return 1;
      if (b.affiliate_attribution_email === 'unattributed') return -1;
      const aActivity = a.latest_audit_at || a.latest_processed_at || '';
      const bActivity = b.latest_audit_at || b.latest_processed_at || '';
      return bActivity.localeCompare(aActivity) || a.affiliate_attribution_email.localeCompare(b.affiliate_attribution_email);
    });
}

export function getMealScoutAffiliateAttributionOperatorReport(options?: {
  includeUnattributed?: boolean;
}): MealScoutAffiliateAttributionOperatorReportRow[] {
  return buildMealScoutAffiliateAttributionOperatorReport({
    processedFiles: listMealScoutBatchProcessedRecords(),
    audits: listMealScoutPublishExecutionAudit(),
    includeUnattributed: options?.includeUnattributed
  });
}

function applyDecisionState(card: MealScoutAffiliateAttributionActionCard): MealScoutAffiliateAttributionActionCard {
  const decision = actionCardDecisions.get(card.cardId);
  if (!decision) return { ...card, decisionStatus: 'pending' };
  return {
    ...card,
    decisionStatus: decision.decisionStatus,
    decisionReason: decision.decisionReason,
    decisionNotes: decision.decisionNotes,
    decidedAt: decision.decidedAt,
    decidedByUserId: decision.decidedByUserId,
    affiliate_attribution_email: decision.affiliate_attribution_email
  };
}

function makeCard(input: Omit<MealScoutAffiliateAttributionActionCard, 'cardId' | 'status' | 'createdAt' | 'mutationAllowed' | 'decisionStatus'>, createdAt: string): MealScoutAffiliateAttributionActionCard {
  const safeEmail = input.affiliate_attribution_email.replace(/[^a-z0-9._@+-]/gi, '-').toLowerCase();
  return applyDecisionState({
    ...input,
    cardId: `ms-affiliate-${input.type}-${safeEmail}`,
    status: 'open',
    createdAt,
    mutationAllowed: false,
    decisionStatus: 'pending'
  });
}

export function buildMealScoutAffiliateAttributionActionCards(
  reportRows: MealScoutAffiliateAttributionOperatorReportRow[],
  options?: { createdAt?: string }
): MealScoutAffiliateAttributionActionCard[] {
  const createdAt = options?.createdAt || new Date().toISOString();
  const cards: MealScoutAffiliateAttributionActionCard[] = [];

  for (const row of reportRows) {
    if (row.affiliate_attribution_email === 'unattributed') {
      const volume = Math.max(row.attribution_warning_count, row.profile_seed_created_count + row.profile_seed_updated_count);
      cards.push(makeCard({
        type: 'affiliate_unattributed_review',
        affiliate_attribution_email: 'unattributed',
        title: 'Review unattributed MealScout screenshots',
        description: 'Screenshots without affiliate folder attribution need operator review before credit can be assigned.',
        priority: volume >= 3 ? 'high' : 'medium',
        reason: 'unattributed_bucket_present',
        sourceReportMetric: 'affiliate_attribution_email=unattributed',
        recommendedAction: 'Review intake folder placement and add valid affiliate folder email tokens where appropriate.'
      }, createdAt));
      continue;
    }

    if (row.attribution_warning_count >= 2) {
      const topWarning = row.top_warning_codes[0]?.code || 'affiliate_attribution_warning';
      cards.push(makeCard({
        type: 'affiliate_warning_review',
        affiliate_attribution_email: row.affiliate_attribution_email,
        title: `Review attribution warnings for ${row.affiliate_attribution_email}`,
        description: `${row.affiliate_attribution_email} has ${row.attribution_warning_count} attribution warning(s).`,
        priority: row.attribution_warning_count >= 4 ? 'high' : 'medium',
        reason: topWarning,
        sourceReportMetric: 'attribution_warning_count',
        recommendedAction: 'Inspect folder naming and source paths before assigning operational credit.'
      }, createdAt));
    }

    if (row.verification_email_sent_count > 0) {
      cards.push(makeCard({
        type: 'affiliate_verification_ready_followup',
        affiliate_attribution_email: row.affiliate_attribution_email,
        title: `Follow up on verification-ready profiles from ${row.affiliate_attribution_email}`,
        description: `${row.affiliate_attribution_email} produced ${row.verification_email_sent_count} profile seed(s) with extracted business email.`,
        priority: 'high',
        reason: 'business_email_extracted_from_seed',
        sourceReportMetric: 'verification_email_sent_count',
        recommendedAction: 'Operator should review the business email and decide whether to send a claim or verification follow-up.'
      }, createdAt));
    }

    const seedCount = row.profile_seed_created_count + row.profile_seed_updated_count;
    if (row.attributed_screenshot_count >= 3 || seedCount >= 2) {
      cards.push(makeCard({
        type: 'affiliate_high_output_followup',
        affiliate_attribution_email: row.affiliate_attribution_email,
        title: `High output affiliate folder: ${row.affiliate_attribution_email}`,
        description: `${row.affiliate_attribution_email} produced ${row.attributed_screenshot_count} attributed screenshot(s) and ${seedCount} profile seed action(s).`,
        priority: 'medium',
        reason: 'high_output_affiliate_folder',
        sourceReportMetric: seedCount >= 2 ? 'profile_seed_total' : 'attributed_screenshot_count',
        recommendedAction: 'Review quality, thank the contributor, and request more screenshots if the work is useful.'
      }, createdAt));
    }

    if (row.attributed_screenshot_count >= 2 && seedCount === 0) {
      cards.push(makeCard({
        type: 'affiliate_low_quality_review',
        affiliate_attribution_email: row.affiliate_attribution_email,
        title: `Review low-yield affiliate folder: ${row.affiliate_attribution_email}`,
        description: `${row.affiliate_attribution_email} has attributed screenshots but no created or updated profile seeds.`,
        priority: 'medium',
        reason: 'screenshots_without_profile_seed',
        sourceReportMetric: 'attributed_screenshot_count',
        recommendedAction: 'Inspect screenshot quality and give the operator or affiliate clearer capture guidance.'
      }, createdAt));
    }
  }

  return cards.sort((a, b) => {
    const priorityRank = { high: 0, medium: 1, low: 2 };
    return priorityRank[a.priority] - priorityRank[b.priority] || a.type.localeCompare(b.type) || a.affiliate_attribution_email.localeCompare(b.affiliate_attribution_email);
  });
}

export function getMealScoutAffiliateAttributionActionCards(options?: {
  includeUnattributed?: boolean;
}): MealScoutAffiliateAttributionActionCard[] {
  return buildMealScoutAffiliateAttributionActionCards(
    getMealScoutAffiliateAttributionOperatorReport({ includeUnattributed: options?.includeUnattributed })
  );
}

export function decideMealScoutAffiliateAttributionActionCard(input: {
  cardId: string;
  decisionStatus: MealScoutAffiliateAttributionActionCardDecisionStatus;
  decisionReason?: string;
  decisionNotes?: string;
  decidedByUserId?: string;
}): MealScoutAffiliateAttributionActionCardDecisionRecord {
  const cardId = input.cardId.trim();
  if (!cardId) throw new Error('card_id_required');
  if (!MEALSCOUT_AFFILIATE_ACTION_CARD_DECISION_STATUSES.includes(input.decisionStatus)) {
    throw new Error('invalid_decision_status');
  }
  const cards = getMealScoutAffiliateAttributionActionCards({ includeUnattributed: true });
  const card = cards.find((item) => item.cardId === cardId);
  if (!card) throw new Error('action_card_not_found');
  const record: MealScoutAffiliateAttributionActionCardDecisionRecord = {
    cardId,
    decisionStatus: input.decisionStatus,
    decisionReason: input.decisionReason?.trim() || undefined,
    decisionNotes: input.decisionNotes?.trim() || undefined,
    decidedAt: new Date().toISOString(),
    decidedByUserId: input.decidedByUserId?.trim() || undefined,
    affiliate_attribution_email: card.affiliate_attribution_email
  };
  actionCardDecisions.set(cardId, record);
  return record;
}

export function listMealScoutAffiliateAttributionActionCardDecisions(): MealScoutAffiliateAttributionActionCardDecisionRecord[] {
  return Array.from(actionCardDecisions.values()).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
}

export function resetMealScoutAffiliateAttributionActionCardDecisionsForTest(): void {
  actionCardDecisions.clear();
}

export function buildMealScoutAffiliateAttributionDecisionRollup(
  cards: MealScoutAffiliateAttributionActionCard[]
): MealScoutAffiliateAttributionDecisionRollup {
  const byAffiliate = new Map<string, MealScoutAffiliateAttributionDecisionRollupGroup>();
  const byCardType = new Map<string, MealScoutAffiliateAttributionDecisionRollupGroup>();
  const byPriority = new Map<string, MealScoutAffiliateAttributionDecisionRollupGroup>();
  const byDecisionStatus = new Map<string, MealScoutAffiliateAttributionDecisionRollupGroup>();

  const totals = emptyDecisionGroup('all');
  for (const card of cards) {
    addCardToDecisionGroup(totals, card);

    const affiliateKey = card.affiliate_attribution_email || 'unattributed';
    if (!byAffiliate.has(affiliateKey)) {
      byAffiliate.set(affiliateKey, emptyDecisionGroup(affiliateKey, { affiliate_attribution_email: affiliateKey }));
    }
    addCardToDecisionGroup(byAffiliate.get(affiliateKey)!, card);

    const cardTypeKey = card.type;
    if (!byCardType.has(cardTypeKey)) {
      byCardType.set(cardTypeKey, emptyDecisionGroup(cardTypeKey, { cardType: card.type }));
    }
    addCardToDecisionGroup(byCardType.get(cardTypeKey)!, card);

    const priorityKey = card.priority;
    if (!byPriority.has(priorityKey)) {
      byPriority.set(priorityKey, emptyDecisionGroup(priorityKey, { priority: card.priority }));
    }
    addCardToDecisionGroup(byPriority.get(priorityKey)!, card);

    const statusKey = card.decisionStatus;
    if (!byDecisionStatus.has(statusKey)) {
      byDecisionStatus.set(statusKey, emptyDecisionGroup(statusKey, { decisionStatus: card.decisionStatus }));
    }
    addCardToDecisionGroup(byDecisionStatus.get(statusKey)!, card);
  }

  const decidedCount = totals.accepted + totals.rejected + totals.deferred + totals.completed_manually;
  return {
    affiliateActionCardsTotal: totals.total,
    affiliateActionCardsPending: totals.pending,
    affiliateActionCardsAccepted: totals.accepted,
    affiliateActionCardsRejected: totals.rejected,
    affiliateActionCardsDeferred: totals.deferred,
    affiliateActionCardsCompletedManually: totals.completed_manually,
    affiliateActionCardDecisionRate: roundedRate(decidedCount, totals.total),
    affiliateActionCardManualCompletionRate: roundedRate(totals.completed_manually, totals.total),
    affiliateHighPriorityPendingCount: cards.filter((card) => card.priority === 'high' && card.decisionStatus === 'pending').length,
    byAffiliate: Array.from(byAffiliate.values()).sort((a, b) => a.key.localeCompare(b.key)),
    byCardType: Array.from(byCardType.values()).sort((a, b) => a.key.localeCompare(b.key)),
    byPriority: Array.from(byPriority.values()).sort((a, b) => a.key.localeCompare(b.key)),
    byDecisionStatus: Array.from(byDecisionStatus.values()).sort((a, b) => a.key.localeCompare(b.key))
  };
}

export function getMealScoutAffiliateAttributionDecisionRollup(options?: {
  includeUnattributed?: boolean;
}): MealScoutAffiliateAttributionDecisionRollup {
  return buildMealScoutAffiliateAttributionDecisionRollup(
    getMealScoutAffiliateAttributionActionCards({ includeUnattributed: options?.includeUnattributed })
  );
}
