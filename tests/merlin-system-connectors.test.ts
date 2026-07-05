import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.MERLIN_RUNTIME = 'test';
process.env.MERLIN_INTAKE_ENABLED = 'true';
process.env.MERLIN_INTAKE_MEALSCOUT_ENABLED = 'true';

const { createMerlinServer } = await import('../src/server.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');

let server: Server;
let baseUrl = '';

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'x-operator-id': 'connector-test-user',
      'x-operator-role': 'admin',
      ...(init.headers || {})
    },
    ...init
  });
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T };
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
  closeLisaStore();
  closeDriveManifestStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
});

test('system connector registry exposes MealScout and TradeScout contract surfaces', async () => {
  const list = await requestJson<{
    connectors: Array<{
      id: string;
      source_key: string;
      brand: string;
      route_inventory: Array<{ path: string; action_class: string }>;
    }>;
  }>('/api/merlin/system-connectors');

  assert.equal(list.status, 200);
  assert.equal(list.body.connectors.length >= 2, true);
  assert.equal(list.body.connectors.some((row) => row.source_key === 'mealscout'), true);
  assert.equal(list.body.connectors.some((row) => row.source_key === 'tradescout'), true);

  const mealscout = list.body.connectors.find((row) => row.source_key === 'mealscout');
  assert.ok(mealscout);
  assert.equal(mealscout?.route_inventory.some((row) => row.path === '/api/restaurants/:restaurantId/operating-hours'), true);
  assert.equal(mealscout?.route_inventory.some((row) => row.path === '/api/upload/restaurant-logo'), true);

  const detail = await requestJson<{
    connector: {
      source_key: string;
      execute_capabilities: string[];
      current_blockers: string[];
    };
  }>('/api/merlin/system-connectors/merlin-system-connector-tradescout');

  assert.equal(detail.status, 200);
  assert.equal(detail.body.connector.source_key, 'tradescout');
  assert.equal(detail.body.connector.execute_capabilities.includes('update_business_profile'), true);
  assert.equal(detail.body.connector.current_blockers.length > 0, true);
});

test('shell payload includes normalized connector summary for selected brand', async () => {
  const response = await requestJson<{
    shell: {
      connectors: Array<{
        sourceKey: string;
        brand: string;
        executeCapabilities: string[];
      }>;
    };
  }>('/api/merlin/shell?workspace_id=merlin-workspace-system&brand=MEALSCOUT');

  assert.equal(response.status, 200);
  assert.equal(response.body.shell.connectors.length >= 1, true);
  assert.equal(response.body.shell.connectors[0].brand, 'MEALSCOUT');
  assert.equal(response.body.shell.connectors[0].sourceKey, 'mealscout');
  assert.equal(response.body.shell.connectors[0].executeCapabilities.includes('update_restaurant_operating_hours'), true);
});
