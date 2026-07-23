import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { rememberMealScoutBatchProcessedRecord } = await import('../src/mealscoutBatchIntakeState.ts');
const { seedMealScoutTruck, listMealScoutTrucks } = await import('../src/mealscoutProfileImport.ts');
const { rememberMealScoutPublishPlan } = await import('../src/mealscoutPublishPlan.ts');
const { executeMealScoutPublishPlan } = await import('../src/mealscoutPublishExecution.ts');
const { listVerificationEmailRecords } = await import('../src/merlin/profileSeedRuntime.ts');
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

function seedProcessedFile(fileId: string, email: string | undefined, warnings: string[] = []) {
  rememberMealScoutBatchProcessedRecord({
    fileId,
    fileName: `${fileId}.png`,
    processedAt: '2026-06-02T00:00:00.000Z',
    batchId: 'batch-decision-rollup',
    classification: 'profile',
    ocrSucceeded: true,
    extractedTextLength: 120,
    sourceEvidenceRefs: [`ev-${fileId}`],
    sourceFileAttribution: email
      ? attributedSource(email, warnings)
      : {
          attributionSource: 'unknown',
          attributionStatus: 'unknown',
          affiliate_attribution_warnings: warnings
        }
  });
}

function seedRollupData() {
  seedProcessedFile('rollup-alpha-warning-1', 'alpha@example.com', ['multiple_email_named_parent_folders']);
  seedProcessedFile('rollup-alpha-warning-2', 'alpha@example.com', ['invalid_email_named_parent_folder']);
  seedProcessedFile('rollup-beta-1', 'beta@example.com');
  seedProcessedFile('rollup-beta-2', 'beta@example.com');
  seedProcessedFile('rollup-beta-3', 'beta@example.com');
  seedProcessedFile('rollup-low-1', 'lowquality@example.com');
  seedProcessedFile('rollup-low-2', 'lowquality@example.com');
  seedProcessedFile('rollup-unattributed-1', undefined, ['invalid_email_named_parent_folder']);

  const existing = seedMealScoutTruck({
    truckName: 'Beta Bowls',
    phone: '504-555-7000',
    cityArea: 'Metairie'
  });
  const plan = rememberMealScoutPublishPlan({
    planId: 'ms-plan-affiliate-rollup',
    signature: 'sig-affiliate-rollup',
    reviewDecisionVersion: 0,
    generatedAt: '2026-06-02T00:05:00.000Z',
    mutationAllowed: false,
    records: [
      {
        recordId: 'alpha-create',
        plannedAction: 'create_new',
        publishReady: true,
        draftIds: ['alpha-draft'],
        profileFields: {
          truckName: plannedField('Alpha Tacos', 'rollup-alpha-warning-1'),
          phone: plannedField('504-555-1000', 'rollup-alpha-warning-1'),
          email: plannedField('alpha-business@example.biz', 'rollup-alpha-warning-1'),
          cityArea: plannedField('Metairie', 'rollup-alpha-warning-1')
        },
        menuItems: [{ name: 'Taco', price: '$4.00', evidenceRefs: ['ev-rollup-alpha-warning-1'], sourceFileIds: ['rollup-alpha-warning-1'] }],
        sourceAttribution: {
          contributingRepIds: [],
          sourceFileIds: ['rollup-alpha-warning-1'],
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
          truckName: plannedField('Beta Bowls', 'rollup-beta-1'),
          phone: plannedField('504-555-7001', 'rollup-beta-1'),
          cityArea: plannedField('Metairie', 'rollup-beta-1')
        },
        menuItems: [{ name: 'Bowl', price: '$8.00', evidenceRefs: ['ev-rollup-beta-1'], sourceFileIds: ['rollup-beta-1'] }],
        sourceAttribution: {
          contributingRepIds: [],
          sourceFileIds: ['rollup-beta-1'],
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

async function decide(cardId: string, decisionStatus: string) {
  return requestJson(`/api/mealscout/intake/affiliate-attribution/action-cards/${encodeURIComponent(cardId)}/decision`, {
    method: 'PATCH',
    headers: { 'x-operator-role': 'operator' },
    body: JSON.stringify({
      decisionStatus,
      decisionReason: `${decisionStatus}_for_rollup`,
      decidedByUserId: 'operator-rollup'
    })
  });
}

test('affiliate decision rollup summarizes counts, rates, priority backlog, and groups', async () => {
  seedRollupData();
  const beforeTrucks = listMealScoutTrucks();
  const beforeVerificationEmails = listVerificationEmailRecords();

  const cards = await requestJson<{
    actionCards: Array<{
      cardId: string;
      type: string;
      priority: string;
      affiliate_attribution_email: string;
    }>;
  }>('/api/mealscout/intake/affiliate-attribution/action-cards', {
    headers: { 'x-operator-role': 'admin' }
  });
  assert.equal(cards.status, 200);

  const alphaWarning = cards.body.actionCards.find((card) => card.type === 'affiliate_warning_review' && card.affiliate_attribution_email === 'alpha@example.com');
  const alphaVerification = cards.body.actionCards.find((card) => card.type === 'affiliate_verification_ready_followup' && card.affiliate_attribution_email === 'alpha@example.com');
  const betaHighOutput = cards.body.actionCards.find((card) => card.type === 'affiliate_high_output_followup' && card.affiliate_attribution_email === 'beta@example.com');
  const lowQuality = cards.body.actionCards.find((card) => card.type === 'affiliate_low_quality_review' && card.affiliate_attribution_email === 'lowquality@example.com');
  const unattributed = cards.body.actionCards.find((card) => card.type === 'affiliate_unattributed_review');
  assert.ok(alphaWarning);
  assert.ok(alphaVerification);
  assert.ok(betaHighOutput);
  assert.ok(lowQuality);
  assert.ok(unattributed);

  await decide(alphaWarning.cardId, 'accepted');
  await decide(betaHighOutput.cardId, 'rejected');
  await decide(lowQuality.cardId, 'deferred');
  await decide(unattributed.cardId, 'completed_manually');

  const response = await requestJson<{
    mutationAllowed: boolean;
    rollup: {
      affiliateActionCardsTotal: number;
      affiliateActionCardsPending: number;
      affiliateActionCardsAccepted: number;
      affiliateActionCardsRejected: number;
      affiliateActionCardsDeferred: number;
      affiliateActionCardsCompletedManually: number;
      affiliateActionCardDecisionRate: number;
      affiliateActionCardManualCompletionRate: number;
      affiliateHighPriorityPendingCount: number;
      byAffiliate: Array<{ key: string; affiliate_attribution_email: string; total: number; accepted: number; completed_manually: number }>;
      byCardType: Array<{ key: string; cardType: string; total: number; rejected: number }>;
      byPriority: Array<{ key: string; priority: string; total: number; pending: number }>;
      byDecisionStatus: Array<{ key: string; decisionStatus: string; total: number }>;
    };
  }>('/api/mealscout/intake/affiliate-attribution/action-cards/decision-rollup', {
    headers: { 'x-operator-role': 'staff' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.rollup.affiliateActionCardsTotal, cards.body.actionCards.length);
  assert.equal(response.body.rollup.affiliateActionCardsAccepted, 1);
  assert.equal(response.body.rollup.affiliateActionCardsRejected, 1);
  assert.equal(response.body.rollup.affiliateActionCardsDeferred, 1);
  assert.equal(response.body.rollup.affiliateActionCardsCompletedManually, 1);
  assert.equal(response.body.rollup.affiliateActionCardsPending, cards.body.actionCards.length - 4);
  assert.equal(response.body.rollup.affiliateActionCardDecisionRate, Number((4 / cards.body.actionCards.length).toFixed(4)));
  assert.equal(response.body.rollup.affiliateActionCardManualCompletionRate, Number((1 / cards.body.actionCards.length).toFixed(4)));
  assert.equal(response.body.rollup.affiliateHighPriorityPendingCount >= 1, true);

  const alphaGroup = response.body.rollup.byAffiliate.find((row) => row.affiliate_attribution_email === 'alpha@example.com');
  const unattributedGroup = response.body.rollup.byAffiliate.find((row) => row.affiliate_attribution_email === 'unattributed');
  assert.ok(alphaGroup);
  assert.equal(alphaGroup.accepted, 1);
  assert.ok(unattributedGroup);
  assert.equal(unattributedGroup.completed_manually, 1);

  assert.equal(response.body.rollup.byCardType.some((row) => row.cardType === 'affiliate_high_output_followup' && row.rejected === 1), true);
  assert.equal(response.body.rollup.byPriority.some((row) => row.priority === 'high' && row.pending >= 1), true);
  assert.equal(response.body.rollup.byDecisionStatus.some((row) => row.decisionStatus === 'completed_manually' && row.total === 1), true);

  assert.deepEqual(listMealScoutTrucks(), beforeTrucks);
  assert.deepEqual(listVerificationEmailRecords(), beforeVerificationEmails);
});

test('affiliate decision rollup is gated and can exclude unattributed bucket', async () => {
  seedRollupData();

  const denied = await requestJson<{ error: string; mutationAllowed: boolean }>(
    '/api/mealscout/intake/affiliate-attribution/action-cards/decision-rollup',
    { headers: { 'x-operator-role': 'viewer' } }
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.body.mutationAllowed, false);

  const attributedOnly = await requestJson<{
    rollup: {
      byAffiliate: Array<{ affiliate_attribution_email: string }>;
    };
  }>('/api/mealscout/intake/affiliate-attribution/action-cards/decision-rollup?includeUnattributed=false', {
    headers: { 'x-operator-role': 'operator' }
  });
  assert.equal(attributedOnly.status, 200);
  assert.equal(attributedOnly.body.rollup.byAffiliate.some((row) => row.affiliate_attribution_email === 'unattributed'), false);
});
