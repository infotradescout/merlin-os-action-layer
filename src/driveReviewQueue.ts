import { runDriveReconciliation, type DriveReconciliationDrift } from './driveSafety.js';

export type DriveReviewQueueItemType =
  | 'missing_folder'
  | 'unexpected_folder'
  | 'permission_drift'
  | 'manifest_mismatch'
  | 'unknown';

export type DriveReviewQueueSeverity = 'info' | 'warning' | 'critical';

export type DriveReviewQueueStatus =
  | 'open'
  | 'acknowledged'
  | 'deferred'
  | 'resolved_externally'
  | 'false_positive';

export type DriveReviewQueueDecision =
  | 'acknowledged'
  | 'needs_manual_review'
  | 'false_positive'
  | 'defer'
  | 'resolved_externally';

export interface DriveReviewQueueDecisionNote {
  decision: DriveReviewQueueDecision;
  note?: string;
  decidedAt: string;
  decidedBy?: string;
}

export interface DriveReviewQueueItem {
  id: string;
  type: DriveReviewQueueItemType;
  severity: DriveReviewQueueSeverity;
  status: DriveReviewQueueStatus;
  title: string;
  summary: string;
  driveFolderId?: string;
  manifestPath?: string;
  observedAt: string;
  source: 'drive_reconciliation';
  readOnly: true;
  recommendedHumanAction: string;
  lastDecision?: DriveReviewQueueDecisionNote;
}

export interface DriveReviewQueueSummary {
  itemCount: number;
  openCount: number;
  acknowledgedCount: number;
  deferredCount: number;
  resolvedExternallyCount: number;
  falsePositiveCount: number;
}

export interface DriveReviewQueueResponse {
  status: 'ok';
  mode: 'read_only';
  mutationAllowed: false;
  checkedAt: string;
  summary: DriveReviewQueueSummary;
  items: DriveReviewQueueItem[];
}

interface DecisionRecord {
  status: DriveReviewQueueStatus;
  lastDecision: DriveReviewQueueDecisionNote;
}

function makeQueueItemId(drift: DriveReconciliationDrift): string {
  const raw = [
    drift.drive_file_id,
    drift.type,
    drift.expected?.folder_path || '',
    drift.actual?.folder_path || ''
  ].join('|');
  return Buffer.from(raw).toString('base64url');
}

function mapDriftToItemType(type: string): DriveReviewQueueItemType {
  if (type === 'missing_drive_file' || type === 'manifest_without_drive_file') {
    return 'missing_folder';
  }
  if (type === 'drive_file_without_manifest' || type === 'unknown_managed_folder') {
    return 'unexpected_folder';
  }
  if (type === 'wrong_folder' || type === 'duplicate_location' || type === 'stale_folder_path') {
    return 'manifest_mismatch';
  }
  return 'unknown';
}

function mapSeverity(type: DriveReconciliationDrift['severity']): DriveReviewQueueSeverity {
  if (type === 'blocking') {
    return 'critical';
  }
  return 'warning';
}

function mapDecisionToStatus(decision: DriveReviewQueueDecision): DriveReviewQueueStatus {
  if (decision === 'acknowledged') return 'acknowledged';
  if (decision === 'defer') return 'deferred';
  if (decision === 'resolved_externally') return 'resolved_externally';
  if (decision === 'false_positive') return 'false_positive';
  return 'open';
}

function recommendedAction(itemType: DriveReviewQueueItemType): string {
  if (itemType === 'missing_folder') {
    return 'Review mismatch and reconcile via manual manifest/file operations in the admin queue.';
  }
  if (itemType === 'unexpected_folder') {
    return 'Validate whether this file should be tracked and mark manually if externally resolved.';
  }
  if (itemType === 'permission_drift') {
    return 'Review permissions with Drive admin before taking any action.';
  }
  if (itemType === 'manifest_mismatch') {
    return 'Review folder mapping and decide whether manual routing is needed.';
  }
  return 'Review mismatch details and decide a human review action.';
}

function makeTitle(itemType: DriveReviewQueueItemType, status: DriveReviewQueueStatus): string {
  return `${itemType.replace(/_/g, ' ')} · ${status}`;
}

function toSummary(items: DriveReviewQueueItem[]): DriveReviewQueueSummary {
  const summary: DriveReviewQueueSummary = {
    itemCount: items.length,
    openCount: 0,
    acknowledgedCount: 0,
    deferredCount: 0,
    resolvedExternallyCount: 0,
    falsePositiveCount: 0
  };

  for (const item of items) {
    if (item.status === 'open') summary.openCount += 1;
    if (item.status === 'acknowledged') summary.acknowledgedCount += 1;
    if (item.status === 'deferred') summary.deferredCount += 1;
    if (item.status === 'resolved_externally') summary.resolvedExternallyCount += 1;
    if (item.status === 'false_positive') summary.falsePositiveCount += 1;
  }

  return summary;
}

const queueDecisionStore = new Map<string, DecisionRecord>();

function buildQueueItem(drift: DriveReconciliationDrift): DriveReviewQueueItem {
  const type = mapDriftToItemType(drift.type);
  const severity = mapSeverity(drift.severity);
  const itemId = makeQueueItemId(drift);
  const status = queueDecisionStore.get(itemId)?.status || 'open';
  const decision = queueDecisionStore.get(itemId);

  return {
    id: itemId,
    type,
    severity,
    status,
    title: makeTitle(type, status),
    summary: drift.message,
    manifestPath: drift.expected?.folder_path,
    observedAt: drift.detectedAt,
    source: 'drive_reconciliation',
    readOnly: true,
    recommendedHumanAction: recommendedAction(type),
    lastDecision: decision?.lastDecision
  };
}

export async function runDriveReviewQueue(): Promise<DriveReviewQueueResponse> {
  const reconciliation = await runDriveReconciliation();
  const items = reconciliation.drift.map(buildQueueItem);
  return {
    status: 'ok',
    mode: 'read_only',
    mutationAllowed: false,
    checkedAt: reconciliation.checkedAt,
    summary: toSummary(items),
    items
  };
}

export async function getDriveReviewQueueItem(itemId: string): Promise<DriveReviewQueueItem | undefined> {
  const queue = await runDriveReviewQueue();
  return queue.items.find((item) => item.id === itemId);
}

export async function decideDriveReviewQueueItem(
  itemId: string,
  decision: DriveReviewQueueDecision,
  note?: string,
  decidedBy?: string
): Promise<DriveReviewQueueItem | undefined> {
  const existing = await getDriveReviewQueueItem(itemId);
  if (!existing) {
    return undefined;
  }

  const updatedStatus = mapDecisionToStatus(decision);
  const lastDecision: DriveReviewQueueDecisionNote = {
    decision,
    note,
    decidedAt: new Date().toISOString(),
    decidedBy
  };

  queueDecisionStore.set(itemId, {
    status: updatedStatus,
    lastDecision
  });

  return {
    ...existing,
    status: updatedStatus,
    lastDecision
  };
}

export function getDriveReviewQueueDecision(itemId: string): DriveReviewQueueDecisionNote | undefined {
  return queueDecisionStore.get(itemId)?.lastDecision;
}

export function resetDriveReviewQueueForTest(): void {
  queueDecisionStore.clear();
}
