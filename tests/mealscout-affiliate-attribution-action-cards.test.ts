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
const { getMealScoutAffiliateAttributionActionCards } = await import('../src/mealscoutAffiliateAttributionKpiRollup.ts');
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
    batchId: 'batch-action-cards',
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

function seedActionCardData() {
  seedProcessedFile('warning-profile-1', 'warning@example.com', ['multiple_email_named_parent_folders']);
  seedProcessedFile('warning-profile-2', 'warning@example.com', ['invalid_email_named_parent_folder']);
  seedProcessedFile('high-output-profile-1', 'highoutput@example.com');
  seedProcessedFile('high-output-profile-2', 'highoutput@example.com');
  seedProcessedFile('high-output-menu-1', 'highoutput@example.com');
  seedProcessedFile('low-quality-profile-1', 'lowquality@example.com');
  seedProcessedFile('low-quality-profile-2', 'lowquality@example.com');
  seedProcessedFile('unattributed-profile-1', undefined, ['invalid_email_named_parent_folder']);

  const existing = seedMealScoutTruck({
    truckName: 'High Output Bowls',
    phone: '504-555-2000',
    cityArea: 'Metairie'
  });
  const plan = rememberMealScoutPublishPlan({
    planId: 'ms-plan-affiliate-action-cards',
    signature: 'sig-affiliate-action-cards',
    reviewDecisionVersion: 0,
    generatedAt: '2026-06-02T00:05:00.000Z',
    mutationAllowed: false,
    records: [
      {
        recordId: 'warning-create',
        plannedAction: 'create_new',
        publishReady: true,
        draftIds: ['warning-draft'],
        profileFields: {
          truckName: plannedField('Warning Tacos', 'warning-profile-1'),
          phone: plannedField('504-555-1000', 'warning-profile-1'),
          email: plannedField('warning-business@example.biz', 'warning-profile-1'),
          cityArea: plannedField('Metairie', 'warning-profile-1')
        },
        menuItems: [{ name: 'Taco', price: '$4.00', evidenceRefs: ['ev-warning-profile-1'], sourceFileIds: ['warning-profile-1'] }],
        sourceAttribution: {
          contributingRepIds: [],
          sourceFileIds: ['warning-profile-1'],
          attributionPolicy: 'folder_credit_only',
          ...attributedSource('warning@example.com', ['multiple_email_named_parent_folders'])
        }
      },
      {
        recordId: 'high-output-update',
        plannedAction: 'update_existing',
        publishReady: true,
        draftIds: ['high-output-draft'],
        existingTruckId: existing.id,
        profileFields: {
          truckName: plannedField('High Output Bowls', 'high-output-profile-1'),
          phone: plannedField('504-555-2001', 'high-output-profile-1'),
          cityArea: plannedField('Metairie', 'high-output-profile-1')
        },
        menuItems: [{ name: 'Bowl', price: '$8.00', evidenceRefs: ['ev-high-output-profile-1'], sourceFileIds: ['high-output-profile-1'] }],
        sourceAttribution: {
          contributingRepIds: [],
          sourceFileIds: ['high-output-profile-1'],
          attributionPolicy: 'folder_credit_only',
          ...attributedSource('highoutput@example.com')
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

test('affiliate attribution report generates non-mutating operator action cards', async () => {
  seedActionCardData();

  const cards = getMealScoutAffiliateAttributionActionCards({ includeUnattributed: true });
  const byType = new Map(cards.map((card) => [`${card.type}:${card.affiliate_attribution_email}`, card]));

  assert.ok(byType.get('affiliate_warning_review:warning@example.com'));
  assert.ok(byType.get('affiliate_unattributed_review:unattributed'));
  assert.ok(byType.get('affiliate_high_output_followup:highoutput@example.com'));
  assert.ok(byType.get('affiliate_verification_ready_followup:warning@example.com'));
  assert.ok(byType.get('affiliate_low_quality_review:lowquality@example.com'));

  for (const card of cards) {
    assert.equal(card.status, 'open');
    assert.equal(card.mutationAllowed, false);
    assert.equal(typeof card.cardId, 'string');
    assert.equal(typeof card.title, 'string');
    assert.equal(typeof card.description, 'string');
    assert.equal(typeof card.reason, 'string');
    assert.equal(typeof card.sourceReportMetric, 'string');
    assert.equal(typeof card.recommendedAction, 'string');
    assert.equal(card.recommendedAction.toLowerCase().includes('send email'), false);
    assert.equal('affiliateEmail' in card, false);
    assert.equal('affiliateCode' in card, false);
    assert.equal('business_profile_email' in card, false);
    assert.equal('email_verified' in card, false);
    assert.equal('insurance_verified' in card, false);
  }

  assert.equal(byType.get('affiliate_warning_review:warning@example.com')?.priority, 'medium');
  assert.equal(byType.get('affiliate_verification_ready_followup:warning@example.com')?.priority, 'high');
});

test('action cards endpoint is gated and preserves affiliate attribution without sending or mutating', async () => {
  seedActionCardData();

  const denied = await requestJson<{ error: string; mutationAllowed: boolean }>('/api/mealscout/intake/affiliate-attribution/action-cards', {
    headers: { 'x-operator-role': 'viewer' }
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.mutationAllowed, false);

  const response = await requestJson<{
    mutationAllowed: boolean;
    actionCards: Array<{
      type: string;
      affiliate_attribution_email: string;
      mutationAllowed: boolean;
      recommendedAction: string;
      sentEmail?: boolean;
      createdUserId?: string;
      email_verified?: boolean;
    }>;
  }>('/api/mealscout/intake/affiliate-attribution/action-cards', {
    headers: { 'x-operator-role': 'operator' }
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.actionCards.some((card) => card.affiliate_attribution_email === 'warning@example.com'), true);
  assert.equal(response.body.actionCards.some((card) => card.type === 'affiliate_unattributed_review'), true);
  assert.equal(response.body.actionCards.every((card) => card.mutationAllowed === false), true);
  assert.equal(response.body.actionCards.every((card) => card.sentEmail !== true), true);
  assert.equal(response.body.actionCards.every((card) => card.createdUserId === undefined), true);
  assert.equal(response.body.actionCards.every((card) => card.email_verified === undefined), true);

  const attributedOnly = await requestJson<{ actionCards: Array<{ affiliate_attribution_email: string }> }>(
    '/api/mealscout/intake/affiliate-attribution/action-cards?includeUnattributed=false',
    { headers: { 'x-operator-role': 'staff' } }
  );
  assert.equal(attributedOnly.status, 200);
  assert.equal(attributedOnly.body.actionCards.some((card) => card.affiliate_attribution_email === 'unattributed'), false);
});
