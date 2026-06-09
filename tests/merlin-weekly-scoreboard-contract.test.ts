import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');
const { closeMerlinActionCardRuntime, resetMerlinActionCardRuntimeForTest } = await import('../src/merlin/actionCardRuntime.ts');
const { closeMerlinApprovalRuntime, resetMerlinApprovalRuntimeForTest } = await import('../src/merlin/approvalRuntime.ts');
const { closeMerlinOutcomeRuntime, resetMerlinOutcomeRuntimeForTest } = await import('../src/merlin/outcomeRuntime.ts');
const {
  MERLIN_WEEKLY_SCOREBOARD_KPI_IDS,
  getMerlinWeeklyScoreboardContract,
  validateMerlinWeeklyScoreboardContract
} = await import('../src/merlin/weeklyScoreboardContract.ts');
const {
  buildMerlinWeeklyScoreboardSnapshotArtifact,
  weeklyScoreboardArtifactPath,
  writeMerlinWeeklyScoreboardSnapshotArtifact
} = await import('../src/merlin/weeklyScoreboardSnapshotArtifact.ts');

let server: Server;
let baseUrl = '';

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  return {
    status: response.status,
    body: (text ? JSON.parse(text) : {}) as T
  };
}

before(async () => {
  server = createMerlinServer();
  await new Promise<void>((resolveStart, reject) => {
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Server did not bind to numeric port'));
        return;
      }
      baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
      resolveStart();
    });
  });
});

after(async () => {
  await new Promise<void>((resolveStop) => server.close(() => resolveStop()));
  closeMerlinOutcomeRuntime();
  closeMerlinApprovalRuntime();
  closeMerlinActionCardRuntime();
  closeLisaStore();
  closeDriveManifestStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
  resetMerlinOutcomeRuntimeForTest();
  resetMerlinApprovalRuntimeForTest();
  resetMerlinActionCardRuntimeForTest();
});

test('weekly scoreboard contract includes all 8 KPI definitions', () => {
  const contract = getMerlinWeeklyScoreboardContract();
  const ids = new Set(contract.kpis.map((kpi) => kpi.id));
  assert.equal(contract.kpis.length, 8);
  for (const requiredId of MERLIN_WEEKLY_SCOREBOARD_KPI_IDS) {
    assert.equal(ids.has(requiredId), true, `missing KPI definition: ${requiredId}`);
  }
});

test('weekly scoreboard contract validator rejects missing KPI definitions', () => {
  const contract = getMerlinWeeklyScoreboardContract();
  const broken = {
    ...contract,
    kpis: contract.kpis.filter((kpi) => kpi.id !== 'operator_override_rate')
  };
  assert.throws(() => validateMerlinWeeklyScoreboardContract(broken), /missing_kpi_definition:operator_override_rate/);
});

test('weekly scoreboard endpoints expose contract and all KPI slots', async () => {
  const contractResponse = await requestJson<{ contract: { kpis: Array<{ id: string }> } }>('/api/merlin/scoreboard/contract');
  assert.equal(contractResponse.status, 200);
  assert.equal(contractResponse.body.contract.kpis.length, 8);

  const weeklyResponse = await requestJson<{ metrics: Record<string, unknown> }>('/api/merlin/scoreboard/weekly');
  assert.equal(weeklyResponse.status, 200);
  for (const requiredId of MERLIN_WEEKLY_SCOREBOARD_KPI_IDS) {
    assert.equal(Object.prototype.hasOwnProperty.call(weeklyResponse.body.metrics, requiredId), true, `missing metric slot: ${requiredId}`);
  }
});

test('weekly scoreboard artifact preserves all KPI slots and unavailable metrics', () => {
  const artifact = buildMerlinWeeklyScoreboardSnapshotArtifact({
    weekStart: '2026-06-01T00:00:00.000Z',
    weekEnd: '2026-06-08T00:00:00.000Z',
    generatedAt: '2026-06-08T12:00:00.000Z'
  });

  assert.equal(artifact.generated_at, '2026-06-08T12:00:00.000Z');
  assert.equal(artifact.mutationAllowed, false);
  assert.equal(artifact.contractVersion, 'v1');
  assert.equal(artifact.council_decision, null);
  assert.equal(artifact.notes, '');
  assert.equal(Object.keys(artifact.metrics).length, 8);
  for (const requiredId of MERLIN_WEEKLY_SCOREBOARD_KPI_IDS) {
    assert.equal(Object.prototype.hasOwnProperty.call(artifact.metrics, requiredId), true, `missing artifact metric: ${requiredId}`);
  }

  const notImplemented = artifact.metrics.verification_failure_rate;
  assert.equal(notImplemented.status, 'unavailable');
  assert.equal(notImplemented.missing_reason, 'source_not_implemented');
  assert.equal(notImplemented.value, null);
  assert.equal(notImplemented.numerator, null);
  assert.equal(notImplemented.denominator, null);
  assert.equal(notImplemented.sample_size, 0);
});

test('weekly scoreboard artifact path is deterministic by ISO week', () => {
  const result = weeklyScoreboardArtifactPath({
    artifactRoot: 'artifacts/merlin-scoreboard',
    weekStart: '2026-06-01T00:00:00.000Z'
  });

  assert.equal(result.weekKey, '2026-23');
  assert.equal(result.artifactPath, resolve('artifacts/merlin-scoreboard/2026-23/weekly-scoreboard.json'));
});

test('weekly scoreboard artifact writer does not invent fake KPI values', () => {
  const artifactRoot = mkdtempSync(resolve(tmpdir(), 'merlin-scoreboard-artifact-'));
  const result = writeMerlinWeeklyScoreboardSnapshotArtifact({
    artifactRoot,
    weekStart: '2026-06-01T00:00:00.000Z',
    weekEnd: '2026-06-08T00:00:00.000Z',
    generatedAt: '2026-06-08T12:00:00.000Z'
  });

  assert.equal(result.weekKey, '2026-23');
  assert.equal(result.artifactPath, resolve(artifactRoot, '2026-23', 'weekly-scoreboard.json'));
  assert.equal(existsSync(result.artifactPath), true);

  const written = JSON.parse(readFileSync(result.artifactPath, 'utf8'));
  assert.equal(written.mutationAllowed, false);
  assert.equal(written.metrics.loop_completion_rate.status, 'unavailable');
  assert.equal(written.metrics.loop_completion_rate.missing_reason, 'no_started_loops');
  assert.equal(written.metrics.loop_completion_rate.value, null);
  assert.equal(written.metrics.intake_to_action_cycle_time.value, null);
  assert.equal(written.metrics.approval_turnaround_time.value, null);
  assert.equal(written.metrics.model_cost_per_completed_loop.missing_reason, 'source_not_implemented');
});
