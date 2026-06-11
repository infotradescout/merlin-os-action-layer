import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { before, after, test } from 'node:test';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const tempDir = mkdtempSync(resolve(tmpdir(), 'merlin-or-g1-'));
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

async function requestText(path: string, init: RequestInit = {}): Promise<{ status: number; body: string }> {
  const response = await fetch(`${baseUrl}${path}`, init);
  return {
    status: response.status,
    body: await response.text()
  };
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...init
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

test('read-only API returns serialized operator review presentation payload', async () => {
  const response = await requestJson<{
    status: string;
    mode: string;
    advisoryOnly: boolean;
    authorityReference: string;
    serializedPresentation: string;
    mutationAllowed: boolean;
    implementationAllowed: boolean;
    executionAllowed: boolean;
  }>('/api/merlin/operator-review/presentation');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mode, 'read_only');
  assert.equal(response.body.advisoryOnly, true);
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.implementationAllowed, false);
  assert.equal(response.body.executionAllowed, false);
  assert.equal(
    response.body.authorityReference,
    'docs/merlin/MERLIN_OPERATOR_REVIEW_PRESENTATION_CLOSEOUT.md'
  );

  const presentation = JSON.parse(response.body.serializedPresentation) as {
    display: { title: string; subtitle: string; detailLines: string[] };
    operatorWarnings: string[];
    evidenceBindings: {
      detailLines: Array<{
        line: string;
        sourceReferences: string[];
        evidenceState: 'bound' | 'no_evidence';
        noEvidenceReason?: 'not_applicable' | 'source_unavailable';
      }>;
      warnings: Array<{
        warning: string;
        sourceReferences: string[];
        evidenceState: 'bound' | 'no_evidence';
        noEvidenceReason?: 'not_applicable' | 'source_unavailable';
      }>;
    };
    mutationAllowed: boolean;
    implementationAllowed: boolean;
    executionAllowed: boolean;
  };

  assert.equal(typeof presentation.display.title, 'string');
  assert.equal(typeof presentation.display.subtitle, 'string');
  assert.equal(Array.isArray(presentation.display.detailLines), true);
  assert.equal(Array.isArray(presentation.operatorWarnings), true);
  assert.equal(Array.isArray(presentation.evidenceBindings.detailLines), true);
  assert.equal(Array.isArray(presentation.evidenceBindings.warnings), true);
  assert.equal(
    presentation.evidenceBindings.detailLines.length,
    presentation.display.detailLines.length
  );

  for (const detailEvidence of presentation.evidenceBindings.detailLines) {
    if (detailEvidence.evidenceState === 'bound') {
      assert.equal(detailEvidence.sourceReferences.length > 0, true);
    } else {
      assert.equal(detailEvidence.sourceReferences.length, 0);
      assert.equal(typeof detailEvidence.noEvidenceReason, 'string');
    }
  }

  for (const warningEvidence of presentation.evidenceBindings.warnings) {
    if (warningEvidence.evidenceState === 'bound') {
      assert.equal(warningEvidence.sourceReferences.length > 0, true);
    } else {
      assert.equal(warningEvidence.sourceReferences.length, 0);
      assert.equal(typeof warningEvidence.noEvidenceReason, 'string');
    }
  }

  assert.equal(
    presentation.evidenceBindings.warnings.some(
      (entry) => entry.evidenceState === 'no_evidence' && entry.noEvidenceReason === 'not_applicable'
    ),
    true
  );
  assert.equal(presentation.mutationAllowed, false);
  assert.equal(presentation.implementationAllowed, false);
  assert.equal(presentation.executionAllowed, false);
});

test('integration gate has no apply or execute API routes', async () => {
  const applyRoute = await requestJson<{ error: string }>('/api/merlin/operator-review/apply', {
    method: 'POST',
    body: '{}'
  });
  const executeRoute = await requestJson<{ error: string }>('/api/merlin/operator-review/execute', {
    method: 'POST',
    body: '{}'
  });

  assert.equal(applyRoute.status, 404);
  assert.equal(executeRoute.status, 404);
  assert.equal(applyRoute.body.error, 'Not found');
  assert.equal(executeRoute.body.error, 'Not found');
});

test('operator review admin view exposes read-only details without action buttons', async () => {
  const response = await requestText('/admin/merlin-operator-review');

  assert.equal(response.status, 200);
  assert.ok(response.body.includes('Merlin Operator Review'));
  assert.ok(response.body.includes('Read-only integration gate view'));
  assert.ok(response.body.includes('/api/merlin/operator-review/presentation'));
  assert.ok(response.body.includes('Detail Lines'));
  assert.ok(response.body.includes('Warnings'));
  assert.ok(response.body.includes('Evidence Binding'));
  assert.ok(response.body.includes('Detail Line Evidence'));
  assert.ok(response.body.includes('Warning Evidence'));
  assert.ok(response.body.includes('Authority Flags'));
  assert.ok(response.body.includes('Authority Reference'));
  assert.ok(response.body.includes('docs/merlin/MERLIN_OPERATOR_REVIEW_PRESENTATION_CLOSEOUT.md'));
  assert.ok(response.body.includes('no_evidence:not_applicable'));

  const normalized = response.body.toLowerCase();
  assert.equal(normalized.includes('<button'), false);
});
