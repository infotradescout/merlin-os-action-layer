import { discoverManagedFolders, syncDriveInbox, type DriveSyncSummary } from './driveSync.js';

export interface DriveSchedulerConfig {
  enabled: boolean;
  intervalMinutes: number;
}

export interface DriveScheduledSyncResult {
  status: 'ok' | 'disabled' | 'error' | 'blocked';
  reason?: string;
  summary?: DriveSyncSummary;
}

export interface DriveSchedulerStatus {
  scheduler_enabled: boolean;
  scheduler_interval_minutes: number;
  last_scheduled_sync_at?: string;
  last_scheduled_sync_result?: DriveScheduledSyncResult;
}

interface RunScheduledDriveSyncOptions {
  discoverFn?: typeof discoverManagedFolders;
  syncFn?: typeof syncDriveInbox;
  now?: Date;
}

const DEFAULT_INTERVAL_MINUTES = 15;

let schedulerTimer: NodeJS.Timeout | undefined;
let lastScheduledSyncAt: string | undefined;
let lastScheduledSyncResult: DriveScheduledSyncResult | undefined;

function parseIntervalMinutes(rawValue: string | undefined): number {
  const parsed = Number.parseInt(rawValue || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_INTERVAL_MINUTES;
  }
  return parsed;
}

export function getDriveSchedulerConfig(
  env: Record<string, string | undefined> = process.env
): DriveSchedulerConfig {
  const syncEnabled = (env.MERLIN_DRIVE_SYNC_ENABLED || '').toLowerCase() === 'true';
  const syncMode = (env.MERLIN_DRIVE_SYNC_MODE || 'manual').toLowerCase();
  const intervalMinutes = parseIntervalMinutes(env.MERLIN_DRIVE_SYNC_INTERVAL_MINUTES);
  return {
    enabled: syncEnabled && syncMode === 'scheduled',
    intervalMinutes
  };
}

export async function runScheduledDriveSync(
  options: RunScheduledDriveSyncOptions = {}
): Promise<DriveScheduledSyncResult> {
  const discoverFn = options.discoverFn || discoverManagedFolders;
  const syncFn = options.syncFn || syncDriveInbox;
  const nowIso = (options.now || new Date()).toISOString();
  const config = getDriveSchedulerConfig();
  if (!config.enabled) {
    const disabledResult: DriveScheduledSyncResult = {
      status: 'disabled',
      reason: 'Scheduled Drive sync is disabled'
    };
    lastScheduledSyncAt = nowIso;
    lastScheduledSyncResult = disabledResult;
    return disabledResult;
  }

  const discovery = await discoverFn();
  if (discovery.status !== 'ready' || discovery.sync_blocked) {
    const blockedResult: DriveScheduledSyncResult = {
      status: 'blocked',
      reason: discovery.sync_block_reason || discovery.reason || 'Drive sync is blocked'
    };
    lastScheduledSyncAt = nowIso;
    lastScheduledSyncResult = blockedResult;
    return blockedResult;
  }

  const summary = await syncFn();
  const status: DriveScheduledSyncResult['status'] = summary.status === 'ok' ? 'ok' : summary.status;
  const result: DriveScheduledSyncResult = {
    status,
    reason: summary.reason,
    summary
  };
  lastScheduledSyncAt = nowIso;
  lastScheduledSyncResult = result;
  return result;
}

export function startDriveScheduler(): void {
  stopDriveScheduler();
  const config = getDriveSchedulerConfig();
  if (!config.enabled) {
    return;
  }

  const intervalMs = config.intervalMinutes * 60 * 1000;
  schedulerTimer = setInterval(() => {
    void runScheduledDriveSync();
  }, intervalMs);
}

export function stopDriveScheduler(): void {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = undefined;
  }
}

export function getDriveSchedulerStatus(): DriveSchedulerStatus {
  const config = getDriveSchedulerConfig();
  return {
    scheduler_enabled: config.enabled,
    scheduler_interval_minutes: config.intervalMinutes,
    last_scheduled_sync_at: lastScheduledSyncAt,
    last_scheduled_sync_result: lastScheduledSyncResult
  };
}

export function resetDriveSchedulerForTest(): void {
  stopDriveScheduler();
  lastScheduledSyncAt = undefined;
  lastScheduledSyncResult = undefined;
}
