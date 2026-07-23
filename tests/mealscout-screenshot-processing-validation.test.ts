import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  validateMealScoutScreenshotProcessingRows,
  type MealScoutScreenshotProcessingSourceRow
} from '../src/mealscoutScreenshotProcessingValidation.ts';

const fixtureRows: MealScoutScreenshotProcessingSourceRow[] = [
  {
    row: '1',
    drive_file_id: 'evidence-mm-bbq',
    final_filename: 'M&M Southern BB.PNG',
    business_name: 'M&M Southern BB',
    drive_url: 'https://drive.google.com/file/d/evidence-mm-bbq/view',
    ocr_snippet:
      'M&M Southern BBQ\n21 followers\nM&M BBQ will connect your soul with aromas of a flavor filled BBQ experience.\n(863) 438-1137\nmmsouthernbbq@gmail.com\nPage - Food & Drink'
  },
  {
    row: '2',
    drive_file_id: 'evidence-jones-1',
    final_filename: 'Jones Shakes Pensacola.PNG',
    business_name: 'Jones Shakes Pensacola',
    drive_url: 'https://drive.google.com/file/d/evidence-jones-1/view',
    ocr_snippet:
      'Jones Shakes Pensacola\n2.9K followers\nA multisensory aesthetic milkshake experience.\nPage - Dessert Shop\n(850) 470-1999\nstore.142893@jonesshakes.com\ninstagram.com/jonesshakes.pensacola'
  },
  {
    row: '3',
    drive_file_id: 'evidence-jones-2',
    final_filename: 'Jones Shakes Pensacola.PNG',
    business_name: 'Jones Shakes Pensacola',
    drive_url: 'https://drive.google.com/file/d/evidence-jones-2/view',
    ocr_snippet:
      'Jones Shakes Pensacola\nFeaturing over 300 unique milkshake flavors.\nPage - Dessert Shop\n850-470-1999\nstore.142893@jonesshakes.com'
  },
  {
    row: '4',
    drive_file_id: 'evidence-acs-hvac',
    final_filename: 'Pace, FL and servicing surrounding areas.PNG',
    business_name: 'Pace, FL and servicing surrounding areas.',
    drive_url: 'https://drive.google.com/file/d/evidence-acs-hvac/view',
    ocr_snippet:
      'ACS HVAC & Construction Services, LLC\nPace, FL and servicing surrounding areas.\nHeating, Ventilating Air Conditioning Service\nacs@example.com\n850-555-1212'
  },
  {
    row: '5',
    drive_file_id: 'evidence-ui-text',
    final_filename: 'Follow @ Message.PNG',
    business_name: 'Follow @ Message',
    drive_url: 'https://drive.google.com/file/d/evidence-ui-text/view',
    ocr_snippet: 'Follow @ Message\nAll Photos Reels Mentions\nDetails\nFood Truck'
  },
  {
    row: '6',
    drive_file_id: 'evidence-neighborly',
    final_filename: 'a Neighborly company.JPG',
    business_name: 'a Neighborly company',
    drive_url: 'https://drive.google.com/file/d/evidence-neighborly/view',
    ocr_snippet: 'Five Star Painting\na Neighborly company\nHome Improvement\nPainting'
  },
  {
    row: '7',
    drive_file_id: 'evidence-taco-good',
    final_filename: 'El Camino Tacos.PNG',
    business_name: 'El Camino Tacos',
    drive_url: 'https://drive.google.com/file/d/evidence-taco-good/view',
    ocr_snippet:
      'El Camino Tacos\nA Taco Truck located behind Perfect Plain Brewing Co.\nfamily@perfectplain.com\n850.222.3333\nwww.elcaminotacos.example'
  }
];

test('MealScout screenshot processing validator preserves evidence and never allows mutation', () => {
  const result = validateMealScoutScreenshotProcessingRows(fixtureRows);

  assert.equal(result.mode, 'validation_export_only');
  assert.equal(result.mutationAllowed, false);
  assert.equal(result.source.evidenceRowCount, fixtureRows.length);
  assert.equal(result.source.uniqueEvidenceRowCount, fixtureRows.length);
  assert.deepEqual(
    new Set(result.evidenceRows.map((row) => row.driveFileId)),
    new Set(fixtureRows.map((row) => row.drive_file_id))
  );
  assert.equal(result.cleanCandidates.every((row) => row.mutationAllowed === false), true);
});

test('MealScout screenshot processing validator quarantines non-food service businesses', () => {
  const result = validateMealScoutScreenshotProcessingRows(fixtureRows);
  const acs = result.rejectedRows.find((row) => row.driveFileId === 'evidence-acs-hvac');
  const neighborly = result.rejectedRows.find((row) => row.driveFileId === 'evidence-neighborly');

  assert.ok(acs);
  assert.equal(acs.originalBusinessName, 'Pace, FL and servicing surrounding areas.');
  assert.equal(acs.reasons.some((reason) => reason.startsWith('non_food_scope:')), true);
  assert.ok(neighborly);
  assert.equal(neighborly.reasons.some((reason) => reason.startsWith('non_food_scope:')), true);
});

test('MealScout screenshot processing validator blocks suspicious UI-text names', () => {
  const result = validateMealScoutScreenshotProcessingRows(fixtureRows);
  const ui = result.manualReviewRows.find((row) => row.driveFileId === 'evidence-ui-text');

  assert.ok(ui);
  assert.equal(ui.reasons.includes('suspicious_business_name'), true);
  assert.equal(result.cleanCandidates.some((row) => row.evidenceDriveFileIds.includes('evidence-ui-text')), false);
});

test('MealScout screenshot processing validator flags M&M Southern BB truncation when OCR contains BBQ', () => {
  const result = validateMealScoutScreenshotProcessingRows(fixtureRows);
  const mm = result.manualReviewRows.find((row) => row.driveFileId === 'evidence-mm-bbq');

  assert.ok(mm);
  assert.equal(mm.reasons.includes('possible_truncated_business_name'), true);
  assert.equal(mm.suggestedBusinessName, 'M&M Southern BBQ');
});

test('MealScout screenshot processing validator collapses duplicate Jones Shakes evidence into one candidate group', () => {
  const result = validateMealScoutScreenshotProcessingRows(fixtureRows);
  const jones = result.cleanCandidates.find((row) => row.businessName === 'Jones Shakes Pensacola');
  const duplicate = result.duplicateGroups.find((row) => row.evidenceDriveFileIds.includes('evidence-jones-1'));

  assert.ok(jones);
  assert.deepEqual(new Set(jones.evidenceDriveFileIds), new Set(['evidence-jones-1', 'evidence-jones-2']));
  assert.equal(jones.contacts.phone, '850-470-1999');
  assert.equal(jones.contacts.email, 'store.142893@jonesshakes.com');
  assert.ok(duplicate);
  assert.equal(duplicate.collapsedCandidateId, jones.candidateId);
});

test('MealScout screenshot processing validator extracts normalized contact fields from OCR', () => {
  const result = validateMealScoutScreenshotProcessingRows(fixtureRows);
  const taco = result.cleanCandidates.find((row) => row.businessName === 'El Camino Tacos');

  assert.ok(taco);
  assert.equal(taco.contacts.phone, '850-222-3333');
  assert.equal(taco.contacts.email, 'family@perfectplain.com');
  assert.equal(taco.contacts.website, 'www.elcaminotacos.example');
  assert.equal(taco.categorySignals.includes('food_truck'), true);
});
