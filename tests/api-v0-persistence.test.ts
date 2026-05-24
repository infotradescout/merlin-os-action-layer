import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, before, after } from 'node:test';

import {
  closeLisaStore,
  getDailyPayloadForUser,
  getEntityState,
  getEntityTimeline,
  getRecentChanges,
  initializeLisaStore,
  ingestTradeScoutEvent,
  resetLisaStore
} from '../src/lisa.ts';

let tempRoot: string;
let tempDbPath: string;

before(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), 'merlin-or-v0-2-'));
  tempDbPath = path.join(tempRoot, 'merlin-or.sqlite');
});

after(async () => {
  closeLisaStore();
  await rm(tempRoot, { recursive: true, force: true });
});

test('entity state, timeline, recent changes, and daily persist through SQLite restart', async () => {
  initializeLisaStore(tempDbPath);
  resetLisaStore();
  const observedAt = new Date().toISOString();
  const entityId = `business-${randomUUID()}`;

  const signalId = ingestTradeScoutEvent({
    entity_id: entityId,
    entity_type: 'business',
    event_type: 'verification_document_uploaded',
    title: 'Insurance document uploaded',
    observed_at: observedAt
  });
  assert.equal(typeof signalId, 'string');
  assert.equal(signalId.length > 0, true);

  const firstState = getEntityState(entityId);
  assert.ok(firstState);
  assert.equal(firstState.entity_id, entityId);
  assert.equal(firstState.current_state, 'active');

  const firstTimeline = getEntityTimeline(entityId);
  assert.equal(firstTimeline.length, 1);
  assert.equal(firstTimeline[0].id, signalId);
  assert.equal(firstTimeline[0].entity_id, entityId);
  assert.equal(firstTimeline[0].signal_type, 'contractor_claim');

  const firstChanges = getRecentChanges(10).changes;
  assert.equal(firstChanges.length >= 1, true);
  assert.equal(firstChanges[0].entity_id, entityId);

  const firstDaily = getDailyPayloadForUser('demo-user', { now: Date.now(), maxItemsPerSection: 10 });
  assert.equal(firstDaily.sections.changed.length, 1);
  assert.equal(firstDaily.sections.changed[0].source_refs.includes(`tradescout:${entityId}`), true);

  closeLisaStore();
  initializeLisaStore(tempDbPath);

  const secondState = getEntityState(entityId);
  assert.ok(secondState);
  assert.equal(secondState.entity_id, entityId);
  assert.equal(secondState.current_state, 'active');
  assert.equal(secondState.last_signal_id, signalId);

  const secondTimeline = getEntityTimeline(entityId);
  assert.equal(secondTimeline.length, 1);
  assert.equal(secondTimeline[0].id, signalId);

  const secondChanges = getRecentChanges(10).changes;
  assert.equal(secondChanges.length >= 1, true);
  assert.equal(secondChanges[0].entity_id, entityId);
  assert.equal(secondChanges[0].id, signalId);

  const secondDaily = getDailyPayloadForUser('demo-user', { now: Date.now(), maxItemsPerSection: 10 });
  assert.equal(secondDaily.sections.changed.length, 1);
  assert.equal(secondDaily.sections.changed[0].source_refs.includes(`lisa:${signalId}`), true);
});

test('empty new SQLite db returns empty daily sections', async () => {
  const newRoot = await mkdtemp(path.join(tmpdir(), 'merlin-or-v0-2-empty-'));
  const newDbPath = path.join(newRoot, 'merlin-or.sqlite');
  initializeLisaStore(newDbPath);

  const payload = getDailyPayloadForUser('demo-user', {
    now: Date.now(),
    maxItemsPerSection: 10
  });

  assert.equal(payload.sections.changed.length, 0);
  assert.equal(payload.sections.needs_attention.length, 0);
  assert.equal(payload.sections.waiting.length, 0);
  assert.equal(payload.sections.stale.length, 0);
  assert.equal(payload.sections.suggested_next_steps.length, 0);

  closeLisaStore();
  await rm(newRoot, { recursive: true, force: true });
  initializeLisaStore(tempDbPath);
});
