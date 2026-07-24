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
      'x-operator-id': 'shell-test-user',
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

test('shell endpoint returns the assembled Merlin front-door payload', async () => {
  const response = await requestJson<{
    status: string;
    operator: { decidedBy: string };
    shell: { sourceCatalog: Array<{ sourceKey: string }>; actions: Array<{ brand: string }>; suggestedNextSteps: string[] };
    operatorConsole: { summary: { intakeOpenCount: number } };
  }>('/api/merlin/shell?workspace_id=merlin-workspace-system&brand=MEALSCOUT');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.operator.decidedBy, 'shell-test-user');
  assert.equal(response.body.shell.sourceCatalog.some((row) => row.sourceKey === 'mealscout'), true);
  assert.equal(response.body.shell.actions.some((row) => row.brand === 'MEALSCOUT'), true);
  assert.equal(Array.isArray(response.body.shell.suggestedNextSteps), true);
  assert.equal(typeof response.body.operatorConsole.summary.intakeOpenCount, 'number');
});

test('connected source route persists a shell-visible workspace source record', async () => {
  const created = await requestJson<{ connectedSource: { source_key: string; connection_status: string; capabilities: string[] } }>(
    '/api/merlin/connected-sources',
    {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: 'merlin-workspace-system',
        source_key: 'github',
        source_label: 'GitHub',
        source_type: 'github',
        connection_status: 'connected',
        auth_kind: 'oauth',
        capabilities: ['read_repo', 'draft_changes']
      })
    }
  );

  assert.equal(created.status, 201);
  assert.equal(created.body.connectedSource.source_key, 'github');
  assert.equal(created.body.connectedSource.connection_status, 'connected');
  assert.deepEqual(created.body.connectedSource.capabilities, ['read_repo', 'draft_changes']);

  const shell = await requestJson<{ shell: { sourceCatalog: Array<{ sourceKey: string; connectionStatus: string }> } }>(
    '/api/merlin/shell?workspace_id=merlin-workspace-system&brand=MEALSCOUT'
  );
  const github = shell.body.shell.sourceCatalog.find((row) => row.sourceKey === 'github');
  assert.ok(github);
  assert.equal(github?.connectionStatus, 'connected');
});
