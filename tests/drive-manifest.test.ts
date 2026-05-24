import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDriveFileRecord } from '../src/driveIngest.ts';
import {
  createManifestEntry,
  getManifestEntriesByStatus,
  getManifestEntryByDriveFileId,
  getRecentManifestEntries,
  markManifestFailed,
  markManifestNeedsReview,
  markManifestProcessed,
  markManifestSkipped,
  resetDriveManifestForTest
} from '../src/driveManifest.ts';

const baseRecord = createDriveFileRecord({
  drive_file_id: 'manifest-file-001',
  file_name: 'quote.pdf',
  mime_type: 'application/pdf',
  folder_id: 'folder-001',
  folder_path: 'Merlin OR Storage/00_Inbox',
  web_url: 'https://drive.google.com/file/d/manifest-file-001'
});

function reset(): void {
  resetDriveManifestForTest();
}

test('create seen/pending manifest entry', () => {
  reset();
  const entry = createManifestEntry(baseRecord);
  assert.equal(entry.processing_status, 'pending');
  assert.equal(entry.drive_file_id, 'manifest-file-001');
  assert.ok(entry.seen_at.length > 0);
});

test('processed update', () => {
  reset();
  const entry = createManifestEntry(baseRecord);
  const updated = markManifestProcessed(entry.id, {
    source_record_id: 'source-123',
    created_4data_event_id: 'event-456',
    notes: 'mapped to 4data'
  });

  assert.equal(updated.processing_status, 'processed');
  assert.equal(updated.source_record_id, 'source-123');
  assert.equal(updated.created_4data_event_id, 'event-456');
  assert.equal(updated.notes, 'mapped to 4data');
});

test('needs_review update', () => {
  reset();
  const entry = createManifestEntry(baseRecord);
  const updated = markManifestNeedsReview(entry.id, 'insufficient context');
  assert.equal(updated.processing_status, 'needs_review');
  assert.equal(updated.review_reason, 'insufficient context');
});

test('skipped update', () => {
  reset();
  const entry = createManifestEntry(baseRecord);
  const updated = markManifestSkipped(entry.id, 'unsupported file format');
  assert.equal(updated.processing_status, 'skipped');
  assert.equal(updated.review_reason, 'unsupported file format');
});

test('failed update', () => {
  reset();
  const entry = createManifestEntry(baseRecord);
  const updated = markManifestFailed(entry.id, 'parse error');
  assert.equal(updated.processing_status, 'failed');
  assert.equal(updated.review_reason, 'parse error');
});

test('lookup by drive_file_id', () => {
  reset();
  const entry = createManifestEntry({
    ...baseRecord,
    drive_file_id: 'manifest-file-lookup'
  });
  const lookup = getManifestEntryByDriveFileId('manifest-file-lookup');
  assert.equal(lookup?.id, entry.id);
});

test('query by status', () => {
  reset();
  const pendingEntry = createManifestEntry({
    ...baseRecord,
    folder_path: 'Merlin OR Storage/00_Inbox'
  });
  const alreadyProcessedEntry = createManifestEntry({
    ...baseRecord,
    drive_file_id: 'manifest-file-002',
    folder_path: 'Merlin OR Storage/01_Processed'
  });
  const reviewEntry = createManifestEntry({
    ...baseRecord,
    drive_file_id: 'manifest-file-003/needs-review',
    folder_path: 'Merlin OR Storage/02_Needs_Review'
  });
  markManifestProcessed(pendingEntry.id);
  markManifestSkipped(alreadyProcessedEntry.id, 'duplicate');
  markManifestNeedsReview(reviewEntry.id, 'ambiguous entity');

  assert.equal(getManifestEntriesByStatus('processed').length, 1);
  assert.equal(getManifestEntriesByStatus('skipped').length, 1);
  assert.equal(getManifestEntriesByStatus('needs_review').length, 1);
  assert.equal(getManifestEntriesByStatus('pending').length, 0);
});

test('recent ordering', () => {
  reset();
  const first = createManifestEntry({
    ...baseRecord,
    drive_file_id: 'manifest-file-a',
    folder_path: 'Merlin OR Storage/00_Inbox'
  });
  const second = createManifestEntry({
    ...baseRecord,
    drive_file_id: 'manifest-file-b',
    folder_path: 'Merlin OR Storage/00_Inbox'
  });
  markManifestProcessed(second.id);
  const recent = getRecentManifestEntries(2);
  assert.equal(recent.length >= 2, true);
  assert.equal(recent[0].id === second.id, true);
  assert.equal(recent[1].id === first.id, true);
});
