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
const { getMealScoutAffiliateAttributionKpiRollup } = await import('../src/mealscoutAffiliateAttributionKpiRollup.ts');
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

const attributedSource = {
  attributionSource: 'folder_context' as const,
  attributionStatus: 'matched_affiliate_folder' as const,
  affiliate_attribution_email: 'foldercredit@example.com',
  affiliate_attribution_source: 'email_named_parent_folder' as const,
  affiliate_attribution_folder: 'FolderCredit@Example.com',
  affiliate_attribution_folder_path: 'MealScout Intake/FolderCredit@Example.com',
  affiliate_attribution_warnings: ['multiple_email_named_parent_folders'],
  capturedAt: '2026-06-02T00:00:00.000Z'
};

function plannedField(value: string, sourceFileId: string) {
  return {
    value,
    evidenceRefs: [`ev-${sourceFileId}`],
    sourceFileIds: [sourceFileId]
  };
}

function seedProcessedFiles() {
  rememberMealScoutBatchProcessedRecord({
    fileId: 'attributed-screenshot-1',
    fileName: 'attributed-profile.png',
    processedAt: '2026-06-02T00:00:00.000Z',
    batchId: 'batch-kpi-1',
    classification: 'profile',
    ocrSucceeded: true,
    extractedTextLength: 120,
    sourceEvidenceRefs: ['ev-attributed-screenshot-1'],
    sourceFileAttribution: attributedSource
  });
  rememberMealScoutBatchProcessedRecord({
    fileId: 'unattributed-screenshot-1',
    fileName: 'invalid-folder-profile.png',
    processedAt: '2026-06-02T00:01:00.000Z',
    batchId: 'batch-kpi-1',
    classification: 'profile',
    ocrSucceeded: true,
    extractedTextLength: 90,
    sourceEvidenceRefs: ['ev-unattributed-screenshot-1'],
    sourceFileAttribution: {
      attributionSource: 'unknown',
      attributionStatus: 'unknown',
      affiliate_attribution_warnings: ['invalid_email_named_parent_folder'],
      capturedAt: '2026-06-02T00:01:00.000Z'
    }
  });
}

function seedPublishExecution() {
  const existing = seedMealScoutTruck({
    truckName: 'Existing Bowl Truck',
    phone: '504-555-4040',
    cityArea: 'Metairie'
  });
  const plan = rememberMealScoutPublishPlan({
    planId: 'ms-plan-affiliate-kpi',
    signature: 'sig-affiliate-kpi',
    reviewDecisionVersion: 0,
    generatedAt: '2026-06-02T00:02:00.000Z',
    mutationAllowed: false,
    records: [
      {
        recordId: 'record-create-attributed',
        plannedAction: 'create_new',
        publishReady: true,
        draftIds: ['draft-create-attributed'],
        profileFields: {
          truckName: plannedField('Folder Credit Tacos', 'attributed-screenshot-1'),
          phone: plannedField('504-555-1000', 'attributed-screenshot-1'),
          email: plannedField('business-owner@example.biz', 'attributed-screenshot-1'),
          cityArea: plannedField('Metairie', 'attributed-screenshot-1')
        },
        menuItems: [{ name: 'Al Pastor Taco', price: '$4.25', evidenceRefs: ['ev-attributed-screenshot-1'], sourceFileIds: ['attributed-screenshot-1'] }],
        sourceAttribution: {
          primarySourceRepId: undefined,
          contributingRepIds: [],
          sourceFileIds: ['attributed-screenshot-1'],
          attributionPolicy: 'folder_credit_only',
          ...attributedSource
        }
      },
      {
        recordId: 'record-update-attributed',
        plannedAction: 'update_existing',
        publishReady: true,
        draftIds: ['draft-update-attributed'],
        existingTruckId: existing.id,
        profileFields: {
          truckName: plannedField('Existing Bowl Truck', 'attributed-screenshot-1'),
          phone: plannedField('504-555-4041', 'attributed-screenshot-1'),
          cityArea: plannedField('Metairie', 'attributed-screenshot-1')
        },
        menuItems: [{ name: 'Berry Bowl', price: '$8.00', evidenceRefs: ['ev-attributed-screenshot-1'], sourceFileIds: ['attributed-screenshot-1'] }],
        sourceAttribution: {
          contributingRepIds: [],
          sourceFileIds: ['attributed-screenshot-1'],
          attributionPolicy: 'folder_credit_only',
          ...attributedSource
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

test('affiliate attribution KPI report counts attributed screenshots, warnings, and profile seed outcomes', async () => {
  seedProcessedFiles();
  seedPublishExecution();

  const direct = getMealScoutAffiliateAttributionKpiRollup();
  assert.equal(direct.affiliate_attributed_screenshot_count, 1);
  assert.equal(direct.affiliate_unattributed_screenshot_count, 1);
  assert.equal(direct.affiliate_profile_seed_created_count, 1);
  assert.equal(direct.affiliate_profile_seed_updated_count, 1);
  assert.equal(direct.affiliate_attribution_warning_count, 4);
  assert.equal(direct.affiliate_verification_email_sent_count, 1);

  const report = await requestJson<{ affiliateAttributionKpis: typeof direct }>('/api/mealscout/intake/affiliate-attribution/kpi', {
    headers: { 'x-operator-role': 'staff' }
  });
  assert.equal(report.status, 200);
  assert.deepEqual(report.body.affiliateAttributionKpis, direct);

  const denied = await requestJson<{ error: string }>('/api/mealscout/intake/affiliate-attribution/kpi', {
    headers: { 'x-operator-role': 'viewer' }
  });
  assert.equal(denied.status, 403);
});

test('preview and audit expose KPI totals without treating folder email as business verification email', async () => {
  const preview = await requestJson<{
    affiliateAttributionKpis: {
      affiliate_attributed_screenshot_count: number;
      affiliate_unattributed_screenshot_count: number;
      affiliate_verification_email_sent_count: number;
    };
    evidenceFiles: Array<{ sourceFileAttribution?: { affiliateEmail?: string; affiliateCode?: string; affiliate_attribution_email?: string } }>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'preview-attributed-1',
          fileName: 'preview-attributed.png',
          sourceFolder: '/MealScout Intake/foldercredit@example.com',
          extractedText: 'Preview Tacos\nEmail: preview-business@example.biz\nPhone: 504-555-1000\nCity: Metairie\nTaco $4',
          sourceFileAttribution: attributedSource
        },
        {
          fileId: 'preview-unattributed-1',
          fileName: 'preview-unattributed.png',
          sourceFolder: '/MealScout Intake/no-folder-credit',
          extractedText: 'No Credit Bowls\nPhone: 504-555-2000\nCity: Metairie\nBowl $8',
          sourceFileAttribution: {
            attributionSource: 'unknown',
            attributionStatus: 'unknown'
          }
        }
      ]
    })
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.affiliateAttributionKpis.affiliate_attributed_screenshot_count, 1);
  assert.equal(preview.body.affiliateAttributionKpis.affiliate_unattributed_screenshot_count, 1);
  assert.equal(preview.body.affiliateAttributionKpis.affiliate_verification_email_sent_count, 0);
  assert.equal(preview.body.evidenceFiles[0].sourceFileAttribution?.affiliate_attribution_email, 'foldercredit@example.com');
  assert.equal(preview.body.evidenceFiles[0].sourceFileAttribution?.affiliateEmail, undefined);
  assert.equal(preview.body.evidenceFiles[0].sourceFileAttribution?.affiliateCode, undefined);

  seedPublishExecution();
  const audit = await requestJson<{
    affiliateAttributionKpis: {
      affiliate_profile_seed_created_count: number;
      affiliate_profile_seed_updated_count: number;
      affiliate_verification_email_sent_count: number;
    };
    records: Array<{ sourceAttribution?: { affiliate_attribution_email?: string }; newValues?: { email?: string } }>;
  }>('/api/mealscout/intake/publish-plan/audit', {
    headers: { 'x-operator-role': 'admin' }
  });
  assert.equal(audit.status, 200);
  assert.equal(audit.body.affiliateAttributionKpis.affiliate_profile_seed_created_count, 1);
  assert.equal(audit.body.affiliateAttributionKpis.affiliate_profile_seed_updated_count, 1);
  assert.equal(audit.body.affiliateAttributionKpis.affiliate_verification_email_sent_count, 1);
  assert.equal(audit.body.records.some((record) => record.sourceAttribution?.affiliate_attribution_email === 'foldercredit@example.com'), true);
  assert.equal(audit.body.records.some((record) => record.newValues?.email === 'foldercredit@example.com'), false);
});
