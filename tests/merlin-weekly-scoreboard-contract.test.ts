import assert from 'node:assert/strict';
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
