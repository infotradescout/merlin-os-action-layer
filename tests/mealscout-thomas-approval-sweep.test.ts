import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { buildThomasCleanCandidateApprovalSweep } from '../src/mealscoutThomasApprovalSweep.ts';
import type { ThomasReviewQueue } from '../src/mealscoutThomasReviewQueue.ts';

function readReviewQueue(): ThomasReviewQueue {
  return JSON.parse(readFileSync('artifacts/mealscout-draft-profile-packets/thomas-review-queue.json', 'utf8')) as ThomasReviewQueue;
}

test('Thomas approval sweep includes exactly the 65 clean candidates', () => {
  const reviewQueue = readReviewQueue();
  const sweep = buildThomasCleanCandidateApprovalSweep({ reviewQueue, generatedAt: '2026-06-14T00:00:00.000Z' });

  assert.equal(sweep.summary.cleanCandidatesIncluded, 65);
  assert.equal(sweep.candidates.length, 65);
  assert.deepEqual(
    sweep.candidates.map((candidate) => candidate.candidateNumber),
    Array.from({ length: 65 }, (_value, index) => index + 1)
  );
});

test('Thomas approval sweep excludes blocked, owner-confirmation, unknown-held, and non-food records', () => {
  const reviewQueue = readReviewQueue();
  const sweep = buildThomasCleanCandidateApprovalSweep({ reviewQueue, generatedAt: '2026-06-14T00:00:00.000Z' });
  const sweptIds = new Set(sweep.candidates.map((candidate) => candidate.draftPacketId));

  assert.equal(sweep.summary.excludedBlockedConflicts, 7);
  assert.equal(sweep.summary.excludedOwnerConfirmationRecords, 28);
  assert.equal(sweep.summary.excludedUnknownHeld, 224);
  assert.equal(sweep.summary.excludedNonFoodQuarantine, 181);
  assert.equal(reviewQueue.buckets.blocked_by_conflict.every((item) => !sweptIds.has(item.draftPacketId)), true);
  assert.equal(reviewQueue.buckets.owner_confirmation_required.every((item) => !sweptIds.has(item.draftPacketId)), true);
  assert.equal(JSON.stringify(sweep).includes('unknown_held'), false);
  assert.equal(JSON.stringify(sweep).includes('non_food_quarantine'), false);
});

test('Thomas approval sweep items carry source evidence and extracted visible facts', () => {
  const reviewQueue = readReviewQueue();
  const sweep = buildThomasCleanCandidateApprovalSweep({ reviewQueue, generatedAt: '2026-06-14T00:00:00.000Z' });

  assert.equal(
    sweep.candidates.every((candidate) => candidate.sourceScreenshots.length > 0),
    true
  );
  assert.equal(
    sweep.candidates.every((candidate) => candidate.extractedVisibleFacts.businessName || candidate.businessName),
    true
  );
  assert.equal(
    sweep.candidates.every((candidate) => ['approve_draft', 'hold_for_more_evidence'].includes(candidate.recommendedDecision)),
    true
  );
  assert.equal(
    sweep.candidates.every((candidate) => candidate.draftOnlyWarning.includes('draft plan only')),
    true
  );
});

test('Thomas approval sweep does not introduce production or apply flags', () => {
  const reviewQueue = readReviewQueue();
  const sweep = buildThomasCleanCandidateApprovalSweep({ reviewQueue, generatedAt: '2026-06-14T00:00:00.000Z' });
  const serialized = JSON.stringify(sweep);

  assert.equal(sweep.liveMealScoutMutation, false);
  assert.equal(serialized.includes('productionApplied'), false);
  assert.equal(serialized.includes('mutationAllowed'), false);
  assert.equal(serialized.includes('applyProfile'), false);
  assert.equal(serialized.includes('publishProfile'), false);
  assert.equal(serialized.includes('liveApply'), false);
});
