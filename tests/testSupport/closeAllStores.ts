import { closeApprovalQueueStore } from '../../src/approvalQueue.js';
import { closeDriveBufferLifecycleStore } from '../../src/driveBufferLifecycle.js';
import { closeDriveManifestStore } from '../../src/driveManifest.js';
import { closeDriveReviewQueueStore } from '../../src/driveReviewQueueStore.js';
import { closeLisaStore } from '../../src/lisa.js';
import { closeMealScoutIncrementalIntakeRuntime } from '../../src/mealscoutIncrementalIntakeRuntime.js';
import { closeMealScoutProfilesStore } from '../../src/mealscoutProfilesStore.js';
import { closeMerlinActionCardRuntime } from '../../src/merlin/actionCardRuntime.js';
import { closeMerlinApprovalRuntime } from '../../src/merlin/approvalRuntime.js';
import { closeMerlinConnectedSourceRuntime } from '../../src/merlin/connectedSourceRuntime.js';
import { closeMerlinConnectorAdapterRuntime } from '../../src/merlin/connectorAdapterRuntime.js';
import { closeMerlinDryRunExecutorRuntime } from '../../src/merlin/dryRunExecutorRuntime.js';
import { closeMerlinEntityMemoryRuntime } from '../../src/merlin/entityMemoryRuntime.js';
import { closeMerlinExecutionPlanRuntime } from '../../src/merlin/executionPlanRuntime.js';
import { closeActionCardQueueStore } from '../../src/merlin/intake/actionCardQueue.js';
import { closeMerlinIntakeRuntime } from '../../src/merlin/intakeRuntime.js';
import { closeMerlinLiveExecutionGateRuntime } from '../../src/merlin/liveExecutionGateRuntime.js';
import { closeMerlinOutcomeRuntime } from '../../src/merlin/outcomeRuntime.js';
import { closeMerlinThreadRuntime } from '../../src/merlin/threadRuntime.js';
import { closeTradeScoutProfilesStore } from '../../src/merlin/tradescoutProfilesStore.js';
import { closeMerlinWorkspaceRuntime } from '../../src/merlin/workspaceRuntime.js';
import { closeOutcomesStore } from '../../src/outcomes.js';
import { closeRecommendationsStore } from '../../src/recommendations.js';
import { closeReplayStore } from '../../src/replay.js';
import { closeRoundTableDiscordStore } from '../../src/roundtableDiscord.js';

/**
 * Every module below opens its own better-sqlite3 connection against
 * MERLIN_DB_PATH. Tests that spin up createMerlinServer() must close all
 * of them in `after()`, or the sqlite file handle outlives the test and
 * Windows throws EPERM when the temp directory is removed.
 */
export function closeAllMerlinStoresForTest(): void {
  closeApprovalQueueStore();
  closeDriveBufferLifecycleStore();
  closeDriveManifestStore();
  closeDriveReviewQueueStore();
  closeLisaStore();
  closeMealScoutIncrementalIntakeRuntime();
  closeMealScoutProfilesStore();
  closeMerlinActionCardRuntime();
  closeMerlinApprovalRuntime();
  closeMerlinConnectedSourceRuntime();
  closeMerlinConnectorAdapterRuntime();
  closeMerlinDryRunExecutorRuntime();
  closeMerlinEntityMemoryRuntime();
  closeMerlinExecutionPlanRuntime();
  closeActionCardQueueStore();
  closeMerlinIntakeRuntime();
  closeMerlinLiveExecutionGateRuntime();
  closeMerlinOutcomeRuntime();
  closeMerlinThreadRuntime();
  closeTradeScoutProfilesStore();
  closeMerlinWorkspaceRuntime();
  closeOutcomesStore();
  closeRecommendationsStore();
  closeReplayStore();
  closeRoundTableDiscordStore();
}
