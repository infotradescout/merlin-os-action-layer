import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import type { MealScoutDraftPacket, MealScoutDraftPacketHeldRow } from '../src/mealscoutDraftPacketGeneration.ts';
import { buildThomasMealScoutReviewQueue } from '../src/mealscoutThomasReviewQueue.ts';

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

test('Thomas review queue includes all generated draft packets and preserves held outputs', () => {
  const draftPackets = readJson<MealScoutDraftPacket[]>('artifacts/mealscout-draft-profile-packets/draft-packets.json');
  const manifestSummary = readJson<{ draftPacketsCreated: number; conflictsFound: number; ownerConfirmationsRequired: number }>(
    'artifacts/mealscout-draft-profile-packets/manifest-summary.json'
  );
  const unknownHeldRows = readJson<MealScoutDraftPacketHeldRow[]>('artifacts/mealscout-draft-profile-packets/unknown-held.json');
  const nonFoodQuarantineRows = readJson<MealScoutDraftPacketHeldRow[]>('artifacts/mealscout-draft-profile-packets/non-food-quarantine.json');

  const queue = buildThomasMealScoutReviewQueue({
    draftPackets,
    manifestSummary,
    unknownHeldRows,
    nonFoodQuarantineRows,
    generatedAt: '2026-06-14T00:00:00.000Z'
  });

  assert.equal(queue.summary.draftPacketsReviewed, 100);
  assert.equal(queue.summary.draftPacketsReviewed, manifestSummary.draftPacketsCreated);
  assert.equal(queue.summary.uniqueDraftPacketsBucketed, 100);
  assert.equal(queue.summary.conflictsFound, manifestSummary.conflictsFound);
  assert.equal(queue.summary.ownerConfirmationRequired, manifestSummary.ownerConfirmationsRequired);
  assert.equal(queue.summary.unknownHeld, unknownHeldRows.length);
  assert.equal(queue.summary.nonFoodQuarantine, nonFoodQuarantineRows.length);
  assert.equal(queue.buckets.unknown_held.length, 224);
  assert.equal(queue.buckets.non_food_quarantine.length, 181);
});

test('Thomas review queue excludes conflict-blocked drafts from clean candidates', () => {
  const draftPackets = readJson<MealScoutDraftPacket[]>('artifacts/mealscout-draft-profile-packets/draft-packets.json');
  const queue = buildThomasMealScoutReviewQueue({
    draftPackets,
    unknownHeldRows: [],
    nonFoodQuarantineRows: [],
    generatedAt: '2026-06-14T00:00:00.000Z'
  });

  const cleanIds = new Set(queue.buckets.clean_draft_candidates.map((item) => item.draftPacketId));
  assert.equal(queue.buckets.blocked_by_conflict.length, 7);
  assert.equal(queue.buckets.blocked_by_conflict.every((item) => item.conflicts.length > 0), true);
  assert.equal(queue.buckets.blocked_by_conflict.every((item) => !cleanIds.has(item.draftPacketId)), true);
});

test('Thomas review queue buckets owner confirmation drafts before low confidence and clean', () => {
  const draftPackets = readJson<MealScoutDraftPacket[]>('artifacts/mealscout-draft-profile-packets/draft-packets.json');
  const queue = buildThomasMealScoutReviewQueue({
    draftPackets,
    unknownHeldRows: [],
    nonFoodQuarantineRows: [],
    generatedAt: '2026-06-14T00:00:00.000Z'
  });

  const ownerIds = new Set(queue.buckets.owner_confirmation_required.map((item) => item.draftPacketId));
  const lowIds = new Set(queue.buckets.low_confidence_or_visual_review.map((item) => item.draftPacketId));
  const cleanIds = new Set(queue.buckets.clean_draft_candidates.map((item) => item.draftPacketId));
  assert.equal(queue.buckets.owner_confirmation_required.every((item) => item.ownerConfirmationRequired && item.conflicts.length === 0), true);
  assert.equal([...ownerIds].every((id) => !lowIds.has(id) && !cleanIds.has(id)), true);
  assert.equal(queue.summary.ownerConfirmationRequired, 35);
});

test('Thomas review queue does not introduce production or apply flags', () => {
  const draftPackets = readJson<MealScoutDraftPacket[]>('artifacts/mealscout-draft-profile-packets/draft-packets.json');
  const queue = buildThomasMealScoutReviewQueue({
    draftPackets: draftPackets.slice(0, 3),
    unknownHeldRows: [],
    nonFoodQuarantineRows: [],
    generatedAt: '2026-06-14T00:00:00.000Z'
  });
  const serialized = JSON.stringify(queue);

  assert.equal(queue.liveMealScoutMutation, false);
  assert.equal(serialized.includes('productionApplied'), false);
  assert.equal(serialized.includes('mutationAllowed'), false);
  assert.equal(serialized.includes('applyProfile'), false);
  assert.equal(serialized.includes('publishProfile'), false);
});
