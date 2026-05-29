import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, beforeEach, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-ms-review-'));
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

async function requestText(path: string): Promise<{ status: number; body: string }> {
  const response = await fetch(`${baseUrl}${path}`);
  return {
    status: response.status,
    body: await response.text()
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
  await fetch(`${baseUrl}/api/demo/reset`, { method: 'POST' });
});

test('mealscout review queue page renders review-only OCR operator surface', async () => {
  const response = await requestText('/admin/mealscout-review-queue');
  assert.equal(response.status, 200);
  assert.ok(response.body.includes('MealScout OCR Review Queue'));
  assert.ok(response.body.includes('Preview-only operator station'));
  assert.ok(response.body.includes('OCR Draft Profiles'));
  assert.ok(response.body.includes('Duplicate / Merge Assist'));
  assert.ok(response.body.includes('Publish Plan Preview'));
  assert.ok(response.body.includes('Drive Batch Intake'));
  assert.ok(response.body.includes('Run batch intake'));
  assert.ok(response.body.includes('Batch intake does not publish records.'));
  assert.ok(response.body.includes('Preview only - no records will be published.'));
  assert.ok(response.body.includes('Publish (Disabled)'));
  assert.ok(response.body.includes('Mark as same truck'));
  assert.ok(response.body.includes('Keep separate'));
  assert.ok(response.body.includes('Needs review'));
  assert.ok(response.body.includes('mutationAllowed'));
});

test('mealscout review queue client uses preview endpoint and local review state only', async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const originalFetch = globalThis.fetch;
  const baseDate = '2026-05-29T18:00:00.000Z';
  try {
    globalThis.fetch = async (url, init = {}) => {
      const method = String(init?.method || 'GET').toUpperCase();
      const target = String(url);
      calls.push({
        url: target,
        method,
        body: typeof init?.body === 'string' ? init.body : undefined
      });

      if (target.includes('/api/mealscout/intake/preview')) {
        return new Response(
          JSON.stringify({
            status: 'ok',
            mutationAllowed: false,
            evidenceFiles: [
              { fileId: 'file-1', detectedType: 'profile' },
              { fileId: 'file-2', detectedType: 'menu' }
            ],
            drafts: [
              {
                draftId: 'draft-1',
                draftType: 'create_new',
                truckName: 'Orbit Tacos',
                sourceFiles: [{ sourceFileId: 'file-1', sourcePath: '/incoming/unknown/orbit/profile.png', sourceType: 'screenshot' }],
                mutationAllowed: false,
                extractedFieldEvidence: {}
              }
            ],
            mergeAssist: {
              candidateGroups: [
                {
                  groupId: 'merge-draft-1-draft-2',
                  draftIds: ['draft-1', 'draft-2'],
                  recommendation: 'possible_match',
                  confidence: 0.65,
                  reasons: [
                    {
                      type: 'similar_name',
                      detail: 'names are similar',
                      sourceDraftIds: ['draft-1', 'draft-2'],
                      sourceFileIds: ['file-1', 'file-2']
                    }
                  ],
                  conflicts: []
                }
              ]
            },
            publishPlan: {
              planId: 'ms-plan-1',
              generatedAt: baseDate,
              mutationAllowed: false,
              records: [
                {
                  recordId: 'ms-plan-record-draft-1',
                  plannedAction: 'create_new',
                  publishReady: true,
                  draftIds: ['draft-1'],
                  profileFields: {
                    truckName: { value: 'Orbit Tacos', evidenceRefs: ['name'], sourceFileIds: ['file-1'] }
                  },
                  menuItems: [{ name: 'Taco', evidenceRefs: ['menu'], sourceFileIds: ['file-2'] }]
                }
              ]
            },
            debugOcr: [
              { fileId: 'file-1', ocrSucceeded: true, extractedTextLength: 200 },
              { fileId: 'file-2', ocrSucceeded: true, extractedTextLength: 120 }
            ],
            summary: { clusterCount: 1, draftCount: 1 }
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (target.includes('/api/mealscout/review-decisions') && method === 'GET') {
        return new Response(
          JSON.stringify({
            status: 'ok',
            mutationAllowed: false,
            decisions: []
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (target.includes('/api/mealscout/review-decisions') && method === 'POST') {
        const requestBody = JSON.parse(typeof init.body === 'string' ? init.body : '{}');
        return new Response(
          JSON.stringify({
            status: 'ok',
            mutationAllowed: false,
            decision: {
              decisionId: 'ms-review-1',
              draftIds: requestBody.draftIds || [],
              decision: requestBody.decision,
              reason: requestBody.reason,
              sourceFileIds: requestBody.sourceFileIds || [],
              evidenceRefs: requestBody.evidenceRefs || [],
              decidedBy: requestBody.decidedBy,
              decidedAt: '2026-05-29T18:10:00.000Z',
              mutationAllowed: false
            }
          }),
          { status: 201, headers: { 'content-type': 'application/json' } }
        );
      }

      if (target.includes('/api/mealscout/intake/publish-plan/execute') && method === 'POST') {
        const requestBody = JSON.parse(typeof init.body === 'string' ? init.body : '{}');
        return new Response(
          JSON.stringify({
            executionId: 'ms-exec-1',
            planId: requestBody.planId,
            mutationAllowed: true,
            executedAt: '2026-05-29T18:20:00.000Z',
            results: [
              {
                recordId: requestBody.recordIds?.[0] || 'none',
                plannedAction: 'create_new',
                result: 'success',
                targetId: 'ms-profile-1',
                auditId: 'ms-audit-1'
              }
            ],
            auditEntries: [
              {
                auditId: 'ms-audit-1',
                executionId: 'ms-exec-1',
                planId: requestBody.planId,
                recordId: requestBody.recordIds?.[0] || 'none',
                draftIds: ['draft-1'],
                sourceFileIds: ['file-1'],
                action: 'create_new',
                fieldsWritten: ['truckName'],
                evidenceRefs: ['name'],
                executedAt: '2026-05-29T18:20:00.000Z',
                result: 'success'
              }
            ]
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      if (target.includes('/api/mealscout/intake/batches/run') && method === 'POST') {
        return new Response(
          JSON.stringify({
            batchId: 'ms-intake-batch-1',
            status: 'completed',
            mutationAllowed: false,
            folderId: 'folder-intake-unknown',
            scannedFileCount: 3,
            eligibleFileCount: 2,
            processedFileCount: 2,
            skippedFileCount: 1,
            failedFileCount: 0,
            processedFiles: [
              { fileId: 'file-1', fileName: 'profile.png', byteLength: 123, ocrAttempted: true, ocrSucceeded: true, classification: 'profile' }
            ],
            skippedFiles: [{ fileId: 'file-x', fileName: 'notes.txt', reason: 'unsupported_type' }],
            draftCount: 1
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      }

      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const { createMealScoutReviewQueueClient } = await import('../public/mealscout-review-queue-client.js');
    const client = createMealScoutReviewQueueClient();
    const preview = await client.getPreview({ loadFromDriveFolder: true, includeDebugOcr: true });
    assert.equal(preview.status, 'ok');
    assert.equal(preview.mutationAllowed, false);
    assert.equal(preview.drafts.length, 1);
    assert.equal(preview.mergeAssist.candidateGroups.length, 1);
    assert.equal(preview.mergeAssist.candidateGroups[0].reasons[0].type, 'similar_name');

    const list = await client.getReviewDecisions();
    assert.equal(list.status, 'ok');
    assert.equal(list.mutationAllowed, false);

    const saved = await client.saveReviewDecision({
      draftIds: ['draft-1', 'draft-2'],
      decision: 'same_truck',
      reason: 'same menu and profile signals',
      sourceFileIds: ['file-1', 'file-2'],
      evidenceRefs: ['similar_name'],
      decidedBy: 'operator'
    });
    assert.equal(saved.status, 'ok');
    assert.equal(saved.mutationAllowed, false);
    assert.equal(saved.decision.decision, 'same_truck');

    const draftState = client.setDraftReviewDecision({}, 'draft-1', 'needs_review');
    assert.equal(draftState['draft-1'].decision, 'needs_review');

    const mergeState = client.setMergeGroupReviewDecision({}, 'merge-draft-1-draft-2', 'keep_separate');
    assert.equal(mergeState['merge-draft-1-draft-2'].decision, 'keep_separate');

    const execution = await client.executePublishPlan({
      planId: 'ms-plan-1',
      recordIds: ['ms-plan-record-draft-1'],
      confirmation: true,
      operatorId: 'operator-a'
    });
    assert.equal(execution.mutationAllowed, true);
    assert.equal(execution.results[0].result, 'success');
    assert.equal(execution.auditEntries[0].auditId, 'ms-audit-1');

    const batch = await client.runBatchIntake({ mode: 'process', maxFiles: 3 });
    assert.equal(batch.mutationAllowed, false);
    assert.equal(batch.processedFileCount, 2);
    assert.equal(batch.skippedFiles[0].reason, 'unsupported_type');

    const previewCalls = calls.filter((entry) => entry.url.includes('/api/mealscout/intake/preview'));
    assert.equal(previewCalls.length, 1);
    assert.equal(previewCalls[0].method, 'POST');
    const payload = JSON.parse(String(previewCalls[0].body || '{}'));
    assert.equal(payload.loadFromDriveFolder, true);
    assert.equal(payload.includeDebugOcr, true);

    const blockedPatterns = [
      '/api/mealscout/profile-import/drafts/',
      '/approve',
      '/approve-updates',
      '/merge',
      '/link-existing',
      '/create-new-draft',
      '/api/mealscout/publish'
    ];
    for (const pattern of blockedPatterns) {
      assert.equal(calls.some((entry) => entry.url.includes(pattern)), false, `unexpected mutation call: ${pattern}`);
    }
    assert.equal(calls.some((entry) => entry.url.includes('/api/mealscout/intake/publish-plan/execute')), true);
    assert.equal(calls.some((entry) => entry.url.includes('/api/mealscout/intake/batches/run')), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
