import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { DriveClient } from '../src/driveClient.ts';

process.env.MERLIN_RUNTIME = 'test';

const { createMealScoutEvidenceFromScreenshotInput, parseMealScoutSignalsFromText } = await import('../src/mealscoutScreenshotExtraction.ts');
const { createMerlinServer } = await import('../src/server.ts');
const { setDriveClientFactory, resetDriveClientFactory } = await import('../src/driveClient.ts');

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
  resetDriveClientFactory();
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

test('logo-only preview evidence remains unattached media and does not create standalone draft', async () => {
  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    drafts: Array<{ draftId: string }>;
    unattachedMedia: Array<{ sourceFileId: string; mediaType: string }>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'logo-only-1',
          fileName: 'brand-logo.png',
          sourceFolder: '/Merlin/MealScout Intake/incoming/logos/',
          extractedText: '',
          visualLabels: ['logo', 'brand']
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.drafts.length, 0);
  assert.equal(response.body.unattachedMedia.length, 1);
  assert.equal(response.body.unattachedMedia[0].sourceFileId, 'logo-only-1');
  assert.equal(response.body.unattachedMedia[0].mediaType, 'logo');
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

test('preview endpoint includes merge assist recommendations without mutation', async () => {
  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    drafts: Array<{ draftId: string; mutationAllowed: boolean }>;
    mergeAssist: {
      candidateGroups: Array<{
        recommendation: string;
        reasons: Array<{ type: string; sourceDraftIds: string[]; sourceFileIds: string[] }>;
        conflicts: Array<{ field: string }>;
      }>;
    };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'merge-file-1',
          fileName: 'profile.png',
          sourceFolder: '/Merlin/MealScout Intake/incoming/unknown/orbit/',
          extractedText: 'Orbit Tacos\nPhone: 985-999-1234\nCity: Kenner\nTacos'
        },
        {
          fileId: 'merge-file-2',
          fileName: 'menu.png',
          sourceFolder: '/Merlin/MealScout Intake/incoming/unknown/orbit/',
          extractedText: 'Orbit Tacos Menu\nPhone: (985)999-1234\nQuesadilla $10.00'
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.drafts.every((draft) => draft.mutationAllowed === false), true);
  assert.equal(Array.isArray(response.body.mergeAssist.candidateGroups), true);
  if (response.body.mergeAssist.candidateGroups.length > 0) {
    const top = response.body.mergeAssist.candidateGroups[0];
    assert.equal(['merge_recommended', 'possible_match', 'keep_separate'].includes(top.recommendation), true);
    assert.equal(top.reasons.length > 0 || top.conflicts.length > 0, true);
    if (top.reasons.length > 0) {
      assert.equal(top.reasons[0].sourceDraftIds.length, 2);
      assert.equal(top.reasons[0].sourceFileIds.length >= 2, true);
    }
  }
});

test('preview endpoint includes publish plan preview with mutation safety', async () => {
  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    publishPlan: {
      mutationAllowed: boolean;
      records: Array<{
        plannedAction: string;
        publishReady: boolean;
        profileFields: Record<string, { evidenceRefs: string[]; sourceFileIds: string[] }>;
      }>;
    };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      inputs: [
        {
          fileId: 'plan-file-1',
          fileName: 'profile.png',
          sourceFolder: '/Merlin/MealScout Intake/incoming/unknown/plan/',
          extractedText: 'Plan Tacos\nPhone: 985-999-1234\nCity: Kenner\nTacos\nQuesadilla $10.00'
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.publishPlan.mutationAllowed, false);
  assert.equal(Array.isArray(response.body.publishPlan.records), true);
  assert.equal(response.body.publishPlan.records.length >= 1, true);
  const first = response.body.publishPlan.records[0];
  assert.equal(['create_new', 'update_existing', 'blocked', 'needs_review'].includes(first.plannedAction), true);
  const anyField = Object.values(first.profileFields)[0];
  if (anyField) {
    assert.equal(Array.isArray(anyField.evidenceRefs), true);
    assert.equal(Array.isArray(anyField.sourceFileIds), true);
  }
});

test('extracts menu items with decimal prices without dollar sign', () => {
  const parsed = parseMealScoutSignalsFromText(['Chicken Adobo 10.95', 'Pork Fried 10.45'].join('\n'));
  assert.equal((parsed.extractedSignals.menuItems || []).length, 2);
  assert.equal(parsed.extractedSignals.menuItems?.[0].price, '$10.95');
});

test('menu price lines are not selected as truckName', () => {
  const parsed = parseMealScoutSignalsFromText(
    ['Al Pastor Taco - $4.25', 'Birria Taco - $5.25', 'Quesadilla - $8.00'].join('\n')
  );

  assert.equal(parsed.extractedSignals.truckName, undefined);
  assert.equal((parsed.extractedSignals.menuItems || []).length, 3);
});

test('OCR text classifies profile screenshot', () => {
  const evidence = createMealScoutEvidenceFromScreenshotInput({
    fileId: 'ocr-profile-classify',
    fileName: 'profile.png',
    sourceFolder: '/incoming/unknown',
    extractedText: 'Lettys Backyard\nPhone: 850-333-1212\nCity: East Milton, FL\nCuisine: Filipino'
  });
  assert.equal(evidence.detectedType, 'profile');
});

test('OCR text classifies menu screenshot', () => {
  const evidence = createMealScoutEvidenceFromScreenshotInput({
    fileId: 'ocr-menu-classify',
    fileName: 'menu.png',
    sourceFolder: '/incoming/unknown',
    extractedText: 'Chicken Adobo 10.95\nPork Fried 10.45'
  });
  assert.equal(evidence.detectedType, 'menu');
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
  assert.equal(response.body.summary.draftCount <= response.body.summary.clusterCount, true);
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

test('pilot 3 existing truck evidence maps to existing candidate without duplicate draft creation', async () => {
  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    clusters: Array<{
      clusterId: string;
      files: Array<{ fileId: string; detectedType: string }>;
    }>;
    drafts: Array<{
      draftId: string;
      truckName?: string;
      mutationAllowed: boolean;
      sourceFiles: Array<{ sourceFileId: string; sourceType: 'screenshot' | 'menu' | 'logo' | 'truck_photo' | 'food_photo' | 'unknown' | 'unknown_media' }>;
      duplicateCandidates: Array<{ existingProfileId: string; reason: string; confidence: number }>;
    }>;
    summary: { clusterCount: number; draftCount: number };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      existingProfiles: [
        {
          id: 'existing-bayou-bites',
          truckName: 'Bayou Bites',
          phone: '985-201-0101',
          cityArea: 'New Orleans'
        }
      ],
      inputs: [
        {
          fileId: 'pilot-3-existing-profile',
          fileName: 'IMG_3001.PNG',
          sourceFolder: '/incoming/unknown',
          extractedText: 'Bayou Bites\nPhone: 985-201-0101\nCity: New Orleans\nCuisine: Cajun'
        },
        {
          fileId: 'pilot-3-existing-menu',
          fileName: 'IMG_3002.PNG',
          sourceFolder: '/incoming/unknown',
          extractedText: 'Bayou Bites Menu\nPhone: 985-201-0101\nShrimp Po Boy - $12.00'
        },
        {
          fileId: 'pilot-3-other-profile',
          fileName: 'IMG_3003.PNG',
          sourceFolder: '/incoming/unknown',
          extractedText: 'Orbit Tacos\nPhone: 504-333-9090\nCity: Metairie\nCuisine: Tacos'
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.summary.clusterCount, 2);
  assert.equal(response.body.summary.draftCount, 2);
  assert.equal(response.body.drafts.every((item) => item.mutationAllowed === false), true);

  const existingTruckDrafts = response.body.drafts.filter((draft) =>
    draft.duplicateCandidates.some((candidate) => candidate.existingProfileId === 'existing-bayou-bites')
  );
  assert.equal(existingTruckDrafts.length, 1);
  assert.equal(
    existingTruckDrafts[0].sourceFiles.some((file) => file.sourceFileId === 'pilot-3-existing-profile'),
    true
  );
  assert.equal(
    existingTruckDrafts[0].sourceFiles.some((file) => file.sourceFileId === 'pilot-3-existing-menu'),
    true
  );

  const unrelatedDraft = response.body.drafts.find((draft) =>
    draft.sourceFiles.some((file) => file.sourceFileId === 'pilot-3-other-profile')
  );
  assert.ok(unrelatedDraft, 'Expected unrelated truck draft');
  assert.equal(
    unrelatedDraft.duplicateCandidates.some((candidate) => candidate.existingProfileId === 'existing-bayou-bites'),
    false
  );

  // Preview pipeline remains read-only and should not expose Drive mutation actions.
  assert.equal('driveActions' in (response.body as unknown as Record<string, unknown>), false);
});

test('pilot 4 drive-style batch preview groups existing and new trucks without mutations', async () => {
  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    clusters: Array<{
      clusterId: string;
      reviewStatus: 'ready_for_draft' | 'uncertain_match' | 'missing_required' | 'duplicate_possible';
      files: Array<{ fileId: string; detectedType: string; drivePath: string }>;
    }>;
    drafts: Array<{
      draftId: string;
      truckName?: string;
      mutationAllowed: boolean;
      sourceFiles: Array<{ sourceFileId: string; sourcePath?: string; sourceType: 'screenshot' | 'menu' | 'logo' | 'truck_photo' | 'food_photo' | 'unknown' | 'unknown_media' }>;
      duplicateCandidates: Array<{ existingProfileId: string; reason: string; confidence: number }>;
    }>;
    summary: { clusterCount: number; draftCount: number };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      existingProfiles: [
        {
          id: 'existing-bayou-bites',
          truckName: 'Bayou Bites',
          phone: '985-201-0101',
          cityArea: 'New Orleans'
        }
      ],
      inputs: [
        {
          fileId: 'pilot-4-existing-profile',
          fileName: 'IMG_4001.PNG',
          drivePath: '/Merlin/MealScout Intake/incoming/unknown/IMG_4001.PNG',
          sourceFolder: '/Merlin/MealScout Intake/incoming/unknown',
          mimeType: 'image/png',
          extractedText: 'Bayou Bites\nPhone: 985-201-0101\nCity: New Orleans\nCuisine: Cajun'
        },
        {
          fileId: 'pilot-4-existing-menu',
          fileName: 'IMG_4002.PNG',
          drivePath: '/Merlin/MealScout Intake/incoming/unknown/IMG_4002.PNG',
          sourceFolder: '/Merlin/MealScout Intake/incoming/unknown',
          mimeType: 'image/png',
          extractedText: 'Bayou Bites Menu\nPhone: 985-201-0101\nShrimp Po Boy - $12.00'
        },
        {
          fileId: 'pilot-4-new-profile',
          fileName: 'IMG_4003.PNG',
          drivePath: '/Merlin/MealScout Intake/incoming/unknown/IMG_4003.PNG',
          sourceFolder: '/Merlin/MealScout Intake/incoming/unknown',
          mimeType: 'image/png',
          extractedText: 'Orbit Tacos\nPhone: 504-333-9090\nCity: Metairie\nCuisine: Tacos'
        },
        {
          fileId: 'pilot-4-new-menu',
          fileName: 'IMG_4004.PNG',
          drivePath: '/Merlin/MealScout Intake/incoming/unknown/IMG_4004.PNG',
          sourceFolder: '/Merlin/MealScout Intake/incoming/unknown',
          mimeType: 'image/png',
          extractedText: 'Orbit Tacos Menu\nPhone: 504-333-9090\nAl Pastor Taco - $4.25'
        },
        {
          fileId: 'pilot-4-orphan-logo',
          fileName: 'IMG_4005.PNG',
          drivePath: '/Merlin/MealScout Intake/incoming/unknown/IMG_4005.PNG',
          sourceFolder: '/Merlin/MealScout Intake/incoming/unknown',
          mimeType: 'image/png',
          extractedText: '',
          visualLabels: ['logo']
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.summary.clusterCount, 3);
  assert.equal(response.body.summary.draftCount, 2);
  assert.equal(response.body.drafts.every((draft) => draft.mutationAllowed === false), true);

  const existingDrafts = response.body.drafts.filter((draft) =>
    draft.duplicateCandidates.some((candidate) => candidate.existingProfileId === 'existing-bayou-bites')
  );
  assert.equal(existingDrafts.length, 1);
  assert.equal(
    existingDrafts[0].sourceFiles.some((file) => file.sourceFileId === 'pilot-4-existing-profile'),
    true
  );
  assert.equal(existingDrafts[0].sourceFiles.some((file) => file.sourceFileId === 'pilot-4-existing-menu'), true);

  const newTruckDraft = response.body.drafts.find((draft) =>
    draft.sourceFiles.some((file) => file.sourceFileId === 'pilot-4-new-profile')
  );
  assert.ok(newTruckDraft, 'Expected new truck draft');
  assert.equal(
    newTruckDraft.sourceFiles.some((file) => file.sourceFileId === 'pilot-4-new-menu'),
    true
  );
  assert.equal(
    newTruckDraft.duplicateCandidates.some((candidate) => candidate.existingProfileId === 'existing-bayou-bites'),
    false
  );

  const orphanCluster = response.body.clusters.find((cluster) =>
    cluster.files.some((file) => file.fileId === 'pilot-4-orphan-logo')
  );
  assert.ok(orphanCluster, 'Expected orphan evidence cluster');
  assert.equal(orphanCluster.reviewStatus, 'uncertain_match');
  assert.equal(orphanCluster.files.length, 1);

  assert.equal(
    response.body.clusters.some(
      (cluster) =>
        cluster.files.some((file) => file.fileId === 'pilot-4-existing-profile') &&
        cluster.files.some((file) => file.fileId === 'pilot-4-existing-menu')
    ),
    true
  );
  assert.equal(
    response.body.clusters.some(
      (cluster) =>
        cluster.files.some((file) => file.fileId === 'pilot-4-new-profile') &&
        cluster.files.some((file) => file.fileId === 'pilot-4-new-menu')
    ),
    true
  );

  const draftSourceFileIds = response.body.drafts.flatMap((draft) => draft.sourceFiles.map((file) => file.sourceFileId));
  for (const expected of [
    'pilot-4-existing-profile',
    'pilot-4-existing-menu',
    'pilot-4-new-profile',
    'pilot-4-new-menu'
  ]) {
    assert.equal(draftSourceFileIds.includes(expected), true);
  }
  assert.equal(draftSourceFileIds.includes('pilot-4-orphan-logo'), false);

  // Preview payload must not include any Drive mutation artifacts.
  const previewPayload = response.body as unknown as Record<string, unknown>;
  assert.equal('driveActions' in previewPayload, false);
  assert.equal('movedFiles' in previewPayload, false);
  assert.equal('appliedMutations' in previewPayload, false);
});

test('pilot 5 drive folder listing converts metadata into preview intake payload without mutations', async () => {
  process.env.MERLIN_DRIVE_MODE = 'oauth';
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
  process.env.MERLIN_DRIVE_SYNC_MODE = 'manual';
  process.env.GOOGLE_CLIENT_ID = 'test-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';

  let moveInvocations = 0;
  const client: DriveClient = {
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'drive-existing-profile',
          file_name: 'IMG_5001.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/5001',
          modified_time: '2026-05-28T12:00:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin/MealScout Intake/incoming/unknown',
            extracted_text: 'Bayou Bites\nPhone: 985-201-0101\nCity: New Orleans\nCuisine: Cajun'
          }
        },
        {
          drive_file_id: 'drive-existing-menu',
          file_name: 'IMG_5002.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/5002',
          modified_time: '2026-05-28T12:01:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin/MealScout Intake/incoming/unknown',
            extracted_text: 'Bayou Bites Menu\nPhone: 985-201-0101\nShrimp Po Boy - $12.00'
          }
        },
        {
          drive_file_id: 'drive-new-profile',
          file_name: 'IMG_5003.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/5003',
          modified_time: '2026-05-28T12:02:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin/MealScout Intake/incoming/unknown',
            extracted_text: 'Orbit Tacos\nPhone: 504-333-9090\nCity: Metairie\nCuisine: Tacos'
          }
        },
        {
          drive_file_id: 'drive-new-menu',
          file_name: 'IMG_5004.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/5004',
          modified_time: '2026-05-28T12:03:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin/MealScout Intake/incoming/unknown',
            extracted_text: 'Orbit Tacos Menu\nPhone: 504-333-9090\nAl Pastor Taco - $4.25'
          }
        },
        {
          drive_file_id: 'drive-orphan-logo',
          file_name: 'IMG_5005.PNG',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/5005',
          modified_time: '2026-05-28T12:04:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin/MealScout Intake/incoming/unknown',
            visual_labels: ['logo']
          }
        },
        {
          drive_file_id: 'drive-unsupported',
          file_name: 'notes.txt',
          mime_type: 'text/plain',
          folder_id: folderId,
          web_url: 'https://example.com/5006',
          modified_time: '2026-05-28T12:05:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin/MealScout Intake/incoming/unknown',
            extracted_text: 'irrelevant'
          }
        }
      ];
    },
    async getFileMetadata() {
      throw new Error('not used');
    },
    async downloadFileContent() {
      return undefined;
    },
    async moveFileToFolder() {
      moveInvocations += 1;
      return true;
    },
    async findFolderByName() {
      return undefined;
    },
    async listFoldersByName(name: string, parentId: string) {
      if (parentId === 'root' && name === 'Merlin OR Storage') return [{ id: 'folder-merlin-storage', name }];
      if (parentId === 'folder-merlin-storage' && name === 'MealScout Intake') return [{ id: 'folder-intake', name }];
      if (parentId === 'folder-intake' && name === 'incoming') return [{ id: 'folder-incoming', name }];
      if (parentId === 'folder-incoming' && name === 'unknown') return [{ id: 'folder-intake-unknown', name }];
      return [];
    },
    async createFolderIfMissing() {
      throw new Error('createFolderIfMissing must not be called in read-only preview');
    }
  };
  setDriveClientFactory(() => client);

  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    driveSource?: { folderId: string; listedCount: number; filteredOutCount: number; folderSource: 'provided' | 'discovered' };
    evidenceFiles: Array<{ fileId: string; fileName: string; sourceFolder: string; drivePath: string }>;
    clusters: Array<{
      reviewStatus: 'ready_for_draft' | 'uncertain_match' | 'missing_required' | 'duplicate_possible';
      files: Array<{ fileId: string }>;
    }>;
    drafts: Array<{
      mutationAllowed: boolean;
      duplicateCandidates: Array<{ existingProfileId: string }>;
      sourceFiles: Array<{ sourceFileId: string; sourcePath?: string }>;
    }>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      loadFromDriveFolder: true,
      existingProfiles: [
        {
          id: 'existing-bayou-bites',
          truckName: 'Bayou Bites',
          phone: '985-201-0101',
          cityArea: 'New Orleans'
        }
      ]
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.driveSource?.folderId, 'folder-intake-unknown');
  assert.equal(response.body.driveSource?.folderSource, 'discovered');
  assert.equal(response.body.driveSource?.listedCount, 6);
  assert.equal(response.body.driveSource?.filteredOutCount, 1);

  const evidenceFileIds = response.body.evidenceFiles.map((item) => item.fileId);
  assert.equal(evidenceFileIds.includes('drive-unsupported'), false);
  for (const expected of ['drive-existing-profile', 'drive-existing-menu', 'drive-new-profile', 'drive-new-menu', 'drive-orphan-logo']) {
    assert.equal(evidenceFileIds.includes(expected), true);
  }

  const existingDraft = response.body.drafts.find((draft) =>
    draft.sourceFiles.some((file) => file.sourceFileId === 'drive-existing-profile')
  );
  assert.ok(existingDraft, 'Expected existing truck draft');
  assert.equal(
    existingDraft.duplicateCandidates.some((candidate) => candidate.existingProfileId === 'existing-bayou-bites'),
    true
  );

  const newDraft = response.body.drafts.find((draft) =>
    draft.sourceFiles.some((file) => file.sourceFileId === 'drive-new-profile')
  );
  assert.ok(newDraft, 'Expected new truck draft');
  assert.equal(
    newDraft.duplicateCandidates.some((candidate) => candidate.existingProfileId === 'existing-bayou-bites'),
    false
  );

  const orphanCluster = response.body.clusters.find((cluster) =>
    cluster.files.some((file) => file.fileId === 'drive-orphan-logo')
  );
  assert.ok(orphanCluster, 'Expected orphan evidence cluster');
  assert.equal(orphanCluster.reviewStatus, 'uncertain_match');
  assert.equal(response.body.drafts.every((draft) => draft.mutationAllowed === false), true);
  assert.equal(moveInvocations, 0);

  const previewPayload = response.body as unknown as Record<string, unknown>;
  assert.equal('driveActions' in previewPayload, false);
  assert.equal('movedFiles' in previewPayload, false);
  assert.equal('appliedMutations' in previewPayload, false);
});

test('pilot 6 preview route returns safe unavailable error and performs no Drive mutations', async () => {
  process.env.MERLIN_DRIVE_MODE = 'oauth';
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
  process.env.MERLIN_DRIVE_SYNC_MODE = 'manual';
  process.env.MERLIN_DRIVE_ROOT_FOLDER_NAME = 'Merlin OR Storage';
  process.env.GOOGLE_CLIENT_ID = 'test-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';

  let createInvocations = 0;
  let moveInvocations = 0;
  const client: DriveClient = {
    async listFilesInFolder() {
      return [];
    },
    async getFileMetadata() {
      throw new Error('not used');
    },
    async downloadFileContent() {
      return undefined;
    },
    async moveFileToFolder() {
      moveInvocations += 1;
      return true;
    },
    async findFolderByName() {
      return undefined;
    },
    async listFoldersByName() {
      return [];
    },
    async createFolderIfMissing() {
      createInvocations += 1;
      throw new Error('createFolderIfMissing must not be called in preview read-only mode');
    }
  };
  setDriveClientFactory(() => client);

  const response = await requestJson<{
    error: string;
    mutationAllowed: boolean;
    diagnostic?: {
      expectedPath: string;
      rootPath: string;
      intakePath: string;
      missingPaths: string[];
      discoveryStatus: string;
      discoveryReason?: string;
    };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      loadFromDriveFolder: true
    })
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.includes('unavailable'), true);
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.diagnostic?.expectedPath, 'Merlin OR Storage/MealScout Intake/incoming/unknown');
  assert.equal(response.body.diagnostic?.rootPath, 'Merlin OR Storage');
  assert.equal(Array.isArray(response.body.diagnostic?.missingPaths), true);
  assert.equal((response.body.diagnostic?.missingPaths || []).length > 0, true);
  assert.equal(createInvocations, 0);
  assert.equal(moveInvocations, 0);
});

test('pilot 6 preview route returns empty preview payload when Drive folder resolves but has no files', async () => {
  process.env.MERLIN_DRIVE_MODE = 'oauth';
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
  process.env.MERLIN_DRIVE_SYNC_MODE = 'manual';
  process.env.MERLIN_DRIVE_ROOT_FOLDER_NAME = 'Merlin OR Storage';
  process.env.GOOGLE_CLIENT_ID = 'test-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';

  let moveInvocations = 0;
  const client: DriveClient = {
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [];
    },
    async getFileMetadata() {
      throw new Error('not used');
    },
    async downloadFileContent() {
      return undefined;
    },
    async moveFileToFolder() {
      moveInvocations += 1;
      return true;
    },
    async findFolderByName() {
      return undefined;
    },
    async listFoldersByName(name: string, parentId: string) {
      if (parentId === 'root' && name === 'Merlin OR Storage') return [{ id: 'folder-merlin-storage', name }];
      if (parentId === 'folder-merlin-storage' && name === 'MealScout Intake') return [{ id: 'folder-intake', name }];
      if (parentId === 'folder-intake' && name === 'incoming') return [{ id: 'folder-incoming', name }];
      if (parentId === 'folder-incoming' && name === 'unknown') return [{ id: 'folder-intake-unknown', name }];
      return [];
    },
    async createFolderIfMissing() {
      throw new Error('createFolderIfMissing must not be called in preview read-only mode');
    }
  };
  setDriveClientFactory(() => client);

  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    driveSource?: { folderId: string; listedCount: number; filteredOutCount: number };
    evidenceFiles: unknown[];
    clusters: unknown[];
    drafts: unknown[];
    summary: { inputs: number; evidenceCount: number; clusterCount: number; draftCount: number };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      loadFromDriveFolder: true
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.driveSource?.folderId, 'folder-intake-unknown');
  assert.equal(response.body.summary.inputs, 0);
  assert.equal(response.body.summary.evidenceCount, 0);
  assert.equal(response.body.summary.clusterCount, 0);
  assert.equal(response.body.summary.draftCount, 0);
  assert.equal(response.body.evidenceFiles.length, 0);
  assert.equal(response.body.clusters.length, 0);
  assert.equal(response.body.drafts.length, 0);
  assert.equal(moveInvocations, 0);
});

test('pilot 7 preview uses Drive-extracted text when metadata text is absent', async () => {
  process.env.MERLIN_DRIVE_MODE = 'oauth';
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
  process.env.MERLIN_DRIVE_SYNC_MODE = 'manual';
  process.env.MERLIN_DRIVE_ROOT_FOLDER_NAME = 'Merlin OR Storage';
  process.env.GOOGLE_CLIENT_ID = 'test-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';

  const texts = new Map<string, string>([
    ['ocr-profile', 'Orbit Tacos\nPhone: 504-333-9090\nCity: Metairie\nCuisine: Tacos'],
    ['ocr-menu', 'Orbit Tacos Menu\nPhone: 504-333-9090\nAl Pastor Taco - $4.25']
  ]);

  const client: DriveClient = {
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'ocr-profile',
          file_name: 'new-truck-profile-01.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/profile',
          modified_time: '2026-05-28T12:00:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown'
          }
        },
        {
          drive_file_id: 'ocr-menu',
          file_name: 'new-truck-menu-01.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/menu',
          modified_time: '2026-05-28T12:01:00.000Z',
          raw_metadata: {
            folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown'
          }
        }
      ];
    },
    async getFileMetadata() {
      throw new Error('not used');
    },
    async downloadFileContent(fileId: string) {
      return texts.get(fileId);
    },
    async moveFileToFolder() {
      throw new Error('moveFileToFolder must not be called');
    },
    async findFolderByName() {
      return undefined;
    },
    async listFoldersByName(name: string, parentId: string) {
      if (parentId === 'root' && name === 'Merlin OR Storage') return [{ id: 'folder-merlin-storage', name }];
      if (parentId === 'folder-merlin-storage' && name === 'MealScout Intake') return [{ id: 'folder-intake', name }];
      if (parentId === 'folder-intake' && name === 'incoming') return [{ id: 'folder-incoming', name }];
      if (parentId === 'folder-incoming' && name === 'unknown') return [{ id: 'folder-intake-unknown', name }];
      return [];
    },
    async createFolderIfMissing() {
      throw new Error('createFolderIfMissing must not be called');
    }
  };
  setDriveClientFactory(() => client);

  const response = await requestJson<{
    status: string;
    evidenceFiles: Array<{ fileId: string; detectedType: string }>;
    clusters: Array<{ files: Array<{ fileId: string }> }>;
    drafts: Array<{ sourceFiles: Array<{ sourceFileId: string }> }>;
    summary: { evidenceCount: number; clusterCount: number; draftCount: number };
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({
      loadFromDriveFolder: true
    })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.summary.evidenceCount, 2);
  assert.equal(response.body.summary.clusterCount, 1);
  assert.equal(response.body.summary.draftCount, 1);
  assert.equal(response.body.evidenceFiles.some((file) => file.detectedType !== 'unknown'), true);
  assert.equal(
    response.body.drafts[0].sourceFiles.some((file) => file.sourceFileId === 'ocr-profile'),
    true
  );
  assert.equal(
    response.body.drafts[0].sourceFiles.some((file) => file.sourceFileId === 'ocr-menu'),
    true
  );
});

test('preview OCR diagnostics are omitted by default', async () => {
  process.env.MERLIN_DRIVE_MODE = 'oauth';
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
  process.env.MERLIN_DRIVE_SYNC_MODE = 'manual';
  process.env.MERLIN_DRIVE_ROOT_FOLDER_NAME = 'Merlin OR Storage';
  process.env.GOOGLE_CLIENT_ID = 'test-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';

  const client: DriveClient = {
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'diag-default-1',
          file_name: 'diag-default-1.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/default',
          modified_time: '2026-05-29T01:00:00.000Z',
          raw_metadata: { folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown' }
        }
      ];
    },
    async getFileMetadata() {
      throw new Error('not used');
    },
    async downloadFileContent() {
      return 'Orbit Tacos\nPhone: 504-333-9090';
    },
    async moveFileToFolder() {
      throw new Error('moveFileToFolder must not be called');
    },
    async findFolderByName() {
      return undefined;
    },
    async listFoldersByName(name: string, parentId: string) {
      if (parentId === 'root' && name === 'Merlin OR Storage') return [{ id: 'folder-merlin-storage', name }];
      if (parentId === 'folder-merlin-storage' && name === 'MealScout Intake') return [{ id: 'folder-intake', name }];
      if (parentId === 'folder-intake' && name === 'incoming') return [{ id: 'folder-incoming', name }];
      if (parentId === 'folder-incoming' && name === 'unknown') return [{ id: 'folder-intake-unknown', name }];
      return [];
    },
    async createFolderIfMissing() {
      throw new Error('createFolderIfMissing must not be called');
    }
  };
  setDriveClientFactory(() => client);

  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    debugOcr?: unknown;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({ loadFromDriveFolder: true })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal('debugOcr' in response.body, false);
});

test('preview OCR diagnostics appear only with includeDebugOcr true', async () => {
  process.env.MERLIN_DRIVE_MODE = 'oauth';
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
  process.env.MERLIN_DRIVE_SYNC_MODE = 'manual';
  process.env.MERLIN_DRIVE_ROOT_FOLDER_NAME = 'Merlin OR Storage';
  process.env.GOOGLE_CLIENT_ID = 'test-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';

  const client: DriveClient = {
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'diag-optin-1',
          file_name: 'diag-optin-1.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/optin',
          modified_time: '2026-05-29T01:30:00.000Z',
          raw_metadata: { folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown' }
        }
      ];
    },
    async getFileMetadata() {
      throw new Error('not used');
    },
    async downloadFileContent() {
      return 'Orbit Tacos\nPhone: 504-333-9090\nCity: Metairie\nAl Pastor Taco - $4.25';
    },
    async moveFileToFolder() {
      throw new Error('moveFileToFolder must not be called');
    },
    async findFolderByName() {
      return undefined;
    },
    async listFoldersByName(name: string, parentId: string) {
      if (parentId === 'root' && name === 'Merlin OR Storage') return [{ id: 'folder-merlin-storage', name }];
      if (parentId === 'folder-merlin-storage' && name === 'MealScout Intake') return [{ id: 'folder-intake', name }];
      if (parentId === 'folder-intake' && name === 'incoming') return [{ id: 'folder-incoming', name }];
      if (parentId === 'folder-incoming' && name === 'unknown') return [{ id: 'folder-intake-unknown', name }];
      return [];
    },
    async createFolderIfMissing() {
      throw new Error('createFolderIfMissing must not be called');
    }
  };
  setDriveClientFactory(() => client);

  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    debugOcr?: Array<{
      fileId: string;
      name: string;
      mimeType: string;
      byteLength: number;
      downloadAttempted: boolean;
      downloadSucceeded: boolean;
      downloadError?: string;
      downloadSource: string;
      detectedEngineCandidates: Array<{ engine: string; status: string }>;
      selectedEngine: string;
      ocrAttempted: boolean;
      ocrSucceeded: boolean;
      extractedTextLength: number;
      extractedTextSnippet: string;
      classification: { detectedType: string };
      detectedSignals: {
        truckName?: string;
        menuItemCount: number;
        contactSignals: string[];
        priceSignals: string[];
        socialSignals: string[];
      };
    }>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({ loadFromDriveFolder: true, includeDebugOcr: true })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(Array.isArray(response.body.debugOcr), true);
  assert.equal(response.body.debugOcr?.length, 1);
  assert.equal(response.body.debugOcr?.[0].fileId, 'diag-optin-1');
  assert.equal(Array.isArray(response.body.debugOcr?.[0].detectedEngineCandidates), true);
  assert.equal(typeof response.body.debugOcr?.[0].selectedEngine, 'string');
  assert.equal(typeof response.body.debugOcr?.[0].downloadAttempted, 'boolean');
  assert.equal(typeof response.body.debugOcr?.[0].downloadSucceeded, 'boolean');
  assert.equal(typeof response.body.debugOcr?.[0].ocrAttempted, 'boolean');
  assert.equal(response.body.debugOcr?.[0].ocrSucceeded, true);
  assert.equal((response.body.debugOcr?.[0].extractedTextLength || 0) > 0, true);
  assert.equal((response.body.debugOcr?.[0].detectedSignals.menuItemCount || 0) > 0, true);
  assert.equal(response.body.debugOcr?.[0].detectedSignals.contactSignals.includes('phone'), true);
  assert.equal(response.body.debugOcr?.[0].detectedSignals.priceSignals.length > 0, true);
});

test('preview OCR diagnostics cap snippet length and include no mutation artifacts', async () => {
  process.env.MERLIN_DRIVE_MODE = 'oauth';
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
  process.env.MERLIN_DRIVE_SYNC_MODE = 'manual';
  process.env.MERLIN_DRIVE_ROOT_FOLDER_NAME = 'Merlin OR Storage';
  process.env.GOOGLE_CLIENT_ID = 'test-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';

  const longText = `Truck Name ${'A'.repeat(500)}`;
  const client: DriveClient = {
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'diag-cap-1',
          file_name: 'diag-cap-1.png',
          mime_type: 'image/png',
          folder_id: folderId,
          web_url: 'https://example.com/cap',
          modified_time: '2026-05-29T02:00:00.000Z',
          raw_metadata: { folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown' }
        }
      ];
    },
    async getFileMetadata() {
      throw new Error('not used');
    },
    async downloadFileContent() {
      return longText;
    },
    async moveFileToFolder() {
      throw new Error('moveFileToFolder must not be called');
    },
    async findFolderByName() {
      return undefined;
    },
    async listFoldersByName(name: string, parentId: string) {
      if (parentId === 'root' && name === 'Merlin OR Storage') return [{ id: 'folder-merlin-storage', name }];
      if (parentId === 'folder-merlin-storage' && name === 'MealScout Intake') return [{ id: 'folder-intake', name }];
      if (parentId === 'folder-intake' && name === 'incoming') return [{ id: 'folder-incoming', name }];
      if (parentId === 'folder-incoming' && name === 'unknown') return [{ id: 'folder-intake-unknown', name }];
      return [];
    },
    async createFolderIfMissing() {
      throw new Error('createFolderIfMissing must not be called');
    }
  };
  setDriveClientFactory(() => client);

  const response = await requestJson<{
    status: string;
    mutationAllowed: boolean;
    debugOcr: Array<{ extractedTextSnippet: string; extractedTextLength: number } & Record<string, unknown>>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({ loadFromDriveFolder: true, includeDebugOcr: true })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.mutationAllowed, false);
  assert.equal(response.body.debugOcr.length, 1);
  assert.equal(response.body.debugOcr[0].extractedTextLength, longText.trim().length);
  assert.equal(response.body.debugOcr[0].extractedTextSnippet.length <= 300, true);
  assert.equal('moveAction' in response.body.debugOcr[0], false);
  assert.equal('targetFolderId' in response.body.debugOcr[0], false);
  assert.equal('rawConfig' in response.body.debugOcr[0], false);
});

test('preview OCR diagnostics include safe download and engine diagnostics fields', async () => {
  process.env.MERLIN_DRIVE_MODE = 'oauth';
  process.env.MERLIN_DRIVE_SYNC_ENABLED = 'true';
  process.env.MERLIN_DRIVE_SYNC_MODE = 'manual';
  process.env.MERLIN_DRIVE_ROOT_FOLDER_NAME = 'Merlin OR Storage';
  process.env.GOOGLE_CLIENT_ID = 'test-id';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3000/callback';
  process.env.GOOGLE_REFRESH_TOKEN = 'refresh-token';

  const client: DriveClient = {
    async listFilesInFolder(folderId: string) {
      assert.equal(folderId, 'folder-intake-unknown');
      return [
        {
          drive_file_id: 'diag-engine-missing',
          file_name: 'diag-engine-missing.jpg',
          mime_type: 'image/jpeg',
          folder_id: folderId,
          web_url: 'https://example.com/engine',
          modified_time: '2026-05-29T03:00:00.000Z',
          raw_metadata: { folder_path: '/Merlin OR Storage/MealScout Intake/incoming/unknown' }
        }
      ];
    },
    async getFileMetadata() {
      throw new Error('not used');
    },
    async downloadFileContent() {
      return undefined;
    },
    async moveFileToFolder() {
      throw new Error('moveFileToFolder must not be called');
    },
    async findFolderByName() {
      return undefined;
    },
    async listFoldersByName(name: string, parentId: string) {
      if (parentId === 'root' && name === 'Merlin OR Storage') return [{ id: 'folder-merlin-storage', name }];
      if (parentId === 'folder-merlin-storage' && name === 'MealScout Intake') return [{ id: 'folder-intake', name }];
      if (parentId === 'folder-intake' && name === 'incoming') return [{ id: 'folder-incoming', name }];
      if (parentId === 'folder-incoming' && name === 'unknown') return [{ id: 'folder-intake-unknown', name }];
      return [];
    },
    async createFolderIfMissing() {
      throw new Error('createFolderIfMissing must not be called');
    }
  };
  setDriveClientFactory(() => client);

  const response = await requestJson<{
    debugOcr: Array<{
      extractionError?: string;
      selectedEngine: string;
      detectedEngineCandidates: Array<{ status: string }>;
      downloadAttempted: boolean;
      downloadSucceeded: boolean;
      downloadError?: string;
      ocrAttempted: boolean;
    }>;
  }>('/api/mealscout/intake/preview', {
    method: 'POST',
    body: JSON.stringify({ loadFromDriveFolder: true, includeDebugOcr: true })
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.debugOcr.length, 1);
  assert.equal(response.body.debugOcr[0].downloadAttempted, true);
  assert.equal(typeof response.body.debugOcr[0].downloadSucceeded, 'boolean');
  assert.equal(typeof response.body.debugOcr[0].selectedEngine, 'string');
  assert.equal(typeof response.body.debugOcr[0].ocrAttempted, 'boolean');
  assert.equal(response.body.debugOcr[0].detectedEngineCandidates.length > 0, true);
});

