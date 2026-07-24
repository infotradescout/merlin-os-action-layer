import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const testDir = mkdtempSync(join(tmpdir(), 'merlin-shell-runtime-'));
const dbPath = join(testDir, 'merlin-shell.sqlite');
process.env.MERLIN_DB_PATH = dbPath;

const { initializeMerlinWorkspaceRuntime, closeMerlinWorkspaceRuntime, createMerlinWorkspace } = await import('../src/merlin/workspaceRuntime.ts');
const { initializeMerlinConnectedSourceRuntime, closeMerlinConnectedSourceRuntime, resetMerlinConnectedSourceRuntimeForTest, listMerlinConnectedSources } =
  await import('../src/merlin/connectedSourceRuntime.ts');
const { registerProductAdapter, resetIntentRegistryForTest } = await import('../src/merlin/intake/intentRegistry.ts');
const { mealscoutAdapter } = await import('../src/merlin/adapters/mealscoutAdapter.ts');
const { getMerlinShellPayload, connectMerlinSource } = await import('../src/merlin/shellRuntime.ts');

initializeMerlinWorkspaceRuntime(dbPath);
initializeMerlinConnectedSourceRuntime(dbPath);

beforeEach(() => {
  resetMerlinConnectedSourceRuntimeForTest();
  resetIntentRegistryForTest();
  registerProductAdapter(mealscoutAdapter);
});

after(() => {
  closeMerlinConnectedSourceRuntime();
  closeMerlinWorkspaceRuntime();
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch (error) {
    if (!(error instanceof Error) || !String((error as NodeJS.ErrnoException).code || '').includes('EPERM')) {
      throw error;
    }
  }
});

test('shell payload exposes workspace, source catalog, adapters, and actions together', () => {
  const workspace = createMerlinWorkspace({
    workspace_name: 'MealScout Ops',
    workspace_type: 'brand'
  });
  connectMerlinSource({
    workspace_id: workspace.id,
    source_key: 'mealscout',
    source_label: 'MealScout',
    source_type: 'app',
    connection_status: 'connected',
    auth_kind: 'internal',
    capabilities: ['read_product_context', 'start_intents']
  });

  const payload = getMerlinShellPayload({
    workspace_id: workspace.id,
    brand: 'MEALSCOUT'
  });

  assert.equal(payload.status, 'ok');
  assert.equal(payload.mode, 'read_only');
  assert.equal(payload.mutationAllowed, false);
  assert.equal(payload.shell.workspace?.id, workspace.id);
  assert.equal(payload.shell.connectedSources.some((row) => row.source_key === 'mealscout'), true);
  assert.equal(payload.shell.sourceCatalog.some((row) => row.sourceKey === 'mealscout' && row.connectionStatus === 'connected'), true);
  assert.equal(payload.shell.actions.some((row) => row.brand === 'MEALSCOUT'), true);
  assert.equal(payload.shell.adapters.some((row) => row.tool === 'GoogleDrive'), true);
});

test('connected source upsert updates a workspace-scoped record instead of duplicating it', () => {
  const workspace = createMerlinWorkspace({
    workspace_name: 'TradeScout Ops',
    workspace_type: 'brand'
  });
  const first = connectMerlinSource({
    workspace_id: workspace.id,
    source_key: 'github',
    source_label: 'GitHub',
    source_type: 'github',
    connection_status: 'needs_auth',
    capabilities: ['read_repo']
  });
  const second = connectMerlinSource({
    workspace_id: workspace.id,
    source_key: 'github',
    source_label: 'GitHub Connected',
    source_type: 'github',
    connection_status: 'connected',
    capabilities: ['read_repo', 'draft_changes']
  });

  const rows = listMerlinConnectedSources(workspace.id);
  assert.equal(first.id, second.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source_label, 'GitHub Connected');
  assert.equal(rows[0].connection_status, 'connected');
  assert.deepEqual(rows[0].capabilities, ['read_repo', 'draft_changes']);
});
