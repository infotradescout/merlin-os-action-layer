import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const {
  buildMealScoutProfileDraft,
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
  assert.equal(draft.missingFields.length, 0);
  assert.equal(draft.menu.length, 1);
  assert.equal(draft.menu[0].sourceFileId, 'file-1');
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
  assert.equal(draft.reviewStatus, 'duplicate_possible');
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
