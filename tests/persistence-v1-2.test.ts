import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-v1-2-'));
const tempDbPath = resolve(tempDir, 'merlin-or.sqlite');

const {
  initializeLisaStore,
  closeLisaStore,
  resetLisaStore,
  ingestTradeScoutEvent,
  getEntityState,
  getEntityTimeline,
  getRecentChanges
} = await import('../src/lisa.ts');
const {
  initializeRecommendationsStore,
  closeRecommendationsStore,
  resetRecommendationsForTest,
  createRecommendation,
  getRecommendationById
} = await import('../src/recommendations.ts');
const {
  initializeApprovalQueueStore,
  closeApprovalQueueStore,
  resetApprovalQueueForTest,
  createApprovalFromRecommendation,
  getApprovalById
} = await import('../src/approvalQueue.ts');
const {
  initializeOutcomesStore,
  closeOutcomesStore,
  resetOutcomesForTest,
  createRecommendation: createOutcomeRecommendation,
  recordOutcome,
  getOutcomeById
} = await import('../src/outcomes.ts');
const {
  initializeReplayStore,
  closeReplayStore,
  resetReplayForTest,
  recordReplayEvent,
  getReplayEventById
} = await import('../src/replay.ts');
const {
  createManifestEntry,
  initializeDriveManifestStore,
  closeDriveManifestStore,
  getManifestEntryByDriveFileId,
  getManifestEntriesByStatus,
  resetDriveManifestForTest
} = await import('../src/driveManifest.ts');

function initializeStores() {
  initializeLisaStore(tempDbPath);
  initializeRecommendationsStore(tempDbPath);
  initializeApprovalQueueStore(tempDbPath);
  initializeOutcomesStore(tempDbPath);
  initializeReplayStore(tempDbPath);
  initializeDriveManifestStore(tempDbPath);
}

function closeStores() {
  closeDriveManifestStore();
  closeReplayStore();
  closeOutcomesStore();
  closeApprovalQueueStore();
  closeRecommendationsStore();
  closeLisaStore();
}

function resetStores() {
  resetRecommendationsForTest();
  resetApprovalQueueForTest();
  resetOutcomesForTest();
  resetReplayForTest();
  resetDriveManifestForTest();
  resetLisaStore();
}

before(() => {
  initializeStores();
});

beforeEach(() => {
  resetStores();
});

after(() => {
  closeStores();
  rmSync(tempDir, { recursive: true, force: true });
});

test('events, entity state, and timeline survive sqlite re-instantiation', () => {
  const entityId = 'business-lisapersist-001';
  const signalId = ingestTradeScoutEvent({
    entity_id: entityId,
    event_type: 'contractor_claim',
    title: 'First signal'
  });

  const firstState = getEntityState(entityId);
  const firstTimeline = getEntityTimeline(entityId);
  const firstChanges = getRecentChanges(10).changes;

  assert.equal(firstState?.entity_id, entityId);
  assert.equal(firstState?.last_signal_id, signalId);
  assert.equal(firstTimeline.length, 1);
  assert.equal(firstTimeline[0].id, signalId);
  assert.equal(firstChanges.length >= 1, true);

  closeLisaStore();
  initializeLisaStore(tempDbPath);

  const secondState = getEntityState(entityId);
  const secondTimeline = getEntityTimeline(entityId);
  const secondChanges = getRecentChanges(10).changes;
  assert.equal(secondState?.entity_id, entityId);
  assert.equal(secondTimeline.length, 1);
  assert.equal(secondTimeline[0].id, signalId);
  assert.equal(secondChanges.length >= 1, true);
});

test('recommendations survive sqlite re-instantiation', () => {
  const recommendation = createRecommendation({
    entity_id: 'business-rec-001',
    title: 'Review business',
    summary: 'Needs attention',
    action_type: 'draft_message',
    brand_lane: 'tradescout'
  });

  const firstRec = getRecommendationById(recommendation.id);
  assert.equal(firstRec?.id, recommendation.id);
  assert.equal(firstRec?.status, 'suggested');

  closeRecommendationsStore();
  initializeRecommendationsStore(tempDbPath);
  const secondRec = getRecommendationById(recommendation.id);
  assert.equal(secondRec?.id, recommendation.id);
  assert.equal(secondRec?.status, recommendation.status);
  assert.equal(secondRec?.policy_result.level, recommendation.policy_result.level);
});

test('approvals survive sqlite re-instantiation', () => {
  const recommendation = createRecommendation({
    entity_id: 'business-approval-001',
    title: 'Approve identity',
    summary: 'Needs approval',
    action_type: 'approve_verification',
    brand_lane: 'tradescout'
  });
  const approval = createApprovalFromRecommendation(recommendation.id);
  assert.ok(approval);

  const firstApproval = getApprovalById(approval!.id);
  assert.equal(firstApproval?.id, approval!.id);
  assert.equal(firstApproval?.status, 'pending');

  closeApprovalQueueStore();
  initializeApprovalQueueStore(tempDbPath);
  const secondApproval = getApprovalById(approval!.id);
  assert.equal(secondApproval?.id, approval?.id);
  assert.equal(secondApproval?.status, 'pending');
});

test('outcomes survive sqlite re-instantiation', () => {
  const recommendation = createOutcomeRecommendation({
    entity_id: 'business-outcome-001',
    recommendation: 'Get docs',
    action: 'document_reviewed'
  });
  const outcome = recordOutcome({
    recommendation_id: recommendation.id,
    action: 'document_reviewed',
    outcome: 'manual_done',
    status: 'completed'
  });

  const firstOutcome = getOutcomeById(outcome.id);
  assert.equal(firstOutcome?.id, outcome.id);
  assert.equal(firstOutcome?.status, 'completed');

  closeOutcomesStore();
  initializeOutcomesStore(tempDbPath);
  const secondOutcome = getOutcomeById(outcome.id);
  assert.equal(secondOutcome?.id, outcome.id);
  assert.equal(secondOutcome?.status, 'completed');
});

test('replay events survive sqlite re-instantiation', () => {
  const replay = recordReplayEvent({
    event_type: 'event_ingested',
    entity_id: 'business-replay-001',
    summary: 'Replay persisted event',
    source_refs: ['lisa:test']
  });

  const firstReplay = getReplayEventById(replay.id);
  assert.equal(firstReplay?.id, replay.id);
  assert.equal(firstReplay?.event_type, 'event_ingested');

  closeReplayStore();
  initializeReplayStore(tempDbPath);
  const secondReplay = getReplayEventById(replay.id);
  assert.equal(secondReplay?.id, replay.id);
  assert.equal(secondReplay?.summary, 'Replay persisted event');
});

test('drive manifest entries survive sqlite re-instantiation', () => {
  const entry = createManifestEntry({
    drive_file_id: 'file-persist-001',
    file_name: 'contract.pdf',
    mime_type: 'application/pdf',
    folder_id: 'folder-001',
    folder_path: '/drive/Merlin OR Storage/00_Inbox',
    web_url: 'https://drive.google.com/file/d/file-persist-001',
    processing_status: 'pending',
    observed_at: '2026-05-23T10:00:00.000Z'
  });

  const firstEntry = getManifestEntryByDriveFileId(entry.drive_file_id);
  assert.equal(firstEntry?.id, entry.id);
  assert.equal(firstEntry?.processing_status, 'pending');

  closeDriveManifestStore();
  initializeDriveManifestStore(tempDbPath);
  const pendingEntries = getManifestEntriesByStatus('pending');
  const persisted = getManifestEntryByDriveFileId(entry.drive_file_id);
  assert.equal(persisted?.id, entry.id);
  assert.equal(pendingEntries.length >= 1, true);
  assert.equal(pendingEntries.some((item) => item.id === entry.id), true);
});
