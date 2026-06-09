import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyMealScoutMenuArtifacts,
  type MealScoutArtifactClassificationRow
} from '../src/mealscoutMenuArtifactClassification.ts';
import type { MealScoutScreenshotProcessingSourceRow } from '../src/mealscoutScreenshotProcessingValidation.ts';

const fixtureRows: MealScoutScreenshotProcessingSourceRow[] = [
  {
    row: '1',
    drive_file_id: 'evidence-comer-fuego-menu',
    final_filename: 'a & gs & @.PNG',
    business_name: 'a & gs & @',
    drive_url: 'https://drive.google.com/file/d/evidence-comer-fuego-menu/view',
    filename_before_final_pass: 'IMG_001.PNG',
    ocr_snippet:
      '< Comer Fuego\n1.2K followers\nMenu\nBirria Tacos $12\nEmpanadas 8.00\nFried Oreos $5\nRamen $10\nFollow @ Message'
  },
  {
    row: '2',
    drive_file_id: 'evidence-143-pizza-menu',
    final_filename: 'Catering.PNG',
    business_name: 'Catering',
    drive_url: 'https://drive.google.com/file/d/evidence-143-pizza-menu/view',
    filename_before_final_pass: 'IMG_002.PNG',
    ocr_snippet:
      '143 Wood Fired Pizza Truck & Catering\n2K followers\nMenu\nPepperoni Pizza $14\nMargherita Pizza 12.99\nLemonade $4'
  },
  {
    row: '3',
    drive_file_id: 'evidence-breakfast-bros-profile',
    final_filename: 'are mobile and our location varies.PNG',
    business_name: 'are mobile and our location varies.',
    drive_url: 'https://drive.google.com/file/d/evidence-breakfast-bros-profile/view',
    filename_before_final_pass: 'IMG_003.PNG',
    ocr_snippet:
      'Breakfast Bros\n3.5K followers\nare mobile and our location varies.\nHours posted weekly\nPancakes $8\nCoffee $3\n850-222-1000'
  },
  {
    row: '4',
    drive_file_id: 'evidence-breakfast-bros-duplicate',
    final_filename: 'Breakfast Bros.PNG',
    business_name: 'Breakfast Bros',
    drive_url: 'https://drive.google.com/file/d/evidence-breakfast-bros-duplicate/view',
    filename_before_final_pass: 'IMG_004.PNG',
    ocr_snippet: 'Breakfast Bros\nCoffee $3\nBreakfast Plate $11\n850.222.1000'
  },
  {
    row: '5',
    drive_file_id: 'evidence-ui-menu-review',
    final_filename: 'Follow @ Message.PNG',
    business_name: 'Follow @ Message',
    drive_url: 'https://drive.google.com/file/d/evidence-ui-menu-review/view',
    filename_before_final_pass: 'IMG_005.PNG',
    ocr_snippet: 'Follow @ Message\nMenu\n$12'
  },
  {
    row: '6',
    drive_file_id: 'evidence-profile-only',
    final_filename: 'Jones Shakes Pensacola.PNG',
    business_name: 'Jones Shakes Pensacola',
    drive_url: 'https://drive.google.com/file/d/evidence-profile-only/view',
    filename_before_final_pass: 'IMG_006.PNG',
    ocr_snippet:
      'Jones Shakes Pensacola\n2.9K followers\nPage - Dessert Shop\nContact info\nstore.142893@jonesshakes.com\ninstagram.com/jonesshakes.pensacola'
  },
  {
    row: '7',
    drive_file_id: 'evidence-food-truck-profile-only',
    final_filename: 'Pensacola Dessert Food Truck.PNG',
    business_name: 'Pensacola Dessert Food Truck',
    drive_url: 'https://drive.google.com/file/d/evidence-food-truck-profile-only/view',
    filename_before_final_pass: 'IMG_007.PNG',
    ocr_snippet:
      'Pensacola Dessert Food Truck\n4K followers\nPage - Food Truck\nContact info\npensacoladesserts.example.com'
  },
  {
    row: '8',
    drive_file_id: 'evidence-mm-bbq-profile',
    final_filename: 'M&M Southern BB.PNG',
    business_name: 'M&M Southern BB',
    drive_url: 'https://drive.google.com/file/d/evidence-mm-bbq-profile/view',
    filename_before_final_pass: 'IMG_008.PNG',
    ocr_snippet:
      'M&M Southern BBQ\n1.7K followers\nPage - Food Truck\nContact info\n850-333-4444'
  }
];

function byId(rows: MealScoutArtifactClassificationRow[], driveFileId: string): MealScoutArtifactClassificationRow {
  const row = rows.find((candidate) => candidate.drive_file_id === driveFileId);
  assert.ok(row, `missing row ${driveFileId}`);
  return row;
}

test('MealScout menu artifact classifier preserves evidence and never allows mutation', () => {
  const result = classifyMealScoutMenuArtifacts(fixtureRows);

  assert.equal(result.mode, 'artifact_classification_export_only');
  assert.equal(result.mutationAllowed, false);
  assert.equal(result.source.evidenceRowCount, fixtureRows.length);
  assert.deepEqual(
    new Set(result.artifactRows.map((row) => row.drive_file_id)),
    new Set(fixtureRows.map((row) => row.drive_file_id))
  );
});

test('MealScout menu artifact classifier classifies menu-like rows separately from business rename status', () => {
  const result = classifyMealScoutMenuArtifacts(fixtureRows);
  const comer = byId(result.artifactRows, 'evidence-comer-fuego-menu');
  const pizza = byId(result.artifactRows, 'evidence-143-pizza-menu');

  assert.ok(['menu', 'possible_menu'].includes(comer.artifact_type));
  assert.equal(comer.artifact_signals.includes('profile_page'), true);
  assert.equal(pizza.artifact_type, 'menu');
});

test('MealScout menu artifact classifier extracts OCR price lines into menu item candidates', () => {
  const result = classifyMealScoutMenuArtifacts(fixtureRows);
  const comer = byId(result.artifactRows, 'evidence-comer-fuego-menu');
  const itemNames = comer.menu_items.map((item) => item.item_name);

  assert.equal(itemNames.includes('Birria Tacos'), true);
  assert.equal(itemNames.includes('Empanadas'), true);
  assert.equal(itemNames.includes('Fried Oreos'), true);
  assert.equal(itemNames.includes('Ramen'), true);
  assert.equal(comer.menu_items.some((item) => item.price === '$12'), true);
});

test('MealScout menu artifact classifier rejects generic UI strings as business names', () => {
  const result = classifyMealScoutMenuArtifacts(fixtureRows);
  const ui = byId(result.artifactRows, 'evidence-ui-menu-review');

  assert.equal(ui.linked_business_candidate, undefined);
  assert.equal(ui.warnings.includes('missing_valid_business_name'), true);
  assert.equal(result.menuCandidates.some((row) => row.drive_file_id === ui.drive_file_id), false);
  assert.equal(result.menuReviewRequired.some((row) => row.drive_file_id === ui.drive_file_id), true);
});

test('MealScout menu artifact classifier keeps Comer Fuego identity and does not accept a & gs & @', () => {
  const result = classifyMealScoutMenuArtifacts(fixtureRows);
  const comer = byId(result.artifactRows, 'evidence-comer-fuego-menu');

  assert.equal(comer.linked_business_candidate, 'Comer Fuego');
  assert.notEqual(comer.linked_business_candidate, 'a & gs & @');
  assert.equal(comer.warnings.includes('generic_sheet_business_name_ignored'), true);
});

test('MealScout menu artifact classifier does not reduce 143 Wood Fired Pizza Truck & Catering to Catering', () => {
  const result = classifyMealScoutMenuArtifacts(fixtureRows);
  const pizza = byId(result.artifactRows, 'evidence-143-pizza-menu');

  assert.equal(pizza.linked_business_candidate, '143 Wood Fired Pizza Truck & Catering');
  assert.notEqual(pizza.linked_business_candidate, 'Catering');
});

test('MealScout menu artifact classifier recovers Breakfast Bros and treats mobile location text as schedule evidence', () => {
  const result = classifyMealScoutMenuArtifacts(fixtureRows);
  const breakfast = byId(result.artifactRows, 'evidence-breakfast-bros-profile');

  assert.equal(breakfast.linked_business_candidate, 'Breakfast Bros');
  assert.notEqual(breakfast.linked_business_candidate, 'are mobile and our location varies.');
  assert.equal(breakfast.artifact_signals.includes('schedule_location_hours'), true);
});

test('MealScout menu artifact classifier collapses duplicate screenshots into evidence groups', () => {
  const result = classifyMealScoutMenuArtifacts(fixtureRows);
  const duplicate = result.duplicateEvidenceGroups.find((group) =>
    group.evidence_drive_file_ids.includes('evidence-breakfast-bros-profile')
  );

  assert.ok(duplicate);
  assert.deepEqual(new Set(duplicate.evidence_drive_file_ids), new Set(['evidence-breakfast-bros-profile', 'evidence-breakfast-bros-duplicate']));
  assert.equal(duplicate.linked_business_candidate, 'Breakfast Bros');
});

test('MealScout menu artifact classifier sends menu extraction failures to review_required', () => {
  const result = classifyMealScoutMenuArtifacts(fixtureRows);
  const ui = byId(result.artifactRows, 'evidence-ui-menu-review');

  assert.equal(ui.warnings.includes('menu_extraction_failed'), true);
  assert.equal(result.menuReviewRequired.some((row) => row.drive_file_id === ui.drive_file_id), true);
});

test('MealScout menu artifact classifier keeps broad food-truck profile wording out of menu candidates', () => {
  const result = classifyMealScoutMenuArtifacts(fixtureRows);
  const profile = byId(result.artifactRows, 'evidence-food-truck-profile-only');

  assert.equal(profile.artifact_type, 'profile');
  assert.equal(result.menuCandidates.some((row) => row.drive_file_id === profile.drive_file_id), false);
});

test('MealScout menu artifact classifier repairs truncated BBQ business names from OCR headers', () => {
  const result = classifyMealScoutMenuArtifacts(fixtureRows);
  const barbecue = byId(result.artifactRows, 'evidence-mm-bbq-profile');

  assert.equal(barbecue.linked_business_candidate, 'M&M Southern BBQ');
  assert.equal(barbecue.warnings.includes('possible_truncated_business_name_repaired'), true);
});
