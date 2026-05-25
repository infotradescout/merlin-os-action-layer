import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';

const schedulerModule = await import('../src/driveScheduler.ts');

const {
  getDriveSchedulerConfig,
  getDriveSchedulerStatus,
  resetDriveSchedulerForTest,
  runScheduledDriveSync
} = schedulerModule;


beforeEach(() => {
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'false';
  process.env.MERLIN_DRIVE_SYNC_MODE = 'manual';
  process.env.MERLIN_DRIVE_SYNC_INTERVAL_MINUTES = '15';
  resetDriveSchedulerForTest();
});

test('scheduler disabled by default', () => {
  const config = getDriveSchedulerConfig();
  assert.equal(config.enabled, false);
  assert.equal(config.intervalMinutes, 15);
});

test('scheduler enabled only in scheduled mode with sync enabled', () => {
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
  process.env.MERLIN_DRIVE_SYNC_MODE = 'scheduled';
  process.env.MERLIN_DRIVE_SYNC_INTERVAL_MINUTES = '7';

  const config = getDriveSchedulerConfig();
  assert.equal(config.enabled, true);
  assert.equal(config.intervalMinutes, 7);
});

test('scheduler refuses to run when sync is blocked', async () => {
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
  process.env.MERLIN_DRIVE_SYNC_MODE = 'scheduled';
  const discoverBlocked = async () =>
    ({
      status: 'error',
      reason: 'folder_conflict',
      mode: 'oauth',
      syncMode: 'scheduled',
      rootMode: 'dedicated_drive',
      root_folder_name: 'Merlin OR Storage',
      folder_paths: [],
      managed_folders: {
        '00_Inbox': { id: '', path: '00_Inbox' },
        '01_Processed': { id: '', path: '01_Processed' },
        '02_Needs_Review': { id: '', path: '02_Needs_Review' },
        '03_Archived_Sources': { id: '', path: '03_Archived_Sources' },
        '04_Entity_Files': { id: '', path: '04_Entity_Files' },
        '05_Exports': { id: '', path: '05_Exports' },
        '06_Audit': { id: '', path: '06_Audit' },
        '07_System': { id: '', path: '07_System' }
      },
      canonical_folder_ids: {
        '00_Inbox': '',
        '01_Processed': '',
        '02_Needs_Review': '',
        '03_Archived_Sources': '',
        '04_Entity_Files': '',
        '05_Exports': '',
        '06_Audit': '',
        '07_System': ''
      },
      duplicate_managed_folders: {},
      sync_blocked: true,
      sync_block_reason: 'folder_conflict',
      bootstrap_enabled: false,
      create_missing_folders: false,
      folder_create_allowed: false,
      bootstrap_plan: {
        root_folder_name: 'Merlin OR Storage',
        required_folders: [],
        reusable_folders: [],
        missing_folders: []
      }
    }) as never;

  const result = await runScheduledDriveSync({ discoverFn: discoverBlocked });
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'folder_conflict');
});

test('scheduler calls manual sync path when enabled', async () => {
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
  process.env.MERLIN_DRIVE_SYNC_MODE = 'scheduled';
  let called = false;

  const discoverReady = async () =>
    ({
      status: 'ready',
      mode: 'oauth',
      syncMode: 'scheduled',
      rootMode: 'dedicated_drive',
      root_folder_name: 'Merlin OR Storage',
      folder_paths: ['00_Inbox'],
      managed_folders: {
        '00_Inbox': { id: 'inbox', path: '00_Inbox' },
        '01_Processed': { id: 'processed', path: '01_Processed' },
        '02_Needs_Review': { id: 'needs', path: '02_Needs_Review' },
        '03_Archived_Sources': { id: 'archived', path: '03_Archived_Sources' },
        '04_Entity_Files': { id: 'entity', path: '04_Entity_Files' },
        '05_Exports': { id: 'exports', path: '05_Exports' },
        '06_Audit': { id: 'audit', path: '06_Audit' },
        '07_System': { id: 'system', path: '07_System' }
      },
      canonical_folder_ids: {
        '00_Inbox': 'inbox',
        '01_Processed': 'processed',
        '02_Needs_Review': 'needs',
        '03_Archived_Sources': 'archived',
        '04_Entity_Files': 'entity',
        '05_Exports': 'exports',
        '06_Audit': 'audit',
        '07_System': 'system'
      },
      duplicate_managed_folders: {},
      sync_blocked: false,
      bootstrap_enabled: false,
      create_missing_folders: false,
      folder_create_allowed: false,
      bootstrap_plan: {
        root_folder_name: 'Merlin OR Storage',
        required_folders: [],
        reusable_folders: [],
        missing_folders: []
      }
    }) as never;

  const syncOk = async () => {
    called = true;
    return {
      status: 'ok',
      processed: 1,
      needs_review: 0,
      skipped: 0,
      failed: 0,
      manifest_updates: 1,
      replay_events: 1
    };
  };

  const result = await runScheduledDriveSync({ discoverFn: discoverReady, syncFn: syncOk });
  assert.equal(called, true);
  assert.equal(result.status, 'ok');
  assert.equal(result.summary?.processed, 1);
});

test('status reports last scheduled sync result', async () => {
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'false';
  process.env.MERLIN_DRIVE_SYNC_MODE = 'manual';

  await runScheduledDriveSync();
  const status = getDriveSchedulerStatus();
  assert.equal(status.scheduler_enabled, false);
  assert.equal(status.scheduler_interval_minutes, 15);
  assert.equal(status.last_scheduled_sync_result?.status, 'disabled');
  assert.equal(Boolean(status.last_scheduled_sync_at), true);
});
