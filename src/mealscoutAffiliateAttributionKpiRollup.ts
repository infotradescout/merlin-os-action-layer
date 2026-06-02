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

function hasFolderAttribution(value: { affiliate_attribution_email?: string } | undefined): boolean {
  return Boolean(value?.affiliate_attribution_email?.trim());
}

function warningCount(value: { affiliate_attribution_warnings?: string[] } | undefined): number {
  return Array.isArray(value?.affiliate_attribution_warnings)
    ? value.affiliate_attribution_warnings.filter((item) => item.trim()).length
    : 0;
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
