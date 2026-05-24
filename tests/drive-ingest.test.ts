import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyDriveFolderPath, createDriveFileRecord, mapDriveFileToSourceRecord, shouldCreate4dataEvent } from '../src/driveIngest.ts';

const baseInput = {
  drive_file_id: 'file-001',
  file_name: 'contract.pdf',
  mime_type: 'application/pdf',
  folder_id: 'folder-001',
  folder_path: '/drive/Merlin OR Storage/00_Inbox',
  web_url: 'https://drive.google.com/file/d/file-001'
};

test('inbox file becomes pending record', () => {
  const record = createDriveFileRecord({
    ...baseInput
  });
  assert.equal(record.processing_status, 'pending');
});

test('processed file maps to processed status', () => {
  const record = createDriveFileRecord({
    ...baseInput,
    file_name: 'invoice.pdf',
    folder_path: '/drive/Merlin OR Storage/01_Processed/reports'
  });
  assert.equal(record.processing_status, 'processed');
});

test('needs-review folder maps to needs_review', () => {
  const record = createDriveFileRecord({
    ...baseInput,
    file_name: 'unknown.heic',
    mime_type: 'image/heic',
    folder_path: 'Merlin OR Storage/02_Needs_Review/unknown'
  });
  assert.equal(record.processing_status, 'needs_review');
});

test('source metadata preserves file id/url/mime type', () => {
  const record = createDriveFileRecord({
    ...baseInput,
    file_name: 'receipt.png',
    mime_type: 'image/png',
    folder_path: '/drive/Merlin OR Storage/01_Processed',
  });
  const sourceMetadata = mapDriveFileToSourceRecord(record);
  assert.equal(sourceMetadata.drive_file_id, 'file-001');
  assert.equal(sourceMetadata.web_url, 'https://drive.google.com/file/d/file-001');
  assert.equal(sourceMetadata.mime_type, 'image/png');
});

test('4data event creation only for useful supported files', () => {
  const supportedProcessed = createDriveFileRecord({
    ...baseInput,
    file_name: 'proposal.docx',
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    folder_path: '/drive/Merlin OR Storage/01_Processed/contracts',
    confidence: 0.91
  });
  assert.equal(shouldCreate4dataEvent(supportedProcessed), true);

  const unsupportedType = createDriveFileRecord({
    ...baseInput,
    drive_file_id: 'file-002',
    file_name: 'bad.exe',
    mime_type: 'application/x-msdownload',
    folder_path: '/drive/Merlin OR Storage/01_Processed',
  });
  assert.equal(shouldCreate4dataEvent(unsupportedType), false);

  const inboxSupported = createDriveFileRecord({
    ...baseInput,
    drive_file_id: 'file-003',
    folder_path: '/drive/Merlin OR Storage/00_Inbox',
  });
  assert.equal(shouldCreate4dataEvent(inboxSupported), false);

  const needsReviewSupported = createDriveFileRecord({
    ...baseInput,
    drive_file_id: 'file-004',
    file_name: 'contract.pdf',
    folder_path: 'Merlin OR Storage/02_Needs_Review',
  });
  assert.equal(classifyDriveFolderPath(needsReviewSupported.folder_path), 'needs_review');
  assert.equal(shouldCreate4dataEvent(needsReviewSupported), false);
});
