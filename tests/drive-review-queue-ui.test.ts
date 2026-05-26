import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-v2-5-'));
process.env.MERLIN_DB_PATH = resolve(tempDir, 'merlin-or.sqlite');
process.env.MERLIN_RUNTIME = 'test';
const baseDate = '2026-05-26T00:00:00.000Z';

const { createMerlinServer } = await import('../src/server.ts');
const { closeDriveManifestStore } = await import('../src/driveManifest.ts');
const { closeLisaStore } = await import('../src/lisa.ts');
const { closeReplayStore } = await import('../src/replay.ts');
const { closeApprovalQueueStore } = await import('../src/approvalQueue.ts');
const { closeOutcomesStore } = await import('../src/outcomes.ts');
const { resetDriveReviewQueueForTest } = await import('../src/driveReviewQueue.ts');

let server: Server;
let baseUrl: string;

async function requestText(path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    body: await response.text()
  };
}

async function requestJson<T>(path: string): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json'
    }
  });
  return {
    status: response.status,
    body: (await response.json()) as T
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
  resetDriveReviewQueueForTest();
});

test('admin review queue page renders operational inbox envelope', async () => {
  const response = await requestText('/admin/drive-review-queue');
  assert.equal(response.status, 200);
  assert.ok(response.body.includes('Drive Review Queue'));
  assert.ok(response.body.includes('Auth Health Strip'));
  assert.ok(response.body.includes('Reconciliation Summary'));
  assert.ok(response.body.includes('Review Queue Inbox'));
  assert.ok(response.body.includes('No Drive changes will be made'));
  assert.ok(response.body.includes('Queue Item Detail'));
  assert.ok(response.body.includes('Acknowledge'));
  assert.ok(response.body.includes('Needs manual review'));
  assert.ok(response.body.includes('Mark externally resolved'));
  assert.ok(response.body.includes('Mark false positive'));
  assert.ok(response.body.includes('Defer'));
});

test('admin review queue page does not expose remediation commands', async () => {
  const response = await requestText('/admin/drive-review-queue');
  assert.equal(response.status, 200);
  const body = response.body.toLowerCase();
  const blocked = [
    /\bfix\b/i,
    /\brepair\b/i,
    /\bauto[-\s]?resolve\b/i,
    /\bcreate missing\b/i,
    /\bdelete unexpected\b/i
  ];
  for (const pattern of blocked) {
    assert.equal(pattern.test(body), false, `unexpected wording: ${pattern}`);
  }
});

test('drive review queue client can post decision metadata only', async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const originalFetch = globalThis.fetch;
  const payload = {
    status: 'ok',
    mode: 'read_only',
    mutationAllowed: false,
    checkedAt: baseDate,
    summary: {
      itemCount: 1,
      openCount: 1,
      acknowledgedCount: 0,
      deferredCount: 0,
      resolvedExternallyCount: 0,
      falsePositiveCount: 0
    },
    items: [
      {
        id: 'file-queue-001',
        type: 'missing_folder',
        severity: 'critical',
        status: 'open',
        title: 'missing folder',
        summary: 'Manifest missing from drive',
        observedAt: baseDate,
        source: 'drive_reconciliation',
        readOnly: true,
        recommendedHumanAction: 'Review mismatch and decide if tracked manually',
        driveFolderId: 'folder-01',
        manifestPath: '02_Needs_Review'
      }
    ]
  };

  try {
    globalThis.fetch = async (url, init = {}) => {
      const method = String(init?.method || 'GET').toUpperCase();
      const target = String(url);
      calls.push({
        url: target,
        method,
        body: typeof init?.body === 'string' ? init.body : undefined
      });

      if (target.includes('/api/drive/review-queue/file-queue-001/decision')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            mode: 'read_only',
            mutationAllowed: false,
            item: {
              id: 'file-queue-001',
              type: 'missing_folder',
              severity: 'critical',
              status: 'acknowledged',
              title: 'missing folder · acknowledged',
              summary: 'Manifest missing from drive',
              observedAt: baseDate,
              source: 'drive_reconciliation',
              readOnly: true,
              recommendedHumanAction: 'Review mismatch and decide if tracked manually',
              lastDecision: {
                decision: 'acknowledged',
                note: 'looks okay',
                decidedAt: baseDate,
                decidedBy: 'operator-a'
              }
            }
          }
          ),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        );
      }

      if (target.endsWith('/api/drive/review-queue')) {
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }

      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const { createDriveReviewQueueClient } = await import('../public/drive-review-queue-client.js');
    const client = createDriveReviewQueueClient();

    const decision = await client.postDecision('file-queue-001', 'acknowledged', 'looks okay', 'operator-a');
    assert.equal(decision.status, 'ok');
    assert.equal(decision.mode, 'read_only');
    assert.equal(decision.mutationAllowed, false);
    assert.equal(decision.item?.status, 'acknowledged');

    const decisionCall = calls.find((entry) => entry.url.includes('/api/drive/review-queue/file-queue-001/decision'));
    assert.equal(Boolean(decisionCall), true);
    const body = JSON.parse(String(decisionCall?.body || '{}'));
    assert.equal(body.decision, 'acknowledged');
    assert.equal(body.note, 'looks okay');
    assert.equal(body.decided_by, 'operator-a');
    assert.equal(body.target === undefined, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
