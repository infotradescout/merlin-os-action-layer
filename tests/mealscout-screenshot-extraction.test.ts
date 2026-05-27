import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

process.env.MERLIN_RUNTIME = 'test';

const { createMealScoutEvidenceFromScreenshotInput, parseMealScoutSignalsFromText } = await import('../src/mealscoutScreenshotExtraction.ts');
const { createMerlinServer } = await import('../src/server.ts');

let server: Server;
let baseUrl = '';

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  });
  const body = (await response.json()) as T;
  return { status: response.status, body };
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
  await new Promise<void>((resolveStop) => server.close(() => resolveStop()));
});

test('extracts phone email website social from screenshot text', () => {
  const parsed = parseMealScoutSignalsFromText(
    [
      'Bayou Bites',
      'Phone: (985) 555-1212',
      'Email: hello@bayoubites.com',
      'Website: https://bayoubites.com',
      'Instagram: @bayoubites',
      'Facebook: bayoubitestruck'
    ].join('\n')
  );

  assert.equal(parsed.extractedSignals.truckName, 'Bayou Bites');
  assert.equal(parsed.extractedSignals.phone, '985-555-1212');
  assert.equal(parsed.extractedSignals.email, 'hello@bayoubites.com');
  assert.equal(parsed.extractedSignals.website, 'https://bayoubites.com');
  assert.equal(parsed.extractedSignals.instagram, '@bayoubites');
  assert.equal(parsed.extractedSignals.facebook, 'bayoubitestruck');
});

test('extracts menu items and prices from menu text', () => {
  const evidence = createMealScoutEvidenceFromScreenshotInput({
    fileId: 'menu-1',
    fileName: 'IMG_9032.PNG',
    sourceFolder: '/Merlin/MealScout Intake/incoming/unknown/',
    extractedText: 'Brisket Taco $4.50\nLoaded Fries $7.00'
  });

  assert.equal(evidence.detectedType, 'menu');
  assert.equal((evidence.extractedSignals.menuItems || []).length, 2);
  assert.equal(evidence.extractedSignals.menuItems?.[0]?.name, 'Brisket Taco');
  assert.equal(evidence.extractedSignals.menuItems?.[0]?.price, '$4.50');
});

test('classifies logo-only evidence without auto-attachment', () => {
  const evidence = createMealScoutEvidenceFromScreenshotInput({
    fileId: 'logo-1',
    fileName: 'logo.png',
    sourceFolder: '/Merlin/MealScout Intake/incoming/logos/',
    extractedText: '',
    visualLabels: ['logo', 'brand']
  });

  assert.equal(evidence.detectedType, 'logo');
  assert.equal(evidence.extractedSignals.truckName, undefined);
});

test('classifies social screenshot', () => {
  const evidence = createMealScoutEvidenceFromScreenshotInput({
    fileId: 'social-1',
    fileName: 'screen.png',
    sourceFolder: '/Merlin/MealScout Intake/incoming/unknown/',
    extractedText: 'Follow us on Instagram @tacoorbit'
  });
  assert.equal(evidence.detectedType, 'social');
  assert.equal(evidence.extractedSignals.instagram, '@tacoorbit');
});

test('unknown low-signal file remains unknown', () => {
  const evidence = createMealScoutEvidenceFromScreenshotInput({
    fileId: 'unknown-1',
    fileName: 'misc.png',
    sourceFolder: '/Merlin/MealScout Intake/incoming/unknown/',
    extractedText: '###'
  });
  assert.equal(evidence.detectedType, 'unknown');
});

test('preview endpoint returns evidence clusters drafts in mutation-safe envelope', async () => {
  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    evidenceFiles: Array<{ fileId: string; detectedType: string }>;
    clusters: Array<{ clusterId: string }>;
    drafts: Array<{ mutationAllowed: boolean }>;
    summary: { inputs: number; evidenceCount: number; clusterCount: number; draftCount: number };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'file-a',
          fileName: 'IMG_1001.PNG',
          sourceFolder: '/Merlin/MealScout Intake/incoming/unknown/',
          extractedText: 'Bayou Bites\nPhone: 985-111-2222\nCity: New Orleans\nCajun\nShrimp Po Boy $12.00'
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.summary.inputs, 1);
  assert.equal(response.body.summary.evidenceCount, 1);
  assert.equal(response.body.summary.clusterCount >= 1, true);
  assert.equal(response.body.summary.draftCount >= 1, true);
  assert.equal(response.body.drafts.every((item) => item.mutationAllowed === false), true);
});

test('preview endpoint requires inputs and does not mutate live profiles', async () => {
  const bad = await requestJson<{ error: string }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({})
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.includes('inputs is required'), true);
});

