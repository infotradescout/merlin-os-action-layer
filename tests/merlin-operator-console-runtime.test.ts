import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Database from 'better-sqlite3';

process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');
const { closeMerlinActionCardRuntime, resetMerlinActionCardRuntimeForTest } = await import('../src/merlin/actionCardRuntime.ts');
const { closeMerlinIntakeRuntime, resetMerlinIntakeRuntimeForTest } = await import('../src/merlin/intakeRuntime.ts');
const { closeMerlinEntityMemoryRuntime, resetMerlinEntityMemoryRuntimeForTest } = await import('../src/merlin/entityMemoryRuntime.ts');
const { closeMerlinOutcomeRuntime, resetMerlinOutcomeRuntimeForTest } = await import('../src/merlin/outcomeRuntime.ts');

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

async function createIntake(brand = 'mealscout') {
  const created = await requestJson<{ intake: { id: string } }>('/api/merlin/intake', {
    method: 'POST',
    body: JSON.stringify({
      brand_lane: brand,
      source_type: 'drive',
      source_reference: `drive://console-${brand}-${Math.random().toString(16).slice(2)}`,
      origin_surface: 'operator_console_test',
      intent_text: 'review profile evidence',
      raw_text: `${brand} profile evidence`,
      extracted_fields: {
        businessName: brand === 'mealscout' ? 'Console Taco Truck' : 'Console Contractor',
        cityArea: 'Test City',
        email: `${brand}@console.example`
      },
      confidence: 0.83,
      required_real_data: ['source_evidence']
    })
  });
  assert.equal(created.status, 201);
  return created.body.intake.id;
}

async function resolveEntity(intakeId: string) {
  const resolved = await requestJson<{ resolution: { entity: { id: string } } }>(`/api/merlin/intake/${encodeURIComponent(intakeId)}/resolve-entity`, {
    method: 'POST'
  });
  assert.equal(resolved.status, 200);
  return resolved.body.resolution.entity.id;
}

async function createActionCard(overrides: Record<string, unknown> = {}) {
  const created = await requestJson<{ card: { id: string; status: string } }>('/api/merlin/action-cards', {
    method: 'POST',
    body: JSON.stringify({
      brand: 'mealscout',
      kpi: 'operator_console_kpi',
      intent: 'operator console action',
      source_of_truth: 'drive://console-action',
      required_real_data: ['source_evidence'],
      tool: 'drive',
      action: 'send_external_message',
      permission_level: 'level_2',
      fail_safes: ['requires_approval'],
      output_location: 'merlin.operator_console',
      source_refs: ['drive://console-action'],
      ...overrides
    })
  });
  assert.equal(created.status, 201);
  return created.body.card.id;
}

function seedOpenConflict(entityId: string) {
  const db = new Database(resolve(process.cwd(), process.env.MERLIN_DB_PATH || './data/merlin-or.sqlite'));
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO merlin_entity_conflicts
    (id, entity_id, conflict_type, summary, source_reference, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(`console-conflict-${Date.now()}`, entityId, 'identifier_collision', 'Console test open conflict', 'drive://conflict-source', 'open', now, now);
  db.close();
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
  closeMerlinOutcomeRuntime();
  closeMerlinEntityMemoryRuntime();
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

test('operator console returns read-only envelope and summary counts', async () => {
  const intakeId = await createIntake();
  const entityId = await resolveEntity(intakeId);
  seedOpenConflict(entityId);
  await createActionCard({ entity_id: entityId, intent: 'pending approval card' });
  const outcomeCardId = await createActionCard({ entity_id: entityId, intent: 'outcome card' });
  await createActionCard({ action: 'unknown_action', intent: 'blocked action' });
  await requestJson('/api/merlin/outcomes', {
    method: 'POST',
    body: JSON.stringify({
      action_card_id: outcomeCardId,
      outcome_type: 'needs_more_data',
      status: 'recorded',
      result_summary: 'Need a clearer source file'
    })
  });

  const console = await requestJson<{
    mode: string;
    mutationAllowed: boolean;
    summary: {
      intakeOpenCount: number;
      entityConflictCount: number;
      actionCardPendingCount: number;
      actionCardBlockedCount: number;
      outcomeRecordedCount: number;
    };
    attention: {
      openEntityConflicts: unknown[];
      approvalRequiredActionCards: unknown[];
      blockedActionCards: unknown[];
      needsMoreDataOutcomes: unknown[];
    };
  }>('/api/merlin/operator-console');
  assert.equal(console.status, 200);
  assert.equal(console.body.mode, 'read_only');
  assert.equal(console.body.mutationAllowed, false);
  assert.equal(console.body.summary.intakeOpenCount >= 1, true);
  assert.equal(console.body.summary.entityConflictCount >= 1, true);
  assert.equal(console.body.summary.actionCardPendingCount >= 1, true);
  assert.equal(console.body.summary.actionCardBlockedCount >= 1, true);
  assert.equal(console.body.summary.outcomeRecordedCount >= 1, true);
  assert.equal(console.body.attention.openEntityConflicts.length >= 1, true);
  assert.equal(console.body.attention.approvalRequiredActionCards.length >= 1, true);
  assert.equal(console.body.attention.blockedActionCards.length >= 1, true);
  assert.equal(console.body.attention.needsMoreDataOutcomes.length >= 1, true);
});

test('brand and entity console filters work', async () => {
  const mealIntake = await createIntake('mealscout');
  const entityId = await resolveEntity(mealIntake);
  await createActionCard({ entity_id: entityId, brand: 'mealscout', intent: 'meal action' });
  await createActionCard({ brand: 'tradescout', intent: 'trade action' });

  const brand = await requestJson<{ recent: { actionCards: Array<{ brand: string }> } }>('/api/merlin/operator-console/brand/mealscout');
  assert.equal(brand.status, 200);
  assert.equal(brand.body.recent.actionCards.every((card) => card.brand === 'mealscout'), true);

  const entity = await requestJson<{ recent: { entities: Array<{ id: string }>; actionCards: Array<{ entity_id?: string }> } }>(
    `/api/merlin/operator-console/entity/${encodeURIComponent(entityId)}`
  );
  assert.equal(entity.status, 200);
  assert.equal(entity.body.recent.entities.length, 1);
  assert.equal(entity.body.recent.entities[0].id, entityId);
  assert.equal(entity.body.recent.actionCards.every((card) => card.entity_id === entityId), true);
});

test('kpi rollups are included and no execution endpoint exists', async () => {
  const cardId = await createActionCard();
  await requestJson('/api/merlin/outcomes', {
    method: 'POST',
    body: JSON.stringify({
      action_card_id: cardId,
      outcome_type: 'verification_completed',
      status: 'verified',
      result_summary: 'Verified for console rollup'
    })
  });

  const console = await requestJson<{ kpiRollups: Array<{ brand_lane: string; verified_outcomes: number }> }>('/api/merlin/operator-console?brand_lane=mealscout');
  assert.equal(console.status, 200);
  assert.equal(console.body.kpiRollups.some((row) => row.brand_lane === 'mealscout' && row.verified_outcomes >= 1), true);

  const exec = await requestJson<Record<string, unknown>>('/api/merlin/operator-console/execute', { method: 'POST', body: '{}' });
  assert.equal(exec.status, 404);
});
