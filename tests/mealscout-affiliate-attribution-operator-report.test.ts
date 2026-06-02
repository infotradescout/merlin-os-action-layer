import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { rememberMealScoutBatchProcessedRecord } = await import('../src/mealscoutBatchIntakeState.ts');
const { seedMealScoutTruck } = await import('../src/mealscoutProfileImport.ts');
const { rememberMealScoutPublishPlan } = await import('../src/mealscoutPublishPlan.ts');
const { executeMealScoutPublishPlan } = await import('../src/mealscoutPublishExecution.ts');
const { getMealScoutAffiliateAttributionOperatorReport } = await import('../src/mealscoutAffiliateAttributionKpiRollup.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');

let server: Server;
let baseUrl = '';

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
    ...init
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T };
}

before(async () => {
  server = createMerlinServer();
  await new Promise<void>((resolveStart, reject) => {
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Server did not bind to numeric port'));
        return;
      }
      baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
      resolveStart();
    });
  });
});

after(async () => {
  await new Promise<void>((resolveStop) => server.close(() => resolveStop()));
  closeLisaStore();
  closeDriveManifestStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
});

function attributedSource(email: string, warnings: string[] = []) {
  return {
    attributionSource: 'folder_context' as const,
    attributionStatus: 'matched_affiliate_folder' as const,
    affiliate_attribution_email: email,
    affiliate_attribution_source: 'folder_email_token' as const,
    affiliate_attribution_folder: email,
    affiliate_attribution_folder_path: `MealScout Intake/${email}`,
    affiliate_attribution_warnings: warnings,
    capturedAt: '2026-06-02T00:00:00.000Z'
  };
}

function plannedField(value: string, sourceFileId: string) {
  return {
    value,
    evidenceRefs: [`ev-${sourceFileId}`],
    sourceFileIds: [sourceFileId]
  };
}

function seedProcessedFiles() {
  rememberMealScoutBatchProcessedRecord({
    fileId: 'alpha-profile-1',
    fileName: 'alpha-profile.png',
    processedAt: '2026-06-02T00:00:00.000Z',
    batchId: 'batch-report-1',
    classification: 'profile',
    ocrSucceeded: true,
    extractedTextLength: 140,
    sourceEvidenceRefs: ['ev-alpha-profile-1'],
    sourceFileAttribution: attributedSource('alpha@example.com', ['multiple_email_named_parent_folders'])
  });
  rememberMealScoutBatchProcessedRecord({
    fileId: 'alpha-menu-1',
    fileName: 'alpha-menu.png',
    processedAt: '2026-06-02T00:03:00.000Z',
    batchId: 'batch-report-1',
    classification: 'menu',
    ocrSucceeded: true,
    extractedTextLength: 90,
    sourceEvidenceRefs: ['ev-alpha-menu-1'],
    sourceFileAttribution: attributedSource('alpha@example.com', ['multiple_email_named_parent_folders'])
  });
  rememberMealScoutBatchProcessedRecord({
    fileId: 'beta-profile-1',
    fileName: 'beta-profile.png',
    processedAt: '2026-06-02T00:04:00.000Z',
    batchId: 'batch-report-1',
    classification: 'profile',
    ocrSucceeded: true,
    extractedTextLength: 120,
    sourceEvidenceRefs: ['ev-beta-profile-1'],
    sourceFileAttribution: attributedSource('beta@example.com')
  });
  rememberMealScoutBatchProcessedRecord({
    fileId: 'unattributed-profile-1',
    fileName: 'unattributed-profile.png',
    processedAt: '2026-06-02T00:05:00.000Z',
    batchId: 'batch-report-1',
    classification: 'profile',
    ocrSucceeded: true,
    extractedTextLength: 80,
    sourceEvidenceRefs: ['ev-unattributed-profile-1'],
    sourceFileAttribution: {
      attributionSource: 'unknown',
      attributionStatus: 'unknown',
      affiliate_attribution_warnings: ['invalid_email_named_parent_folder']
    }
  });
}

function seedPublishExecution() {
  const existing = seedMealScoutTruck({
    truckName: 'Beta Bowls',
    phone: '504-555-3000',
    cityArea: 'Metairie'
  });
  const plan = rememberMealScoutPublishPlan({
    planId: 'ms-plan-affiliate-report',
    signature: 'sig-affiliate-report',
    reviewDecisionVersion: 0,
    generatedAt: '2026-06-02T00:06:00.000Z',
    mutationAllowed: false,
    records: [
      {
        recordId: 'alpha-create',
        plannedAction: 'create_new',
        publishReady: true,
        draftIds: ['alpha-draft'],
        profileFields: {
          truckName: plannedField('Alpha Tacos', 'alpha-profile-1'),
          phone: plannedField('504-555-1000', 'alpha-profile-1'),
          email: plannedField('alpha-business@example.biz', 'alpha-profile-1'),
          cityArea: plannedField('Metairie', 'alpha-profile-1')
        },
        menuItems: [{ name: 'Taco', price: '$4.00', evidenceRefs: ['ev-alpha-menu-1'], sourceFileIds: ['alpha-menu-1'] }],
        sourceAttribution: {
          contributingRepIds: [],
          sourceFileIds: ['alpha-profile-1', 'alpha-menu-1'],
          attributionPolicy: 'folder_credit_only',
          ...attributedSource('alpha@example.com', ['multiple_email_named_parent_folders'])
        }
      },
      {
        recordId: 'beta-update',
        plannedAction: 'update_existing',
        publishReady: true,
        draftIds: ['beta-draft'],
        existingTruckId: existing.id,
        profileFields: {
          truckName: plannedField('Beta Bowls', 'beta-profile-1'),
          phone: plannedField('504-555-3001', 'beta-profile-1'),
          cityArea: plannedField('Metairie', 'beta-profile-1')
        },
        menuItems: [{ name: 'Bowl', price: '$8.00', evidenceRefs: ['ev-beta-profile-1'], sourceFileIds: ['beta-profile-1'] }],
        sourceAttribution: {
          contributingRepIds: [],
          sourceFileIds: ['beta-profile-1'],
          attributionPolicy: 'folder_credit_only',
          ...attributedSource('beta@example.com')
        }
      }
    ]
  });
  executeMealScoutPublishPlan({
    planId: plan.planId,
    recordIds: plan.records.map((record) => record.recordId),
    confirmation: true,
    operatorId: 'staff-user-1',
    expectedSignature: plan.signature
  });
}

test('affiliate attribution operator report groups production by folder email and separates outcomes', async () => {
  seedProcessedFiles();
  seedPublishExecution();

  const direct = getMealScoutAffiliateAttributionOperatorReport();
  const alpha = direct.find((row) => row.affiliate_attribution_email === 'alpha@example.com');
  const beta = direct.find((row) => row.affiliate_attribution_email === 'beta@example.com');
  const unattributed = direct.find((row) => row.affiliate_attribution_email === 'unattributed');

  assert.ok(alpha);
  assert.equal(alpha.attributed_screenshot_count, 2);
  assert.equal(alpha.profile_seed_created_count, 1);
  assert.equal(alpha.profile_seed_updated_count, 0);
  assert.equal(alpha.verification_email_sent_count, 1);
  assert.equal(alpha.attribution_warning_count, 3);
  assert.equal(alpha.top_warning_codes[0]?.code, 'multiple_email_named_parent_folders');
  assert.equal(alpha.top_warning_codes[0]?.count, 3);
  assert.equal(alpha.latest_processed_at, '2026-06-02T00:03:00.000Z');
  assert.equal(Boolean(alpha.latest_audit_at), true);

  assert.ok(beta);
  assert.equal(beta.attributed_screenshot_count, 1);
  assert.equal(beta.profile_seed_created_count, 0);
  assert.equal(beta.profile_seed_updated_count, 1);
  assert.equal(beta.verification_email_sent_count, 0);
  assert.equal(beta.attribution_warning_count, 0);

  assert.ok(unattributed);
  assert.equal(unattributed.attributed_screenshot_count, 0);
  assert.equal(unattributed.attribution_warning_count, 1);

  const report = await requestJson<{ report: typeof direct }>('/api/mealscout/intake/affiliate-attribution/report', {
    headers: { 'x-operator-role': 'operator' }
  });
  assert.equal(report.status, 200);
  assert.equal(report.body.report.some((row) => row.affiliate_attribution_email === 'alpha@example.com'), true);
  assert.equal(report.body.report.some((row) => row.affiliate_attribution_email === 'unattributed'), true);

  const attributedOnly = await requestJson<{ report: typeof direct }>('/api/mealscout/intake/affiliate-attribution/report?includeUnattributed=false', {
    headers: { 'x-operator-role': 'staff' }
  });
  assert.equal(attributedOnly.status, 200);
  assert.equal(attributedOnly.body.report.some((row) => row.affiliate_attribution_email === 'unattributed'), false);
});

test('operator report is gated and does not treat folder attribution as business email or cross-brand identity', async () => {
  seedProcessedFiles();
  seedPublishExecution();

  const denied = await requestJson<{ error: string }>('/api/mealscout/intake/affiliate-attribution/report', {
    headers: { 'x-operator-role': 'viewer' }
  });
  assert.equal(denied.status, 403);

  const report = await requestJson<{
    report: Array<{
      affiliate_attribution_email: string;
      verification_email_sent_count: number;
      business_profile_email?: string;
      affiliateEmail?: string;
      affiliateCode?: string;
      brand_lane?: string;
    }>;
  }>('/api/mealscout/intake/affiliate-attribution/report', {
    headers: { 'x-operator-role': 'admin' }
  });
  assert.equal(report.status, 200);
  const alpha = report.body.report.find((row) => row.affiliate_attribution_email === 'alpha@example.com');
  assert.ok(alpha);
  assert.equal(alpha.verification_email_sent_count, 1);
  assert.equal(alpha.business_profile_email, undefined);
  assert.equal(alpha.affiliateEmail, undefined);
  assert.equal(alpha.affiliateCode, undefined);
  assert.equal(alpha.brand_lane, undefined);
});
