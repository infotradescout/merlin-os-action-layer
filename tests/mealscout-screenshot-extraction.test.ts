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

test('pilot 1 payload consolidates to one cluster and one draft in preview-only mode', async () => {
  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    clusters: Array<{ clusterId: string; files: Array<{ fileId: string }> }>;
    drafts: Array<{ draftId: string; mutationAllowed: boolean; sourceFiles: Array<{ sourceFileId: string }> }>;
    summary: { clusterCount: number; draftCount: number };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'pilot-1-profile',
          fileName: 'IMG_1021.PNG',
          drivePath: '/Merlin/MealScout Intake/incoming/unknown/IMG_1021.PNG',
          sourceFolder: '/incoming/unknown',
          mimeType: 'image/png',
          extractedText:
            'Big Mikes Taco Truck\nPhone: 985-111-2222\nEmail: bigmikes@example.com\nCity: New Orleans\nCuisine: Tacos',
          visualLabels: ['food truck', 'profile']
        },
        {
          fileId: 'pilot-1-menu',
          fileName: 'IMG_1033.PNG',
          drivePath: '/Merlin/MealScout Intake/incoming/unknown/IMG_1033.PNG',
          sourceFolder: '/incoming/unknown',
          mimeType: 'image/png',
          extractedText: 'Menu\nBrisket Taco - $4.50\nChicken Taco - $4.00\nLoaded Nachos - $9.00',
          visualLabels: ['menu', 'food']
        },
        {
          fileId: 'pilot-1-logo',
          fileName: 'IMG_1044.PNG',
          drivePath: '/Merlin/MealScout Intake/incoming/unknown/IMG_1044.PNG',
          sourceFolder: '/incoming/unknown',
          mimeType: 'image/png',
          extractedText: 'Big Mikes Taco Truck',
          visualLabels: ['logo']
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.summary.clusterCount, 1);
  assert.equal(response.body.summary.draftCount, 1);
  assert.equal(response.body.clusters.length, 1);
  assert.equal(response.body.drafts.length, 1);
  assert.equal(response.body.drafts[0].mutationAllowed, false);
  assert.equal(response.body.drafts[0].sourceFiles.length, 3);
});

test('pilot 2 mixed multi-truck dump stays separated and mutation-safe in preview-only mode', async () => {
  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    clusters: Array<{
      clusterId: string;
      reviewStatus: 'ready_for_draft' | 'missing_required' | 'duplicate_possible' | 'uncertain_match';
      files: Array<{ fileId: string; detectedType: string }>;
    }>;
    drafts: Array<{
      draftId: string;
      truckName?: string;
      mutationAllowed: boolean;
      reviewStatus: 'ready_for_review' | 'missing_required' | 'duplicate_possible' | 'uncertain_match';
      menu: Array<{ name: string; sourceFileId: string }>;
      sourceFiles: Array<{ sourceFileId: string; sourceType: 'screenshot' | 'menu' | 'logo' | 'unknown' }>;
    }>;
    summary: { clusterCount: number; draftCount: number };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'pilot-2-a-profile',
          fileName: 'IMG_2001.PNG',
          sourceFolder: '/incoming/unknown',
          extractedText:
            'Bayou Bites\nPhone: 985-201-0101\nEmail: hello@bayoubites.com\nCity: New Orleans\nCuisine: Cajun'
        },
        {
          fileId: 'pilot-2-a-menu',
          fileName: 'IMG_2002.PNG',
          sourceFolder: '/incoming/unknown',
          extractedText: 'Bayou Bites Menu\nPhone: 985-201-0101\nShrimp Po Boy - $12.00\nGumbo Bowl - $10.00'
        },
        {
          fileId: 'pilot-2-b-profile',
          fileName: 'IMG_2003.PNG',
          sourceFolder: '/incoming/unknown',
          extractedText: 'Taco Orbit\nPhone: 504-777-0001\nCity: Metairie\nCuisine: Tacos\nInstagram: @tacoorbit'
        },
        {
          fileId: 'pilot-2-b-menu',
          fileName: 'IMG_2004.PNG',
          sourceFolder: '/incoming/unknown',
          extractedText: 'Taco Orbit Menu\nPhone: 504-777-0001\nAl Pastor Taco - $4.25\nBirria Quesadilla - $9.75'
        },
        {
          fileId: 'pilot-2-b-logo',
          fileName: 'IMG_2005.PNG',
          sourceFolder: '/incoming/unknown',
          extractedText: 'Taco Orbit',
          visualLabels: ['logo']
        },
        {
          fileId: 'pilot-2-orphan-logo',
          fileName: 'IMG_2006.PNG',
          sourceFolder: '/incoming/unknown',
          extractedText: '',
          visualLabels: ['logo']
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.summary.clusterCount >= 2 && response.body.summary.clusterCount <= 3, true);
  assert.equal(response.body.summary.draftCount, response.body.summary.clusterCount);
  assert.equal(response.body.drafts.every((item) => item.mutationAllowed === false), true);

  const bayouCluster = response.body.clusters.find((cluster) =>
    cluster.files.some((file) => file.fileId === 'pilot-2-a-profile')
  );
  const tacoCluster = response.body.clusters.find((cluster) =>
    cluster.files.some((file) => file.fileId === 'pilot-2-b-profile')
  );
  assert.ok(bayouCluster, 'Expected Bayou Bites cluster');
  assert.ok(tacoCluster, 'Expected Taco Orbit cluster');
  assert.equal(bayouCluster.files.some((file) => file.fileId === 'pilot-2-a-menu'), true);
  assert.equal(tacoCluster.files.some((file) => file.fileId === 'pilot-2-b-menu'), true);

  assert.equal(
    response.body.clusters.some(
      (cluster) =>
        cluster.reviewStatus === 'uncertain_match' &&
        cluster.files.length === 1 &&
        cluster.files[0].fileId === 'pilot-2-orphan-logo' &&
        cluster.files[0].detectedType === 'logo'
    ),
    true
  );
});

