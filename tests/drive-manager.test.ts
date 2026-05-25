import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import {
  buildDriveFolderPlan,
  classifyDriveManagedPath,
  getRequiredDriveFolders,
  normalizeDriveFolderName
} from '../src/driveFolders.ts';
import {
  createDriveBootstrapPlan,
  createFileRoutingPlan,
  parseDriveManagerConfig,
  shouldArchiveOriginal,
  shouldMoveToNeedsReview,
  shouldMoveToProcessed
} from '../src/driveManager.ts';
import type { DriveFileRecord } from '../src/driveTypes.ts';

beforeEach(() => {
  process.env.MERLIN_DRIVE_MODE = '';
  process.env.MERLIN_DRIVE_SYNC_ENABLED = '';
  process.env.MERLIN_DRIVE_ROOT_MODE = '';
  process.env.MERLIN_DRIVE_ROOT_FOLDER_NAME = '';
  process.env.MERLIN_DRIVE_SYNC_MODE = '';
});

test('required folders are generated', () => {
  const required = getRequiredDriveFolders('Merlin OR Storage');
  assert.equal(required.length, 8);
  assert.equal(required[0], 'Merlin OR Storage/00_Inbox');
  assert.equal(required[7], 'Merlin OR Storage/07_System');
});

test('missing folders are detected', () => {
  const plan = buildDriveFolderPlan(['Merlin OR Storage/00_Inbox', 'Merlin OR Storage/02_Needs_Review']);
  assert.equal(plan.missing_paths.includes('Merlin OR Storage/01_Processed'), true);
  assert.equal(plan.missing_paths.includes('Merlin OR Storage/07_System'), true);
});

test('existing folders are reused', () => {
  const plan = createDriveBootstrapPlan([
    'Merlin OR Storage/00_Inbox',
    'Merlin OR Storage/01_Processed',
    'Merlin OR Storage/03_Archived_Sources',
    'Random Folder'
  ]);
  assert.equal(plan.reusable_folders.includes('Merlin OR Storage/00_Inbox'), true);
  assert.equal(plan.reusable_folders.includes('Merlin OR Storage/01_Processed'), true);
  assert.equal(plan.reusable_folders.includes('Merlin OR Storage/03_Archived_Sources'), true);
  assert.equal(plan.missing_folders.includes('Merlin OR Storage/07_System'), true);
});

test('inbox path classifies as inbox', () => {
  assert.equal(classifyDriveManagedPath('/Merlin OR Storage/00_Inbox/new'), 'inbox');
});

test('processed path classifies as processed', () => {
  assert.equal(classifyDriveManagedPath('Merlin OR Storage/01_Processed/reports'), 'processed');
});

test('needs-review path classifies as needs_review', () => {
  assert.equal(classifyDriveManagedPath('Merlin OR Storage/02_Needs_Review/2026'), 'needs_review');
});

test('supported PDF routes to processed after import planning', () => {
  const file: DriveFileRecord = {
    drive_file_id: 'plan-001',
    file_name: 'insurance.pdf',
    mime_type: 'application/pdf',
    folder_id: 'f-001',
    folder_path: 'Merlin OR Storage/01_Processed/contracts',
    web_url: 'https://drive.google.com/file/d/plan-001',
    source_type: 'google_drive_file',
    processing_status: 'processed',
    observed_at: '2026-05-24T14:00:00.000Z',
    entity_id: 'business-001'
  };
  const plan = createFileRoutingPlan(file);
  assert.equal(plan.shouldMoveToProcessed, true);
  assert.equal(plan.shouldCreate4dataEvent, true);
  assert.equal(plan.route, 'processed');
});

test('unsupported file routes to needs_review or skipped', () => {
  const file: DriveFileRecord = {
    drive_file_id: 'plan-002',
    file_name: 'unknown.bin',
    mime_type: 'application/octet-stream',
    folder_id: 'f-002',
    folder_path: 'Merlin OR Storage/01_Processed/contracts',
    web_url: 'https://drive.google.com/file/d/plan-002',
    source_type: 'google_drive_file',
    processing_status: 'processed',
    observed_at: '2026-05-24T14:01:00.000Z',
    entity_id: 'business-001'
  };
  const plan = createFileRoutingPlan(file);
  assert.equal(plan.shouldCreate4dataEvent, false);
  assert.equal(plan.route === 'needs_review' || plan.route === 'skipped', true);
});

test('system folder is reserved', () => {
  const file: DriveFileRecord = {
    drive_file_id: 'plan-003',
    file_name: 'manifest.json',
    mime_type: 'application/json',
    folder_id: 'f-003',
    folder_path: 'Merlin OR Storage/07_System/index',
    web_url: 'https://drive.google.com/file/d/plan-003',
    source_type: 'google_drive_file',
    processing_status: 'unknown',
    observed_at: '2026-05-24T14:02:00.000Z',
    entity_id: 'business-001'
  };
  const plan = createFileRoutingPlan(file);
  assert.equal(plan.route, 'skipped');
  assert.equal(shouldMoveToNeedsReview(file), false);
  assert.equal(shouldMoveToProcessed(file), false);
  assert.equal(shouldArchiveOriginal(file), false);
});

test('parseDriveManagerConfig reads env support', () => {
  const config = parseDriveManagerConfig({
    MERLIN_DRIVE_MODE: 'oauth',
    MERLIN_DRIVE_SYNC_ENABLED: 'true',
    MERLIN_DRIVE_ROOT_MODE: 'dedicated_drive',
    MERLIN_DRIVE_ROOT_FOLDER_NAME: 'Merlin OR Storage',
    MERLIN_DRIVE_SYNC_MODE: 'scheduled'
  });
  assert.equal(config.mode, 'oauth');
  assert.equal(config.syncEnabled, true);
  assert.equal(config.rootMode, 'dedicated_drive');
  assert.equal(config.syncMode, 'scheduled');
});

test('normalizeDriveFolderName handles extra slashes', () => {
  assert.equal(normalizeDriveFolderName(' /drive//Merlin OR Storage/00_Inbox/ '), 'drive/Merlin OR Storage/00_Inbox');
});
