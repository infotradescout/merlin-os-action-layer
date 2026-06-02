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
