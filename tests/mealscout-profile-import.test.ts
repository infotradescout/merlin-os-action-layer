import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const {
  buildMealScoutProfileDraft,
  buildMealScoutDraftsFromClusters,
  buildMealScoutMergeAssist,
  resetMealScoutProfileImportForTest,
  seedMealScoutTruck,
  publishMealScoutDraft
} = await import('../src/mealscoutProfileImport.ts');

beforeEach(() => {
  resetMealScoutProfileImportForTest();
});

test('creates draft from complete extracted signal', () => {
  const draft = buildMealScoutProfileDraft([
    {
      sourceFileId: 'file-1',
      sourceType: 'screenshot',
      truckName: 'Bayou Bites',
      phone: '985-222-1111',
      cityArea: 'New Orleans',
      cuisine: 'Cajun',
      menuItems: [{ name: 'Shrimp Po Boy', price: '$12.00' }],
      socials: { instagram: '@bayoubites' },
      website: 'https://bayoubites.example'
    }
  ]);

  assert.equal(draft.reviewStatus, 'ready_for_review');
  assert.equal(draft.draftType, 'create_new');
  assert.equal(draft.missingFields.length, 0);
  assert.equal(draft.menu.length, 1);
  assert.equal(draft.menu[0].sourceFileId, 'file-1');
  assert.equal(draft.extractedFieldEvidence.truckName?.sourceFileId, 'file-1');
  assert.equal(draft.extractedFieldEvidence.menuItems?.length, 1);
});

test('flags missing required fields', () => {
  const draft = buildMealScoutProfileDraft([
    {
      sourceFileId: 'file-2',
      sourceType: 'screenshot',
      truckName: 'Missing Menu Truck'
    }
  ]);

  assert.equal(draft.reviewStatus, 'missing_required');
  assert.equal(draft.missingFields.includes('phone_or_email'), true);
  assert.equal(draft.missingFields.includes('cityArea'), true);
  assert.equal(draft.missingFields.includes('cuisine'), true);
  assert.equal(draft.missingFields.includes('menu'), true);
});

test('allows menuDeferred when menu is missing', () => {
  const draft = buildMealScoutProfileDraft([
    {
      sourceFileId: 'file-3',
      sourceType: 'screenshot',
      truckName: 'Deferred Menu Truck',
      phone: '985-333-1111',
      cityArea: 'Baton Rouge',
      cuisine: 'BBQ',
      menuDeferred: true
    }
  ]);

  assert.equal(draft.missingFields.includes('menu'), false);
  assert.equal(draft.reviewStatus, 'ready_for_review');
});

test('adds source evidence to draft and menu items', () => {
  const draft = buildMealScoutProfileDraft([
    {
      sourceFileId: 'menu-1',
      sourcePath: 'incoming/menus/menu-1.png',
      sourceType: 'menu',
      menuItems: [{ name: 'Fish Taco', price: '$5.50' }]
    },
    {
      sourceFileId: 'profile-1',
      sourcePath: 'incoming/screenshots/profile-1.png',
      sourceType: 'screenshot',
      truckName: 'Sea Wheels',
      email: 'hello@seawheels.example',
      cityArea: 'Metairie',
      cuisine: 'Seafood',
      menuDeferred: true
    }
  ]);

  assert.equal(draft.sourceFiles.length, 2);
  assert.equal(draft.sourceFiles.some((item) => item.sourceFileId === 'menu-1'), true);
  assert.equal(draft.menu[0].sourceFileId, 'menu-1');
});

test('detects duplicate by phone email social website', () => {
  const existing = {
    id: 'existing-1',
    truckName: 'Nola Wraps',
    phone: '985-444-2222',
    email: 'owner@nola-wraps.example',
    website: 'https://nola-wraps.example',
    cityArea: 'New Orleans',
    socials: { instagram: '@nolawraps' }
  };

  const draft = buildMealScoutProfileDraft(
    [
      {
        sourceFileId: 'file-4',
        sourceType: 'screenshot',
        truckName: 'Nola Wraps',
        phone: '9854442222',
        email: 'owner@nola-wraps.example',
        website: 'https://nola-wraps.example',
        socials: { instagram: '@nolawraps' },
        cityArea: 'New Orleans',
        cuisine: 'Wraps',
        menuItems: [{ name: 'Chicken Wrap' }]
      }
    ],
    [existing]
  );

  assert.equal(draft.duplicateCandidates.length > 0, true);
  assert.equal(draft.reviewStatus, 'duplicate_possible');
  assert.equal(draft.draftType, 'update_existing');
  assert.equal(draft.existingTruckId, 'existing-1');
  assert.equal(draft.duplicateCandidates[0].existingProfileId, 'existing-1');
});

test('detects duplicate by similar name and same city', () => {
  const draft = buildMealScoutProfileDraft(
    [
      {
        sourceFileId: 'file-5',
        sourceType: 'screenshot',
        truckName: 'Big Mike Taco Truck',
        phone: '985-999-0000',
        cityArea: 'New Orleans',
        cuisine: 'Mexican',
        menuItems: [{ name: 'Brisket Taco' }]
      }
    ],
    [
      {
        id: 'existing-2',
        truckName: "Big Mike's Taco Truck",
        cityArea: 'New Orleans'
      }
    ]
  );

  assert.equal(draft.duplicateCandidates.length, 1);
  assert.equal(draft.reviewStatus, 'uncertain_match');
  assert.equal(draft.draftType, 'uncertain_match');
});

test('review status priority favors missing_required over duplicate_possible', () => {
  const draft = buildMealScoutProfileDraft(
    [
      {
        sourceFileId: 'file-6',
        sourceType: 'screenshot',
        truckName: 'Priority Test',
        phone: '985-111-0000'
      }
    ],
    [
      {
        id: 'existing-3',
        truckName: 'Priority Test',
        phone: '9851110000'
      }
    ]
  );

  assert.equal(draft.duplicateCandidates.length > 0, true);
  assert.equal(draft.missingFields.length > 0, true);
  assert.equal(draft.reviewStatus, 'missing_required');
});

test('ambiguous top matches stay uncertain_match', () => {
  const draft = buildMealScoutProfileDraft(
    [
      {
        sourceFileId: 'file-ambiguous',
        sourceType: 'screenshot',
        truckName: 'Taco Orbit',
        phone: '985-111-2222',
        cityArea: 'Kenner',
        cuisine: 'Mexican',
        menuItems: [{ name: 'Taco' }]
      }
    ],
    [
      { id: 'existing-a', truckName: 'Taco Orbit', phone: '9851112222' },
      { id: 'existing-b', truckName: 'Taco Orbit', phone: '9851112222' }
    ]
  );

  assert.equal(draft.draftType, 'uncertain_match');
  assert.equal(draft.reviewStatus, 'uncertain_match');
});

test('sets mutationAllowed false', () => {
  const draft = buildMealScoutProfileDraft([
    {
      sourceFileId: 'file-7',
      sourceType: 'screenshot',
      truckName: 'No Mutation Truck',
      phone: '985-100-2000',
      cityArea: 'Kenner',
      cuisine: 'Fusion',
      menuItems: [{ name: 'Fusion Bowl' }]
    }
  ]);

  assert.equal(draft.mutationAllowed, false);
});

test('does not expose publish mutate behavior', () => {
  seedMealScoutTruck({ truckName: 'Existing', phone: '985-777-0000' });
  const published = publishMealScoutDraft('any-draft-id');
  assert.equal(published, undefined);
});

test('can build drafts from evidence clusters without mutating profiles', () => {
  const drafts = buildMealScoutDraftsFromClusters([
    {
      clusterId: 'cluster-1',
      likelyTruckName: 'Cluster Truck',
      confidence: 0.8,
      matchSignals: ['phone_match'],
      reviewStatus: 'ready_for_draft',
      files: [
        {
          fileId: 'f1',
          fileName: 'x.png',
          drivePath: '/incoming/unknown/x.png',
          sourceFolder: '/incoming/unknown',
          detectedType: 'profile_screenshot',
          confidence: 0.8,
          extractedSignals: {
            truckName: 'Cluster Truck',
            phone: '985-222-9999',
            cityArea: 'New Orleans',
            cuisine: 'Cajun',
            menuItems: [{ name: 'Po Boy' }]
          }
        }
      ]
    }
  ]);

  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].mutationAllowed, false);
  assert.equal(drafts[0].reviewStatus, 'ready_for_review');
});

test('merge assist recommends merge for same phone', () => {
  const left = buildMealScoutProfileDraft([
    {
      sourceFileId: 'left-file',
      sourcePath: '/incoming/unknown/left.png',
      sourceType: 'screenshot',
      truckName: 'Bayou Wheels',
      phone: '985-555-1212',
      cityArea: 'New Orleans',
      cuisine: 'Cajun',
      menuItems: [{ name: 'Po Boy' }]
    }
  ]);
  const right = buildMealScoutProfileDraft([
    {
      sourceFileId: 'right-file',
      sourcePath: '/incoming/unknown/right.png',
      sourceType: 'menu',
      truckName: 'Bayou Wheels Catering',
      phone: '(985)555-1212',
      cityArea: 'New Orleans',
      cuisine: 'Cajun',
      menuItems: [{ name: 'Jambalaya' }]
    }
  ]);

  const assist = buildMealScoutMergeAssist([left, right]);
  assert.equal(assist.candidateGroups.length, 1);
  assert.equal(assist.candidateGroups[0].recommendation, 'merge_recommended');
  assert.equal(assist.candidateGroups[0].reasons.some((reason) => reason.type === 'same_phone'), true);
});

test('merge assist recommends merge for same email', () => {
  const left = buildMealScoutProfileDraft([
    {
      sourceFileId: 'left-email-file',
      sourceType: 'screenshot',
      truckName: 'Crescent Crave',
      email: 'hello@crescent.example',
      phone: '985-000-1234',
      cityArea: 'Kenner',
      cuisine: 'Fusion',
      menuItems: [{ name: 'Wrap' }]
    }
  ]);
  const right = buildMealScoutProfileDraft([
    {
      sourceFileId: 'right-email-file',
      sourceType: 'screenshot',
      truckName: 'Crescent Crave Truck',
      email: 'HELLO@crescent.example',
      cityArea: 'Kenner',
      cuisine: 'Fusion',
      menuItems: [{ name: 'Burger' }]
    }
  ]);

  const assist = buildMealScoutMergeAssist([left, right]);
  assert.equal(assist.candidateGroups[0].recommendation, 'merge_recommended');
  assert.equal(assist.candidateGroups[0].reasons.some((reason) => reason.type === 'same_email'), true);
});

test('merge assist recommends merge for same social handle', () => {
  const left = buildMealScoutProfileDraft([
    {
      sourceFileId: 'left-social-file',
      sourceType: 'screenshot',
      truckName: 'Orbit Tacos',
      socials: { instagram: '@orbitrides' },
      phone: '985-000-1111',
      cityArea: 'Metairie',
      cuisine: 'Mexican',
      menuItems: [{ name: 'Taco' }]
    }
  ]);
  const right = buildMealScoutProfileDraft([
    {
      sourceFileId: 'right-social-file',
      sourceType: 'menu',
      truckName: 'Orbit Tacos NOLA',
      socials: { facebook: 'orbitrides' },
      cityArea: 'Metairie',
      cuisine: 'Mexican',
      menuItems: [{ name: 'Burrito' }]
    }
  ]);

  const assist = buildMealScoutMergeAssist([left, right]);
  assert.equal(assist.candidateGroups[0].recommendation, 'merge_recommended');
  assert.equal(assist.candidateGroups[0].reasons.some((reason) => reason.type === 'same_social'), true);
});

test('merge assist keeps similar name only as possible_match', () => {
  const left = buildMealScoutProfileDraft([
    {
      sourceFileId: 'left-name-file',
      sourcePath: '/incoming/unknown/orbit/profile-1.png',
      sourceType: 'screenshot',
      truckName: 'Big Orbit Tacos',
      cityArea: 'Kenner',
      cuisine: 'Mexican',
      menuItems: [{ name: 'Taco Plate' }]
    }
  ]);
  const right = buildMealScoutProfileDraft([
    {
      sourceFileId: 'right-name-file',
      sourcePath: '/incoming/unknown/orbit/menu-1.png',
      sourceType: 'menu',
      truckName: "Big Orbit's Tacos",
      cityArea: 'Kenner',
      cuisine: 'Mexican',
      menuItems: [{ name: 'Quesadilla' }]
    }
  ]);

  const assist = buildMealScoutMergeAssist([left, right]);
  assert.equal(assist.candidateGroups[0].recommendation, 'possible_match');
  assert.equal(assist.candidateGroups[0].reasons.some((reason) => reason.type === 'similar_name'), true);
});

test('merge assist prevents merge_recommended on conflicting phone', () => {
  const left = buildMealScoutProfileDraft([
    {
      sourceFileId: 'left-conflict-file',
      sourceType: 'screenshot',
      truckName: 'Nova Bites',
      phone: '985-100-0001',
      email: 'hello@novabites.example',
      cityArea: 'Harahan',
      cuisine: 'Fusion',
      menuItems: [{ name: 'Bowl' }]
    }
  ]);
  const right = buildMealScoutProfileDraft([
    {
      sourceFileId: 'right-conflict-file',
      sourceType: 'screenshot',
      truckName: 'Nova Bites',
      phone: '985-100-0002',
      email: 'hello@novabites.example',
      cityArea: 'Harahan',
      cuisine: 'Fusion',
      menuItems: [{ name: 'Wrap' }]
    }
  ]);

  const assist = buildMealScoutMergeAssist([left, right]);
  assert.equal(assist.candidateGroups[0].recommendation, 'keep_separate');
  assert.equal(assist.candidateGroups[0].conflicts.some((conflict) => conflict.field === 'phone'), true);
});

test('merge assist reasons preserve source file IDs', () => {
  const left = buildMealScoutProfileDraft([
    {
      sourceFileId: 'file-merge-left',
      sourceType: 'screenshot',
      truckName: 'Signal Truck',
      phone: '985-212-3434',
      cityArea: 'New Orleans',
      cuisine: 'BBQ',
      menuItems: [{ name: 'Brisket' }]
    }
  ]);
  const right = buildMealScoutProfileDraft([
    {
      sourceFileId: 'file-merge-right',
      sourceType: 'menu',
      truckName: 'Signal Truck',
      phone: '9852123434',
      cityArea: 'New Orleans',
      cuisine: 'BBQ',
      menuItems: [{ name: 'Ribs' }]
    }
  ]);

  const assist = buildMealScoutMergeAssist([left, right]);
  const reason = assist.candidateGroups[0].reasons.find((item) => item.type === 'same_phone');
  assert.ok(reason);
  assert.equal(reason.sourceFileIds.includes('file-merge-left'), true);
  assert.equal(reason.sourceFileIds.includes('file-merge-right'), true);
});
