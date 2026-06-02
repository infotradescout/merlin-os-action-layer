import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');
const { closeMerlinActionCardRuntime, resetMerlinActionCardRuntimeForTest } = await import('../src/merlin/actionCardRuntime.ts');
const { closeMerlinIntakeRuntime, resetMerlinIntakeRuntimeForTest } = await import('../src/merlin/intakeRuntime.ts');
const { closeMerlinOutcomeRuntime, resetMerlinOutcomeRuntimeForTest } = await import('../src/merlin/outcomeRuntime.ts');
const { closeMerlinEntityMemoryRuntime, resetMerlinEntityMemoryRuntimeForTest } = await import('../src/merlin/entityMemoryRuntime.ts');

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

async function createActionCard(): Promise<{ cardId: string; intakeId: string }> {
  const intake = await requestJson<{ intake: { id: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify({
      brand_lane: 'mealscout',
      source_type: 'drive',
      source_reference: 'drive://outcome-seed',
      origin_surface: 'admin_review_queue',
      intent_text: 'verify profile update',
      raw_text: 'menu changed',
      extracted_fields: { businessName: 'Lettys Backyard', cityArea: 'Baton Rouge, LA' },
      confidence: 0.88,
      required_real_data: ['menu_image']
    })
  });
  assert.equal(intake.status, 201);
  await requestJson(`/api/merlin/intake/${encodeURIComponent(intake.body.intake.id)}/resolve-entity`, { method: 'POST' });
  const generated = await requestJson<{ cards: Array<{ id: string }> }>(`/api/merlin/intake/${encodeURIComponent(intake.body.intake.id)}/action-cards`, {
    method: 'POST'
  });
  assert.equal(generated.status, 200);
  assert.equal(generated.body.cards.length > 0, true);
  return { cardId: generated.body.cards[0].id, intakeId: intake.body.intake.id };
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
  closeMerlinEntityMemoryRuntime();
  closeMerlinOutcomeRuntime();
  closeMerlinIntakeRuntime();
  closeMerlinActionCardRuntime();
  closeLisaStore();
  closeDriveManifestStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
  resetMerlinOutcomeRuntimeForTest();
  resetMerlinEntityMemoryRuntimeForTest();
  resetMerlinIntakeRuntimeForTest();
  resetMerlinActionCardRuntimeForTest();
});

test('outcome persists and links/infers from action card + intake', async () => {
  const { cardId, intakeId } = await createActionCard();
  const created = await requestJson<{ outcome: { id: string; action_card_id: string; intake_item_id?: string; brand_lane: string; kpi: string } }>(
    '/api/merlin/outcomes',
    {
      method: 'POST',
      body: JSON.stringify({
        action_card_id: cardId,
        outcome_type: 'profile_updated',
        status: 'recorded',
        result_summary: 'Profile draft updated from menu evidence',
        source_refs: ['drive://outcome-seed']
      })
    }
  );
  assert.equal(created.status, 201);
  assert.equal(created.body.outcome.action_card_id, cardId);
  assert.equal(created.body.outcome.intake_item_id, intakeId);
  assert.equal(created.body.outcome.brand_lane, 'mealscout');
  assert.equal(typeof created.body.outcome.kpi, 'string');

  const detail = await requestJson<{ outcome: { id: string } }>(`/api/merlin/outcomes/${encodeURIComponent(created.body.outcome.id)}`);
  assert.equal(detail.status, 200);
});

test('outcome transitions action-card status by outcome type', async () => {
  const first = await createActionCard();
  await requestJson('/api/merlin/outcomes', {
    method: 'POST',
    body: JSON.stringify({
      action_card_id: first.cardId,
      outcome_type: 'profile_updated',
      status: 'recorded',
      result_summary: 'done'
    })
  });
  const firstCard = await requestJson<{ card: { status: string } }>(`/api/merlin/action-cards/${encodeURIComponent(first.cardId)}`);
  assert.equal(firstCard.status, 200);
  assert.equal(firstCard.body.card.status, 'completed');

  const second = await createActionCard();
  await requestJson('/api/merlin/outcomes', {
    method: 'POST',
    body: JSON.stringify({
      action_card_id: second.cardId,
      outcome_type: 'failed',
      status: 'failed',
      result_summary: 'failed check'
    })
  });
  const secondCard = await requestJson<{ card: { status: string } }>(`/api/merlin/action-cards/${encodeURIComponent(second.cardId)}`);
  assert.equal(secondCard.body.card.status, 'failed');

  const third = await createActionCard();
  await requestJson('/api/merlin/outcomes', {
    method: 'POST',
    body: JSON.stringify({
      action_card_id: third.cardId,
      outcome_type: 'needs_more_data',
      status: 'recorded',
      result_summary: 'need better screenshot'
    })
  });
  const thirdCard = await requestJson<{ card: { status: string } }>(`/api/merlin/action-cards/${encodeURIComponent(third.cardId)}`);
  assert.equal(thirdCard.body.card.status, 'deferred');
});

test('outcome status update writes history and rollup aggregates', async () => {
  const a = await createActionCard();
  const b = await createActionCard();
  const c = await createActionCard();

  const o1 = await requestJson<{ outcome: { id: string } }>('/api/merlin/outcomes', {
    method: 'POST',
    body: JSON.stringify({
      action_card_id: a.cardId,
      outcome_type: 'blocked_resolved',
      status: 'verified',
      result_summary: 'conflict resolved'
    })
  });
  await requestJson('/api/merlin/outcomes', {
    method: 'POST',
    body: JSON.stringify({
      action_card_id: b.cardId,
      outcome_type: 'failed',
      status: 'failed',
      result_summary: 'bad data'
    })
  });
  await requestJson('/api/merlin/outcomes', {
    method: 'POST',
    body: JSON.stringify({
      action_card_id: c.cardId,
      outcome_type: 'manual_done',
      status: 'recorded',
      result_summary: 'manual close'
    })
  });

  const patch = await requestJson<{ outcome: { status: string } }>(`/api/merlin/outcomes/${encodeURIComponent(o1.body.outcome.id)}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'verified', reason: 'confirmed by operator' })
  });
  assert.equal(patch.status, 200);
  assert.equal(patch.body.outcome.status, 'verified');

  const history = await requestJson<{ history: Array<{ event_type: string }> }>(`/api/merlin/outcomes/${encodeURIComponent(o1.body.outcome.id)}/history`);
  assert.equal(history.status, 200);
  assert.equal(history.body.history.some((h) => h.event_type === 'status_updated'), true);

  const rollup = await requestJson<{ rollup: Array<{ brand_lane: string; total_outcomes: number; failed_outcomes: number; blocked_resolved_count: number }> }>(
    '/api/merlin/kpi-rollup?brand_lane=mealscout'
  );
  assert.equal(rollup.status, 200);
  assert.equal(rollup.body.rollup.length > 0, true);
  const row = rollup.body.rollup[0];
  assert.equal(row.total_outcomes >= 3, true);
  assert.equal(row.failed_outcomes >= 1, true);
  assert.equal(row.blocked_resolved_count >= 1, true);
});

test('search includes outcome hits and no connector execution endpoint exists', async () => {
  const seed = await createActionCard();
  await requestJson('/api/merlin/outcomes', {
    method: 'POST',
    body: JSON.stringify({
      action_card_id: seed.cardId,
      outcome_type: 'verification_completed',
      status: 'verified',
      result_summary: 'verification completed successfully'
    })
  });
  const search = await requestJson<{ results: Array<{ source: string }> }>('/api/search?q=verification');
  assert.equal(search.status, 200);
  assert.equal(search.body.results.some((row) => row.source === 'merlin_outcome'), true);

  const exec = await requestJson<Record<string, unknown>>('/api/merlin/outcomes/execute', { method: 'POST', body: '{}' });
  assert.equal(exec.status, 404);
});
