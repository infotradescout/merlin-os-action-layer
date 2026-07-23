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
    batchId: 'batch-action-card-decisions',
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

function seedDecisionData() {
  seedProcessedFile('decision-warning-1', 'decision@example.com', ['multiple_email_named_parent_folders']);
  seedProcessedFile('decision-warning-2', 'decision@example.com', ['invalid_email_named_parent_folder']);
  seedProcessedFile('decision-unattributed-1', undefined, ['invalid_email_named_parent_folder']);
  const existing = seedMealScoutTruck({
    truckName: 'Decision Bowls',
    phone: '504-555-6000',
    cityArea: 'Metairie'
  });
  const plan = rememberMealScoutPublishPlan({
    planId: 'ms-plan-affiliate-decisions',
    signature: 'sig-affiliate-decisions',
    reviewDecisionVersion: 0,
    generatedAt: '2026-06-02T00:05:00.000Z',
    mutationAllowed: false,
    records: [
      {
        recordId: 'decision-update',
        plannedAction: 'update_existing',
        publishReady: true,
        draftIds: ['decision-draft'],
        existingTruckId: existing.id,
        profileFields: {
          truckName: plannedField('Decision Bowls', 'decision-warning-1'),
          phone: plannedField('504-555-6001', 'decision-warning-1'),
          cityArea: plannedField('Metairie', 'decision-warning-1')
        },
        menuItems: [{ name: 'Bowl', price: '$8.00', evidenceRefs: ['ev-decision-warning-1'], sourceFileIds: ['decision-warning-1'] }],
        sourceAttribution: {
          contributingRepIds: [],
          sourceFileIds: ['decision-warning-1'],
          attributionPolicy: 'folder_credit_only',
          ...attributedSource('decision@example.com', ['multiple_email_named_parent_folders'])
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

test('affiliate action card decision endpoint records valid decisions and overlays card state', async () => {
  seedDecisionData();
  const beforeTrucks = listMealScoutTrucks();
  const beforeVerificationEmails = listVerificationEmailRecords();

  const cards = await requestJson<{
    actionCards: Array<{
      cardId: string;
      type: string;
      affiliate_attribution_email: string;
      decisionStatus: string;
      decisionReason?: string;
      decisionNotes?: string;
      decidedAt?: string;
      decidedByUserId?: string;
      email_verified?: boolean;
      mutationAllowed: boolean;
    }>;
  }>('/api/mealscout/intake/affiliate-attribution/action-cards', {
    headers: { 'x-operator-role': 'staff' }
  });
  assert.equal(cards.status, 200);
  const warningCard = cards.body.actionCards.find((card) => card.type === 'affiliate_warning_review');
  assert.ok(warningCard);
  assert.equal(warningCard.decisionStatus, 'pending');
  assert.equal(warningCard.affiliate_attribution_email, 'decision@example.com');

  const decision = await requestJson<{
    mutationAllowed: boolean;
    decision: {
      cardId: string;
      decisionStatus: string;
      decisionReason?: string;
      decisionNotes?: string;
      decidedAt?: string;
      decidedByUserId?: string;
      affiliate_attribution_email: string;
      createdUserId?: string;
      sentEmail?: boolean;
      email_verified?: boolean;
    };
  }>(`/api/mealscout/intake/affiliate-attribution/action-cards/${encodeURIComponent(warningCard.cardId)}/decision`, {
    method: 'PATCH',
    headers: { 'x-operator-role': 'operator' },
    body: JSON.stringify({
      decisionStatus: 'accepted',
      decisionReason: 'folder_warning_confirmed',
      decisionNotes: 'Operator will clean up folder naming manually.',
      decidedByUserId: 'operator-123'
    })
  });
  assert.equal(decision.status, 200);
  assert.equal(decision.body.mutationAllowed, false);
  assert.equal(decision.body.decision.cardId, warningCard.cardId);
  assert.equal(decision.body.decision.decisionStatus, 'accepted');
  assert.equal(decision.body.decision.decisionReason, 'folder_warning_confirmed');
  assert.equal(decision.body.decision.decisionNotes, 'Operator will clean up folder naming manually.');
  assert.equal(decision.body.decision.decidedByUserId, 'operator-123');
  assert.equal(decision.body.decision.affiliate_attribution_email, 'decision@example.com');
  assert.equal(decision.body.decision.createdUserId, undefined);
  assert.equal(decision.body.decision.sentEmail, undefined);
  assert.equal(decision.body.decision.email_verified, undefined);

  const afterCards = await requestJson<{ actionCards: Array<typeof warningCard> }>('/api/mealscout/intake/affiliate-attribution/action-cards', {
    headers: { 'x-operator-role': 'admin' }
  });
  const updatedCard = afterCards.body.actionCards.find((card) => card.cardId === warningCard.cardId);
  assert.ok(updatedCard);
  assert.equal(updatedCard.decisionStatus, 'accepted');
  assert.equal(updatedCard.decisionReason, 'folder_warning_confirmed');
  assert.equal(updatedCard.decisionNotes, 'Operator will clean up folder naming manually.');
  assert.equal(updatedCard.decidedByUserId, 'operator-123');
  assert.equal(updatedCard.affiliate_attribution_email, 'decision@example.com');
  assert.equal(updatedCard.email_verified, undefined);
  assert.equal(updatedCard.mutationAllowed, false);

  const decisions = await requestJson<{ decisions: Array<{ cardId: string; affiliate_attribution_email: string; decisionStatus: string }> }>(
    '/api/mealscout/intake/affiliate-attribution/action-cards/decisions',
    { headers: { 'x-operator-role': 'staff' } }
  );
  assert.equal(decisions.status, 200);
  assert.equal(decisions.body.decisions.some((row) => row.cardId === warningCard.cardId && row.decisionStatus === 'accepted'), true);

  assert.deepEqual(listMealScoutTrucks(), beforeTrucks);
  assert.deepEqual(listVerificationEmailRecords(), beforeVerificationEmails);
});

test('affiliate action card decision guards invalid statuses, roles, and unattributed bucket identity', async () => {
  seedDecisionData();
  const cards = await requestJson<{ actionCards: Array<{ cardId: string; type: string; affiliate_attribution_email: string }> }>(
    '/api/mealscout/intake/affiliate-attribution/action-cards',
    { headers: { 'x-operator-role': 'admin' } }
  );
  const unattributedCard = cards.body.actionCards.find((card) => card.type === 'affiliate_unattributed_review');
  assert.ok(unattributedCard);
  assert.equal(unattributedCard.affiliate_attribution_email, 'unattributed');

  const denied = await requestJson<{ error: string; mutationAllowed: boolean }>(
    `/api/mealscout/intake/affiliate-attribution/action-cards/${encodeURIComponent(unattributedCard.cardId)}/decision`,
    {
      method: 'PATCH',
      headers: { 'x-operator-role': 'viewer' },
      body: JSON.stringify({ decisionStatus: 'deferred' })
    }
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.body.mutationAllowed, false);

  const invalid = await requestJson<{ error: string; mutationAllowed: boolean }>(
    `/api/mealscout/intake/affiliate-attribution/action-cards/${encodeURIComponent(unattributedCard.cardId)}/decision`,
    {
      method: 'PATCH',
      headers: { 'x-operator-role': 'staff' },
      body: JSON.stringify({ decisionStatus: 'sent_email' })
    }
  );
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error, 'invalid_decision_status');
  assert.equal(invalid.body.mutationAllowed, false);

  const decision = await requestJson<{ decision: { decisionStatus: string; affiliate_attribution_email: string } }>(
    `/api/mealscout/intake/affiliate-attribution/action-cards/${encodeURIComponent(unattributedCard.cardId)}/decision`,
    {
      method: 'PATCH',
      headers: { 'x-operator-role': 'staff' },
      body: JSON.stringify({
        decisionStatus: 'completed_manually',
        decisionReason: 'reviewed_without_credit',
        decisionNotes: 'No valid folder email was present.'
      })
    }
  );
  assert.equal(decision.status, 200);
  assert.equal(decision.body.decision.decisionStatus, 'completed_manually');
  assert.equal(decision.body.decision.affiliate_attribution_email, 'unattributed');

  const listDenied = await requestJson<{ error: string; mutationAllowed: boolean }>(
    '/api/mealscout/intake/affiliate-attribution/action-cards/decisions',
    { headers: { 'x-operator-role': 'viewer' } }
  );
  assert.equal(listDenied.status, 403);
  assert.equal(listDenied.body.mutationAllowed, false);
});
