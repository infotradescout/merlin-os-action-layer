import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const {
  closeActionCardQueueStore,
  getActionCard,
  initializeActionCardQueueStore,
  rememberActionCards
} = await import('../src/merlin/intake/actionCardQueue.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');

let server: Server;
let baseUrl = '';

async function requestJson<T>(path: string, init: RequestInit = {}, role = 'admin'): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', 'x-operator-role': role, ...(init.headers || {}) },
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

test('fetching batch action cards returns expected card count/types from stored queue', async () => {
  rememberActionCards(
    [
      {
        id: 'card-a',
        type: 'create_profile_draft',
        title: 'Create profile draft',
        entityType: 'food_truck',
        confidence: 0.9,
        sourceFileIds: ['f1'],
        extractedFields: { truckName: 'Truck A' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      },
      {
        id: 'card-b',
        type: 'defer_unclassified',
        title: 'Defer',
        entityType: 'unknown',
        confidence: 0.2,
        sourceFileIds: ['f2'],
        extractedFields: {},
        missingFields: ['identity'],
        existingEntityMatch: null,
        recommendedAction: 'hold_for_manual_review',
        mutationAllowed: false
      }
    ],
    'batch-123'
  );

  const batch = await requestJson<{ actionCards: Array<{ id: string; type: string }> }>('/api/mealscout/intake/batches/batch-123/action-cards');
  assert.equal(batch.status, 200);
  assert.equal(batch.body.actionCards.length, 2);
  assert.deepEqual(batch.body.actionCards.map((row) => row.type).sort(), ['create_profile_draft', 'defer_unclassified']);
  assert.equal((batch.body.actionCards as Array<{ decisionState?: string }>).every((row) => row.decisionState === 'pending'), true);
});

test('dry-run create_profile_draft returns wouldCreate and mutationAllowed false', async () => {
  rememberActionCards(
    [
      {
        id: 'card-create',
        type: 'create_profile_draft',
        title: 'Create profile draft',
        entityType: 'food_truck',
        confidence: 0.92,
        sourceFileIds: ['f-create'],
        extractedFields: { truckName: 'Traci', phone: '850-255-8396' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-create'
  );

  const dryRun = await requestJson<{
    mutationAllowed: boolean;
    wouldCreate: Record<string, unknown> | null;
    wouldUpdate: Record<string, unknown> | null;
  }>('/api/mealscout/intake/action-cards/card-create/dry-run', { method: 'POST' });

  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.mutationAllowed, false);
  assert.equal(dryRun.body.wouldCreate !== null, true);
  assert.equal(dryRun.body.wouldUpdate, null);
});

test('dry-run update_existing_profile returns field-level before/after diff', async () => {
  rememberActionCards(
    [
      {
        id: 'card-update',
        type: 'update_existing_profile',
        title: 'Update profile',
        entityType: 'food_truck',
        confidence: 0.93,
        sourceFileIds: ['f-update'],
        extractedFields: { truckName: "Traci's Cherished Creations LLC", cityArea: 'Pensacola, FL' },
        missingFields: [],
        existingEntityMatch: { entityId: 'existing-1', confidence: 0.93, reason: 'phone_match' },
        recommendedAction: 'review_update_existing_profile',
        mutationAllowed: false
      }
    ],
    'batch-update'
  );

  const dryRun = await requestJson<{
    wouldUpdate: { entityId: string; fieldDiffs: Array<{ field: string; before: unknown; after: unknown }> } | null;
  }>('/api/mealscout/intake/action-cards/card-update/dry-run', { method: 'POST' });

  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.wouldUpdate?.entityId, 'existing-1');
  assert.equal((dryRun.body.wouldUpdate?.fieldDiffs || []).length >= 1, true);
  assert.equal((dryRun.body.wouldUpdate?.fieldDiffs || []).some((row) => row.field === 'truckName'), true);
});

test('dry-run request_missing_info and defer_unclassified return skippedReason', async () => {
  rememberActionCards(
    [
      {
        id: 'card-missing',
        type: 'request_missing_info',
        title: 'Need fields',
        entityType: 'food_truck',
        confidence: 0.7,
        sourceFileIds: ['f-missing'],
        extractedFields: { truckName: 'Unknown' },
        missingFields: ['menu'],
        existingEntityMatch: null,
        recommendedAction: 'collect_required_fields',
        mutationAllowed: false
      },
      {
        id: 'card-defer',
        type: 'defer_unclassified',
        title: 'Defer',
        entityType: 'unknown',
        confidence: 0.3,
        sourceFileIds: ['f-defer'],
        extractedFields: {},
        missingFields: ['identity'],
        existingEntityMatch: null,
        recommendedAction: 'hold_for_manual_review',
        mutationAllowed: false
      }
    ],
    'batch-skip'
  );

  const missing = await requestJson<{ skippedReason: string | null; missingFields: string[] }>('/api/mealscout/intake/action-cards/card-missing/dry-run', { method: 'POST' });
  assert.equal(missing.status, 200);
  assert.equal(missing.body.skippedReason, 'missing_required_fields');
  assert.equal(missing.body.missingFields.includes('menu'), true);

  const defer = await requestJson<{ skippedReason: string | null }>('/api/mealscout/intake/action-cards/card-defer/dry-run', { method: 'POST' });
  assert.equal(defer.status, 200);
  assert.equal(defer.body.skippedReason, 'deferred_unclassified_evidence');
});

test('invalid card id returns 404 and non-admin access is denied', async () => {
  const missing = await requestJson<{ error: string }>('/api/mealscout/intake/action-cards/does-not-exist/dry-run', { method: 'POST' });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, 'action_card_not_found');

  const denied = await requestJson<{ error: string }>('/api/mealscout/intake/action-cards', {}, 'viewer');
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, 'forbidden');
});

test('decision endpoint updates approved_for_apply without mutation', async () => {
  rememberActionCards(
    [
      {
        id: 'card-decision-approve',
        type: 'create_profile_draft',
        title: 'Create draft',
        entityType: 'food_truck',
        confidence: 0.91,
        sourceFileIds: ['src-1'],
        extractedFields: { truckName: 'Approve Me' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-decision'
  );

  const before = await requestJson<{ records: unknown[] }>('/api/mealscout/intake/publish-plan/audit');
  const updated = await requestJson<{ decisionState: string; mutationAllowed: boolean }>(
    '/api/mealscout/intake/action-cards/card-decision-approve/decision',
    { method: 'PATCH', body: JSON.stringify({ decisionState: 'approved_for_apply', decisionReason: 'ready for next slice' }) }
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.decisionState, 'approved_for_apply');
  assert.equal(updated.body.mutationAllowed, false);
  const after = await requestJson<{ records: unknown[] }>('/api/mealscout/intake/publish-plan/audit');
  assert.equal(after.body.records.length, before.body.records.length);
});

test('decision endpoint updates rejected/deferred and preserves card evidence fields', async () => {
  rememberActionCards(
    [
      {
        id: 'card-decision-reject',
        type: 'update_existing_profile',
        title: 'Reject me',
        entityType: 'food_truck',
        confidence: 0.62,
        sourceFileIds: ['src-reject'],
        extractedFields: { truckName: 'Reject Me', cityArea: 'City' },
        missingFields: ['menu'],
        existingEntityMatch: { entityId: 'existing-x', confidence: 0.9, reason: 'phone_match' },
        recommendedAction: 'review_update_existing_profile',
        mutationAllowed: false
      }
    ],
    'batch-decision-2'
  );

  const rejected = await requestJson<{ decisionState: string }>(
    '/api/mealscout/intake/action-cards/card-decision-reject/decision',
    { method: 'PATCH', body: JSON.stringify({ decisionState: 'rejected', decisionReason: 'bad extraction' }) }
  );
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.decisionState, 'rejected');

  const deferred = await requestJson<{ decisionState: string }>(
    '/api/mealscout/intake/action-cards/card-decision-reject/decision',
    { method: 'PATCH', body: JSON.stringify({ decisionState: 'deferred', decisionReason: 'awaiting files' }) }
  );
  assert.equal(deferred.status, 200);
  assert.equal(deferred.body.decisionState, 'deferred');

  const list = await requestJson<{ actionCards: Array<{ id: string; sourceFileIds: string[]; extractedFields: Record<string, unknown> }> }>(
    '/api/mealscout/intake/action-cards'
  );
  const card = list.body.actionCards.find((row) => row.id === 'card-decision-reject');
  assert.ok(card);
  assert.equal(card?.sourceFileIds.includes('src-reject'), true);
  assert.equal((card?.extractedFields?.truckName as string) || '', 'Reject Me');
});

test('invalid decisionState returns 400', async () => {
  rememberActionCards(
    [
      {
        id: 'card-invalid-decision',
        type: 'defer_unclassified',
        title: 'x',
        entityType: 'unknown',
        confidence: 0.2,
        sourceFileIds: ['f'],
        extractedFields: {},
        missingFields: ['identity'],
        existingEntityMatch: null,
        recommendedAction: 'hold_for_manual_review',
        mutationAllowed: false
      }
    ],
    'batch-invalid-decision'
  );
  const response = await requestJson<{ error: string }>(
    '/api/mealscout/intake/action-cards/card-invalid-decision/decision',
    { method: 'PATCH', body: JSON.stringify({ decisionState: 'invalid_state' }) }
  );
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'invalid_decision_state');
});

test('dry-run does not mutate publish execution audit', async () => {
  rememberActionCards(
    [
      {
        id: 'card-no-mutate',
        type: 'create_profile_draft',
        title: 'Create draft',
        entityType: 'food_truck',
        confidence: 0.91,
        sourceFileIds: ['f-no-mutate'],
        extractedFields: { truckName: 'No Mutate Truck' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-no-mutate'
  );

  const before = await requestJson<{ records: unknown[] }>('/api/mealscout/intake/publish-plan/audit');
  assert.equal(before.status, 200);

  const dryRun = await requestJson('/api/mealscout/intake/action-cards/card-no-mutate/dry-run', { method: 'POST' });
  assert.equal(dryRun.status, 200);

  const after = await requestJson<{ records: unknown[] }>('/api/mealscout/intake/publish-plan/audit');
  assert.equal(after.status, 200);
  assert.equal(after.body.records.length, before.body.records.length);
});

test('apply approved create_profile_draft mutates runtime entity once and is idempotent', async () => {
  rememberActionCards(
    [
      {
        id: 'card-apply-create',
        type: 'create_profile_draft',
        title: 'Create profile',
        entityType: 'food_truck',
        confidence: 0.95,
        sourceFileIds: ['src-create'],
        extractedFields: { truckName: 'Apply Truck', phone: '8502558396' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-apply-create'
  );
  await requestJson('/api/mealscout/intake/action-cards/card-apply-create/decision', {
    method: 'PATCH',
    body: JSON.stringify({ decisionState: 'approved_for_apply' })
  });
  const first = await requestJson<{ applyState: string; mutationAllowed: boolean; createdEntity: unknown }>(
    '/api/mealscout/intake/action-cards/card-apply-create/apply',
    { method: 'POST' }
  );
  assert.equal(first.status, 200);
  assert.equal(first.body.mutationAllowed, true);
  assert.equal(first.body.applyState, 'applied');
  assert.ok(first.body.createdEntity);

  const second = await requestJson<{ skippedReason: string; applyState: string }>(
    '/api/mealscout/intake/action-cards/card-apply-create/apply',
    { method: 'POST' }
  );
  assert.equal(second.status, 200);
  assert.equal(second.body.applyState, 'applied');
  assert.equal(second.body.skippedReason, 'already_applied');
});

test('duplicate-looking create card stays visible and requires explicit override to apply', async () => {
  rememberActionCards(
    [
      {
        id: 'card-dup-create',
        type: 'create_profile_draft',
        title: 'Create duplicate-like',
        entityType: 'food_truck',
        confidence: 0.91,
        sourceFileIds: ['dup-src'],
        extractedFields: { truckName: 'Duplicate Candidate', phone: '850-000-1111' },
        missingFields: [],
        existingEntityMatch: { entityId: 'existing-dup-1', confidence: 0.88, reason: 'phone_match' },
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-dup-create'
  );
  await requestJson('/api/mealscout/intake/action-cards/card-dup-create/decision', {
    method: 'PATCH',
    body: JSON.stringify({ decisionState: 'approved_for_apply' })
  });

  const list = await requestJson<{ actionCards: Array<{ id: string }> }>('/api/mealscout/intake/action-cards');
  assert.equal(list.body.actionCards.some((row) => row.id === 'card-dup-create'), true);

  const dryRun = await requestJson<{ duplicateWarnings: string[] }>(
    '/api/mealscout/intake/action-cards/card-dup-create/dry-run',
    { method: 'POST' }
  );
  assert.equal(dryRun.status, 200);
  assert.equal(dryRun.body.duplicateWarnings.includes('possible_duplicate_existing_entity_match'), true);

  const blockedApply = await requestJson<{ applyState: string; skippedReason: string; duplicateWarnings: string[] }>(
    '/api/mealscout/intake/action-cards/card-dup-create/apply',
    { method: 'POST', body: JSON.stringify({}) }
  );
  assert.equal(blockedApply.status, 200);
  assert.equal(blockedApply.body.applyState, 'apply_failed');
  assert.equal(blockedApply.body.skippedReason, 'duplicate_override_required');
  assert.equal(blockedApply.body.duplicateWarnings.includes('possible_duplicate_existing_entity_match'), true);

  const overriddenApply = await requestJson<{ applyState: string; createdEntity: unknown }>(
    '/api/mealscout/intake/action-cards/card-dup-create/apply',
    { method: 'POST', body: JSON.stringify({ allowDuplicateCreate: true }) }
  );
  assert.equal(overriddenApply.status, 200);
  assert.equal(overriddenApply.body.applyState, 'applied');
  assert.ok(overriddenApply.body.createdEntity);
});

test('apply denies unapproved/rejected/deferred cards', async () => {
  rememberActionCards(
    [
      {
        id: 'card-pending',
        type: 'create_profile_draft',
        title: 'Pending',
        entityType: 'food_truck',
        confidence: 0.9,
        sourceFileIds: ['a'],
        extractedFields: { truckName: 'Pending' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-pending'
  );
  const pending = await requestJson<{ error: string }>('/api/mealscout/intake/action-cards/card-pending/apply', { method: 'POST' });
  assert.equal(pending.status, 409);
  assert.equal(pending.body.error, 'card_not_approved_for_apply');

  await requestJson('/api/mealscout/intake/action-cards/card-pending/decision', {
    method: 'PATCH',
    body: JSON.stringify({ decisionState: 'rejected' })
  });
  const rejected = await requestJson<{ error: string }>('/api/mealscout/intake/action-cards/card-pending/apply', { method: 'POST' });
  assert.equal(rejected.status, 409);

  await requestJson('/api/mealscout/intake/action-cards/card-pending/decision', {
    method: 'PATCH',
    body: JSON.stringify({ decisionState: 'deferred' })
  });
  const deferred = await requestJson<{ error: string }>('/api/mealscout/intake/action-cards/card-pending/apply', { method: 'POST' });
  assert.equal(deferred.status, 409);
});

test('apply update_existing_profile updates only approved non-empty fields and rejects stale conflicts', async () => {
  rememberActionCards(
    [
      {
        id: 'card-seed-existing',
        type: 'create_profile_draft',
        title: 'Seed',
        entityType: 'food_truck',
        confidence: 0.99,
        sourceFileIds: ['seed'],
        extractedFields: { truckName: 'Seed Truck', phone: '111', cityArea: 'A' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-seed'
  );
  await requestJson('/api/mealscout/intake/action-cards/card-seed-existing/decision', { method: 'PATCH', body: JSON.stringify({ decisionState: 'approved_for_apply' }) });
  await requestJson('/api/mealscout/intake/action-cards/card-seed-existing/apply', { method: 'POST' });

  rememberActionCards(
    [
      {
        id: 'card-update-existing',
        type: 'update_existing_profile',
        title: 'Update',
        entityType: 'food_truck',
        confidence: 0.91,
        sourceFileIds: ['upd'],
        extractedFields: { truckName: 'Seed Truck Updated', phone: '', cityArea: 'B' },
        missingFields: [],
        existingEntityMatch: { entityId: 'ms-runtime-card-seed-existing', confidence: 0.9, reason: 'match' },
        recommendedAction: 'review_update_existing_profile',
        mutationAllowed: false
      }
    ],
    'batch-update'
  );
  await requestJson('/api/mealscout/intake/action-cards/card-update-existing/decision', { method: 'PATCH', body: JSON.stringify({ decisionState: 'approved_for_apply' }) });
  const update = await requestJson<{ applyState: string; updatedEntity: { fields: Record<string, unknown> }; fieldDiff: Array<{ field: string }> }>(
    '/api/mealscout/intake/action-cards/card-update-existing/apply',
    { method: 'POST' }
  );
  assert.equal(update.status, 200);
  assert.equal(update.body.applyState, 'applied');
  assert.equal(update.body.updatedEntity.fields.phone, '111');
  assert.equal(update.body.updatedEntity.fields.cityArea, 'B');
  assert.equal(update.body.fieldDiff.some((row) => row.field === 'phone'), false);

  rememberActionCards(
    [
      {
        id: 'card-update-stale',
        type: 'update_existing_profile',
        title: 'Stale',
        entityType: 'food_truck',
        confidence: 0.91,
        sourceFileIds: ['upd2'],
        extractedFields: { truckName: 'x' },
        missingFields: [],
        existingEntityMatch: { entityId: 'missing-entity', confidence: 0.9, reason: 'match' },
        recommendedAction: 'review_update_existing_profile',
        mutationAllowed: false
      }
    ],
    'batch-stale'
  );
  await requestJson('/api/mealscout/intake/action-cards/card-update-stale/decision', { method: 'PATCH', body: JSON.stringify({ decisionState: 'approved_for_apply' }) });
  const stale = await requestJson<{ applyState: string; skippedReason: string }>(
    '/api/mealscout/intake/action-cards/card-update-stale/apply',
    { method: 'POST' }
  );
  assert.equal(stale.status, 200);
  assert.equal(stale.body.applyState, 'apply_failed');
  assert.equal(stale.body.skippedReason, 'stale_before_state_conflict');
});

test('apply claim/request_missing/defer do not mutate live profile data', async () => {
  rememberActionCards(
    [
      {
        id: 'card-claim',
        type: 'claim_existing_profile',
        title: 'Claim',
        entityType: 'food_truck',
        confidence: 0.9,
        sourceFileIds: ['c'],
        extractedFields: { truckName: 'Claim' },
        missingFields: [],
        existingEntityMatch: { entityId: 'existing-claim', confidence: 0.9, reason: 'match' },
        recommendedAction: 'review_claim_existing_profile',
        mutationAllowed: false
      },
      {
        id: 'card-missing-apply',
        type: 'request_missing_info',
        title: 'Missing',
        entityType: 'food_truck',
        confidence: 0.8,
        sourceFileIds: ['m'],
        extractedFields: {},
        missingFields: ['menu'],
        existingEntityMatch: null,
        recommendedAction: 'collect_required_fields',
        mutationAllowed: false
      },
      {
        id: 'card-defer-apply',
        type: 'defer_unclassified',
        title: 'Defer',
        entityType: 'unknown',
        confidence: 0.2,
        sourceFileIds: ['d'],
        extractedFields: {},
        missingFields: ['identity'],
        existingEntityMatch: null,
        recommendedAction: 'hold_for_manual_review',
        mutationAllowed: false
      }
    ],
    'batch-others'
  );
  for (const id of ['card-claim', 'card-missing-apply', 'card-defer-apply']) {
    await requestJson(`/api/mealscout/intake/action-cards/${id}/decision`, { method: 'PATCH', body: JSON.stringify({ decisionState: 'approved_for_apply' }) });
  }

  const claim = await requestJson<{ applyState: string; skippedReason: string; claimResult: { ownershipTransferred: boolean } | null }>(
    '/api/mealscout/intake/action-cards/card-claim/apply',
    { method: 'POST' }
  );
  assert.equal(claim.status, 200);
  assert.equal(claim.body.applyState, 'apply_failed');
  assert.equal(claim.body.skippedReason, 'pending_claim_not_supported');
  assert.equal(claim.body.claimResult, null);

  const missing = await requestJson<{ applyState: string; skippedReason: string }>(
    '/api/mealscout/intake/action-cards/card-missing-apply/apply',
    { method: 'POST' }
  );
  assert.equal(missing.status, 200);
  assert.equal(missing.body.applyState, 'apply_failed');
  assert.equal(missing.body.skippedReason, 'missing_info_task_not_supported');

  const defer = await requestJson<{ applyState: string; skippedReason: string }>(
    '/api/mealscout/intake/action-cards/card-defer-apply/apply',
    { method: 'POST' }
  );
  assert.equal(defer.status, 200);
  assert.equal(defer.body.applyState, 'apply_failed');
  assert.equal(defer.body.skippedReason, 'defer_unclassified_no_apply');
});

test('apply supports applyReason and returns applyError field on blocked duplicate create', async () => {
  rememberActionCards(
    [
      {
        id: 'card-dup-reason',
        type: 'create_profile_draft',
        title: 'Create duplicate-like with reason',
        entityType: 'food_truck',
        confidence: 0.91,
        sourceFileIds: ['dup-src-reason'],
        extractedFields: { truckName: 'Duplicate Candidate Reason', phone: '850-111-0000' },
        missingFields: [],
        existingEntityMatch: { entityId: 'existing-dup-reason', confidence: 0.88, reason: 'phone_match' },
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-dup-reason'
  );
  await requestJson('/api/mealscout/intake/action-cards/card-dup-reason/decision', {
    method: 'PATCH',
    body: JSON.stringify({ decisionState: 'approved_for_apply' })
  });
  const blockedApply = await requestJson<{ applyState: string; skippedReason: string; applyError: string; auditWarnings: string[] }>(
    '/api/mealscout/intake/action-cards/card-dup-reason/apply',
    { method: 'POST', body: JSON.stringify({ applyReason: 'operator_reviewed_no_override' }) }
  );
  assert.equal(blockedApply.status, 200);
  assert.equal(blockedApply.body.applyState, 'apply_failed');
  assert.equal(blockedApply.body.skippedReason, 'duplicate_override_required');
  assert.equal(blockedApply.body.applyError, 'duplicate_override_required');
  assert.equal(blockedApply.body.auditWarnings.some((item) => item.startsWith('apply_reason:')), true);
});

test('apply endpoint enforces role gate and unknown id safety', async () => {
  const unauthorized = await requestJson<{ error: string }>(
    '/api/mealscout/intake/action-cards/nope/apply',
    { method: 'POST' },
    'viewer'
  );
  assert.equal(unauthorized.status, 403);
  assert.equal(unauthorized.body.error, 'forbidden');

  const unknown = await requestJson<{ error: string }>(
    '/api/mealscout/intake/action-cards/nope/apply',
    { method: 'POST' }
  );
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error, 'action_card_not_found');
});

test('regeneration does not duplicate cards and preserves decision/apply states', async () => {
  rememberActionCards(
    [
      {
        id: 'card-persist-1',
        type: 'create_profile_draft',
        title: 'Persist me',
        entityType: 'food_truck',
        confidence: 0.9,
        sourceFileIds: ['src-persist'],
        extractedFields: { truckName: 'Persist One' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false,
        duplicateWarnings: ['possible_duplicate_existing_entity_match'],
        conflictWarnings: [],
        replacementCandidate: { entityId: 'x', confidence: 0.7, reason: 'phone_match' }
      }
    ],
    'batch-persist'
  );
  await requestJson('/api/mealscout/intake/action-cards/card-persist-1/decision', {
    method: 'PATCH',
    body: JSON.stringify({ decisionState: 'approved_for_apply', decisionReason: 'approved' })
  });

  // Regenerate/upsert same card with changed title; decision/apply state must persist.
  rememberActionCards(
    [
      {
        id: 'card-persist-1',
        type: 'create_profile_draft',
        title: 'Persist me updated',
        entityType: 'food_truck',
        confidence: 0.91,
        sourceFileIds: ['src-persist'],
        extractedFields: { truckName: 'Persist One Updated' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false,
        duplicateWarnings: ['possible_duplicate_existing_entity_match'],
        conflictWarnings: [],
        replacementCandidate: { entityId: 'x', confidence: 0.8, reason: 'phone_match' }
      }
    ],
    'batch-persist'
  );

  const list = await requestJson<{ actionCards: Array<{ id: string; decisionState: string; duplicateWarnings: string[]; replacementCandidate: unknown }> }>(
    '/api/mealscout/intake/action-cards'
  );
  const rows = list.body.actionCards.filter((row) => row.id === 'card-persist-1');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decisionState, 'approved_for_apply');
  assert.equal(rows[0].duplicateWarnings.includes('possible_duplicate_existing_entity_match'), true);
  assert.ok(rows[0].replacementCandidate);
});

test('action card data survives queue store reload', async () => {
  rememberActionCards(
    [
      {
        id: 'card-reload-1',
        type: 'defer_unclassified',
        title: 'Reload me',
        entityType: 'unknown',
        confidence: 0.3,
        sourceFileIds: ['reload-src'],
        extractedFields: { note: 'reload test' },
        missingFields: ['identity'],
        existingEntityMatch: null,
        recommendedAction: 'hold_for_manual_review',
        mutationAllowed: false,
        duplicateWarnings: [],
        conflictWarnings: ['possible_rebrand_or_replacement'],
        replacementCandidate: { entityId: 'reload-entity', confidence: 0.5, reason: 'name_match' }
      }
    ],
    'batch-reload'
  );
  closeActionCardQueueStore();
  initializeActionCardQueueStore();
  const row = getActionCard('card-reload-1');
  assert.ok(row);
  assert.equal(row?.sourceFileIds.includes('reload-src'), true);
  assert.equal((row?.conflictWarnings || []).includes('possible_rebrand_or_replacement'), true);
  assert.equal(row?.replacementCandidate?.entityId, 'reload-entity');
});

test('notification preview denied for unapplied and ready for applied with recipient/link', async () => {
  rememberActionCards(
    [
      {
        id: 'card-notify-1',
        type: 'create_profile_draft',
        title: 'Notify me',
        entityType: 'food_truck',
        confidence: 0.95,
        sourceFileIds: ['src-notify'],
        extractedFields: { truckName: 'Notify Truck', email: 'owner@example.com' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-notify'
  );
  const blocked = await requestJson<{ eligible: boolean; blockedReason: string; notificationState: string }>(
    '/api/mealscout/intake/action-cards/card-notify-1/notification/preview',
    { method: 'POST' }
  );
  assert.equal(blocked.status, 200);
  assert.equal(blocked.body.eligible, false);
  assert.equal(blocked.body.blockedReason, 'card_not_applied');
  assert.equal(blocked.body.notificationState, 'blocked');

  await requestJson('/api/mealscout/intake/action-cards/card-notify-1/decision', {
    method: 'PATCH',
    body: JSON.stringify({ decisionState: 'approved_for_apply' })
  });
  await requestJson('/api/mealscout/intake/action-cards/card-notify-1/apply', { method: 'POST' });

  const ready = await requestJson<{ eligible: boolean; profileLink: string; recipientCandidate: { value: string } }>(
    '/api/mealscout/intake/action-cards/card-notify-1/notification/preview',
    { method: 'POST' }
  );
  assert.equal(ready.status, 200);
  assert.equal(ready.body.eligible, true);
  assert.equal(ready.body.profileLink.includes('/mealscout/profile/'), true);
  assert.equal(ready.body.recipientCandidate.value, 'owner@example.com');
});

test('notification preview blocks missing recipient and conflict without override send', async () => {
  rememberActionCards(
    [
      {
        id: 'card-notify-missing',
        type: 'create_profile_draft',
        title: 'No recipient',
        entityType: 'food_truck',
        confidence: 0.95,
        sourceFileIds: ['src-nr'],
        extractedFields: { truckName: 'No Recipient Truck' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      },
      {
        id: 'card-notify-conflict',
        type: 'create_profile_draft',
        title: 'Conflict recipient',
        entityType: 'food_truck',
        confidence: 0.95,
        sourceFileIds: ['src-cf'],
        extractedFields: { truckName: 'Conflict Truck', phone: '850-333-1212' },
        missingFields: [],
        existingEntityMatch: { entityId: 'existing-cf', confidence: 0.9, reason: 'phone_match' },
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false,
        duplicateWarnings: ['possible_duplicate_existing_entity_match']
      }
    ],
    'batch-notify-2'
  );
  for (const id of ['card-notify-missing', 'card-notify-conflict']) {
    await requestJson(`/api/mealscout/intake/action-cards/${id}/decision`, {
      method: 'PATCH',
      body: JSON.stringify({ decisionState: 'approved_for_apply' })
    });
    await requestJson(`/api/mealscout/intake/action-cards/${id}/apply`, { method: 'POST', body: JSON.stringify({ allowDuplicateCreate: true }) });
  }

  const missingPreview = await requestJson<{ eligible: boolean; blockedReason: string }>(
    '/api/mealscout/intake/action-cards/card-notify-missing/notification/preview',
    { method: 'POST' }
  );
  assert.equal(missingPreview.body.eligible, false);
  assert.equal(missingPreview.body.blockedReason, 'recipient_missing');

  const conflictBlocked = await requestJson<{ notificationState: string; blockedReason: string }>(
    '/api/mealscout/intake/action-cards/card-notify-conflict/notification/send',
    { method: 'POST', body: JSON.stringify({ channel: 'manual_copy' }) }
  );
  assert.equal(conflictBlocked.status, 200);
  assert.equal(conflictBlocked.body.notificationState, 'blocked');
  assert.equal(conflictBlocked.body.blockedReason, 'conflict_override_required');
});

test('notification preview blocks with recipient_ambiguous when multiple contact candidates conflict', async () => {
  rememberActionCards(
    [
      {
        id: 'card-notify-ambiguous',
        type: 'create_profile_draft',
        title: 'Ambiguous recipient',
        entityType: 'food_truck',
        confidence: 0.95,
        sourceFileIds: ['src-amb-1', 'src-amb-2'],
        extractedFields: {
          truckName: 'Ambiguous Truck',
          contactCandidates: [
            { type: 'email', value: 'a@example.com', normalizedValue: 'a@example.com' },
            { type: 'email', value: 'b@example.com', normalizedValue: 'b@example.com' }
          ]
        },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-notify-ambiguous'
  );
  await requestJson('/api/mealscout/intake/action-cards/card-notify-ambiguous/decision', {
    method: 'PATCH',
    body: JSON.stringify({ decisionState: 'approved_for_apply' })
  });
  await requestJson('/api/mealscout/intake/action-cards/card-notify-ambiguous/apply', { method: 'POST' });

  const preview = await requestJson<{ eligible: boolean; blockedReason: string; recipientAmbiguous: boolean; recipientCandidates: unknown[] }>(
    '/api/mealscout/intake/action-cards/card-notify-ambiguous/notification/preview',
    { method: 'POST' }
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.body.eligible, false);
  assert.equal(preview.body.blockedReason, 'recipient_ambiguous');
  assert.equal(preview.body.recipientAmbiguous, true);
  assert.equal(Array.isArray(preview.body.recipientCandidates), true);
  assert.equal(preview.body.recipientCandidates.length, 2);
});

test('manual_copy notification returns copy text and does not claim external delivery', async () => {
  rememberActionCards(
    [
      {
        id: 'card-notify-send',
        type: 'create_profile_draft',
        title: 'Send copy',
        entityType: 'food_truck',
        confidence: 0.95,
        sourceFileIds: ['src-send'],
        extractedFields: { truckName: 'Send Truck', phone: '850-900-0000' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-notify-3'
  );
  await requestJson('/api/mealscout/intake/action-cards/card-notify-send/decision', {
    method: 'PATCH',
    body: JSON.stringify({ decisionState: 'approved_for_apply' })
  });
  await requestJson('/api/mealscout/intake/action-cards/card-notify-send/apply', { method: 'POST' });

  const sent = await requestJson<{
    notificationState: string;
    messageSent: string;
    mutationAllowed: boolean;
    notificationResult: { mode: string };
    notificationTrackingId: string;
    notificationLink: string;
  }>(
    '/api/mealscout/intake/action-cards/card-notify-send/notification/send',
    { method: 'POST', body: JSON.stringify({ channel: 'manual_copy', recipient: '850-900-0000' }) }
  );
  assert.equal(sent.status, 200);
  assert.equal(sent.body.notificationState, 'ready');
  assert.equal(sent.body.mutationAllowed, false);
  assert.equal(sent.body.notificationResult.mode, 'copy_only');
  assert.equal(sent.body.messageSent.includes('join our platform'), false);
  assert.equal(sent.body.messageSent.includes('/api/mealscout/intake/notifications/'), true);
  assert.equal(typeof sent.body.notificationTrackingId, 'string');
  assert.equal(sent.body.notificationLink.includes('/api/mealscout/intake/notifications/'), true);

  const second = await requestJson<{ notificationState: string; blockedReason: string }>(
    '/api/mealscout/intake/action-cards/card-notify-send/notification/send',
    { method: 'POST', body: JSON.stringify({ channel: 'email', recipient: 'owner@example.com' }) }
  );
  assert.equal(second.status, 200);
  assert.equal(second.body.notificationState, 'blocked');
  assert.equal(second.body.blockedReason, 'channel_not_available');
});

test('notification open tracking increments and redirects to canonical profile link', async () => {
  rememberActionCards(
    [
      {
        id: 'card-notify-open',
        type: 'create_profile_draft',
        title: 'Track open',
        entityType: 'food_truck',
        confidence: 0.95,
        sourceFileIds: ['src-open'],
        extractedFields: { truckName: 'Open Truck', email: 'open@example.com' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-notify-open'
  );
  await requestJson('/api/mealscout/intake/action-cards/card-notify-open/decision', {
    method: 'PATCH',
    body: JSON.stringify({ decisionState: 'approved_for_apply' })
  });
  await requestJson('/api/mealscout/intake/action-cards/card-notify-open/apply', { method: 'POST' });
  const preview = await requestJson<{ notificationTrackingId: string; notificationLink: string }>(
    '/api/mealscout/intake/action-cards/card-notify-open/notification/preview',
    { method: 'POST' }
  );
  const trackingId = preview.body.notificationTrackingId;
  assert.equal(Boolean(trackingId), true);

  const open1 = await fetch(`${baseUrl}/api/mealscout/intake/notifications/${encodeURIComponent(trackingId)}/open`, {
    redirect: 'manual'
  });
  assert.equal(open1.status, 302);
  assert.equal((open1.headers.get('location') || '').includes('/mealscout/profile/'), true);

  const status1 = await requestJson<{
    notificationOpenCount: number;
    notificationOpenedAt: string | null;
    notificationLastOpenedAt: string | null;
  }>(`/api/mealscout/intake/action-cards/card-notify-open/notification/status`);
  assert.equal(status1.status, 200);
  assert.equal(status1.body.notificationOpenCount, 1);
  assert.equal(Boolean(status1.body.notificationOpenedAt), true);
  assert.equal(Boolean(status1.body.notificationLastOpenedAt), true);

  const open2 = await fetch(`${baseUrl}/api/mealscout/intake/notifications/${encodeURIComponent(trackingId)}/open`, {
    redirect: 'manual'
  });
  assert.equal(open2.status, 302);
  const status2 = await requestJson<{ notificationOpenCount: number }>(
    `/api/mealscout/intake/action-cards/card-notify-open/notification/status`
  );
  assert.equal(status2.body.notificationOpenCount, 2);
});

test('unknown notification tracking id returns 404 and no profile mutation side effects', async () => {
  const response = await fetch(`${baseUrl}/api/mealscout/intake/notifications/not-real/open`, { redirect: 'manual' });
  assert.equal(response.status, 404);
});

test('manual recipient override requires reason/valid format and enables preview when recipient was missing', async () => {
  rememberActionCards(
    [
      {
        id: 'card-manual-recipient',
        type: 'create_profile_draft',
        title: 'Manual recipient',
        entityType: 'food_truck',
        confidence: 0.95,
        sourceFileIds: ['src-manual-recipient'],
        extractedFields: { truckName: 'Manual Recipient Truck' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-manual-recipient'
  );
  await requestJson('/api/mealscout/intake/action-cards/card-manual-recipient/decision', {
    method: 'PATCH',
    body: JSON.stringify({ decisionState: 'approved_for_apply' })
  });
  await requestJson('/api/mealscout/intake/action-cards/card-manual-recipient/apply', { method: 'POST' });

  const denied = await requestJson<{ mutationAllowed: boolean }>(
    '/api/mealscout/intake/action-cards/card-manual-recipient/notification/recipient',
    {
      method: 'PATCH',
      headers: { 'x-operator-role': 'viewer' },
      body: JSON.stringify({ recipient: 'x@example.com', recipientType: 'email', recipientSource: 'operator_supplied', reason: 'known contact' })
    }
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.body.mutationAllowed, false);

  const missingReason = await requestJson<{ error: string }>(
    '/api/mealscout/intake/action-cards/card-manual-recipient/notification/recipient',
    {
      method: 'PATCH',
      body: JSON.stringify({ recipient: 'x@example.com', recipientType: 'email', recipientSource: 'operator_supplied' })
    }
  );
  assert.equal(missingReason.status, 400);

  const invalidEmail = await requestJson<{ error: string }>(
    '/api/mealscout/intake/action-cards/card-manual-recipient/notification/recipient',
    {
      method: 'PATCH',
      body: JSON.stringify({ recipient: 'not-an-email', recipientType: 'email', recipientSource: 'operator_supplied', reason: 'known contact' })
    }
  );
  assert.equal(invalidEmail.status, 400);

  const saved = await requestJson<{ mutationAllowed: boolean; manualNotificationRecipient: string }>(
    '/api/mealscout/intake/action-cards/card-manual-recipient/notification/recipient',
    {
      method: 'PATCH',
      body: JSON.stringify({ recipient: 'owner@example.com', recipientType: 'email', recipientSource: 'operator_supplied', reason: 'known contact' })
    }
  );
  assert.equal(saved.status, 200);
  assert.equal(saved.body.mutationAllowed, false);
  assert.equal(saved.body.manualNotificationRecipient, 'owner@example.com');

  const preview = await requestJson<{ eligible: boolean; blockedReason: string | null; recipientCandidate: { value: string } | null }>(
    '/api/mealscout/intake/action-cards/card-manual-recipient/notification/preview',
    { method: 'POST' }
  );
  assert.equal(preview.status, 200);
  assert.equal(preview.body.eligible, true);
  assert.equal(preview.body.blockedReason, null);
  assert.equal(preview.body.recipientCandidate?.value, 'owner@example.com');
});

test('contact evidence add-on endpoint is gated and validates sourceFileIds', async () => {
  rememberActionCards(
    [
      {
        id: 'card-contact-addon',
        type: 'create_profile_draft',
        title: 'Contact addon',
        entityType: 'food_truck',
        confidence: 0.95,
        sourceFileIds: ['src-contact-addon'],
        extractedFields: { truckName: 'Contact Addon Truck' },
        missingFields: [],
        existingEntityMatch: null,
        recommendedAction: 'review_create_profile_draft',
        mutationAllowed: false
      }
    ],
    'batch-contact-addon'
  );
  const denied = await requestJson<{ mutationAllowed: boolean }>(
    '/api/mealscout/intake/action-cards/card-contact-addon/contact-evidence',
    {
      method: 'POST',
      headers: { 'x-operator-role': 'viewer' },
      body: JSON.stringify({ sourceFileIds: ['x'], reason: 'contact_screenshot_added', reprocessContactOnly: true })
    }
  );
  assert.equal(denied.status, 403);
  assert.equal(denied.body.mutationAllowed, false);

  const missing = await requestJson<{ error: string }>(
    '/api/mealscout/intake/action-cards/card-contact-addon/contact-evidence',
    {
      method: 'POST',
      body: JSON.stringify({ sourceFileIds: [], reason: 'contact_screenshot_added', reprocessContactOnly: true })
    }
  );
  assert.equal(missing.status, 400);
});
