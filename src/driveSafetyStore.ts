import { recordReplayEvent } from './replay.js';

const DRIVE_DRIFT_REPLAY_TTL_MS = 60_000;
const MAX_DRIFT_REPLAY_EVENTS = 500;

interface DriftReplayCacheEntry {
  expiresAt: number;
}

const driveDriftReplayKeys = new Map<string, DriftReplayCacheEntry>();

function normalizeFolderPath(value: string): string {
  return value.toLowerCase().trim();
}

function makeReplayCacheKey(
  driveFileId: string,
  driftType: string,
  expectedFolderPath: string,
  actualFolderPath: string,
  mode: string
): string {
  return [
    driveFileId,
    driftType,
    normalizeFolderPath(expectedFolderPath),
    normalizeFolderPath(actualFolderPath),
    mode
  ].join('|');
}

function pruneExpiredEntries(now: number): void {
  for (const [key, value] of driveDriftReplayKeys) {
    if (value.expiresAt <= now) {
      driveDriftReplayKeys.delete(key);
    }
  }
}

function pruneOldestIfNeeded(): void {
  if (driveDriftReplayKeys.size <= MAX_DRIFT_REPLAY_EVENTS) {
    return;
  }

  const toDelete = driveDriftReplayKeys.size - MAX_DRIFT_REPLAY_EVENTS;
  const sortedKeys = Array.from(driveDriftReplayKeys.entries()).sort((a, b) => a[1].expiresAt - b[1].expiresAt);

  for (let i = 0; i < toDelete; i += 1) {
    driveDriftReplayKeys.delete(sortedKeys[i][0]);
  }
}

function shouldEmitDriveDriftDetected(now: number, key: string): boolean {
  const existing = driveDriftReplayKeys.get(key);
  if (existing && existing.expiresAt > now) {
    return false;
  }

  driveDriftReplayKeys.set(key, { expiresAt: now + DRIVE_DRIFT_REPLAY_TTL_MS });
  pruneExpiredEntries(now);
  pruneOldestIfNeeded();
  return true;
}

interface DriftEventData {
  drive_file_id: string;
  type: string;
  mode: string;
  expectedFolderPath: string;
  actualFolderPath: string;
  message: string;
}

export function emitDriveDriftDetectedReplayEvent(input: DriftEventData): boolean {
  const now = Date.now();
  const key = makeReplayCacheKey(
    input.drive_file_id,
    input.type,
    input.expectedFolderPath,
    input.actualFolderPath,
    input.mode
  );
  if (!shouldEmitDriveDriftDetected(now, key)) {
    return false;
  }

  recordReplayEvent({
    event_type: 'drive_drift_detected' as Parameters<typeof recordReplayEvent>[0]['event_type'],
    summary: `Drive drift detected for ${input.drive_file_id}`,
    source_refs: [`drive:${input.drive_file_id}`],
    payload: {
      drive_file_id: input.drive_file_id,
      drift_type: input.type,
      mode: input.mode,
      expected: {
        folder_path: input.expectedFolderPath
      },
      actual: {
        folder_path: input.actualFolderPath
      },
      message: input.message
    }
  });

  return true;
}

export function resetDriveSafetyStoreForTest(): void {
  driveDriftReplayKeys.clear();
}
