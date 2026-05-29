import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-ms-review-persist-'));
process.env.MERLIN_DB_PATH = resolve(tempDir, 'merlin-or.sqlite');
process.env.MERLIN_RUNTIME = 'test';

const { createMerlinServer } = await import('../src/server.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');

let server: Server;
let baseUrl: string;

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...init
  });
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
        reject(new Error('Server did not bind to a numeric port'));
        return;
      }
      baseUrl = `http://127.0.0.1:${(address as AddressInfo).port}`;
      resolveStart();
    });
  });
});

after(async () => {
  await new Promise<void>((resolveStop) => {
    server.close(() => resolveStop());
  });
  closeLisaStore();
  closeDriveManifestStore();
  closeReplayStore();
  closeApprovalQueueStore();
  closeOutcomesStore();
});

beforeEach(async () => {
  await requestJson('/api/demo/reset', { method: 'POST' });
});

test('saving same_truck persists review-only decision', async () => {
  const save = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    decision: { decision: string; draftIds: string[]; sourceFileIds: string[]; mutationAllowed: boolean };
  }>('/api/mealscout/review-decisions', {
    method: 'POST',
    body: JSON.stringify({
      draftIds: ['d-1', 'd-2'],
      decision: 'same_truck',
      sourceFileIds: ['f-1', 'f-2'],
      evidenceRefs: ['same_phone'],
      decidedBy: 'operator'
    })
  });
  assert.equal(save.status, 201);
  assert.equal(save.body.status, 'ok');
  assert.equal(save.body.mutationAllowed, false);
  assert.equal(save.body.decision.decision, 'same_truck');
  assert.deepEqual(save.body.decision.draftIds, ['d-1', 'd-2']);
  assert.equal(save.body.decision.mutationAllowed, false);

  const list = await requestJson<{ status: string; mutationAllowed: boolean; decisions: Array<{ decision: string }> }>(
    '/api/mealscout/review-decisions'
  );
  assert.equal(list.status, 200);
  assert.equal(list.body.status, 'ok');
  assert.equal(list.body.mutationAllowed, false);
  assert.equal(list.body.decisions.some((item) => item.decision === 'same_truck'), true);
});

test('saving keep_separate and needs_review persists and includes source ids', async () => {
  const keep = await requestJson<{ decision: { decisionId: string; decision: string; sourceFileIds: string[]; mutationAllowed: boolean } }>(
    '/api/mealscout/review-decisions',
    {
      method: 'POST',
      body: JSON.stringify({
        draftIds: ['d-3'],
        decision: 'keep_separate',
        sourceFileIds: ['f-3']
      })
    }
  );
  assert.equal(keep.status, 201);
  assert.equal(keep.body.decision.decision, 'keep_separate');
  assert.deepEqual(keep.body.decision.sourceFileIds, ['f-3']);
  assert.equal(keep.body.decision.mutationAllowed, false);

  const needs = await requestJson<{ decision: { decision: string; draftIds: string[]; mutationAllowed: boolean } }>(
    '/api/mealscout/review-decisions',
    {
      method: 'POST',
      body: JSON.stringify({
        draftIds: ['d-4'],
        decision: 'needs_review',
        reason: 'low confidence',
        sourceFileIds: ['f-4'],
        evidenceRefs: ['weak_text_overlap']
      })
    }
  );
  assert.equal(needs.status, 201);
  assert.equal(needs.body.decision.decision, 'needs_review');
  assert.deepEqual(needs.body.decision.draftIds, ['d-4']);
  assert.equal(needs.body.decision.mutationAllowed, false);
});

test('updating decision persists without production mutation', async () => {
  const created = await requestJson<{ decision: { decisionId: string; decision: string; mutationAllowed: boolean } }>(
    '/api/mealscout/review-decisions',
    {
      method: 'POST',
      body: JSON.stringify({
        draftIds: ['d-5'],
        decision: 'needs_review'
      })
    }
  );
  const decisionId = created.body.decision.decisionId;
  const updated = await requestJson<{ status: string; mutationAllowed: boolean; decision: { decision: string; mutationAllowed: boolean } }>(
    `/api/mealscout/review-decisions/${encodeURIComponent(decisionId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        decision: 'keep_separate',
        reason: 'conflicting phones'
      })
    }
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.status, 'ok');
  assert.equal(updated.body.mutationAllowed, false);
  assert.equal(updated.body.decision.decision, 'keep_separate');
  assert.equal(updated.body.decision.mutationAllowed, false);

  const publish = await requestJson<{ error: string }>('/api/mealscout/profile-import/drafts/not-a-draft/publish', {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(publish.status >= 400, true);
});
